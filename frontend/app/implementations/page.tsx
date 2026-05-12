'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { ImpactViewModal } from '@/components/ui/ImpactViewModal';
import { fetchImplementations, ImplementationRecord } from '@/lib/api';
import { formatCurrency, formatDateShort } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, Clock, DollarSign, FileText } from 'lucide-react';

function statusBadge(status: string) {
  if (status === 'succeeded') return <Badge variant="success">Succeeded</Badge>;
  if (status === 'failed')    return <Badge variant="danger">Failed</Badge>;
  if (status === 'running')   return <Badge variant="info">Running</Badge>;
  if (status === 'manual')    return <Badge variant="warning">Manual</Badge>;
  return <Badge variant="default">{status}</Badge>;
}

export default function ImplementationsPage() {
  const [impactRecord, setImpactRecord] = useState<ImplementationRecord | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['implementations'],
    queryFn: fetchImplementations,
    refetchInterval: 30_000,
  });

  const records = data?.data ?? [];

  const totalSaving    = records.reduce((s, r) => s + (r.monthlySaving ?? 0), 0);
  const succeeded      = records.filter((r) => r.status === 'succeeded').length;
  const manual         = records.filter((r) => r.status === 'manual').length;
  const failed         = records.filter((r) => r.status === 'failed').length;

  if (error) {
    return (
      <AppLayout>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          Failed to load implementation records.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Implementation Log</h2>
          <p className="text-sm text-slate-500">All remediation runs initiated through AzureOptimize Pro</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard
            title="Total Monthly Saving"
            value={formatCurrency(totalSaving)}
            icon={DollarSign}
            iconClassName="bg-green-600"
            loading={isLoading}
          />
          <MetricCard
            title="Automated"
            value={String(succeeded)}
            icon={CheckCircle2}
            iconClassName="bg-green-600"
            loading={isLoading}
          />
          <MetricCard
            title="Manual Actions"
            value={String(manual)}
            icon={Clock}
            iconClassName="bg-amber-500"
            loading={isLoading}
          />
          <MetricCard
            title="Failed"
            value={String(failed)}
            icon={AlertTriangle}
            iconClassName="bg-red-500"
            loading={isLoading}
          />
        </div>

        <DataTable
          data={records}
          loading={isLoading}
          pageSize={20}
          searchKeys={['resourceName', 'resourceGroup', 'initiatedBy', 'action']}
          emptyMessage="No implementations recorded yet. Use the Implement button on any recommendation page."
          columns={[
            {
              key: 'initiatedAt',
              label: 'Date',
              sortable: true,
              render: (v) => <span className="text-slate-500 text-xs">{formatDateShort(String(v))}</span>,
            },
            { key: 'resourceName', label: 'Resource', sortable: true },
            {
              key: 'type',
              label: 'Category',
              sortable: true,
              render: (v) => {
                const labels: Record<string, string> = {
                  idle: 'Idle Resource',
                  rightsizing: 'VM Rightsizing',
                  ahb: 'Hybrid Benefit',
                  storage: 'Storage',
                  databases: 'Database',
                  reservations: 'Reservation',
                };
                return <Badge variant="info">{labels[String(v)] ?? String(v)}</Badge>;
              },
            },
            { key: 'resourceGroup', label: 'Resource Group', sortable: true },
            { key: 'action', label: 'Action', className: 'max-w-[260px] text-sm' },
            {
              key: 'status',
              label: 'Status',
              sortable: true,
              render: (v) => statusBadge(String(v)),
            },
            {
              key: 'monthlySaving',
              label: 'Monthly Saving',
              sortable: true,
              render: (v) => (
                <span className="font-semibold text-green-600">{formatCurrency(Number(v))}</span>
              ),
            },
            { key: 'initiatedBy', label: 'Initiated By', sortable: true },
            {
              key: 'id',
              label: 'Impact',
              render: (_v, row) => (
                <button
                  onClick={() => setImpactRecord(row as ImplementationRecord)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Impact
                </button>
              ),
            },
          ]}
        />
      </div>

      {impactRecord && (
        <ImpactViewModal
          record={impactRecord}
          onClose={() => setImpactRecord(null)}
        />
      )}
    </AppLayout>
  );
}
