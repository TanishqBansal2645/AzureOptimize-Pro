'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StaleBanner } from '@/components/ui/StaleBanner';
import { fetchIdleResources, updateIdleStatus, markImplemented, IdleResourceItem } from '@/lib/api';
import { formatCurrency, formatDateShort } from '@/lib/utils';
import { Trash2, CheckCircle, DollarSign, PlayCircle } from 'lucide-react';
import { useState } from 'react';

const categories = [
  'All',
  'Unattached Disk',
  'Orphaned Public IP',
  'Empty App Service Plan',
  'Old Snapshot',
  'Orphaned NIC',
  'Idle Load Balancer',
];

export default function IdleResourcesPage() {
  const qc = useQueryClient();
  const [activeCategory, setActiveCategory] = useState('All');
  const [implementing, setImplementing] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['idle-resources'],
    queryFn: () => fetchIdleResources(),
  });

  const dismissMutation = useMutation({
    mutationFn: ({ ids, subscriptionId }: { ids: string[]; subscriptionId: string }) =>
      updateIdleStatus(ids, subscriptionId, 'reviewed'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['idle-resources'] });
      setDismissing(null);
    },
    onError: () => setDismissing(null),
  });

  const implementMutation = useMutation({
    mutationFn: (item: IdleResourceItem) =>
      markImplemented({
        recommendationType: 'idle',
        id: item.id,
        subscriptionId: item.subscriptionId,
        resourceName: item.resourceName,
        resourceId: item.resourceId,
        resourceGroup: item.resourceGroup,
        category: `Idle: ${item.resourceType}`,
        projectedMonthlySaving: item.estimatedMonthlyCost,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['idle-resources'] });
      qc.invalidateQueries({ queryKey: ['savings'] });
      setImplementing(null);
    },
    onError: () => setImplementing(null),
  });

  const resources = data?.data ?? [];
  const filtered =
    activeCategory === 'All'
      ? resources
      : resources.filter((r) => r.resourceType === activeCategory);

  const totalWaste = data?.summary.totalMonthlyWaste ?? 0;

  if (error) {
    return (
      <AppLayout>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          Failed to load idle resources. Please try again.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Idle Resource Detector</h2>
            <p className="text-sm text-slate-500">Resources incurring cost with no active use</p>
          </div>
          <StaleBanner lastUpdated={data?.lastScanned} />
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            title="Total Monthly Waste"
            value={formatCurrency(totalWaste)}
            icon={DollarSign}
            iconClassName="bg-red-500"
            loading={isLoading}
          />
          <MetricCard
            title="Resources Found"
            value={String(resources.length)}
            icon={Trash2}
            iconClassName="bg-amber-500"
            loading={isLoading}
          />
          <MetricCard
            title="Annual Waste"
            value={formatCurrency(totalWaste * 12)}
            icon={DollarSign}
            iconClassName="bg-slate-700"
            loading={isLoading}
          />
        </div>

        {/* Category filter */}
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => {
            const count =
              cat === 'All'
                ? resources.length
                : resources.filter((r) => r.resourceType === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeCategory === cat
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {cat}
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${activeCategory === cat ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <DataTable
          data={filtered}
          loading={isLoading}
          searchKeys={['resourceName', 'resourceGroup', 'subscriptionId']}
          emptyMessage="No idle resources detected. Run a scan to check for waste."
          columns={[
            {
              key: 'resourceType',
              label: 'Category',
              sortable: true,
              render: (v) => <Badge variant="warning">{String(v)}</Badge>,
            },
            { key: 'resourceName', label: 'Resource Name', sortable: true },
            { key: 'resourceGroup', label: 'Resource Group', sortable: true },
            { key: 'location', label: 'Region', sortable: true },
            {
              key: 'estimatedMonthlyCost',
              label: 'Monthly Waste',
              sortable: true,
              render: (v) => (
                <span className="font-semibold text-red-600">{formatCurrency(Number(v))}</span>
              ),
            },
            {
              key: 'detectedAt',
              label: 'Detected',
              sortable: true,
              render: (v) => <span className="text-slate-500">{formatDateShort(String(v))}</span>,
            },
            {
              key: 'id',
              label: 'Actions',
              render: (v, row) => (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<PlayCircle className="w-3.5 h-3.5" />}
                    loading={implementing === String(v)}
                    onClick={() => {
                      setImplementing(String(v));
                      implementMutation.mutate(row as unknown as IdleResourceItem);
                    }}
                  >
                    Implement
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<CheckCircle className="w-3.5 h-3.5" />}
                    loading={dismissing === String(v)}
                    onClick={() => {
                      setDismissing(String(v));
                      dismissMutation.mutate({ ids: [String(v)], subscriptionId: String(row['subscriptionId']) });
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>
    </AppLayout>
  );
}
