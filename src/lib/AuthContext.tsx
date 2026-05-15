import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User
} from 'firebase/auth';
import { auth, db } from './firebase';
import { collection, query, where, getDocs, onSnapshot, doc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { syncClaimsAndRefreshToken } from './syncClaims';

// Shape of a teacher document as stored in Firestore. Fields derived from
// actual consumer usage across the dashboard — extend as new fields are added.
export interface TeacherDoc {
  id: string;
  schoolId?: string;
  branchId?: string;
  email?: string;
  name?: string;
  displayName?: string;
  phone?: string;
  schoolName?: string;
  branch?: string;
  className?: string;
  assignedClass?: string;
  subject?: string;
  status?: string;
  isActive?: boolean;
  isPrimarySchool?: boolean;
  activatedAt?: Timestamp;
  createdAt?: Timestamp;
  lastLoginAt?: Timestamp;
  notifications?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AuthContextType {
  user: User | null;
  teacherData: TeacherDoc | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Skip the `lastLoginAt` write if it was updated less than this many ms ago.
// Eliminates redundant Firestore writes on tab focus / token refresh.
const LAST_LOGIN_DEBOUNCE_MS = 5 * 60 * 1000;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [teacherData, setTeacherData] = useState<TeacherDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    let snapshotUnsub: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Clean up previous snapshot listener on each auth change
      if (snapshotUnsub) { snapshotUnsub(); snapshotUnsub = null; }

      // Only show the full-screen "Checking Access" splash on first load.
      // Subsequent auth events (token refresh, etc.) shouldn't flash it.
      if (isInitialLoad.current) setLoading(true);

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
            const score = (d: Record<string, unknown>) => {
              const status = String(d.status ?? "").toLowerCase();
              if (status === "active") return 2;
              if (status === "invited") return 1;
              return 0;
            };
            const diff = score(bD) - score(aD);
            if (diff !== 0) return diff;
            const aTime = (aD.activatedAt as Timestamp | undefined)?.toMillis?.() ?? (aD.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
            const bTime = (bD.activatedAt as Timestamp | undefined)?.toMillis?.() ?? (bD.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
            return bTime - aTime;
          });
          const teacherDoc  = sortedDocs[0];
          const teacherInfo = teacherDoc.data();

          // ── Step 2: Auto-activate if status is "Invited"; otherwise refresh
          // `lastLoginAt` at most once per LAST_LOGIN_DEBOUNCE_MS window.
          // Writes are fire-and-forget so we don't block the snapshot listener
          // below — the snapshot itself will reflect the update when it lands.
          const statusLower = String(teacherInfo.status ?? "").toLowerCase();
          if (statusLower === "invited") {
            updateDoc(doc(db, "teachers", teacherDoc.id), {
              status:      "Active",
              isActive:    true,
              activatedAt: serverTimestamp(),
              lastLoginAt: serverTimestamp(),
            }).catch((e) => console.error("[Auth] activate failed", e));
          } else {
            const lastLoginMs = (teacherInfo.lastLoginAt as Timestamp | undefined)?.toMillis?.() ?? 0;
            if (Date.now() - lastLoginMs > LAST_LOGIN_DEBOUNCE_MS) {
              updateDoc(doc(db, "teachers", teacherDoc.id), {
                lastLoginAt: serverTimestamp(),
              }).catch((e) => console.error("[Auth] lastLoginAt failed", e));
            }
          }

          // ── Step 3: Real-time listener on the specific doc (not the query) ──
          // Using doc(db, "teachers", teacherDoc.id) instead of onSnapshot(q, ...) ensures
          // we always listen to the exact doc chosen above — not "first matching doc for email"
          // which can change if teacher records are reordered or a new school record is added.
          snapshotUnsub = onSnapshot(doc(db, "teachers", teacherDoc.id), (docSnap) => {
            if (docSnap.exists()) {
              setTeacherData({ id: docSnap.id, ...docSnap.data() } as TeacherDoc);
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
            isInitialLoad.current = false;
          });

        } catch (err: unknown) {
          console.error("Auth Error:", err);
          setError("An error occurred during verification. Please try again.");
          setLoading(false);
          isInitialLoad.current = false;
        }
      } else {
        setUser(null);
        setTeacherData(null);
        setLoading(false);
        isInitialLoad.current = false;
      }
    });

    return () => {
      unsubscribe();
      if (snapshotUnsub) snapshotUnsub();
    };
  }, []);

  // ── Live school-name subscription ────────────────────────────────────
  // Header reads `teacherData.schoolName`. Subscribing to schools/{schoolId}
  // as the source of truth means rename events from the principal (or any
  // other dashboard / tab) flow into the header within ~1s without
  // depending on the cascade trigger's denormalized writes catching up.
  useEffect(() => {
    const schoolId = teacherData?.schoolId;
    if (!schoolId) return;
    const unsub = onSnapshot(
      doc(db, "schools", schoolId),
      (snap) => {
        if (!snap.exists()) return;
        const liveName = String((snap.data() as { name?: string })?.name || "").trim();
        if (!liveName) return;
        setTeacherData((prev) => {
          if (!prev) return prev;
          if (prev.schoolName === liveName && (prev as { branchName?: string }).branchName === liveName) return prev;
          return { ...prev, schoolName: liveName, branchName: liveName } as TeacherDoc;
        });
      },
      (err) => console.warn("[AuthContext] live school-name listener failed:", err),
    );
    return () => unsub();
  }, [teacherData?.schoolId]);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      setError(null);
      await signInWithPopup(auth, provider);
    } catch (err: unknown) {
      // User-cancellation paths are not errors — closing the popup or starting
      // a second one is intentional. Surfacing a red banner for those would
      // make the system look broken.
      const code = (err as { code?: string } | null)?.code;
      const userCancelled =
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request" ||
        code === "auth/popup-blocked";
      if (!userCancelled) {
        const message = err instanceof Error ? err.message : "Sign-in failed. Please try again.";
        setError(message);
      }
      throw err;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (err: unknown) {
      console.error("[Auth] logout failed", err);
      setError("Could not sign out. Please try again.");
    }
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
