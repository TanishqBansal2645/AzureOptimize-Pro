'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { fetchReports, generateReport } from '@/lib/api';
import { formatDateTime, formatDateShort } from '@/lib/utils';
import { FileSpreadsheet, Download, RefreshCw, Calendar } from 'lucide-react';
import { useState } from 'react';

export default function ReportsPage() {
  const qc = useQueryClient();
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [generating, setGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<{ url: string; name: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['reports'],
    queryFn: fetchReports,
  });

  const generateMutation = useMutation({
    mutationFn: () => generateReport(selectedMonth),
    onSuccess: (result) => {
      setLastGenerated({ url: result.downloadUrl, name: result.fileName });
      setGenerating(false);
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: () => setGenerating(false),
  });

  const reports = data?.data ?? [];

  // Month picker options: last 12 months
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  if (error) {
    return (
      <AppLayout>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          Failed to load reports. Please try again.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Excel Reports</h2>
          <p className="text-sm text-slate-500">
            Generate and download comprehensive Azure cost optimization reports
          </p>
        </div>

        {/* Generate report card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Generate New Report</h3>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Report Month</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {new Date(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button
              icon={<FileSpreadsheet className="w-4 h-4" />}
              loading={generating || generateMutation.isPending}
              onClick={() => {
                setGenerating(true);
                generateMutation.mutate();
              }}
            >
              Generate Excel Report
            </Button>
          </div>

          {lastGenerated && (
            <div className="mt-4 flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
              <FileSpreadsheet className="w-5 h-5 text-green-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-green-800">Report ready!</p>
                <p className="text-xs text-green-600 truncate">{lastGenerated.name}</p>
              </div>
              <a
                href={lastGenerated.url}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
              >
                <Download className="w-4 h-4" />
                Download
              </a>
            </div>
          )}

          <div className="mt-4 p-4 bg-slate-50 rounded-lg">
            <p className="text-xs font-medium text-slate-600 mb-2">Report includes 2 worksheets:</p>
            <div className="flex flex-col gap-2">
              {[
                {
                  name: 'Cost & Savings Overview',
                  desc: 'MTD spend, forecasts, savings implemented, top services, budget status',
                  color: 'bg-blue-500',
                },
                {
                  name: 'Recommendations',
                  desc: 'All open opportunities (priority-coloured) + all implemented savings in one place',
                  color: 'bg-green-500',
                },
              ].map((tab) => (
                <div key={tab.name} className="flex items-start gap-2">
                  <span className={`w-2 h-2 rounded-full ${tab.color} shrink-0 mt-1`} />
                  <div>
                    <p className="text-xs font-semibold text-slate-700">{tab.name}</p>
                    <p className="text-xs text-slate-500">{tab.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Report history */}
        <div>
          <h3 className="font-semibold text-slate-800 mb-3">Report History</h3>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
            </div>
          ) : reports.length === 0 ? (
            <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-slate-200">
              <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>No reports generated yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {reports.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-4 bg-white rounded-xl border border-slate-200 px-4 py-3"
                >
                  <FileSpreadsheet className="w-8 h-8 text-green-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 text-sm">
                      {new Date(r.reportMonth + '-01').toLocaleDateString('en-US', {
                        month: 'long',
                        year: 'numeric',
                      })} Report
                    </p>
                    <p className="text-xs text-slate-500">
                      Generated {formatDateTime(r.generatedAt)} by {r.generatedBy}
                    </p>
                  </div>
                  <Badge variant={r.status === 'ready' ? 'success' : r.status === 'error' ? 'danger' : 'default'}>
                    {r.status}
                  </Badge>
                  {r.status === 'ready' && r.downloadUrl && (
                    <a
                      href={r.downloadUrl}
                      download
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
