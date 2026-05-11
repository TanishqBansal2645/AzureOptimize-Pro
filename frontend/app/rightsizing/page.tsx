'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StaleBanner } from '@/components/ui/StaleBanner';
import { fetchRightsizing, markImplemented, RightsizingItem } from '@/lib/api';
import { formatCurrency, formatPercent, formatDateShort } from '@/lib/utils';
import { Server, DollarSign, CheckCircle, ArrowRight } from 'lucide-react';
import { useState } from 'react';

export default function RightsizingPage() {
  const qc = useQueryClient();
  const [implementing, setImplementing] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['rightsizing'],
    queryFn: fetchRightsizing,
  });

  const implementMutation = useMutation({
    mutationFn: (item: RightsizingItem) =>
      markImplemented({
        recommendationType: 'rightsizing',
        id: item.id,
        subscriptionId: item.subscriptionId,
        resourceName: item.vmName,
        resourceId: item.resourceId,
        resourceGroup: item.resourceGroup,
        category: 'VM Rightsizing',
        projectedMonthlySaving: item.monthlySaving,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rightsizing'] });
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
          Failed to load rightsizing data.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">VM Rightsizing Engine</h2>
            <p className="text-sm text-slate-500">VMs oversized relative to actual workload (p95 CPU &lt; 40% AND p95 Memory &lt; 60%)</p>
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
            title="VMs to Rightsize"
            value={String(recommendations.length)}
            icon={Server}
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
          searchKeys={['vmName', 'resourceGroup', 'subscriptionId']}
          emptyMessage="No rightsizing recommendations. Analysis runs daily at 8am UTC."
          columns={[
            { key: 'vmName', label: 'VM Name', sortable: true },
            { key: 'resourceGroup', label: 'Resource Group', sortable: true },
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
              key: 'cpuP95',
              label: 'CPU p95',
              sortable: true,
              render: (v) => (
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-slate-100 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Number(v)}%` }} />
                  </div>
                  <span className="text-xs">{formatPercent(Number(v))}</span>
                </div>
              ),
            },
            {
              key: 'memoryP95',
              label: 'Mem p95',
              sortable: true,
              render: (v) => (
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-slate-100 rounded-full h-1.5">
                    <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${Number(v)}%` }} />
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
              key: 'confidence',
              label: 'Confidence',
              sortable: true,
              render: (v) => (
                <Badge variant={String(v) === 'High' ? 'success' : 'warning'}>{String(v)}</Badge>
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
                    implementMutation.mutate(row as unknown as RightsizingItem);
                  }}
                >
                  Implement
                </Button>
              ),
            },
          ]}
        />
      </div>
    </AppLayout>
  );
}
