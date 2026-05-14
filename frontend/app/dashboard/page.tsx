'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { StaleBanner } from '@/components/ui/StaleBanner';
import { SavingsBarChart } from '@/components/charts/SpendChart';
import {
  fetchIdleResources,
  fetchRightsizing,
  fetchAHB,
  fetchStorage,
  fetchDatabases,
  fetchReservations,
  fetchSavings,
  fetchCosts,
  fetchASP,
  refreshAll,
} from '@/lib/api';
import { formatCurrency, formatPercent } from '@/lib/utils';
import {
  RefreshCw, Sparkles, ArrowRight, Trophy, Leaf, DollarSign,
  Zap, TrendingDown, Award, HardDrive, Database, BookMarked, Globe,
} from 'lucide-react';
import { useState, type CSSProperties } from 'react';

const stagger = (i: number): CSSProperties => ({ animationDelay: `${i * 70}ms` });

export default function DashboardPage() {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: idleData } = useQuery({ queryKey: ['idle-resources'], queryFn: () => fetchIdleResources() });
  const { data: rightsizingData } = useQuery({ queryKey: ['rightsizing'], queryFn: fetchRightsizing });
  const { data: ahbData } = useQuery({ queryKey: ['ahb'], queryFn: fetchAHB });
  const { data: storageData } = useQuery({ queryKey: ['storage'], queryFn: fetchStorage });
  const { data: databasesData } = useQuery({ queryKey: ['databases'], queryFn: fetchDatabases });
  const { data: reservationsData } = useQuery({ queryKey: ['reservations'], queryFn: fetchReservations });
  const { data: savingsData, isLoading: savingsLoading } = useQuery({ queryKey: ['savings'], queryFn: fetchSavings });
  const { data: costsData } = useQuery({ queryKey: ['costs'], queryFn: () => fetchCosts() });
  const { data: aspData } = useQuery({ queryKey: ['asp'], queryFn: fetchASP });

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshStatus('Running all scans — this takes 1–3 minutes…');
    try {
      const result = await refreshAll();
      const failed = result.results.filter((r) => r.status === 'error');
      setRefreshStatus(
        failed.length > 0
          ? `Done (${failed.length} scanner(s) had errors — check API logs)`
          : null
      );
      await qc.invalidateQueries();
    } catch (err) {
      console.error('Refresh failed:', err);
      setRefreshStatus('Refresh failed — see browser console for details');
    } finally {
      setRefreshing(false);
    }
  };

  // Savings by module, sorted by opportunity size
  const modules = [
    {
      key: 'idle',
      label: 'Idle Resources',
      href: '/idle-resources',
      icon: Zap,
      color: 'text-red-500',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-100',
      accentColor: '#ef4444',
      saving: idleData?.summary.totalMonthlyWaste ?? 0,
      count: idleData?.summary.totalCount ?? 0,
      countLabel: 'idle resources',
    },
    {
      key: 'rightsizing',
      label: 'VM Rightsizing',
      href: '/rightsizing',
      icon: TrendingDown,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-100',
      accentColor: '#2563eb',
      saving: rightsizingData?.summary.totalMonthlySaving ?? 0,
      count: rightsizingData?.summary.totalCount ?? 0,
      countLabel: 'VMs to resize',
    },
    {
      key: 'ahb',
      label: 'Azure Hybrid Benefit',
      href: '/hybrid-benefit',
      icon: Award,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-100',
      accentColor: '#d97706',
      saving: ahbData?.summary.totalMonthlySaving ?? 0,
      count: ahbData?.summary.totalCount ?? 0,
      countLabel: 'eligible resources',
    },
    {
      key: 'reservations',
      label: 'Reserved Instances',
      href: '/reservations',
      icon: BookMarked,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      borderColor: 'border-indigo-100',
      accentColor: '#4f46e5',
      saving: reservationsData?.summary.totalOneYearMonthlySaving ?? 0,
      count: reservationsData?.data?.length ?? 0,
      countLabel: 'RI opportunities',
    },
    {
      key: 'storage',
      label: 'Storage Optimization',
      href: '/storage',
      icon: HardDrive,
      color: 'text-cyan-600',
      bgColor: 'bg-cyan-50',
      borderColor: 'border-cyan-100',
      accentColor: '#0891b2',
      saving: storageData?.summary.totalMonthlySaving ?? 0,
      count: storageData?.summary.totalCount ?? 0,
      countLabel: 'issues found',
    },
    {
      key: 'databases',
      label: 'Database Optimizer',
      href: '/databases',
      icon: Database,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-100',
      accentColor: '#9333ea',
      saving: databasesData?.summary.totalMonthlySaving ?? 0,
      count: databasesData?.summary.totalCount ?? 0,
      countLabel: 'databases to optimize',
    },
    {
      key: 'asp',
      label: 'ASP Rightsizing',
      href: '/asp-rightsizing',
      icon: Globe,
      color: 'text-teal-600',
      bgColor: 'bg-teal-50',
      borderColor: 'border-teal-100',
      accentColor: '#0d9488',
      saving: aspData?.summary.totalMonthlySaving ?? 0,
      count: aspData?.summary.totalCount ?? 0,
      countLabel: 'plans to downsize',
    },
  ].sort((a, b) => b.saving - a.saving);

  const totalMonthlySavings = modules.reduce((s, m) => s + m.saving, 0);
  const implementedThisMonth = savingsData?.summary.totalThisMonth ?? 0;
  const implementedAllTime = savingsData?.summary.totalAllTime ?? 0;
  const roi = savingsData?.summary.roi ?? 0;
  const paybackAchieved = savingsData?.summary.paybackAchieved ?? false;
  const monthlyBreakdown = savingsData?.summary.monthlyBreakdown ?? [];

  const totalMTDSpend = (costsData?.data ?? []).reduce((s, d) => s + d.mtdTotal, 0);
  const savingsPercent = totalMTDSpend > 0 ? (totalMonthlySavings / totalMTDSpend) * 100 : 0;

  return (
    <AppLayout>
      <div className="space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-green-500" />
              Savings Dashboard
            </h2>
            <p className="text-sm text-slate-500">Your Azure cost intelligence centre</p>
          </div>
          <div className="flex items-center gap-3">
            <StaleBanner
              lastUpdated={costsData?.lastUpdated ?? null}
              onRefresh={handleRefresh}
              refreshing={refreshing}
            />
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:shadow-sm transition-all duration-150 disabled:opacity-50 active:scale-[0.97]"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh All'}
            </button>
          </div>
        </div>

        {/* ── Refresh status ── */}
        {refreshStatus && (
          <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 flex items-center gap-2 animate-fade-in">
            {refreshing && <RefreshCw className="w-4 h-4 animate-spin shrink-0" />}
            {refreshStatus}
          </div>
        )}

        {/* ── Hero savings banner ── */}
        <div
          className="relative rounded-2xl p-6 md:p-8 overflow-hidden animate-fade-in-up"
          style={{
            background: 'linear-gradient(135deg, #064e3b 0%, #065f46 45%, #047857 100%)',
            boxShadow: '0 20px 60px rgba(5, 150, 105, 0.2)',
          }}
        >
          {/* Dot mesh */}
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />
          {/* Glow orbs */}
          <div
            className="absolute -top-20 -right-20 w-64 h-64 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.3), transparent 70%)' }}
          />

          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <p className="text-emerald-300 text-sm font-medium mb-2 flex items-center gap-1.5">
                <DollarSign className="w-4 h-4" />
                Total Monthly Savings Available
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-bold text-white tracking-tight animate-count-in">
                  {formatCurrency(totalMonthlySavings)}
                </span>
                <span className="text-emerald-300 text-sm font-medium">/month</span>
              </div>
              <p className="text-emerald-300 text-sm mt-2">
                <span className="text-white font-semibold">{formatCurrency(totalMonthlySavings * 12)}</span>{' '}
                annual savings potential
                {savingsPercent > 1 && (
                  <>
                    {' '}·{' '}
                    <span className="text-white font-semibold">{formatPercent(savingsPercent, 0)}</span> of current monthly spend
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex items-center gap-3 bg-white/10 border border-white/15 rounded-xl px-4 py-3 backdrop-blur-sm">
                <Trophy className="w-5 h-5 text-yellow-300 shrink-0" />
                <div>
                  <p className="text-xs text-emerald-300">Implemented All Time</p>
                  <p className="text-xl font-bold text-white">{formatCurrency(implementedAllTime)}</p>
                </div>
              </div>
              {paybackAchieved && (
                <div className="flex items-center gap-1.5 text-xs text-yellow-300 font-semibold bg-yellow-400/10 rounded-full px-3 py-1.5 border border-yellow-400/20">
                  <Leaf className="w-3.5 h-3.5" />
                  License paid off! ROI: {formatPercent(roi * 100, 0)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 4 stat cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'Monthly Savings Available',
              value: formatCurrency(totalMonthlySavings),
              sub: 'across all modules',
              topColor: 'border-t-green-500',
              valueColor: 'text-green-600',
            },
            {
              label: 'Implemented This Month',
              value: formatCurrency(implementedThisMonth),
              sub: 'savings actioned',
              topColor: 'border-t-blue-500',
              valueColor: 'text-blue-600',
            },
            {
              label: 'Saved All Time',
              value: formatCurrency(implementedAllTime),
              sub: 'cumulative savings',
              topColor: 'border-t-indigo-500',
              valueColor: 'text-indigo-600',
            },
            {
              label: 'Annual Potential',
              value: formatCurrency(totalMonthlySavings * 12),
              sub: 'if all actioned',
              topColor: 'border-t-amber-500',
              valueColor: 'text-amber-600',
            },
          ].map((card, i) => (
            <div
              key={card.label}
              className={`bg-white rounded-xl border border-slate-200 border-t-4 ${card.topColor} p-4 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 animate-fade-in-up`}
              style={stagger(i)}
            >
              <p className="text-xs font-medium text-slate-500 mb-1">{card.label}</p>
              <p className={`text-2xl font-bold ${card.valueColor} truncate`}>{card.value}</p>
              <p className="text-xs text-slate-400 mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* ── Savings by category ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800">Savings by Category</h3>
            <p className="text-xs text-slate-400">Sorted by opportunity size — click any to explore</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {modules.map((mod, i) => {
              const Icon = mod.icon;
              return (
                <Link
                  key={mod.key}
                  href={mod.href}
                  className={`group bg-white rounded-xl border ${mod.borderColor} border p-4 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 animate-fade-in-up flex items-start gap-3`}
                  style={stagger(i + 4)}
                >
                  <div
                    className={`w-10 h-10 rounded-xl ${mod.bgColor} flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-200`}
                  >
                    <Icon className={`w-5 h-5 ${mod.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-sm font-semibold text-slate-900 leading-tight">{mod.label}</p>
                      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5" />
                    </div>
                    <p className={`text-xl font-bold ${mod.color} mt-0.5`}>
                      {formatCurrency(mod.saving)}
                      <span className="text-xs font-normal text-slate-400">/mo</span>
                    </p>
                    {mod.count > 0 && (
                      <p className="text-xs text-slate-400 mt-0.5">{mod.count} {mod.countLabel}</p>
                    )}
                    {mod.count === 0 && (
                      <p className="text-xs text-slate-300 mt-0.5">No issues detected</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* ── Chart + spend context ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Monthly savings chart */}
          <div
            className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-5 animate-fade-in-up"
            style={stagger(10)}
          >
            <h3 className="font-semibold text-slate-800 mb-4">Monthly Savings Implemented</h3>
            {savingsLoading ? (
              <div className="skeleton h-48 w-full" />
            ) : monthlyBreakdown.length > 0 ? (
              <SavingsBarChart data={monthlyBreakdown} height={200} />
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                <Trophy className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm font-medium">No savings implemented yet</p>
                <p className="text-xs mt-1 text-center">
                  Open any module above and click{' '}
                  <span className="font-semibold">Implemented</span> to start tracking
                </p>
              </div>
            )}
          </div>

          {/* Spend context */}
          {totalMTDSpend > 0 && (
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-4 animate-fade-in-up self-start" style={stagger(11)}>
              <p className="text-xs font-medium text-slate-500 mb-1">Month-to-Date Spend</p>
              <p className="text-2xl font-bold text-slate-800">{formatCurrency(totalMTDSpend)}</p>
              {savingsPercent > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                    <span>Savings opportunity</span>
                    <span className="text-green-600 font-semibold">{formatPercent(savingsPercent, 0)} of spend</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(100, savingsPercent)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </AppLayout>
  );
}
