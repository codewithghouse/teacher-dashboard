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
          const email = currentUser.email.toLowerCase();
          const q = query(collection(db, "teachers"), where("email", "==", email));

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

          const teacherDoc  = snap.docs[0];
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

          // ── Step 3: Real-time listener to keep teacherData in sync ────────
          snapshotUnsub = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
              const d = snapshot.docs[0];
              setTeacherData({ id: d.id, ...d.data() });
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
