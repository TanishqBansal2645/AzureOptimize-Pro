'use client';

import { getAccessToken } from './auth';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:7071/api';

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers ?? {}) },
  });

  if (!res.ok) {
    let errorMessage = `HTTP ${res.status}`;
    try {
      const errBody = await res.json() as { error?: string };
      errorMessage = errBody.error ?? errorMessage;
    } catch {
      // Ignore JSON parse errors for error responses
    }
    throw new Error(errorMessage);
  }

  return res.json() as Promise<T>;
}

// ─── Cost Data ────────────────────────────────────────────────────────────────

export interface CostSummaryResponse {
  data: Array<{
    subscriptionId: string;
    subscriptionName: string;
    month: string;
    mtdTotal: number;
    forecastedTotal: number;
    previousMonthTotal: number;
    currency: string;
    dailySpend: Array<{ date: string; cost: number }>;
    serviceBreakdown: Array<{ serviceName: string; cost: number }>;
    resourceGroupBreakdown: Array<{ resourceGroupName: string; cost: number }>;
    topResources: Array<{ resourceName: string; resourceType: string; resourceGroup: string; cost: number }>;
    collectedAt: string;
  }>;
  lastUpdated: string | null;
}

export async function fetchCosts(subscriptionId = 'all'): Promise<CostSummaryResponse> {
  return apiFetch<CostSummaryResponse>(`costs?subscriptionId=${subscriptionId}`);
}

export async function refreshCosts(): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('costs/refresh', { method: 'POST' });
}

export interface RefreshResult {
  scanner: string;
  status: 'ok' | 'error';
  error?: string;
}

export async function refreshAll(): Promise<{ message: string; results: RefreshResult[] }> {
  return apiFetch<{ message: string; results: RefreshResult[] }>('refresh', { method: 'POST' });
}

// ─── Idle Resources ───────────────────────────────────────────────────────────

export interface IdleResourceItem {
  id: string;
  resourceId: string;
  resourceType: string;
  resourceName: string;
  resourceGroup: string;
  subscriptionId: string;
  location: string;
  estimatedMonthlyCost: number;
  detectedAt: string;
  status: string;
}

export interface IdleResourcesResponse {
  data: IdleResourceItem[];
  summary: {
    totalCount: number;
    totalMonthlyWaste: number;
    byCategory: Record<string, number>;
  };
  lastScanned: string | null;
}

export async function fetchIdleResources(category?: string): Promise<IdleResourcesResponse> {
  const q = category ? `?category=${encodeURIComponent(category)}` : '';
  return apiFetch<IdleResourcesResponse>(`idle-resources${q}`);
}

export async function updateIdleStatus(
  ids: string[],
  subscriptionId: string,
  status: 'reviewed' | 'dismissed'
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('idle-resources/status', {
    method: 'PATCH',
    body: JSON.stringify({ ids, subscriptionId, status }),
  });
}

// ─── VM Rightsizing ───────────────────────────────────────────────────────────

export interface RightsizingItem {
  id: string;
  resourceId: string;
  vmName: string;
  resourceGroup: string;
  subscriptionId: string;
  location: string;
  currentSku: string;
  recommendedSku: string;
  cpuAvg: number;
  cpuP95: number;
  memoryAvg: number;
  memoryP95: number;
  currentMonthlyCost: number;
  recommendedMonthlyCost: number;
  monthlySaving: number;
  confidence: 'High' | 'Medium';
  analyzedAt: string;
  status: string;
}

export interface RightsizingResponse {
  data: RightsizingItem[];
  summary: { totalCount: number; totalMonthlySaving: number };
  lastAnalyzed: string | null;
}

export async function fetchRightsizing(): Promise<RightsizingResponse> {
  return apiFetch<RightsizingResponse>('rightsizing');
}

// ─── Reservations ─────────────────────────────────────────────────────────────

export interface ReservationItem {
  id: string;
  resourceType: string;
  region: string;
  scope: string;
  subscriptionId: string;
  currentMonthlyCost: number;
  oneYearMonthlyCost: number;
  threeYearMonthlyCost: number;
  oneYearSaving: number;
  threeYearSaving: number;
  oneYearPaybackMonths: number;
  threeYearPaybackMonths: number;
  term: string;
  fetchedAt: string;
}

export interface ReservationsResponse {
  data: ReservationItem[];
  summary: {
    totalCount: number;
    totalOneYearMonthlySaving: number;
    totalThreeYearMonthlySaving: number;
  };
  lastFetched: string | null;
}

export async function fetchReservations(): Promise<ReservationsResponse> {
  return apiFetch<ReservationsResponse>('reservations');
}

// ─── AHB ──────────────────────────────────────────────────────────────────────

export interface AHBItem {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  location: string;
  sku: string;
  currentMonthlyCost: number;
  savingWithAHB: number;
  powershellCommand: string;
  scannedAt: string;
  status: string;
}

export interface AHBResponse {
  data: AHBItem[];
  summary: {
    totalCount: number;
    totalMonthlySaving: number;
    windowsVMs: number;
    sqlVMs: number;
  };
  lastScanned: string | null;
}

export async function fetchAHB(): Promise<AHBResponse> {
  return apiFetch<AHBResponse>('ahb');
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export interface StorageItem {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  issue: string;
  recommendation: string;
  estimatedMonthlySaving: number;
  scannedAt: string;
  status: string;
}

export interface StorageResponse {
  data: StorageItem[];
  summary: { totalCount: number; totalMonthlySaving: number; byType: Record<string, number> };
  lastScanned: string | null;
}

export async function fetchStorage(): Promise<StorageResponse> {
  return apiFetch<StorageResponse>('storage');
}

// ─── Databases ────────────────────────────────────────────────────────────────

export interface DatabaseItem {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  currentTier: string;
  avgUtilization: number;
  recommendation: string;
  estimatedMonthlySaving: number;
  details?: Record<string, unknown>;
  scannedAt: string;
  status: string;
}

export interface DatabaseResponse {
  data: DatabaseItem[];
  summary: { totalCount: number; totalMonthlySaving: number };
  lastScanned: string | null;
}

export async function fetchDatabases(): Promise<DatabaseResponse> {
  return apiFetch<DatabaseResponse>('databases');
}

// ─── ASP Rightsizing ──────────────────────────────────────────────────────────

export interface ASPItem {
  id: string;
  resourceId: string;
  aspName: string;
  resourceGroup: string;
  subscriptionId: string;
  location: string;
  currentSku: string;
  recommendedSku: string;
  currentTier: string;
  recommendedTier: string;
  numberOfSites: number;
  cpuAvg: number;
  memoryAvg: number;
  currentMonthlyCost: number;
  recommendedMonthlyCost: number;
  monthlySaving: number;
  analyzedAt: string;
  status: string;
}

export interface ASPResponse {
  data: ASPItem[];
  summary: { totalCount: number; totalMonthlySaving: number };
  lastAnalyzed: string | null;
}

export async function fetchASP(): Promise<ASPResponse> {
  return apiFetch<ASPResponse>('asp');
}

// ─── Dismissed Recommendations ────────────────────────────────────────────────

export type DismissedType = 'rightsizing' | 'ahb' | 'storage' | 'idle' | 'database' | 'asp';

export interface DismissedItem {
  id: string;
  type: DismissedType;
  resourceName: string;
  resourceGroup: string;
  subscriptionId: string;
  estimatedMonthlySaving: number;
  details: string;
}

export interface DismissedResponse {
  data: DismissedItem[];
  summary: { totalCount: number; totalMonthlySaving: number };
}

export async function fetchDismissed(): Promise<DismissedResponse> {
  return apiFetch<DismissedResponse>('dismissed');
}

export async function dismissRecommendation(
  type: DismissedType,
  id: string,
  subscriptionId: string
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('recommendations/dismiss', {
    method: 'POST',
    body: JSON.stringify({ type, id, subscriptionId }),
  });
}

export async function restoreRecommendation(
  type: DismissedType,
  id: string,
  subscriptionId: string
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('recommendations/restore', {
    method: 'POST',
    body: JSON.stringify({ type, id, subscriptionId }),
  });
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

export interface BudgetItem {
  id: string;
  name: string;
  scope: string;
  scopeType: string;
  amount: number;
  currentSpend: number;
  forecastedSpend: number;
  percentUsed: number;
  status: 'On Track' | 'At Risk' | 'Over';
  startDate: string;
  endDate: string;
  contactEmails: string[];
  updatedAt: string;
}

export interface BudgetsResponse {
  data: BudgetItem[];
}

export async function fetchBudgets(): Promise<BudgetsResponse> {
  return apiFetch<BudgetsResponse>('budgets');
}

export async function createBudget(payload: {
  name: string;
  subscriptionId: string;
  resourceGroup?: string;
  amount: number;
  contactEmails: string[];
}): Promise<{ message: string; id: string }> {
  return apiFetch<{ message: string; id: string }>('budgets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteBudget(
  id: string,
  subscriptionId: string
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('budgets', {
    method: 'DELETE',
    body: JSON.stringify({ id, subscriptionId }),
  });
}

// ─── Savings ──────────────────────────────────────────────────────────────────

export interface SavingsItem {
  id: string;
  category: string;
  resourceName: string;
  projectedMonthlySaving: number;
  implementedBy: string;
  implementedByEmail: string;
  notes: string;
  implementedAt: string;
}

export interface SavingsResponse {
  data: SavingsItem[];
  summary: {
    totalAllTime: number;
    totalThisMonth: number;
    licenseCost: number;
    roi: number;
    paybackAchieved: boolean;
    paybackDate: string | null;
    monthlyBreakdown: Array<{ month: string; saving: number }>;
  };
}

export async function fetchSavings(): Promise<SavingsResponse> {
  return apiFetch<SavingsResponse>('savings');
}

// ─── Mark Implemented ────────────────────────────────────────────────────────

export interface MarkImplementedPayload {
  recommendationType: 'idle' | 'rightsizing' | 'ahb' | 'storage' | 'databases' | 'reservations' | 'asp';
  id: string;
  subscriptionId: string;
  resourceName: string;
  resourceId: string;
  resourceGroup: string;
  category: string;
  projectedMonthlySaving: number;
  notes?: string;
}

export async function markImplemented(
  payload: MarkImplementedPayload
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('recommendations/implement', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface ReportItem {
  id: string;
  reportMonth: string;
  generatedAt: string;
  generatedBy: string;
  downloadUrl: string;
  status: string;
}

export interface ReportsResponse {
  data: ReportItem[];
}

export async function fetchReports(): Promise<ReportsResponse> {
  return apiFetch<ReportsResponse>('reports');
}

export async function generateReport(month: string): Promise<{
  reportId: string;
  fileName: string;
  downloadUrl: string;
  reportMonth: string;
}> {
  return apiFetch('reports/generate', {
    method: 'POST',
    body: JSON.stringify({ month }),
  });
}

// ─── Remediation (automated implementation) ──────────────────────────────────

export interface RemediatePayload {
  type: 'idle' | 'rightsizing' | 'ahb' | 'storage' | 'databases' | 'reservations' | 'asp';
  recommendationId: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  monthlySaving: number;
  recommendedSku?: string;
  details?: string;
  term?: '1Year' | '3Year';
  notes?: string;
}

export interface RemediationResponse {
  implementationId: string;
  action: string;
  status: 'succeeded' | 'running' | 'failed' | 'manual';
  automated: boolean;
  details?: string;
  portalUrl?: string;
  powershellCommand?: string;
  cliCommand?: string;
  errorCode?: string;
  errorMessage?: string;
}

export async function executeRemediation(
  payload: RemediatePayload
): Promise<RemediationResponse> {
  return apiFetch<RemediationResponse>('remediation/execute', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Implementations log ──────────────────────────────────────────────────────

export interface ImplementationRecord {
  id: string;
  type: string;
  resourceId: string;
  resourceType: string;
  resourceName: string;
  resourceGroup: string;
  subscriptionId: string;
  action: string;
  status: 'running' | 'succeeded' | 'failed' | 'manual';
  automated: boolean;
  monthlySaving: number;
  initiatedBy: string;
  initiatedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  notes: string | null;
}

export interface ImplementationsResponse {
  data: ImplementationRecord[];
}

export async function fetchImplementations(): Promise<ImplementationsResponse> {
  return apiFetch<ImplementationsResponse>('implementations');
}

// ─── Config / Branding ───────────────────────────────────────────────────────

export async function fetchConfig(): Promise<{ companyName: string }> {
  try {
    const res = await fetch(`${BASE_URL}/config`);
    if (!res.ok) return { companyName: '' };
    return res.json() as Promise<{ companyName: string }>;
  } catch {
    return { companyName: '' };
  }
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function fetchHealth(): Promise<{
  status: string;
  timestamp: string;
  version: string;
}> {
  const res = await fetch(`${BASE_URL}/health`);
  return res.json() as Promise<{ status: string; timestamp: string; version: string }>;
}
