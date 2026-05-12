'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StaleBanner } from '@/components/ui/StaleBanner';
import { ImplementationModal } from '@/components/ui/ImplementationModal';
import { fetchStorage, StorageItem } from '@/lib/api';
import { RemediationContext } from '@/lib/remediationMeta';
import { formatCurrency } from '@/lib/utils';
import { HardDrive, DollarSign, Zap } from 'lucide-react';
import { useState } from 'react';

export default function StoragePage() {
  const qc = useQueryClient();
  const [modalContext, setModalContext] = useState<RemediationContext | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['storage'],
    queryFn: fetchStorage,
  });

  const recommendations = data?.data ?? [];
  const totalSaving = data?.summary.totalMonthlySaving ?? 0;

  const openModal = (item: StorageItem) => {
    setModalContext({
      type: 'storage',
      recommendationId: item.id,
      resourceId: item.resourceId ?? '',
      resourceName: item.resourceName,
      resourceType: item.resourceType,
      resourceGroup: item.resourceGroup,
      subscriptionId: item.subscriptionId,
      monthlySaving: item.estimatedMonthlySaving,
      recommendation: item.recommendation,
    });
  };

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
              render: (_, row) => (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Zap className="w-3.5 h-3.5" />}
                  onClick={() => openModal(row as unknown as StorageItem)}
                >
                  Implement
                </Button>
              ),
            },
          ]}
        />
      </div>

      {modalContext && (
        <ImplementationModal
          context={modalContext}
          onClose={() => setModalContext(null)}
          onSuccess={() => {
            setModalContext(null);
            qc.invalidateQueries({ queryKey: ['storage'] });
            qc.invalidateQueries({ queryKey: ['savings'] });
          }}
        />
      )}
    </AppLayout>
  );
}
