'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StaleBanner } from '@/components/ui/StaleBanner';
import { fetchAHB, markImplemented, AHBItem } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Award, DollarSign, Copy, CheckCircle } from 'lucide-react';
import { useState } from 'react';

export default function HybridBenefitPage() {
  const qc = useQueryClient();
  const [implementing, setImplementing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['ahb'],
    queryFn: fetchAHB,
  });

  const implementMutation = useMutation({
    mutationFn: (item: AHBItem) =>
      markImplemented({
        recommendationType: 'ahb',
        id: item.id,
        subscriptionId: item.subscriptionId,
        resourceName: item.resourceName,
        resourceId: item.resourceId,
        resourceGroup: item.resourceGroup,
        category: 'Azure Hybrid Benefit',
        projectedMonthlySaving: item.savingWithAHB,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ahb'] });
      qc.invalidateQueries({ queryKey: ['savings'] });
      setImplementing(null);
    },
  });

  const copyPowerShell = async (command: string, id: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback
    }
  };

  const recommendations = data?.data ?? [];
  const totalSaving = data?.summary.totalMonthlySaving ?? 0;

  if (error) {
    return (
      <AppLayout>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          Failed to load Azure Hybrid Benefit data.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Azure Hybrid Benefit Scanner</h2>
            <p className="text-sm text-slate-500">Resources eligible for AHB that are not using it</p>
          </div>
          <StaleBanner lastUpdated={data?.lastScanned} maxAgeHours={24} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <MetricCard
            title="Total Monthly Savings"
            value={formatCurrency(totalSaving)}
            icon={DollarSign}
            iconClassName="bg-green-600"
            loading={isLoading}
          />
          <MetricCard
            title="Resources Eligible"
            value={String(recommendations.length)}
            icon={Award}
            iconClassName="bg-blue-600"
            loading={isLoading}
          />
          <MetricCard
            title="Windows VMs"
            value={String(data?.summary.windowsVMs ?? 0)}
            icon={Award}
            iconClassName="bg-slate-600"
            loading={isLoading}
          />
          <MetricCard
            title="SQL VMs"
            value={String(data?.summary.sqlVMs ?? 0)}
            icon={Award}
            iconClassName="bg-amber-600"
            loading={isLoading}
          />
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="font-semibold text-blue-800 mb-1">What is Azure Hybrid Benefit?</h3>
          <p className="text-sm text-blue-700">
            Azure Hybrid Benefit allows you to use existing Windows Server and SQL Server licenses
            on Azure VMs, reducing costs by up to <strong>40%</strong> for Windows Server and
            up to <strong>55%</strong> for SQL Server. Enable it with a single PowerShell command.
          </p>
        </div>

        <DataTable
          data={recommendations}
          loading={isLoading}
          searchKeys={['resourceName', 'resourceGroup', 'subscriptionId']}
          emptyMessage="No AHB opportunities found. All eligible resources may already have it enabled."
          columns={[
            { key: 'resourceName', label: 'Resource Name', sortable: true },
            {
              key: 'resourceType',
              label: 'Type',
              sortable: true,
              render: (v) => <Badge variant="info">{String(v)}</Badge>,
            },
            { key: 'resourceGroup', label: 'Resource Group', sortable: true },
            { key: 'sku', label: 'SKU', className: 'font-mono text-xs' },
            { key: 'location', label: 'Region', sortable: true },
            {
              key: 'savingWithAHB',
              label: 'Monthly Saving',
              sortable: true,
              render: (v) => (
                <span className="font-semibold text-green-600">{formatCurrency(Number(v))}</span>
              ),
            },
            {
              key: 'powershellCommand',
              label: 'Enable AHB',
              render: (v, row) => (
                <Button
                  size="sm"
                  variant="outline"
                  icon={
                    copied === String(row['id']) ? (
                      <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )
                  }
                  onClick={() => copyPowerShell(String(v), String(row['id']))}
                >
                  {copied === String(row['id']) ? 'Copied!' : 'Copy PS'}
                </Button>
              ),
            },
            {
              key: 'id',
              label: 'Action',
              render: (v, row) => (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<CheckCircle className="w-3.5 h-3.5" />}
                  loading={implementing === String(v)}
                  onClick={() => {
                    setImplementing(String(v));
                    implementMutation.mutate(row as unknown as AHBItem);
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
