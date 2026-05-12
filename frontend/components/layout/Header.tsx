'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { logout } from '@/lib/auth';
import { LogOut, User, RefreshCw, Shield } from 'lucide-react';
import { useState } from 'react';

const routeLabels: Record<string, string> = {
  '/dashboard': 'Savings Dashboard',
  '/idle-resources': 'Idle Resource Detector',
  '/rightsizing': 'VM Rightsizing Engine',
  '/reservations': 'Reserved Instance Advisor',
  '/hybrid-benefit': 'Azure Hybrid Benefit Scanner',
  '/storage': 'Storage Optimizer',
  '/databases': 'Database Optimizer',
  '/budgets': 'Budget Manager',
  '/savings': 'Savings Tracker',
  '/reports': 'Excel Reports',
  '/implementations': 'Implementation Log',
};

export function Header() {
  const pathname = usePathname();
  const { user, isAdmin } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const title = routeLabels[pathname ?? ''] ?? 'AzureOptimize Pro';

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-100 shadow-sm">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <p className="text-xs font-medium" style={{ background: 'linear-gradient(90deg, #2563eb, #0ea5e9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          AzureOptimize Pro
        </p>
      </div>

      <div className="flex items-center gap-3">
        {isAdmin && (
          <span className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
            <Shield className="w-3 h-3" />
            Admin
          </span>
        )}

        {user && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0">
                {user.avatar}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-sm font-medium text-slate-900 leading-tight">{user.name}</p>
                <p className="text-xs text-slate-500 leading-tight">{user.email}</p>
              </div>
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <p className="text-xs font-medium text-slate-900 truncate">{user.name}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    {loggingOut ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <LogOut className="w-4 h-4" />
                    )}
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
