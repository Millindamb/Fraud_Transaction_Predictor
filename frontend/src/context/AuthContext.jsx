import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('fg_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('fg_token')));

  useEffect(() => {
    if (!localStorage.getItem('fg_token')) return setLoading(false);
    authApi
      .me()
      .then((u) => {
        setUser(u);
        localStorage.setItem('fg_user', JSON.stringify(u));
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      async signIn(email, password) {
        const { token, user: u } = await authApi.login(email, password);
        localStorage.setItem('fg_token', token);
        localStorage.setItem('fg_user', JSON.stringify(u));
        setUser(u);
        return u;
      },
      signOut() {
        localStorage.removeItem('fg_token');
        localStorage.removeItem('fg_user');
        setUser(null);
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
