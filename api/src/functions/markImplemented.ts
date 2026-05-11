import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import {
  insertSavings,
  markEntityStatus,
  TABLES,
} from '../lib/storage/tableClient';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

interface MarkImplementedRequest {
  recommendationType: 'idle' | 'rightsizing' | 'ahb' | 'storage' | 'databases' | 'reservations';
  id: string;
  subscriptionId: string;
  resourceName: string;
  resourceId: string;
  resourceGroup: string;
  category: string;
  projectedMonthlySaving: number;
  notes?: string;
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

async function markImplementedHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  let user;
  try {
    user = await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = (await request.json()) as MarkImplementedRequest;

    const {
      recommendationType,
      id: rowKey,
      subscriptionId,
      resourceName,
      resourceId,
      resourceGroup,
      category,
      projectedMonthlySaving,
      notes,
    } = body;

    if (!recommendationType || !rowKey || !subscriptionId) {
      return errorResponse(
        'recommendationType, id, and subscriptionId are required',
        400
      );
    }

    const tableName = TABLE_MAP[recommendationType];
    if (!tableName) {
      return errorResponse(`Unknown recommendation type: ${recommendationType}`, 400);
    }

    // Mark the recommendation as implemented
    await markEntityStatus(tableName, subscriptionId, rowKey, 'implemented');

    // Log to savings tracker — fire-and-forget so a savings log failure doesn't
    // falsely report the mark-as-implemented operation as failed
    if (projectedMonthlySaving > 0) {
      const savingId = generateId();
      insertSavings({
        partitionKey: subscriptionId,
        rowKey: savingId,
        category,
        resourceName,
        resourceId,
        resourceGroup,
        subscriptionId,
        projectedMonthlySaving,
        implementedBy: user.name,
        implementedByEmail: user.email,
        notes: notes ?? '',
        implementedAt: new Date().toISOString(),
      }).catch((e: unknown) => context.error('Failed to insert savings log entry:', e));
    }

    context.log(
      `${user.email} marked ${recommendationType} recommendation ${rowKey} as implemented. Saving: $${projectedMonthlySaving}/month`
    );

    return jsonResponse({
      message: 'Marked as implemented and logged to savings tracker',
      savingLogged: projectedMonthlySaving > 0,
    });
  } catch (err) {
    context.error('Error marking recommendation as implemented:', err);
    return errorResponse('Failed to mark as implemented');
  }
}

app.http('markImplemented', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'recommendations/implement',
  handler: markImplementedHttp,
});
