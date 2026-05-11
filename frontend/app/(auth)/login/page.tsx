'use client';

import { useEffect, useState } from 'react';
import { msalInstance, loginRequest, initializeMsal } from '@/lib/auth';
import { Zap, Shield, TrendingDown, BarChart2 } from 'lucide-react';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    initializeMsal()
      .then(() => setInitializing(false))
      .catch((err) => {
        console.error('MSAL init error:', err);
        setInitializing(false);
      });
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await msalInstance.loginRedirect(loginRequest);
    } catch (err) {
      setError('Sign-in failed. Please try again.');
      setLoading(false);
    }
  };

  const features = [
    { icon: TrendingDown, text: 'Find 25–40% cost savings on first scan' },
    { icon: BarChart2, text: 'Multi-subscription cost dashboard' },
    { icon: Shield, text: 'All data stays in your Azure tenant' },
  ];

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="w-10 h-10 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left: branding */}
      <div className="hidden lg:flex flex-col justify-between bg-slate-900 text-white w-1/2 p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <p className="font-bold text-lg leading-tight">AzureOptimize Pro</p>
            <p className="text-xs text-slate-400">Cost Optimization Platform</p>
          </div>
        </div>

        <div>
          <h2 className="text-4xl font-bold leading-tight mb-4">
            Reduce your Azure costs.
            <span className="text-blue-400"> Starting today.</span>
          </h2>
          <p className="text-slate-400 text-lg mb-8">
            A self-hosted cost optimization tool deployed directly into your Azure tenant.
            No SaaS fees. No data leaving your environment.
          </p>

          <div className="space-y-4">
            {features.map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600/20 rounded-lg flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-blue-400" />
                </div>
                <p className="text-slate-300 text-sm">{text}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-slate-500">
          © 2026 Tech Plus Talent · AzureOptimize Pro v1.0
        </p>
      </div>

      {/* Right: login form */}
      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <p className="font-bold text-lg">AzureOptimize Pro</p>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-2">Sign in</h1>
          <p className="text-slate-500 text-sm mb-8">
            Use your Microsoft account to access the dashboard.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            className="flex items-center justify-center gap-3 w-full px-4 py-3 bg-[#0078d4] hover:bg-[#106ebe] text-white font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {loading ? (
              <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
              </svg>
            )}
            {loading ? 'Signing in…' : 'Sign in with Microsoft'}
          </button>

          <p className="mt-6 text-xs text-center text-slate-400">
            By signing in, you agree to the terms of use.
            <br />
            Your data stays within your Azure tenant.
          </p>
        </div>
      </div>
    </div>
  );
}
