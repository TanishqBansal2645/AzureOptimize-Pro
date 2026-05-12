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
import { getImplementations } from '../lib/storage/tableClient';

async function getImplementationsHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const records = await getImplementations();
    return jsonResponse({
      data: records.map((r) => ({
        id: r.rowKey,
        type: r.type,
        resourceId: r.resourceId,
        resourceType: r.resourceType,
        resourceName: r.resourceName,
        resourceGroup: r.resourceGroup,
        subscriptionId: r.subscriptionId,
        action: r.action,
        status: r.status,
        automated: r.automated,
        monthlySaving: r.monthlySaving,
        initiatedBy: r.initiatedBy,
        initiatedAt: r.initiatedAt,
        completedAt: r.completedAt || null,
        errorMessage: r.errorMessage || null,
        notes: r.notes || null,
      })),
    });
  } catch (err) {
    context.error('Error fetching implementations:', err);
    return errorResponse('Failed to fetch implementations');
  }
}

app.http('getImplementations', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'implementations',
  handler: getImplementationsHttp,
});
