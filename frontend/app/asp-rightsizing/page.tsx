'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { StaleBanner } from '@/components/ui/StaleBanner';
import { ImplementationModal } from '@/components/ui/ImplementationModal';
import {
  fetchASP,
  dismissRecommendation,
  ASPItem,
} from '@/lib/api';
import { RemediationContext } from '@/lib/remediationMeta';
import { formatCurrency, formatPercent, formatDateShort } from '@/lib/utils';
import { Globe, DollarSign, ArrowRight, Zap, XCircle, Layers } from 'lucide-react';

export default function ASPRightsizingPage() {
  const qc = useQueryClient();
  const [modalContext, setModalContext] = useState<RemediationContext | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['asp'],
    queryFn: fetchASP,
  });

  const dismissMutation = useMutation({
    mutationFn: ({ id, subscriptionId }: { id: string; subscriptionId: string }) =>
      dismissRecommendation('asp', id, subscriptionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asp'] });
      qc.invalidateQueries({ queryKey: ['dismissed'] });
    },
  });

  const recommendations = data?.data ?? [];
  const totalSaving = data?.summary.totalMonthlySaving ?? 0;

  const openModal = (item: ASPItem) => {
    setModalContext({
      type: 'asp',
      recommendationId: item.id,
      resourceId: item.resourceId,
      resourceName: item.aspName,
      resourceType: 'App Service Plan',
      resourceGroup: item.resourceGroup,
      subscriptionId: item.subscriptionId,
      monthlySaving: item.monthlySaving,
      currentSku: item.currentSku,
      recommendedSku: item.recommendedSku,
    });
  };

  if (error) {
    return (
      <AppLayout>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          Failed to load ASP rightsizing data.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">App Service Plan Rightsizing</h2>
            <p className="text-sm text-slate-500">
              Plans running below 20% avg CPU and Memory over 30 days — eligible for downgrade within the same tier family
            </p>
          </div>
          <StaleBanner lastUpdated={data?.lastAnalyzed} maxAgeHours={24} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            title="Total Monthly Savings"
            value={formatCurrency(totalSaving)}
            icon={DollarSign}
            iconClassName="bg-green-600"
            loading={isLoading}
          />
          <MetricCard
            title="Plans to Rightsize"
            value={String(recommendations.length)}
            icon={Globe}
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
          searchKeys={['aspName', 'resourceGroup', 'subscriptionId']}
          emptyMessage="No ASP rightsizing recommendations. Analysis runs daily at 8:30am UTC."
          columns={[
            { key: 'aspName', label: 'Plan Name', sortable: true },
            { key: 'resourceGroup', label: 'Resource Group', sortable: true },
            {
              key: 'numberOfSites',
              label: 'Sites',
              sortable: true,
              render: (v) => (
                <span className="flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  {String(v)}
                </span>
              ),
            },
            {
              key: 'currentSku',
              label: 'Current → Recommended',
              render: (_, row) => (
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                    {String(row['currentSku'])}
                  </span>
                  <ArrowRight className="w-3 h-3 text-slate-400" />
                  <span className="font-mono bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                    {String(row['recommendedSku'])}
                  </span>
                </div>
              ),
            },
            {
              key: 'cpuAvg',
              label: 'Avg CPU',
              sortable: true,
              render: (v) => (
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-slate-100 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Math.min(Number(v), 100)}%` }} />
                  </div>
                  <span className="text-xs">{formatPercent(Number(v))}</span>
                </div>
              ),
            },
            {
              key: 'memoryAvg',
              label: 'Avg Memory',
              sortable: true,
              render: (v) => (
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-slate-100 rounded-full h-1.5">
                    <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${Math.min(Number(v), 100)}%` }} />
                  </div>
                  <span className="text-xs">{formatPercent(Number(v))}</span>
                </div>
              ),
            },
            {
              key: 'monthlySaving',
              label: 'Monthly Saving',
              sortable: true,
              render: (v) => (
                <span className="font-semibold text-green-600">{formatCurrency(Number(v))}</span>
              ),
            },
            {
              key: 'analyzedAt',
              label: 'Scanned',
              sortable: true,
              render: (v) => (
                <span className="text-xs text-slate-500">{formatDateShort(String(v))}</span>
              ),
            },
            {
              key: 'id',
              label: 'Actions',
              render: (_, row) => {
                const item = row as unknown as ASPItem;
                return (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Zap className="w-3.5 h-3.5" />}
                      onClick={() => openModal(item)}
                    >
                      Implement
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<XCircle className="w-3.5 h-3.5" />}
                      onClick={() =>
                        dismissMutation.mutate({ id: item.id, subscriptionId: item.subscriptionId })
                      }
                      disabled={dismissMutation.isPending}
                    >
                      Dismiss
                    </Button>
                  </div>
                );
              },
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
            qc.invalidateQueries({ queryKey: ['asp'] });
            qc.invalidateQueries({ queryKey: ['savings'] });
          }}
        />
      )}
    </AppLayout>
  );
}
