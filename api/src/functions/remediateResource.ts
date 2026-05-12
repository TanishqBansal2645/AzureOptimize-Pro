import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';
import {
  insertImplementation,
  updateImplementation,
  insertSavings,
  markEntityStatus,
  TABLES,
} from '../lib/storage/tableClient';
import {
  remediateIdleResource,
  remediateRightsizing,
  remediateAHBWindows,
  remediateAHBSqlManual,
  remediateStorageDiskDowngrade,
  remediateStorageAccountManual,
  remediateLogAnalyticsRetention,
  remediateSqlDatabase,
  remediateCosmosManual,
  RemediationResult,
} from '../lib/azure/remediation';

interface RemediateRequest {
  type: 'idle' | 'rightsizing' | 'ahb' | 'storage' | 'databases' | 'reservations';
  recommendationId?: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  monthlySaving: number;
  recommendedSku?: string;
  currentSku?: string;
  details?: string;       // JSON string with type-specific params
  notes?: string;
  term?: '1Year' | '3Year';
}

function generateId(): string {
  const bytes = new Array(16).fill(0).map(() => Math.floor(Math.random() * 256));
  const hex = bytes.map((b) => (b as number).toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const TABLE_MAP: Record<string, string> = {
  idle: TABLES.idleResources,
  rightsizing: TABLES.rightsizing,
  ahb: TABLES.ahb,
  storage: TABLES.storage,
  databases: TABLES.databases,
  reservations: TABLES.reservations,
};

async function dispatchRemediation(
  req: RemediateRequest
): Promise<RemediationResult> {
  const { type, resourceId, resourceName, resourceType, resourceGroup, subscriptionId } = req;

  switch (type) {
    // ── Idle resource deletion ───────────────────────────────────────────────
    case 'idle':
      return remediateIdleResource(subscriptionId, resourceId, resourceType);

    // ── VM Rightsizing ───────────────────────────────────────────────────────
    case 'rightsizing': {
      if (!req.recommendedSku) throw new Error('recommendedSku is required for rightsizing');
      return remediateRightsizing(subscriptionId, resourceGroup, resourceName, req.recommendedSku);
    }

    // ── Azure Hybrid Benefit ─────────────────────────────────────────────────
    case 'ahb': {
      const isSqlVM = resourceType.toLowerCase().includes('sql');
      if (isSqlVM) {
        return remediateAHBSqlManual(resourceGroup, resourceName, subscriptionId);
      }
      return remediateAHBWindows(subscriptionId, resourceGroup, resourceName);
    }

    // ── Storage optimizations ────────────────────────────────────────────────
    case 'storage': {
      if (resourceType === 'Premium Disk') {
        return remediateStorageDiskDowngrade(subscriptionId, resourceGroup, resourceName);
      }
      if (resourceType === 'Storage Account') {
        return remediateStorageAccountManual(resourceGroup, resourceName, subscriptionId);
      }
      if (resourceType === 'Log Analytics Workspace') {
        return remediateLogAnalyticsRetention(subscriptionId, resourceGroup, resourceName);
      }
      // Unknown storage type — generate generic CLI guidance
      return remediateStorageAccountManual(resourceGroup, resourceName, subscriptionId);
    }

    // ── Database optimizations ────────────────────────────────────────────────
    case 'databases': {
      if (resourceType === 'Azure SQL Database') {
        const details = req.details ? JSON.parse(req.details) as {
          recommendedCapacity?: number;
          tier?: string;
        } : {};
        const recommendedCapacity = details.recommendedCapacity ?? 5;
        const targetTier = details.tier ?? 'Standard';
        return remediateSqlDatabase(subscriptionId, resourceGroup, resourceId, recommendedCapacity, targetTier);
      }
      if (resourceType === 'Cosmos DB Account') {
        return remediateCosmosManual(resourceGroup, resourceName, subscriptionId);
      }
      return remediateCosmosManual(resourceGroup, resourceName, subscriptionId);
    }

    // ── Reservations — cannot auto-purchase, mark as manual ──────────────────
    case 'reservations': {
      const term = req.term ?? '1Year';
      return {
        success: true,
        automated: false,
        action: `Reserved Instance purchase (${term}) marked as implemented`,
        portalUrl: `https://portal.azure.com/#view/Microsoft_Azure_Reservations/ReservationsBrowseTab.ReactView`,
        powershellCommand: [
          `# Purchase Reserved Instance via Azure CLI`,
          `# Review available SKUs first:`,
          `az reservations catalog show --subscription-id "${subscriptionId}" --resource-type "VirtualMachines"`,
        ].join('\n'),
      };
    }

    default:
      throw new Error(`Unknown remediation type: ${type}`);
  }
}

async function remediateResourceHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  let user;
  try {
    user = await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  if (!user.isAdmin) {
    return errorResponse('Admin access required to execute remediations', 403);
  }

  let implId = '';
  let body: RemediateRequest;

  try {
    body = (await request.json()) as RemediateRequest;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  const { type, resourceId, resourceName, resourceType, resourceGroup, subscriptionId, monthlySaving, notes } = body;

  if (!type || !resourceId || !resourceName || !resourceGroup || !subscriptionId) {
    return errorResponse('type, resourceId, resourceName, resourceGroup, subscriptionId are required', 400);
  }

  try {
    implId = generateId();
    const now = new Date().toISOString();

    // Record as 'running' immediately
    await insertImplementation({
      partitionKey: subscriptionId,
      rowKey: implId,
      implementationId: implId,
      type,
      resourceType: resourceType ?? '',
      resourceId,
      resourceName,
      resourceGroup,
      subscriptionId,
      action: 'Executing...',
      status: 'running',
      automated: false,
      monthlySaving: monthlySaving ?? 0,
      initiatedBy: user.name,
      initiatedByEmail: user.email,
      initiatedAt: now,
      completedAt: '',
      errorMessage: '',
      notes: notes ?? '',
    });

    // Execute the actual remediation
    const result = await dispatchRemediation(body);
    const completedAt = new Date().toISOString();

    // Update implementation record to succeeded
    await updateImplementation(subscriptionId, implId, {
      action: result.action,
      status: result.automated ? 'succeeded' : 'manual',
      automated: result.automated,
      completedAt,
      errorMessage: result.details ?? '',
    });

    // Mark the original recommendation as implemented in its source table
    const tableName = TABLE_MAP[type];
    if (tableName) {
      // rowKey for the recommendation is passed as resourceId for simple types,
      // but we need the actual table row key — the frontend passes it as part of body
      const recRowKey = body.recommendationId ?? '';
      if (recRowKey) {
        markEntityStatus(tableName, subscriptionId, recRowKey, 'implemented')
          .catch((e: unknown) => context.error('Failed to mark recommendation implemented:', e));
      }
    }

    // Log to savings tracker (fire-and-forget)
    if (monthlySaving > 0) {
      const savingId = generateId();
      insertSavings({
        partitionKey: subscriptionId,
        rowKey: savingId,
        category: type === 'idle' ? `Idle: ${resourceType}` : type,
        resourceName,
        resourceId,
        resourceGroup,
        subscriptionId,
        projectedMonthlySaving: monthlySaving,
        implementedBy: user.name,
        implementedByEmail: user.email,
        notes: result.action,
        implementedAt: now,
      }).catch((e: unknown) => context.error('Failed to insert savings log:', e));
    }

    context.log(`${user.email} executed ${type} remediation on ${resourceName}: ${result.action}`);

    return jsonResponse({
      implementationId: implId,
      action: result.action,
      status: result.automated ? 'succeeded' : 'manual',
      automated: result.automated,
      details: result.details,
      portalUrl: result.portalUrl,
      powershellCommand: result.powershellCommand,
      cliCommand: result.cliCommand,
    });
  } catch (err) {
    context.error(`Remediation failed for ${type}/${resourceName}:`, err);
    const msg = err instanceof Error ? err.message : String(err);

    // Update implementation record to failed
    if (implId) {
      updateImplementation(subscriptionId, implId, {
        action: `Failed: ${msg}`,
        status: 'failed',
        completedAt: new Date().toISOString(),
        errorMessage: msg,
      }).catch((e: unknown) => context.error('Failed to update implementation status:', e));
    }

    return errorResponse(`Remediation failed: ${msg}`);
  }
}

app.http('remediateResource', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'remediation/execute',
  handler: remediateResourceHttp,
});
