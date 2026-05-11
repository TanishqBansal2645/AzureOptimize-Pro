'use client';

import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { StaleBanner } from '@/components/ui/StaleBanner';
import { fetchReservations } from '@/lib/api';
import { formatCurrency, formatDateShort } from '@/lib/utils';
import { BookMarked, DollarSign, Clock } from 'lucide-react';
import { useState } from 'react';

export default function ReservationsPage() {
  const [termFilter, setTermFilter] = useState<'1Year' | '3Year'>('1Year');

  const { data, isLoading, error } = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchReservations,
  });

  const reservations = data?.data ?? [];
  const totalOneYear = data?.summary.totalOneYearMonthlySaving ?? 0;
  const totalThreeYear = data?.summary.totalThreeYearMonthlySaving ?? 0;

  if (error) {
    return (
      <AppLayout>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          Failed to load reservation recommendations.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Reserved Instance Advisor</h2>
            <p className="text-sm text-slate-500">AI-powered RI recommendations from Azure Advisor</p>
          </div>
          <StaleBanner lastUpdated={data?.lastFetched} maxAgeHours={6} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            title="1-Year Monthly Savings"
            value={formatCurrency(totalOneYear)}
            icon={DollarSign}
            iconClassName="bg-green-600"
            loading={isLoading}
          />
          <MetricCard
            title="3-Year Monthly Savings"
            value={formatCurrency(totalThreeYear)}
            icon={DollarSign}
            iconClassName="bg-blue-600"
            loading={isLoading}
          />
          <MetricCard
            title="Recommendations"
            value={String(reservations.length)}
            icon={BookMarked}
            iconClassName="bg-slate-700"
            loading={isLoading}
          />
        </div>

        {/* Term toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600 font-medium">Compare:</span>
          <div className="flex bg-slate-100 rounded-lg p-1">
            {(['1Year', '3Year'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTermFilter(t)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  termFilter === t ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t === '1Year' ? '1-Year RI' : '3-Year RI'}
              </button>
            ))}
          </div>
        </div>

        <DataTable
          data={reservations}
          loading={isLoading}
          searchKeys={['resourceType', 'region', 'scope']}
          emptyMessage="No RI recommendations available. Azure Advisor updates recommendations periodically."
          columns={[
            { key: 'resourceType', label: 'Resource Type', sortable: true },
            { key: 'region', label: 'Region', sortable: true },
            { key: 'subscriptionId', label: 'Subscription', className: 'max-w-[180px] truncate' },
            {
              key: 'currentMonthlyCost',
              label: 'On-Demand Monthly',
              sortable: true,
              render: (v) => formatCurrency(Number(v)),
            },
            {
              key: termFilter === '1Year' ? 'oneYearMonthlyCost' : 'threeYearMonthlyCost',
              label: `${termFilter} RI Monthly`,
              sortable: true,
              render: (v) => (
                <span className="font-medium text-green-700">{formatCurrency(Number(v))}</span>
              ),
            },
            {
              key: termFilter === '1Year' ? 'oneYearSaving' : 'threeYearSaving',
              label: 'Monthly Saving',
              sortable: true,
              render: (v) => (
                <span className="font-semibold text-green-600">{formatCurrency(Number(v))}</span>
              ),
            },
            {
              key: termFilter === '1Year' ? 'oneYearPaybackMonths' : 'threeYearPaybackMonths',
              label: 'Payback',
              sortable: true,
              render: (v) => (
                <div className="flex items-center gap-1 text-slate-600">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{Number(v)} months</span>
                </div>
              ),
            },
          ]}
        />
      </div>
    </AppLayout>
  );
}
