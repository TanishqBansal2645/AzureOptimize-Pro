'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { InteractionStatus } from '@azure/msal-browser';
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
  const { accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [user, setUser] = useState<UserInfo | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const refreshUser = useCallback(() => {
    const info = getUserInfo();
    setUser(info);
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    refreshUser();
  }, [accounts, refreshUser]);

  // Wait for any in-flight MSAL operation (redirect processing, token refresh, etc.)
  const isAuthBusy = inProgress !== InteractionStatus.None;

  useEffect(() => {
    if (isAuthBusy) return;

    // Normalize trailing slash so /login and /login/ both match
    const path = (pathname ?? '').replace(/\/$/, '');
    const isAuthPage = path === '/login';

    if (!isAuthenticated && !isAuthPage && path !== '') {
      router.replace('/login');
    }
    if (isAuthenticated && (isAuthPage || path === '')) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isAuthBusy, pathname, router]);

  if (isAuthBusy) {
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
    <AuthContext.Provider value={{ user, isAuthenticated, isLoading: isAuthBusy, isAdmin }}>
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
