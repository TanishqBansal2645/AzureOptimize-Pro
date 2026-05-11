'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { MetricCard } from '@/components/ui/MetricCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { fetchBudgets, createBudget, deleteBudget, BudgetItem } from '@/lib/api';
import { formatCurrency, formatPercent } from '@/lib/utils';
import { Wallet, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/components/layout/AuthProvider';

interface NewBudget {
  name: string;
  subscriptionId: string;
  amount: string;
  contactEmails: string;
}

export default function BudgetsPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewBudget>({ name: '', subscriptionId: '', amount: '', contactEmails: '' });
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['budgets'],
    queryFn: fetchBudgets,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createBudget({
        name: form.name,
        subscriptionId: form.subscriptionId,
        amount: parseFloat(form.amount),
        contactEmails: form.contactEmails.split(',').map((e) => e.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      setShowForm(false);
      setForm({ name: '', subscriptionId: '', amount: '', contactEmails: '' });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, subscriptionId }: { id: string; subscriptionId: string }) =>
      deleteBudget(id, subscriptionId),
    onSuccess: () => {
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });

  const budgets = data?.data ?? [];
  const overBudget = budgets.filter((b) => b.status === 'Over').length;
  const atRisk = budgets.filter((b) => b.status === 'At Risk').length;

  const statusBadge = (status: BudgetItem['status']) => {
    if (status === 'Over') return <Badge variant="danger">Over Budget</Badge>;
    if (status === 'At Risk') return <Badge variant="warning">At Risk</Badge>;
    return <Badge variant="success">On Track</Badge>;
  };

  if (error) {
    return (
      <AppLayout>
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
          Failed to load budget data.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Budget Manager</h2>
            <p className="text-sm text-slate-500">Monitor and manage Azure spend budgets</p>
          </div>
          {isAdmin && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowForm(true)}>
              New Budget
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            title="Active Budgets"
            value={String(budgets.length)}
            icon={Wallet}
            iconClassName="bg-blue-600"
            loading={isLoading}
          />
          <MetricCard
            title="Over Budget"
            value={String(overBudget)}
            icon={Wallet}
            iconClassName="bg-red-500"
            loading={isLoading}
          />
          <MetricCard
            title="At Risk"
            value={String(atRisk)}
            icon={Wallet}
            iconClassName="bg-amber-500"
            loading={isLoading}
          />
        </div>

        {/* Budget grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-48 rounded-xl" />
            ))}
          </div>
        ) : budgets.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Wallet className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No budgets found</p>
            <p className="text-sm mt-1">Create a budget to track spend against limits.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {budgets.map((budget) => (
              <div
                key={budget.id}
                className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">{budget.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[200px]">{budget.scope}</p>
                  </div>
                  {statusBadge(budget.status)}
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Spent</span>
                    <span className="font-semibold">{formatCurrency(budget.currentSpend)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Budget</span>
                    <span className="font-medium">{formatCurrency(budget.amount)}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 mt-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        budget.status === 'Over'
                          ? 'bg-red-500'
                          : budget.status === 'At Risk'
                          ? 'bg-amber-500'
                          : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(100, budget.percentUsed)}%` }}
                    />
                  </div>
                  <p className="text-right text-xs text-slate-500">{formatPercent(budget.percentUsed, 0)} used</p>
                </div>

                {isAdmin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="w-3.5 h-3.5 text-red-500" />}
                    loading={deleting === budget.id}
                    onClick={() => {
                      setDeleting(budget.id);
                      deleteMutation.mutate({ id: budget.id, subscriptionId: budget.scope.split('/')[2] ?? '' });
                    }}
                    className="text-red-500 hover:bg-red-50"
                  >
                    Delete
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* New budget modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900">New Budget</h3>
                <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Budget Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Production Subscription"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subscription ID</label>
                  <input
                    type="text"
                    value={form.subscriptionId}
                    onChange={(e) => setForm({ ...form, subscriptionId: e.target.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Monthly Limit (USD)</label>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="5000"
                    min="0"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Alert Emails</label>
                  <input
                    type="text"
                    value={form.contactEmails}
                    onChange={(e) => setForm({ ...form, contactEmails: e.target.value })}
                    placeholder="admin@company.com, finance@company.com"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">Alerts sent at 80% and 100%</p>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  loading={createMutation.isPending}
                  disabled={!form.name || !form.subscriptionId || !form.amount}
                  onClick={() => createMutation.mutate()}
                >
                  Create Budget
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
