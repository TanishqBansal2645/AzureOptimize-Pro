'use client';

import {
  PublicClientApplication,
  Configuration,
  AccountInfo,
  InteractionRequiredAuthError,
  BrowserAuthError,
} from '@azure/msal-browser';

const msalConfig: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ?? '',
    authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID ?? ''}`,
    redirectUri: process.env.NEXT_PUBLIC_AZURE_REDIRECT_URI ?? 'http://localhost:3000',
    postLogoutRedirectUri: process.env.NEXT_PUBLIC_AZURE_REDIRECT_URI ?? 'http://localhost:3000',
  },
  cache: {
    cacheLocation: 'localStorage',
  },
  system: {
    loggerOptions: {
      logLevel: process.env.NODE_ENV === 'development' ? 3 : 0, // 3 = Verbose
      loggerCallback: (level, message) => {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[MSAL][${level}] ${message}`);
        }
      },
    },
  },
};

// Login scopes — include the API scope so the token is cached from the first login.
// Admin consent is pre-granted so users never see a consent prompt.
export const loginRequest = {
  scopes: [
    'openid',
    'profile',
    'email',
    `api://${process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ?? ''}/user_impersonation`,
  ],
};

// API token scopes — must match loginRequest scope exactly so MSAL finds a cache hit
export const apiTokenRequest = {
  scopes: [`api://${process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ?? ''}/user_impersonation`],
};

export const msalInstance = new PublicClientApplication(msalConfig);

// Initialize MSAL — must be called before any MSAL operations
export async function initializeMsal(): Promise<void> {
  await msalInstance.initialize();
  await msalInstance.handleRedirectPromise();
}

export function getActiveAccount(): AccountInfo | null {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;
  if (msalInstance.getActiveAccount()) return msalInstance.getActiveAccount();
  msalInstance.setActiveAccount(accounts[0]);
  return accounts[0];
}

export async function getAccessToken(): Promise<string | null> {
  const account = getActiveAccount();
  if (!account) return null;

  try {
    const result = await msalInstance.acquireTokenSilent({
      ...apiTokenRequest,
      account,
    });
    return result.accessToken;
  } catch (err) {
    if (
      err instanceof InteractionRequiredAuthError ||
      // BrowserAuthError: timed_out fires when the hidden iframe MSAL uses for silent
      // SSO is blocked by X-Frame-Options: DENY on the SWA. Treat it the same as
      // InteractionRequiredAuthError — redirect to login to get a fresh token.
      (err instanceof BrowserAuthError && (err as BrowserAuthError).errorCode === 'timed_out')
    ) {
      await msalInstance.acquireTokenRedirect({ ...apiTokenRequest, account });
      return null; // unreachable; browser navigates away
    }
    console.error('Error acquiring token:', err);
    return null;
  }
}

export async function login(): Promise<void> {
  await msalInstance.loginRedirect(loginRequest);
}

export async function logout(): Promise<void> {
  const account = getActiveAccount();
  await msalInstance.logoutRedirect({
    account,
    postLogoutRedirectUri: process.env.NEXT_PUBLIC_AZURE_REDIRECT_URI ?? '/',
  });
}

export interface UserInfo {
  name: string;
  email: string;
  oid: string;
  avatar: string;
}

export function getUserInfo(): UserInfo | null {
  const account = getActiveAccount();
  if (!account) return null;

  const name = account.name ?? account.username ?? 'User';
  const email = account.username ?? '';
  const oid = account.localAccountId ?? '';

  return {
    name,
    email,
    oid,
    avatar: name.charAt(0).toUpperCase(),
  };
}
