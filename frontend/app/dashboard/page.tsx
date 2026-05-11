'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { DataTable } from '@/components/ui/DataTable';
import { StaleBanner } from '@/components/ui/StaleBanner';
import { SpendBarChart, SpendLineChart } from '@/components/charts/SpendChart';
import { fetchCosts, refreshAll } from '@/lib/api';
import { formatCurrency, calculateMoMChange, formatPercent } from '@/lib/utils';
import { DollarSign, TrendingUp, TrendingDown, RefreshCw, Activity } from 'lucide-react';
import { useState } from 'react';

export default function DashboardPage() {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['costs'],
    queryFn: () => fetchCosts(),
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshStatus('Running all scans — this takes 1–3 minutes…');
    try {
      const result = await refreshAll();
      const failed = result.results.filter((r) => r.status === 'error');
      if (failed.length > 0) {
        setRefreshStatus(`Done (${failed.length} scanner(s) had errors — check API logs)`);
      } else {
        setRefreshStatus(null);
      }
      // Invalidate all cached data so every page shows fresh results
      await queryClient.invalidateQueries();
      await refetch();
    } catch (err) {
      console.error('Refresh failed:', err);
      setRefreshStatus('Refresh failed — see browser console for details');
    } finally {
      setRefreshing(false);
    }
  };

  // Aggregate across subscriptions
  const costs = data?.data ?? [];
  const totalMTD = costs.reduce((s, d) => s + d.mtdTotal, 0);
  const totalForecasted = costs.reduce((s, d) => s + d.forecastedTotal, 0);
  const totalPrev = costs.reduce((s, d) => s + d.previousMonthTotal, 0);
  const momChange = calculateMoMChange(totalMTD, totalPrev);

  // Aggregate daily spend
  const dailyMap: Record<string, number> = {};
  for (const sub of costs) {
    for (const d of sub.dailySpend) {
      dailyMap[d.date] = (dailyMap[d.date] ?? 0) + d.cost;
    }
  }
  const dailyData = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, cost]) => ({ date, cost }));

  // Aggregate service breakdown
  const serviceMap: Record<string, number> = {};
  for (const sub of costs) {
    for (const s of sub.serviceBreakdown) {
      serviceMap[s.serviceName] = (serviceMap[s.serviceName] ?? 0) + s.cost;
    }
  }
  const serviceData = Object.entries(serviceMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Aggregate resource groups
  const rgData = costs
    .flatMap((d) => d.resourceGroupBreakdown)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  // Top resources
  const topResources = costs
    .flatMap((d) => d.topResources)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 20);

  if (error) {
    return (
      <AppLayout>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          Failed to load cost data. Make sure the API is running and you are authenticated.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Cost Dashboard</h2>
            <p className="text-sm text-slate-500">{costs.length} subscription{costs.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-3">
            <StaleBanner lastUpdated={data?.lastUpdated} onRefresh={handleRefresh} refreshing={refreshing} />
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh All'}
            </button>
          </div>
        </div>

        {/* Refresh status banner */}
        {refreshStatus && (
          <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 flex items-center gap-2">
            {refreshing && <RefreshCw className="w-4 h-4 animate-spin shrink-0" />}
            {refreshStatus}
          </div>
        )}

        {/* Metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Month-to-Date Spend"
            value={formatCurrency(totalMTD)}
            icon={DollarSign}
            iconClassName="bg-blue-600"
            loading={isLoading}
          />
          <MetricCard
            title="Forecasted Month-End"
            value={formatCurrency(totalForecasted)}
            icon={Activity}
            iconClassName="bg-slate-700"
            loading={isLoading}
          />
          <MetricCard
            title="MoM Change ($)"
            value={`${momChange.amount >= 0 ? '+' : ''}${formatCurrency(momChange.amount)}`}
            icon={momChange.direction === 'down' ? TrendingDown : TrendingUp}
            iconClassName={momChange.direction === 'down' ? 'bg-green-600' : 'bg-red-500'}
            trend={{
              value: momChange.amount,
              label: `vs last month`,
              direction: momChange.direction,
            }}
            loading={isLoading}
          />
          <MetricCard
            title="MoM Change (%)"
            value={`${momChange.percent >= 0 ? '+' : ''}${formatPercent(momChange.percent)}`}
            icon={momChange.direction === 'down' ? TrendingDown : TrendingUp}
            iconClassName={momChange.direction === 'down' ? 'bg-green-600' : 'bg-red-500'}
            loading={isLoading}
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-800 mb-4">Daily Spend — Last 30 Days</h3>
            {isLoading ? (
              <div className="skeleton h-64 w-full" />
            ) : (
              <SpendLineChart data={dailyData} />
            )}
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-800 mb-4">Top Services by Spend</h3>
            {isLoading ? (
              <div className="skeleton h-64 w-full" />
            ) : (
              <SpendBarChart
                data={serviceData}
                xKey="name"
                yKey="value"
              />
            )}
          </div>
        </div>

        {/* Top Resource Groups */}
        <div>
          <h3 className="font-semibold text-slate-800 mb-3">Top Resource Groups</h3>
          <DataTable
            data={rgData}
            columns={[
              { key: 'resourceGroupName', label: 'Resource Group', sortable: true },
              { key: 'subscriptionId', label: 'Subscription', sortable: true },
              {
                key: 'cost',
                label: 'MTD Spend',
                sortable: true,
                render: (v) => <span className="font-semibold">{formatCurrency(Number(v))}</span>,
              },
              {
                key: 'cost',
                label: '% of Total',
                render: (v) => (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-100 rounded-full h-2 max-w-[80px]">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{ width: `${Math.min(100, totalMTD > 0 ? (Number(v) / totalMTD) * 100 : 0)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500">
                      {formatPercent(totalMTD > 0 ? (Number(v) / totalMTD) * 100 : 0)}
                    </span>
                  </div>
                ),
              },
            ]}
            emptyMessage="No resource group data yet. Data collects every 4 hours."
            loading={isLoading}
            pageSize={10}
          />
        </div>

        {/* Top Resources */}
        <div>
          <h3 className="font-semibold text-slate-800 mb-3">Top 20 Most Expensive Resources</h3>
          <DataTable
            data={topResources}
            columns={[
              { key: 'resourceName', label: 'Resource', sortable: true },
              { key: 'resourceType', label: 'Type', sortable: true },
              { key: 'resourceGroup', label: 'Resource Group', sortable: true },
              {
                key: 'cost',
                label: 'MTD Cost',
                sortable: true,
                render: (v) => <span className="font-semibold text-red-600">{formatCurrency(Number(v))}</span>,
              },
            ]}
            searchKeys={['resourceName', 'resourceType', 'resourceGroup']}
            emptyMessage="No resource data yet."
            loading={isLoading}
          />
        </div>
      </div>
    </AppLayout>
  );
}
