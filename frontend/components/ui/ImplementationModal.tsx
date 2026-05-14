'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, AlertTriangle, ShieldCheck, ShieldAlert, Clock, RefreshCw,
  CheckCircle2, Terminal, ExternalLink, Info, Zap, DollarSign,
  Copy, Check, Bot, Lightbulb,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { executeRemediation, RemediationResponse } from '@/lib/api';
import {
  RemediationContext,
  getRiskProfile,
  buildActionDescription,
} from '@/lib/remediationMeta';
import { AZURE_ERROR_PATTERNS } from '@/lib/azureErrorPatterns';

interface Props {
  context: RemediationContext;
  onClose: () => void;
  onSuccess: (result: RemediationResponse) => void;
}

const RISK_STYLES = {
  Low:    { pill: 'bg-green-100 text-green-700',  icon: ShieldCheck,  bar: 'bg-green-500' },
  Medium: { pill: 'bg-amber-100 text-amber-700',  icon: ShieldAlert,  bar: 'bg-amber-500' },
  High:   { pill: 'bg-red-100 text-red-700',      icon: AlertTriangle, bar: 'bg-red-500'  },
} as const;

export function ImplementationModal({ context, onClose, onSuccess }: Props) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult]             = useState<RemediationResponse | null>(null);
  const [copied, setCopied]             = useState(false);
  const qc = useQueryClient();

  const profile     = getRiskProfile(context.type, context.resourceType);
  const actionDesc  = buildActionDescription(context);
  const riskStyles  = RISK_STYLES[profile.risk];
  const RiskIcon    = riskStyles.icon;

  const mutation = useMutation({
    mutationFn: () =>
      executeRemediation({
        type: context.type,
        recommendationId: context.recommendationId,
        resourceId: context.resourceId,
        resourceName: context.resourceName,
        resourceType: context.resourceType,
        resourceGroup: context.resourceGroup,
        subscriptionId: context.subscriptionId,
        monthlySaving: context.monthlySaving,
        recommendedSku: context.recommendedSku,
        details: context.details ? JSON.stringify(context.details) : undefined,
        term: context.term,
        notes: context.notes,
      }),
    onSuccess: (res) => {
      setResult(res);
      // Invalidate relevant queries
      qc.invalidateQueries({ queryKey: [context.type === 'idle' ? 'idle-resources' : context.type] });
      qc.invalidateQueries({ queryKey: ['savings'] });
      qc.invalidateQueries({ queryKey: ['implementations'] });
    },
  });

  const handleProceed = () => {
    if (!acknowledged) return;
    mutation.mutate();
  };

  const handleDone = () => {
    if (result) onSuccess(result);
    onClose();
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !mutation.isPending) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in-up">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-semibold text-slate-900">Confirm Implementation</h2>
          </div>
          {!mutation.isPending && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4 text-slate-500" />
            </button>
          )}
        </div>

        {/* ── Result State ── */}
        {result ? (
          <div className="p-6 space-y-4">

            {/* ── Failed ── */}
            {result.status === 'failed' ? (() => {
              const pattern = result.errorCode ? AZURE_ERROR_PATTERNS[result.errorCode] : undefined;
              const aiPrompt = [
                'Azure cost optimization tool — automated remediation failed.',
                '',
                `Operation: ${context.type} on ${context.resourceName} (${context.resourceType})`,
                `Resource Group: ${context.resourceGroup}`,
                `Azure Error Code: ${result.errorCode ?? 'Unknown'}`,
                `Error: ${result.errorMessage ?? result.action}`,
                '',
                'What caused this error and how do I fix it in Azure?',
              ].join('\n');

              const handleCopy = async () => {
                try {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    await navigator.clipboard.writeText(aiPrompt);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }
                } catch {
                  // Clipboard access denied or page not focused — silently ignore
                }
              };

              return (
                <div className="space-y-4">
                  {/* Error header */}
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-red-800">Implementation Failed</p>
                      <p className="text-sm mt-0.5 text-red-700">{result.errorMessage ?? result.action}</p>
                      {result.errorCode && result.errorCode !== 'Unknown' && (
                        <p className="text-xs mt-1.5 font-mono text-red-400">
                          Azure error code: {result.errorCode}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Known error pattern — show guidance */}
                  {pattern ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <Lightbulb className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-amber-800">{pattern.title}</p>
                          <p className="text-sm text-amber-700 mt-0.5">{pattern.explanation}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                          Suggested fixes
                        </p>
                        <ul className="space-y-2">
                          {pattern.suggestions.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                              <span className="text-slate-400 shrink-0 mt-0.5">→</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      {pattern.docLink && (
                        <a
                          href={pattern.docLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Azure Documentation
                        </a>
                      )}
                    </div>
                  ) : (
                    /* Unknown error — Ask AI fallback */
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <Bot className="w-4 h-4 text-slate-500" />
                        Ask AI for help
                      </div>
                      <p className="text-xs text-slate-500">
                        Copy the prompt below and paste it in ChatGPT for a diagnosis and fix.
                      </p>
                      <pre className="bg-slate-900 text-slate-200 text-xs p-3 rounded-lg whitespace-pre-wrap leading-relaxed font-mono max-h-36 overflow-y-auto">
                        {aiPrompt}
                      </pre>
                      <div className="flex gap-2">
                        <button
                          onClick={handleCopy}
                          className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                        >
                          {copied
                            ? <><Check className="w-3.5 h-3.5 text-green-600" />Copied</>
                            : <><Copy className="w-3.5 h-3.5" />Copy prompt</>
                          }
                        </button>
                        <a
                          href="https://chatgpt.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open ChatGPT
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })() : (
              /* ── Success / Manual ── */
              <div className="space-y-4">
                <div
                  className={`flex items-start gap-3 p-4 rounded-xl border ${
                    result.automated ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'
                  }`}
                >
                  {result.automated ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className={`font-semibold text-sm ${result.automated ? 'text-green-800' : 'text-blue-800'}`}>
                      {result.automated ? 'Implementation Successful' : 'Manual Action Required'}
                    </p>
                    <p className={`text-sm mt-0.5 ${result.automated ? 'text-green-700' : 'text-blue-700'}`}>
                      {result.action}
                    </p>
                    {result.details && (
                      <p className="text-xs mt-1 text-slate-500">{result.details}</p>
                    )}
                  </div>
                </div>

                {/* Manual instructions */}
                {!result.automated && (result.powershellCommand || result.cliCommand || result.portalUrl) && (
                  <div className="space-y-3">
                    {result.portalUrl && (
                      <a
                        href={result.portalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Open Azure Portal
                      </a>
                    )}
                    {(result.powershellCommand || result.cliCommand) && (
                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                          <Terminal className="w-3.5 h-3.5" />
                          Run in PowerShell / Azure CLI:
                        </p>
                        <pre className="bg-slate-900 text-green-400 text-xs p-3 rounded-lg overflow-x-auto leading-relaxed whitespace-pre-wrap">
                          {result.powershellCommand ?? result.cliCommand}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleDone}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ── Disclaimer State ── */
          <div className="p-6 space-y-5">

            {/* Resource identity */}
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500 mb-1">{context.resourceType} · {context.resourceGroup}</p>
              <p className="font-semibold text-slate-900 text-sm">{context.resourceName}</p>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{context.subscriptionId}</p>
            </div>

            {/* Action description */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Action</p>
              <p className="text-sm text-slate-800 font-medium">{actionDesc}</p>
            </div>

            {/* Risk overview grid */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Impact Assessment</p>
              <div className="grid grid-cols-2 gap-2">
                {/* Risk level */}
                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${riskStyles.pill}`}>
                  <RiskIcon className="w-4 h-4 shrink-0" />
                  <div>
                    <p className="text-xs font-bold">{profile.risk} Risk</p>
                  </div>
                </div>
                {/* Downtime */}
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-100 text-slate-700">
                  <Clock className="w-4 h-4 shrink-0" />
                  <div>
                    <p className="text-xs font-bold">Downtime</p>
                    <p className="text-xs">{profile.downtime}</p>
                  </div>
                </div>
                {/* Reversible */}
                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${profile.reversible ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  <RefreshCw className="w-4 h-4 shrink-0" />
                  <div>
                    <p className="text-xs font-bold">{profile.reversible ? 'Reversible' : 'Irreversible'}</p>
                  </div>
                </div>
                {/* Timing */}
                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${profile.recommendedTime === 'Anytime' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  <Clock className="w-4 h-4 shrink-0" />
                  <div>
                    <p className="text-xs font-bold">{profile.recommendedTime}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Cost savings */}
            {context.monthlySaving > 0 && (
              <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
                <DollarSign className="w-5 h-5 text-green-600 shrink-0" />
                <div>
                  <p className="text-xs text-green-600 font-medium">Cost Savings</p>
                  <p className="text-sm font-bold text-green-700">
                    {formatCurrency(context.monthlySaving)}/month · {formatCurrency(context.monthlySaving * 12)}/year
                  </p>
                </div>
              </div>
            )}

            {/* What will happen */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {profile.automated ? 'What will happen automatically' : 'What you need to do'}
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
                ? 'This action will be executed automatically in your Azure tenant via Managed Identity.'
                : 'This action requires manual steps. Instructions will be shown after you proceed.'}
            </div>

            {/* Error display */}
            {mutation.isError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{mutation.error instanceof Error ? mutation.error.message : 'Execution failed. Check API logs.'}</span>
              </div>
            )}

            {/* Acknowledge */}
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-300 text-blue-600 accent-blue-600 shrink-0"
              />
              <span className="text-sm text-slate-700">
                I acknowledge the impacts described above and approve this change to my Azure environment.
              </span>
            </label>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                disabled={mutation.isPending}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleProceed}
                disabled={!acknowledged || mutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors active:scale-[0.97]"
              >
                {mutation.isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Executing…
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Proceed with Implementation
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
