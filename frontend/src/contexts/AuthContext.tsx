import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { authApi } from '../api';
import type { User } from '../types';
import i18n from '../i18n';

type AuthContextType = {
  user: User | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ requires2fa?: boolean }>;
  register: (email: string, password: string) => Promise<void>;
  verifyTelegram2fa: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const response = await authApi.me();
      setUser(response.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshUser();
      setLoading(false);
    })();
  }, [refreshUser]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const nextLang = user.language === 'ru' ? 'ru' : 'en';
    if (i18n.language !== nextLang) {
      void i18n.changeLanguage(nextLang);
    }

    const nextTheme = user.theme === 'dark' ? 'dark' : 'light';
    localStorage.setItem('steamguard-theme', nextTheme);
    const root = document.documentElement;
    if (nextTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password);

    if (response.user) {
      setUser(response.user);
      return {};
    }

    if (response.requires2fa) {
      return { requires2fa: true };
    }

    return {};
  }, []);

  const verifyTelegram2fa = useCallback(async (email: string, code: string) => {
    const response = await authApi.verifyTelegram2fa(email, code);
    setUser(response.user);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const response = await authApi.register(email, password);
    setUser(response.user);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      refreshUser,
      login,
      register,
      verifyTelegram2fa,
      logout
    }),
    [user, loading, refreshUser, login, register, verifyTelegram2fa, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
