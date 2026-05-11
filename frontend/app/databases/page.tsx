'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StaleBanner } from '@/components/ui/StaleBanner';
import { fetchDatabases, markImplemented, DatabaseItem } from '@/lib/api';
import { formatCurrency, formatPercent } from '@/lib/utils';
import { Database, DollarSign, CheckCircle } from 'lucide-react';
import { useState } from 'react';

export default function DatabasesPage() {
  const qc = useQueryClient();
  const [implementing, setImplementing] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['databases'],
    queryFn: fetchDatabases,
  });

  const implementMutation = useMutation({
    mutationFn: (item: DatabaseItem) =>
      markImplemented({
        recommendationType: 'databases',
        id: item.id,
        subscriptionId: item.subscriptionId,
        resourceName: item.resourceName,
        resourceId: item.resourceId ?? '',
        resourceGroup: item.resourceGroup,
        category: `Database: ${item.resourceType}`,
        projectedMonthlySaving: item.estimatedMonthlySaving,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['databases'] });
      qc.invalidateQueries({ queryKey: ['savings'] });
      setImplementing(null);
    },
  });

  const recommendations = data?.data ?? [];
  const totalSaving = data?.summary.totalMonthlySaving ?? 0;

  if (error) {
    return (
      <AppLayout>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          Failed to load database data.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Database Optimizer</h2>
            <p className="text-sm text-slate-500">Underutilized and over-provisioned databases</p>
          </div>
          <StaleBanner lastUpdated={data?.lastScanned} maxAgeHours={24} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            title="Monthly Savings Available"
            value={formatCurrency(totalSaving)}
            icon={DollarSign}
            iconClassName="bg-green-600"
            loading={isLoading}
          />
          <MetricCard
            title="Issues Found"
            value={String(recommendations.length)}
            icon={Database}
            iconClassName="bg-blue-600"
            loading={isLoading}
          />
          <MetricCard
            title="Annual Savings Potential"
            value={formatCurrency(totalSaving * 12)}
            icon={DollarSign}
            iconClassName="bg-slate-700"
            loading={isLoading}
          />
        </div>

        <DataTable
          data={recommendations}
          loading={isLoading}
          searchKeys={['resourceName', 'resourceGroup', 'resourceType']}
          emptyMessage="No database optimization opportunities found."
          columns={[
            {
              key: 'resourceType',
              label: 'Type',
              sortable: true,
              render: (v) => <Badge variant="info">{String(v)}</Badge>,
            },
            { key: 'resourceName', label: 'Database', sortable: true },
            { key: 'resourceGroup', label: 'Resource Group', sortable: true },
            { key: 'currentTier', label: 'Current Tier' },
            {
              key: 'avgUtilization',
              label: 'Avg Utilization',
              sortable: true,
              render: (v) => (
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-slate-100 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${Number(v) < 30 ? 'bg-green-500' : Number(v) < 70 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, Number(v))}%` }}
                    />
                  </div>
                  <span className="text-xs">{formatPercent(Number(v))}</span>
                </div>
              ),
            },
            { key: 'recommendation', label: 'Recommendation', className: 'max-w-[240px] text-sm' },
            {
              key: 'estimatedMonthlySaving',
              label: 'Monthly Saving',
              sortable: true,
              render: (v) => (
                <span className={`font-semibold ${Number(v) > 0 ? 'text-green-600' : 'text-slate-400'}`}>
                  {Number(v) > 0 ? formatCurrency(Number(v)) : 'Review needed'}
                </span>
              ),
            },
            {
              key: 'id',
              label: 'Action',
              render: (v, row) => (
                <Button
                  size="sm"
                  variant="outline"
                  icon={<CheckCircle className="w-3.5 h-3.5" />}
                  loading={implementing === String(v)}
                  disabled={Number(row['estimatedMonthlySaving']) <= 0}
                  onClick={() => {
                    setImplementing(String(v));
                    implementMutation.mutate(row as unknown as DatabaseItem);
                  }}
                >
                  Implemented
                </Button>
              ),
            },
          ]}
        />
      </div>
    </AppLayout>
  );
}
