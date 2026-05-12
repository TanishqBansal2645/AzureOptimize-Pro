'use client';

import {
  X, ShieldCheck, ShieldAlert, AlertTriangle, Clock, RefreshCw,
  CheckCircle2, Info, DollarSign, FileText,
} from 'lucide-react';
import { formatCurrency, formatDateShort } from '@/lib/utils';
import { ImplementationRecord } from '@/lib/api';
import { getRiskProfile, RemediationContext } from '@/lib/remediationMeta';

interface Props {
  record: ImplementationRecord;
  onClose: () => void;
}

const RISK_STYLES = {
  Low:    { pill: 'bg-green-100 text-green-700',  icon: ShieldCheck,   bar: 'bg-green-500' },
  Medium: { pill: 'bg-amber-100 text-amber-700',  icon: ShieldAlert,   bar: 'bg-amber-500' },
  High:   { pill: 'bg-red-100 text-red-700',      icon: AlertTriangle, bar: 'bg-red-500'  },
} as const;

function outcomeStyle(status: ImplementationRecord['status']) {
  if (status === 'succeeded') return { bg: 'bg-green-50 border-green-200', icon: CheckCircle2, iconCls: 'text-green-600', textCls: 'text-green-800', label: 'Completed — Automated' };
  if (status === 'manual')    return { bg: 'bg-blue-50 border-blue-200',   icon: Info,         iconCls: 'text-blue-600',  textCls: 'text-blue-800',  label: 'Completed — Manual action' };
  if (status === 'running')   return { bg: 'bg-blue-50 border-blue-200',   icon: Clock,        iconCls: 'text-blue-600',  textCls: 'text-blue-800',  label: 'Running' };
  return                             { bg: 'bg-red-50 border-red-200',     icon: AlertTriangle, iconCls: 'text-red-600',  textCls: 'text-red-800',   label: 'Failed' };
}

export function ImpactViewModal({ record, onClose }: Props) {
  const type = record.type as RemediationContext['type'];
  const profile = getRiskProfile(type, record.resourceType);
  const riskStyles = RISK_STYLES[profile.risk];
  const RiskIcon = riskStyles.icon;
  const outcome = outcomeStyle(record.status);
  const OutcomeIcon = outcome.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in-up">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Implementation Impact Record</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">

          {/* Outcome banner */}
          <div className={`flex items-start gap-3 p-4 rounded-xl border ${outcome.bg}`}>
            <OutcomeIcon className={`w-5 h-5 shrink-0 mt-0.5 ${outcome.iconCls}`} />
            <div>
              <p className={`font-semibold text-sm ${outcome.textCls}`}>{outcome.label}</p>
              <p className={`text-sm mt-0.5 ${outcome.textCls} opacity-90`}>{record.action}</p>
              <p className="text-xs text-slate-400 mt-1">
                {formatDateShort(record.initiatedAt)} · by {record.initiatedBy}
              </p>
            </div>
          </div>

          {/* Resource identity */}
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500 mb-1">{record.resourceType} · {record.resourceGroup}</p>
            <p className="font-semibold text-slate-900 text-sm">{record.resourceName}</p>
            <p className="text-xs text-slate-400 mt-0.5 truncate">{record.subscriptionId}</p>
          </div>

          {/* Impact assessment — same as shown at time of action */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Impact Assessment (shown at time of action)</p>
            <div className="grid grid-cols-2 gap-2">
              <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${riskStyles.pill}`}>
                <RiskIcon className="w-4 h-4 shrink-0" />
                <div>
                  <p className="text-xs font-bold">{profile.risk} Risk</p>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-100 text-slate-700">
                <Clock className="w-4 h-4 shrink-0" />
                <div>
                  <p className="text-xs font-bold">Downtime</p>
                  <p className="text-xs">{profile.downtime}</p>
                </div>
              </div>
              <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${profile.reversible ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                <RefreshCw className="w-4 h-4 shrink-0" />
                <div>
                  <p className="text-xs font-bold">{profile.reversible ? 'Reversible' : 'Irreversible'}</p>
                </div>
              </div>
              <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${profile.recommendedTime === 'Anytime' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                <Clock className="w-4 h-4 shrink-0" />
                <div>
                  <p className="text-xs font-bold">{profile.recommendedTime}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Cost savings */}
          {record.monthlySaving > 0 && (
            <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
              <DollarSign className="w-5 h-5 text-green-600 shrink-0" />
              <div>
                <p className="text-xs text-green-600 font-medium">Cost Savings</p>
                <p className="text-sm font-bold text-green-700">
                  {formatCurrency(record.monthlySaving)}/month · {formatCurrency(record.monthlySaving * 12)}/year
                </p>
              </div>
            </div>
          )}

          {/* What was disclosed */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              {profile.automated ? 'What was disclosed — automated action' : 'What was disclosed — manual action'}
            </p>
            <ul className="space-y-1.5">
              {profile.impacts.map((impact, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0 mt-1.5" />
                  {impact}
                </li>
              ))}
            </ul>
          </div>

          {/* Execution mode note */}
          <div className={`text-xs px-3 py-2 rounded-lg ${profile.automated ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
            {profile.automated
              ? 'This action was executed automatically in the Azure tenant via Managed Identity.'
              : 'This action required manual steps. Instructions were provided at time of execution.'}
          </div>

          {/* Acknowledgement notice */}
          <div className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <CheckCircle2 className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-500">
              The initiating admin acknowledged all impacts described above before the action was executed.
            </p>
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
