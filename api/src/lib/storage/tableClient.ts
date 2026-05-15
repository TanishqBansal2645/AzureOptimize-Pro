import {
  TableClient,
  TableEntity,
  odata,
} from '@azure/data-tables';
import { credential } from '../azure/credential';

const accountName = process.env['STORAGE_ACCOUNT_NAME'] ?? '';
const connectionString = process.env['STORAGE_CONNECTION_STRING'] ?? '';

function getTableClient(tableName: string): TableClient {
  if (connectionString && connectionString !== '') {
    return TableClient.fromConnectionString(connectionString, tableName);
  }
  const url = `https://${accountName}.table.core.windows.net`;
  return new TableClient(url, tableName, credential);
}

async function ensureTable(tableName: string): Promise<TableClient> {
  const client = getTableClient(tableName);
  try {
    await client.createTable();
  } catch (err: unknown) {
    const error = err as { statusCode?: number };
    if (error.statusCode !== 409) {
      throw err;
    }
  }
  return client;
}

// ─── Entity Types ────────────────────────────────────────────────────────────

export interface CostDataEntity extends TableEntity {
  subscriptionId: string;
  subscriptionName: string;
  month: string;
  totalCost: number;
  forecastedCost: number;
  previousMonthCost: number;
  currency: string;
  dailyData: string;
  serviceData: string;
  resourceGroupData: string;
  topResources: string;
  collectedAt: string;
}

export interface IdleResourceEntity extends TableEntity {
  resourceId: string;
  resourceType: string;
  resourceName: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  location: string;
  estimatedMonthlyCost: number;
  detectedAt: string;
  status: 'active' | 'reviewed' | 'dismissed';
  details: string;
}

export interface RightsizingEntity extends TableEntity {
  resourceId: string;
  vmName: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
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
  status: 'active' | 'implemented' | 'dismissed';
}

export interface ReservationEntity extends TableEntity {
  advisorId: string;
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
  term: '1Year' | '3Year';
  fetchedAt: string;
  status: 'active' | 'purchased' | 'dismissed';
}

export interface AHBEntity extends TableEntity {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  location: string;
  sku: string;
  currentMonthlyCost: number;
  savingWithAHB: number;
  powershellCommand: string;
  scannedAt: string;
  status: 'active' | 'applied' | 'dismissed';
}

export interface StorageRecommendationEntity extends TableEntity {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  issue: string;
  recommendation: string;
  estimatedMonthlySaving: number;
  details: string;
  scannedAt: string;
  status: 'active' | 'implemented' | 'dismissed';
}

export interface ASPRightsizingEntity extends TableEntity {
  resourceId: string;
  aspName: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
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
  status: 'active' | 'implemented' | 'dismissed';
}

export interface DatabaseRecommendationEntity extends TableEntity {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  currentTier: string;
  avgUtilization: number;
  recommendation: string;
  estimatedMonthlySaving: number;
  details: string;
  scannedAt: string;
  status: 'active' | 'implemented' | 'dismissed';
}

export interface SavingsEntity extends TableEntity {
  category: string;
  resourceName: string;
  resourceId: string;
  resourceGroup: string;
  subscriptionId: string;
  projectedMonthlySaving: number;
  implementedBy: string;
  implementedByEmail: string;
  notes: string;
  implementedAt: string;
}

export interface BudgetEntity extends TableEntity {
  budgetId: string;
  name: string;
  scope: string;
  scopeType: 'subscription' | 'resourceGroup';
  amount: number;
  timeGrain: 'Monthly';
  currentSpend: number;
  forecastedSpend: number;
  startDate: string;
  endDate: string;
  alertThreshold80: boolean;
  alertThreshold100: boolean;
  contactEmails: string;
  azureBudgetId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportEntity extends TableEntity {
  reportMonth: string;
  generatedAt: string;
  generatedBy: string;
  blobUrl: string;
  sasUrl: string;
  status: 'generating' | 'ready' | 'error';
  errorMessage: string;
}

export interface ImplementationEntity extends TableEntity {
  implementationId: string;
  type: string;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  resourceGroup: string;
  subscriptionId: string;
  action: string;
  status: 'running' | 'succeeded' | 'failed' | 'manual';
  automated: boolean;
  monthlySaving: number;
  initiatedBy: string;
  initiatedByEmail: string;
  initiatedAt: string;
  completedAt: string;
  errorMessage: string;
  notes: string;
}

// ─── Table Names ─────────────────────────────────────────────────────────────

const TABLES = {
  costs: 'costs',
  idleResources: 'idleresources',
  rightsizing: 'rightsizing',
  reservations: 'reservations',
  ahb: 'ahbrecommendations',
  storage: 'storagerecommendations',
  databases: 'databaserecommendations',
  asp: 'asprightizing',
  savings: 'savings',
  budgets: 'budgets',
  reports: 'reports',
  implementations: 'implementations',
} as const;

// ─── Cost Data Operations ────────────────────────────────────────────────────

export async function upsertCostData(entity: CostDataEntity): Promise<void> {
  const client = await ensureTable(TABLES.costs);
  await client.upsertEntity(entity, 'Replace');
}

export async function getCostData(subscriptionId: string): Promise<CostDataEntity[]> {
  const client = await ensureTable(TABLES.costs);
  const results: CostDataEntity[] = [];
  const filter = subscriptionId === 'all'
    ? undefined
    : odata`PartitionKey eq ${subscriptionId}`;
  const iter = client.listEntities<CostDataEntity>({ queryOptions: { filter } });
  for await (const entity of iter) {
    results.push(entity);
  }
  return results;
}

// ─── Idle Resources Operations ────────────────────────────────────────────────

export async function upsertIdleResource(entity: IdleResourceEntity): Promise<void> {
  const client = await ensureTable(TABLES.idleResources);
  try {
    const existing = await client.getEntity<IdleResourceEntity>(entity.partitionKey, entity.rowKey);
    if (existing.status === 'dismissed' || existing.status === 'reviewed') entity.status = existing.status;
    if (existing.detectedAt) entity.detectedAt = existing.detectedAt;
  } catch { /* new entity */ }
  await client.upsertEntity(entity, 'Replace');
}

export async function getIdleResources(filter?: string): Promise<IdleResourceEntity[]> {
  const client = await ensureTable(TABLES.idleResources);
  const results: IdleResourceEntity[] = [];
  const iter = client.listEntities<IdleResourceEntity>({
    queryOptions: { filter: filter ?? odata`status eq 'active'` },
  });
  for await (const entity of iter) {
    results.push(entity);
  }
  return results;
}

export async function updateIdleResourceStatus(
  partitionKey: string,
  rowKey: string,
  status: 'active' | 'reviewed' | 'dismissed'
): Promise<void> {
  const client = await ensureTable(TABLES.idleResources);
  await client.updateEntity({ partitionKey, rowKey, status }, 'Merge');
}

// ─── Rightsizing Operations ───────────────────────────────────────────────────

export async function upsertRightsizing(entity: RightsizingEntity): Promise<void> {
  const client = await ensureTable(TABLES.rightsizing);
  try {
    const existing = await client.getEntity<RightsizingEntity>(entity.partitionKey, entity.rowKey);
    if (existing.status === 'dismissed' || existing.status === 'implemented') entity.status = existing.status;
  } catch { /* new entity */ }
  await client.upsertEntity(entity, 'Replace');
}

export async function getRightsizing(subscriptionId?: string): Promise<RightsizingEntity[]> {
  const client = await ensureTable(TABLES.rightsizing);
  const results: RightsizingEntity[] = [];
  const statusFilter = odata`status eq 'active'`;
  const filter = subscriptionId
    ? odata`PartitionKey eq ${subscriptionId} and status eq 'active'`
    : statusFilter;
  const iter = client.listEntities<RightsizingEntity>({ queryOptions: { filter } });
  for await (const entity of iter) {
    results.push(entity);
  }
  return results;
}

// ─── Reservations Operations ──────────────────────────────────────────────────

export async function upsertReservation(entity: ReservationEntity): Promise<void> {
  const client = await ensureTable(TABLES.reservations);
  try {
    const existing = await client.getEntity<ReservationEntity>(entity.partitionKey, entity.rowKey);
    if (existing.status === 'purchased' || existing.status === 'dismissed') entity.status = existing.status;
  } catch { /* new entity */ }
  await client.upsertEntity(entity, 'Replace');
}

export async function getReservations(): Promise<ReservationEntity[]> {
  const client = await ensureTable(TABLES.reservations);
  const results: ReservationEntity[] = [];
  const iter = client.listEntities<ReservationEntity>({
    queryOptions: { filter: odata`status eq 'active'` },
  });
  for await (const entity of iter) {
    results.push(entity);
  }
  return results;
}

// ─── AHB Operations ──────────────────────────────────────────────────────────

export async function upsertAHB(entity: AHBEntity): Promise<void> {
  const client = await ensureTable(TABLES.ahb);
  try {
    const existing = await client.getEntity<AHBEntity>(entity.partitionKey, entity.rowKey);
    if (existing.status === 'dismissed' || existing.status === 'applied') entity.status = existing.status;
  } catch { /* new entity */ }
  await client.upsertEntity(entity, 'Replace');
}

export async function getAHBRecommendations(): Promise<AHBEntity[]> {
  const client = await ensureTable(TABLES.ahb);
  const results: AHBEntity[] = [];
  const iter = client.listEntities<AHBEntity>({
    queryOptions: { filter: odata`status eq 'active'` },
  });
  for await (const entity of iter) {
    results.push(entity);
  }
  return results;
}

// ─── Storage Recommendations ──────────────────────────────────────────────────

export async function upsertStorageRecommendation(
  entity: StorageRecommendationEntity
): Promise<void> {
  const client = await ensureTable(TABLES.storage);
  try {
    const existing = await client.getEntity<StorageRecommendationEntity>(entity.partitionKey, entity.rowKey);
    if (existing.status === 'dismissed' || existing.status === 'implemented') entity.status = existing.status;
  } catch { /* new entity */ }
  await client.upsertEntity(entity, 'Replace');
}

export async function getStorageRecommendations(): Promise<StorageRecommendationEntity[]> {
  const client = await ensureTable(TABLES.storage);
  const results: StorageRecommendationEntity[] = [];
  const iter = client.listEntities<StorageRecommendationEntity>({
    queryOptions: { filter: odata`status eq 'active'` },
  });
  for await (const entity of iter) {
    results.push(entity);
  }
  return results;
}

// ─── Database Recommendations ─────────────────────────────────────────────────

export async function upsertDatabaseRecommendation(
  entity: DatabaseRecommendationEntity
): Promise<void> {
  const client = await ensureTable(TABLES.databases);
  try {
    const existing = await client.getEntity<DatabaseRecommendationEntity>(entity.partitionKey, entity.rowKey);
    if (existing.status === 'dismissed' || existing.status === 'implemented') entity.status = existing.status;
  } catch { /* new entity */ }
  await client.upsertEntity(entity, 'Replace');
}

export async function getDatabaseRecommendations(): Promise<DatabaseRecommendationEntity[]> {
  const client = await ensureTable(TABLES.databases);
  const results: DatabaseRecommendationEntity[] = [];
  const iter = client.listEntities<DatabaseRecommendationEntity>({
    queryOptions: { filter: odata`status eq 'active'` },
  });
  for await (const entity of iter) {
    results.push(entity);
  }
  return results;
}

// ─── Savings Operations ───────────────────────────────────────────────────────

export async function insertSavings(entity: SavingsEntity): Promise<void> {
  const client = await ensureTable(TABLES.savings);
  await client.createEntity(entity);
}

export async function getSavingsLog(): Promise<SavingsEntity[]> {
  const client = await ensureTable(TABLES.savings);
  const results: SavingsEntity[] = [];
  const iter = client.listEntities<SavingsEntity>();
  for await (const entity of iter) {
    results.push(entity);
  }
  return results.sort(
    (a, b) =>
      new Date(b.implementedAt).getTime() - new Date(a.implementedAt).getTime()
  );
}

// ─── Budget Operations ────────────────────────────────────────────────────────

export async function upsertBudget(entity: BudgetEntity): Promise<void> {
  const client = await ensureTable(TABLES.budgets);
  await client.upsertEntity(entity, 'Replace');
}

export async function getBudgets(): Promise<BudgetEntity[]> {
  const client = await ensureTable(TABLES.budgets);
  const results: BudgetEntity[] = [];
  const iter = client.listEntities<BudgetEntity>();
  for await (const entity of iter) {
    results.push(entity);
  }
  return results;
}

export async function deleteBudget(partitionKey: string, rowKey: string): Promise<void> {
  const client = await ensureTable(TABLES.budgets);
  await client.deleteEntity(partitionKey, rowKey);
}

// ─── Report Operations ────────────────────────────────────────────────────────

export async function upsertReport(entity: ReportEntity): Promise<void> {
  const client = await ensureTable(TABLES.reports);
  await client.upsertEntity(entity, 'Replace');
}

export async function getReports(): Promise<ReportEntity[]> {
  const client = await ensureTable(TABLES.reports);
  const results: ReportEntity[] = [];
  const iter = client.listEntities<ReportEntity>();
  for await (const entity of iter) {
    results.push(entity);
  }
  return results.sort(
    (a, b) =>
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  );
}

// ─── ASP Rightsizing Operations ──────────────────────────────────────────────

export async function upsertASPRightsizing(entity: ASPRightsizingEntity): Promise<void> {
  const client = await ensureTable(TABLES.asp);
  try {
    const existing = await client.getEntity<ASPRightsizingEntity>(entity.partitionKey, entity.rowKey);
    if (existing.status === 'dismissed' || existing.status === 'implemented') entity.status = existing.status;
  } catch { /* new entity */ }
  await client.upsertEntity(entity, 'Replace');
}

export async function getASPRightsizing(subscriptionId?: string): Promise<ASPRightsizingEntity[]> {
  const client = await ensureTable(TABLES.asp);
  const results: ASPRightsizingEntity[] = [];
  const filter = subscriptionId
    ? odata`PartitionKey eq ${subscriptionId} and status eq 'active'`
    : odata`status eq 'active'`;
  const iter = client.listEntities<ASPRightsizingEntity>({ queryOptions: { filter } });
  for await (const entity of iter) results.push(entity);
  return results;
}

// ─── Dismissed Recommendations ───────────────────────────────────────────────

export interface DismissedItem {
  id: string;
  type: 'rightsizing' | 'ahb' | 'storage' | 'idle' | 'database' | 'asp';
  resourceName: string;
  resourceGroup: string;
  subscriptionId: string;
  estimatedMonthlySaving: number;
  details: string;
}

export async function getDismissedRecommendations(): Promise<DismissedItem[]> {
  const results: DismissedItem[] = [];
  const dismissedFilter = odata`status eq 'dismissed'`;

  async function collect<T extends TableEntity>(
    tableName: string,
    type: DismissedItem['type'],
    map: (e: T) => DismissedItem
  ) {
    try {
      const client = await ensureTable(tableName);
      const iter = client.listEntities<T>({ queryOptions: { filter: dismissedFilter } });
      for await (const e of iter) results.push(map(e));
    } catch { /* table may not exist yet */ }
  }

  await Promise.all([
    collect<RightsizingEntity>(TABLES.rightsizing, 'rightsizing', (e) => ({
      id: e.rowKey, type: 'rightsizing',
      resourceName: e.vmName, resourceGroup: e.resourceGroup,
      subscriptionId: e.subscriptionId, estimatedMonthlySaving: e.monthlySaving,
      details: `${e.currentSku} → ${e.recommendedSku}`,
    })),
    collect<AHBEntity>(TABLES.ahb, 'ahb', (e) => ({
      id: e.rowKey, type: 'ahb',
      resourceName: e.resourceName, resourceGroup: e.resourceGroup,
      subscriptionId: e.subscriptionId, estimatedMonthlySaving: e.savingWithAHB,
      details: `${e.resourceType} — ${e.sku}`,
    })),
    collect<StorageRecommendationEntity>(TABLES.storage, 'storage', (e) => ({
      id: e.rowKey, type: 'storage',
      resourceName: e.resourceName, resourceGroup: e.resourceGroup,
      subscriptionId: e.subscriptionId, estimatedMonthlySaving: e.estimatedMonthlySaving,
      details: e.recommendation,
    })),
    collect<IdleResourceEntity>(TABLES.idleResources, 'idle', (e) => ({
      id: e.rowKey, type: 'idle',
      resourceName: e.resourceName, resourceGroup: e.resourceGroup,
      subscriptionId: e.subscriptionId, estimatedMonthlySaving: e.estimatedMonthlyCost,
      details: e.resourceType,
    })),
    collect<DatabaseRecommendationEntity>(TABLES.databases, 'database', (e) => ({
      id: e.rowKey, type: 'database',
      resourceName: e.resourceName, resourceGroup: e.resourceGroup,
      subscriptionId: e.subscriptionId, estimatedMonthlySaving: e.estimatedMonthlySaving,
      details: e.recommendation,
    })),
    collect<ASPRightsizingEntity>(TABLES.asp, 'asp', (e) => ({
      id: e.rowKey, type: 'asp',
      resourceName: e.aspName, resourceGroup: e.resourceGroup,
      subscriptionId: e.subscriptionId, estimatedMonthlySaving: e.monthlySaving,
      details: `${e.currentSku} → ${e.recommendedSku}`,
    })),
  ]);

  return results.sort((a, b) => b.estimatedMonthlySaving - a.estimatedMonthlySaving);
}

// ─── Generic Upsert for marking items ────────────────────────────────────────

export async function markEntityStatus(
  tableName: string,
  partitionKey: string,
  rowKey: string,
  status: string
): Promise<void> {
  const client = await ensureTable(tableName);
  await client.updateEntity({ partitionKey, rowKey, status }, 'Merge');
}

// ─── Implementation Operations ────────────────────────────────────────────────

export async function insertImplementation(entity: ImplementationEntity): Promise<void> {
  const client = await ensureTable(TABLES.implementations);
  await client.createEntity(entity);
}

export async function updateImplementation(
  partitionKey: string,
  rowKey: string,
  update: Partial<ImplementationEntity>
): Promise<void> {
  const client = await ensureTable(TABLES.implementations);
  await client.updateEntity({ partitionKey, rowKey, ...update }, 'Merge');
}

export async function getImplementations(): Promise<ImplementationEntity[]> {
  const client = await ensureTable(TABLES.implementations);
  const results: ImplementationEntity[] = [];
  const iter = client.listEntities<ImplementationEntity>();
  for await (const entity of iter) {
    results.push(entity);
  }
  return results.sort(
    (a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime()
  );
}

// ─── Stale Recommendation Cleanup ────────────────────────────────────────────

export async function deleteStaleEntities(
  tableName: string,
  subscriptionId: string,
  currentRowKeys: Set<string>,
  logError: (msg: string, err?: unknown) => void
): Promise<void> {
  try {
    const client = await ensureTable(tableName);
    const iter = client.listEntities<TableEntity>({
      queryOptions: { filter: odata`PartitionKey eq ${subscriptionId}` },
    });
    for await (const entity of iter) {
      if (!currentRowKeys.has(entity.rowKey as string)) {
        try {
          await client.deleteEntity(entity.partitionKey as string, entity.rowKey as string);
        } catch (err) {
          logError(`Failed to delete stale entity ${entity.rowKey as string} from ${tableName}:`, err);
        }
      }
    }
  } catch (err) {
    logError(`Stale cleanup query failed for ${tableName} (${subscriptionId}):`, err);
  }
}

export { TABLES };
