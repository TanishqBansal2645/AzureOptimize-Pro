'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  fetchDismissed,
  restoreRecommendation,
  DismissedItem,
  DismissedType,
} from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { XCircle, DollarSign, RotateCcw } from 'lucide-react';

const TYPE_LABELS: Record<DismissedType, string> = {
  rightsizing: 'VM Rightsizing',
  ahb: 'Hybrid Benefit',
  storage: 'Storage',
  idle: 'Idle Resource',
  database: 'Database',
  asp: 'ASP Rightsizing',
};

const TYPE_BADGE_VARIANT: Record<DismissedType, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  rightsizing: 'info',
  ahb: 'success',
  storage: 'warning',
  idle: 'danger',
  database: 'default',
  asp: 'info',
};

export default function DismissedPage() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['dismissed'],
    queryFn: fetchDismissed,
  });

  const restoreMutation = useMutation({
    mutationFn: (item: DismissedItem) =>
      restoreRecommendation(item.type, item.id, item.subscriptionId),
    onSuccess: (_data, item) => {
      qc.invalidateQueries({ queryKey: ['dismissed'] });
      qc.invalidateQueries({ queryKey: [item.type] });
    },
  });

  const dismissed = data?.data ?? [];
  const totalSaving = data?.summary.totalMonthlySaving ?? 0;

  if (error) {
    return (
      <AppLayout>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          Failed to load dismissed recommendations.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Dismissed Recommendations</h2>
          <p className="text-sm text-slate-500">
            Recommendations you have dismissed. They will not reappear after rescans. Restore to make them active again.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MetricCard
            title="Dismissed Items"
            value={String(dismissed.length)}
            icon={XCircle}
            iconClassName="bg-slate-500"
            loading={isLoading}
          />
          <MetricCard
            title="Deferred Monthly Saving"
            value={formatCurrency(totalSaving)}
            icon={DollarSign}
            iconClassName="bg-amber-500"
            loading={isLoading}
          />
        </div>

        <DataTable
          data={dismissed}
          loading={isLoading}
          searchKeys={['resourceName', 'resourceGroup', 'subscriptionId', 'details']}
          emptyMessage="No dismissed recommendations. Dismiss items from the optimization pages to track them here."
          columns={[
            {
              key: 'type',
              label: 'Category',
              sortable: true,
              render: (v) => {
                const t = v as DismissedType;
                const variant = TYPE_BADGE_VARIANT[t] ?? 'default';
                return (
                  <Badge variant={variant}>
                    {TYPE_LABELS[t] ?? String(v)}
                  </Badge>
                );
              },
            },
            { key: 'resourceName', label: 'Resource', sortable: true },
            { key: 'resourceGroup', label: 'Resource Group', sortable: true },
            {
              key: 'details',
              label: 'Details',
              render: (v) => (
                <span className="text-xs text-slate-500 truncate max-w-xs block">{String(v)}</span>
              ),
            },
            {
              key: 'estimatedMonthlySaving',
              label: 'Potential Saving',
              sortable: true,
              render: (v) =>
                Number(v) > 0 ? (
                  <span className="font-medium text-amber-600">{formatCurrency(Number(v))}</span>
                ) : (
                  <span className="text-slate-400 text-xs">—</span>
                ),
            },
            {
              key: 'id',
              label: 'Action',
              render: (_, row) => {
                const item = row as unknown as DismissedItem;
                return (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RotateCcw className="w-3.5 h-3.5" />}
                    onClick={() => restoreMutation.mutate(item)}
                    disabled={restoreMutation.isPending}
                  >
                    Restore
                  </Button>
                );
              },
            },
          ]}
        />
      </div>
    </AppLayout>
  );
}
