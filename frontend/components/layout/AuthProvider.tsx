'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react';
import { msalInstance, initializeMsal, getUserInfo, UserInfo } from '@/lib/auth';
import { useRouter, usePathname } from 'next/navigation';

interface AuthContextValue {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  isAdmin: false,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<UserInfo | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const refreshUser = useCallback(() => {
    const info = getUserInfo();
    setUser(info);
  }, []);

  useEffect(() => {
    // MSAL is already initialized by AuthProvider before this mounts
    refreshUser();
    setIsLoading(false);
  }, [refreshUser]);

  useEffect(() => {
    refreshUser();
  }, [accounts, refreshUser]);

  useEffect(() => {
    if (isLoading) return;
    const isLoginPage = pathname === '/login' || pathname?.startsWith('/(auth)');
    if (!isAuthenticated && !isLoginPage) {
      router.replace('/login');
    }
    if (isAuthenticated && isLoginPage) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-4 border-blue-600 border-t-transparent animate-spin mx-auto" />
          <p className="text-slate-600 font-medium">Loading AzureOptimize Pro…</p>
        </div>
      </div>
    );
  }

  const adminPrincipalId = process.env.NEXT_PUBLIC_ADMIN_PRINCIPAL_ID;
  const isAdmin = user ? (adminPrincipalId ? user.oid === adminPrincipalId : true) : false;

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, isLoading, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

let msalInitialized = false;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (msalInitialized) {
      setReady(true);
      return;
    }
    initializeMsal()
      .then(() => {
        msalInitialized = true;
        setReady(true);
      })
      .catch((err) => {
        console.error('MSAL init error:', err);
        msalInitialized = true;
        setReady(true);
      });
  }, []);

  if (!ready) return null;

  return (
    <MsalProvider instance={msalInstance}>
      <AuthGuard>{children}</AuthGuard>
    </MsalProvider>
  );
}
