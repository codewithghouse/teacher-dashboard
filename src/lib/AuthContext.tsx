import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { auth, db } from './firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

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
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);
      if (currentUser && currentUser.email) {
        try {
          // Whitelist Check for Teachers
          const q = query(collection(db, "teachers"), where("email", "==", currentUser.email.toLowerCase()));
          const querySnapshot = await getDocs(q);

          if (!querySnapshot.empty) {
            // Authorized Teacher
            setTeacherData(querySnapshot.docs[0].data());
            setUser(currentUser);
            setError(null);
          } else {
            // Not in whitelist
            await signOut(auth);
            setUser(null);
            setTeacherData(null);
            setError("You are not authorized to access the Teacher Dashboard. Please contact your school principal.");
          }
        } catch (err: any) {
          console.error("Auth Error:", err);
          setError("An error occurred during verification.");
        }
      } else {
        setUser(null);
        setTeacherData(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
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
