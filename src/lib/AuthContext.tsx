import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User
} from 'firebase/auth';
import { auth, db } from './firebase';
import { collection, query, where, getDocs, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { syncClaimsAndRefreshToken } from './syncClaims';

interface AuthContextType {
  user: User | null;
  teacherData: any | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [teacherData, setTeacherData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let snapshotUnsub: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Clean up previous snapshot listener on each auth change
      if (snapshotUnsub) { snapshotUnsub(); snapshotUnsub = null; }

      setLoading(true);

      if (currentUser && currentUser.email) {
        try {
          // Sync custom claims first — the Cloud Function picks the best
          // teacher record across schools via Admin SDK and returns schoolId.
          // We filter by that schoolId so the client-side list query passes
          // the `inSameSchool()` rule.
          const synced = await syncClaimsAndRefreshToken(currentUser);
          const claimSchoolId = synced?.schoolId || null;

          const email = currentUser.email.toLowerCase();
          const q = claimSchoolId
            ? query(
                collection(db, "teachers"),
                where("schoolId", "==", claimSchoolId),
                where("email", "==", email),
              )
            : query(collection(db, "teachers"), where("email", "==", email));

          // ── Step 1: One-time fetch to verify + auto-activate ──────────────
          const snap = await getDocs(q);

          if (snap.empty) {
            // Email not whitelisted — reject immediately
            await signOut(auth);
            setUser(null);
            setTeacherData(null);
            setError("You are not authorized to access the Teacher Dashboard. Please contact your school principal.");
            setLoading(false);
            return;
          }

          // Pick the best matching teacher doc when the same email exists across multiple schools.
          // Priority order:
          //   1. isPrimarySchool flag (explicit user/principal choice)
          //   2. Status: Active > Invited > other
          //   3. Most recently activated (timestamp tiebreak)
          const sortedDocs = [...snap.docs].sort((a, b) => {
            const aD = a.data(), bD = b.data();
            const primary = (Number(!!bD.isPrimarySchool)) - (Number(!!aD.isPrimarySchool));
            if (primary !== 0) return primary;
            const score = (d: any) =>
              ["Active", "active"].includes(d.status) ? 2 :
              ["Invited", "invited"].includes(d.status) ? 1 : 0;
            const diff = score(bD) - score(aD);
            if (diff !== 0) return diff;
            const aTime = aD.activatedAt?.toMillis?.() || aD.createdAt?.toMillis?.() || 0;
            const bTime = bD.activatedAt?.toMillis?.() || bD.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });
          const teacherDoc  = sortedDocs[0];
          const teacherInfo = teacherDoc.data();

          // ── Step 2: Auto-activate if status is "Invited" ──────────────────
          if (teacherInfo.status === "Invited" || teacherInfo.status === "invited") {
            await updateDoc(doc(db, "teachers", teacherDoc.id), {
              status:      "Active",
              isActive:    true,
              activatedAt: serverTimestamp(),
              lastLoginAt: serverTimestamp(),
            });
          } else {
            // Just update last login time for Active teachers
            await updateDoc(doc(db, "teachers", teacherDoc.id), {
              lastLoginAt: serverTimestamp(),
            });
          }

          // ── Step 3: Real-time listener on the specific doc (not the query) ──
          // Using doc(db, "teachers", teacherDoc.id) instead of onSnapshot(q, ...) ensures
          // we always listen to the exact doc chosen above — not "first matching doc for email"
          // which can change if teacher records are reordered or a new school record is added.
          snapshotUnsub = onSnapshot(doc(db, "teachers", teacherDoc.id), (docSnap) => {
            if (docSnap.exists()) {
              setTeacherData({ id: docSnap.id, ...docSnap.data() });
              setUser(currentUser);
              setError(null);
            } else {
              // Doc was deleted/archived after login
              signOut(auth);
              setUser(null);
              setTeacherData(null);
              setError("Your account has been deactivated. Please contact your school principal.");
            }
            setLoading(false);
          });

        } catch (err: any) {
          console.error("Auth Error:", err);
          setError("An error occurred during verification. Please try again.");
          setLoading(false);
        }
      } else {
        setUser(null);
        setTeacherData(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (snapshotUnsub) snapshotUnsub();
    };
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      setError(null);
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, teacherData, loading, loginWithGoogle, logout, error }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
