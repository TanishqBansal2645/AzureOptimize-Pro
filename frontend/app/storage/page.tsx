'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StaleBanner } from '@/components/ui/StaleBanner';
import { fetchStorage, markImplemented, StorageItem } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { HardDrive, DollarSign, CheckCircle } from 'lucide-react';
import { useState } from 'react';

export default function StoragePage() {
  const qc = useQueryClient();
  const [implementing, setImplementing] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['storage'],
    queryFn: fetchStorage,
  });

  const implementMutation = useMutation({
    mutationFn: (item: StorageItem) =>
      markImplemented({
        recommendationType: 'storage',
        id: item.id,
        subscriptionId: item.subscriptionId,
        resourceName: item.resourceName,
        resourceId: item.resourceId ?? '',
        resourceGroup: item.resourceGroup,
        category: `Storage: ${item.resourceType}`,
        projectedMonthlySaving: item.estimatedMonthlySaving,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['storage'] });
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
          Failed to load storage data.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Storage Optimizer</h2>
            <p className="text-sm text-slate-500">Over-tiered and unused storage resources</p>
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
            icon={HardDrive}
            iconClassName="bg-amber-500"
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
          searchKeys={['resourceName', 'resourceGroup']}
          emptyMessage="No storage optimization opportunities found."
          columns={[
            {
              key: 'resourceType',
              label: 'Type',
              sortable: true,
              render: (v) => <Badge variant="info">{String(v)}</Badge>,
            },
            { key: 'resourceName', label: 'Resource', sortable: true },
            { key: 'resourceGroup', label: 'Resource Group', sortable: true },
            { key: 'issue', label: 'Issue', className: 'max-w-[240px]' },
            { key: 'recommendation', label: 'Recommendation', className: 'max-w-[240px]' },
            {
              key: 'estimatedMonthlySaving',
              label: 'Monthly Saving',
              sortable: true,
              render: (v) => (
                <span className="font-semibold text-green-600">{formatCurrency(Number(v))}</span>
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
                  onClick={() => {
                    setImplementing(String(v));
                    implementMutation.mutate(row as unknown as StorageItem);
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
