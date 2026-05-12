'use client';

import { useState } from 'react';
import { msalInstance, loginRequest } from '@/lib/auth';
import { CloudCog, TrendingDown, Shield, BarChart3, Sparkles } from 'lucide-react';

const DEVELOPER = process.env.NEXT_PUBLIC_DEVELOPER_NAME || 'Tanishq Bansal';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await msalInstance.loginRedirect(loginRequest);
    } catch (err) {
      console.error('Login redirect error:', err);
      setError('Sign-in failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes blob1 {
          0%,100% { transform: translate(0,0) scale(1); }
          33%      { transform: translate(4%,-5%) scale(1.06); }
          66%      { transform: translate(-3%,4%) scale(0.96); }
        }
        @keyframes blob2 {
          0%,100% { transform: translate(0,0) scale(1); }
          40%      { transform: translate(-5%,4%) scale(1.04); }
          70%      { transform: translate(3%,-3%) scale(1.07); }
        }
        @keyframes blob3 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-4%,-4%) scale(1.08); }
        }
        @keyframes floatDot {
          0%,100% { transform: translateY(0px); opacity: 0.35; }
          50%      { transform: translateY(-22px); opacity: 0.75; }
        }
        @keyframes cardIn {
          from { opacity:0; transform:translateY(28px) scale(0.98); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        @keyframes ringPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(56,189,248,0.35); }
          55%     { box-shadow: 0 0 0 14px rgba(56,189,248,0); }
        }
        @keyframes shimmerMove {
          0%   { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        @keyframes spinRing {
          to { transform: rotate(360deg); }
        }
        .az-blob1 { animation: blob1 20s ease-in-out infinite; }
        .az-blob2 { animation: blob2 25s ease-in-out infinite; }
        .az-blob3 { animation: blob3 18s ease-in-out infinite; }
        .az-card  { animation: cardIn 0.65s cubic-bezier(0.22,1,0.36,1) forwards; }
        .az-logo  { animation: ringPulse 3.2s ease-in-out infinite; }
        .az-btn-shimmer {
          background-size: 300% auto;
          animation: shimmerMove 4s linear infinite;
        }
        .az-dot { animation: floatDot var(--dur,4s) ease-in-out infinite; animation-delay: var(--delay,0s); }
        .az-spin { animation: spinRing 0.8s linear infinite; }
      `}</style>

      <div
        className="min-h-screen flex items-center justify-center relative overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 0%, #06152b 0%, #020810 100%)' }}
      >
        {/* ── Animated blobs ── */}
        <div
          className="az-blob1 pointer-events-none absolute -top-48 -left-48 w-[680px] h-[680px] rounded-full"
          style={{
            background: 'radial-gradient(circle at 40% 40%, #1d4ed8, #0369a1)',
            filter: 'blur(88px)',
            opacity: 0.22,
          }}
        />
        <div
          className="az-blob2 pointer-events-none absolute -bottom-48 -right-24 w-[760px] h-[760px] rounded-full"
          style={{
            background: 'radial-gradient(circle at 60% 60%, #0891b2, #4f46e5)',
            filter: 'blur(100px)',
            opacity: 0.18,
          }}
        />
        <div
          className="az-blob3 pointer-events-none absolute top-1/3 right-1/4 w-[420px] h-[420px] rounded-full"
          style={{
            background: 'radial-gradient(circle, #0ea5e9, #6366f1)',
            filter: 'blur(80px)',
            opacity: 0.12,
          }}
        />

        {/* ── Dot grid ── */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.06) 1px, transparent 1px)',
            backgroundSize: '30px 30px',
          }}
        />

        {/* ── Floating particles ── */}
        {([
          { left: '12%', top: '22%', dur: '3.8s', delay: '0s' },
          { left: '25%', top: '65%', dur: '5.2s', delay: '0.7s' },
          { left: '42%', top: '15%', dur: '4.4s', delay: '1.4s' },
          { left: '60%', top: '72%', dur: '3.6s', delay: '0.3s' },
          { left: '75%', top: '30%', dur: '5.8s', delay: '1.1s' },
          { left: '88%', top: '58%', dur: '4.0s', delay: '0.6s' },
          { left: '33%', top: '45%', dur: '6.2s', delay: '1.8s' },
          { left: '70%', top: '12%', dur: '3.4s', delay: '0.9s' },
        ] as const).map(({ left, top, dur, delay }, i) => (
          <div
            key={i}
            className="az-dot pointer-events-none absolute rounded-full"
            style={
              {
                left,
                top,
                width: i % 3 === 0 ? '5px' : '3px',
                height: i % 3 === 0 ? '5px' : '3px',
                background: i % 2 === 0 ? '#38bdf8' : '#818cf8',
                '--dur': dur,
                '--delay': delay,
              } as React.CSSProperties
            }
          />
        ))}

        {/* ── Horizontal scan line (very subtle) ── */}
        <div
          className="pointer-events-none absolute inset-x-0 h-px"
          style={{
            top: '38%',
            background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.08), transparent)',
          }}
        />

        {/* ── Glass card ── */}
        <div className="az-card relative z-10 w-full max-w-md mx-4">
          <div
            className="rounded-2xl p-8 md:p-10"
            style={{
              background: 'rgba(255,255,255,0.035)',
              backdropFilter: 'blur(32px)',
              WebkitBackdropFilter: 'blur(32px)',
              border: '1px solid rgba(255,255,255,0.09)',
              boxShadow:
                '0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
            }}
          >
            {/* Logo */}
            <div className="flex flex-col items-center mb-8">
              <div
                className="az-logo w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{
                  background: 'linear-gradient(145deg, #1d4ed8 0%, #0ea5e9 100%)',
                  boxShadow: '0 8px 32px rgba(14,165,233,0.35)',
                }}
              >
                <CloudCog className="w-8 h-8 text-white" />
              </div>

              <h1
                className="text-[1.65rem] font-bold tracking-tight"
                style={{
                  background: 'linear-gradient(90deg, #e0f2fe, #bae6fd, #7dd3fc)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                AzureOptimize Pro
              </h1>
              <p className="mt-1 text-sm font-medium" style={{ color: '#475569' }}>
                Cloud Cost Intelligence Platform
              </p>
            </div>

            {/* Feature chips */}
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {[
                { icon: TrendingDown, label: '25–40% cost savings' },
                { icon: BarChart3,   label: 'All subscriptions' },
                { icon: Shield,      label: 'Data stays in tenant' },
                { icon: Sparkles,    label: 'AI recommendations' },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{
                    background: 'rgba(14,165,233,0.1)',
                    border: '1px solid rgba(14,165,233,0.18)',
                    color: '#7dd3fc',
                  }}
                >
                  <Icon className="w-3 h-3 shrink-0" />
                  {label}
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div
                  className="w-full h-px"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
                  }}
                />
              </div>
              <div className="relative flex justify-center">
                <span
                  className="px-3 text-xs"
                  style={{ background: 'rgba(2,8,16,0.7)', color: '#334155' }}
                >
                  Authenticated access via Microsoft
                </span>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                className="mb-4 px-4 py-3 rounded-xl text-sm"
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.22)',
                  color: '#fca5a5',
                }}
              >
                {error}
              </div>
            )}

            {/* Sign-in button */}
            <button
              onClick={handleLogin}
              disabled={loading}
              className="az-btn-shimmer relative w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-white transition-all duration-200 overflow-hidden"
              style={{
                background: loading
                  ? 'rgba(37,99,235,0.45)'
                  : 'linear-gradient(270deg, #0ea5e9, #1d4ed8, #6366f1, #0ea5e9)',
                boxShadow: loading ? 'none' : '0 4px 28px rgba(14,165,233,0.28)',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.75 : 1,
              }}
            >
              {loading ? (
                <>
                  <div
                    className="az-spin w-5 h-5 rounded-full border-2 border-white/30 border-t-white shrink-0"
                  />
                  <span>Redirecting to Microsoft…</span>
                </>
              ) : (
                <>
                  {/* Microsoft logo */}
                  <svg className="w-5 h-5 shrink-0" viewBox="0 0 21 21" fill="none">
                    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                  </svg>
                  <span>Sign in with Microsoft</span>
                </>
              )}
            </button>

            {/* Footer */}
            <p className="mt-6 text-center text-xs" style={{ color: '#1e3a5f' }}>
              Developer: {DEVELOPER} &nbsp;·&nbsp; Your data never leaves Azure
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
