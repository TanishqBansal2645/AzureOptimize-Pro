'use client';

import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { SavingsBarChart } from '@/components/charts/SpendChart';
import { fetchSavings } from '@/lib/api';
import { formatCurrency, formatDateTime, formatPercent } from '@/lib/utils';
import { TrendingUp, DollarSign, Star, Trophy } from 'lucide-react';

export default function SavingsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['savings'],
    queryFn: fetchSavings,
  });

  const summary = data?.summary;
  const savings = data?.data ?? [];

  if (error) {
    return (
      <AppLayout>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          Failed to load savings data.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Savings Tracker</h2>
          <p className="text-sm text-slate-500">Track implemented recommendations and ROI</p>
        </div>

        {/* Payback achieved banner */}
        {summary?.paybackAchieved && (
          <div className="flex items-center gap-3 px-4 py-4 bg-green-50 border border-green-200 rounded-xl">
            <Trophy className="w-8 h-8 text-green-600 shrink-0" />
            <div>
              <p className="font-semibold text-green-800">License Paid Off!</p>
              <p className="text-sm text-green-700">
                Cumulative savings exceeded the $1,000 license cost. ROI: {formatPercent(summary.roi * 100, 0)}
              </p>
            </div>
          </div>
        )}

        {/* Hero metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <MetricCard
            title="Saved This Month"
            value={formatCurrency(summary?.totalThisMonth ?? 0)}
            icon={DollarSign}
            iconClassName="bg-green-600"
            loading={isLoading}
            index={0}
          />
          <MetricCard
            title="Saved All Time"
            value={formatCurrency(summary?.totalAllTime ?? 0)}
            icon={TrendingUp}
            iconClassName="bg-blue-600"
            loading={isLoading}
            index={1}
          />
          <MetricCard
            title="ROI"
            value={`${formatPercent((summary?.roi ?? 0) * 100, 0)}`}
            subtitle={`vs $${summary?.licenseCost?.toLocaleString() ?? '1,000'} license`}
            icon={Star}
            iconClassName={summary?.paybackAchieved ? 'bg-green-600' : 'bg-slate-600'}
            loading={isLoading}
            index={2}
          />
          <MetricCard
            title="Implementations"
            value={String(savings.length)}
            icon={Trophy}
            iconClassName="bg-amber-500"
            loading={isLoading}
            index={3}
          />
        </div>

        {/* Monthly savings chart */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Monthly Savings — Last 12 Months</h3>
          {isLoading ? (
            <div className="skeleton h-56 w-full" />
          ) : (
            <SavingsBarChart data={summary?.monthlyBreakdown ?? []} />
          )}
        </div>

        {/* ROI progress bar */}
        {!isLoading && summary && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-slate-800">License Payback Progress</h3>
              <span className="text-sm font-medium text-green-600">
                {formatCurrency(summary.totalAllTime)} / {formatCurrency(summary.licenseCost)}
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-4">
              <div
                className={`h-4 rounded-full transition-all ${summary.paybackAchieved ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(100, (summary.totalAllTime / summary.licenseCost) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>$0</span>
              <span>{formatPercent((summary.totalAllTime / summary.licenseCost) * 100, 0)} of license paid off</span>
              <span>{formatCurrency(summary.licenseCost)}</span>
            </div>
          </div>
        )}

        {/* Savings log */}
        <div>
          <h3 className="font-semibold text-slate-800 mb-3">Savings Log</h3>
          <DataTable
            data={savings}
            loading={isLoading}
            searchKeys={['resourceName', 'category', 'implementedBy']}
            emptyMessage="No savings recorded yet. Implement recommendations from any module to start tracking."
            columns={[
              {
                key: 'implementedAt',
                label: 'Date',
                sortable: true,
                render: (v) => <span className="text-slate-500">{formatDateTime(String(v))}</span>,
              },
              {
                key: 'category',
                label: 'Category',
                sortable: true,
                render: (v) => <Badge variant="info">{String(v)}</Badge>,
              },
              { key: 'resourceName', label: 'Resource', sortable: true },
              { key: 'notes', label: 'Notes', className: 'max-w-[200px] text-sm text-slate-500' },
              {
                key: 'projectedMonthlySaving',
                label: 'Monthly Saving',
                sortable: true,
                render: (v) => (
                  <span className="font-semibold text-green-600">{formatCurrency(Number(v))}</span>
                ),
              },
              {
                key: 'projectedMonthlySaving',
                label: 'Annual Impact',
                render: (v) => (
                  <span className="text-slate-600 font-medium">{formatCurrency(Number(v) * 12)}/yr</span>
                ),
              },
              { key: 'implementedBy', label: 'Implemented By', sortable: true },
            ]}
          />
        </div>
      </div>
    </AppLayout>
  );
}
