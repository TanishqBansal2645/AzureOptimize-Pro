import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import {
  getDismissedRecommendations,
  markEntityStatus,
  TABLES,
} from '../lib/storage/tableClient';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

const TABLE_MAP: Record<string, string> = {
  rightsizing: TABLES.rightsizing,
  ahb: TABLES.ahb,
  storage: TABLES.storage,
  idle: TABLES.idleResources,
  database: TABLES.databases,
  asp: TABLES.asp,
};

async function getDismissedHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const dismissed = await getDismissedRecommendations();
    const totalSaving = dismissed.reduce((s, r) => s + r.estimatedMonthlySaving, 0);
    return jsonResponse({
      data: dismissed,
      summary: {
        totalCount: dismissed.length,
        totalMonthlySaving: Math.round(totalSaving * 100) / 100,
      },
    });
  } catch (err) {
    context.error('Error fetching dismissed recommendations:', err);
    return errorResponse('Failed to fetch dismissed data');
  }
}

async function dismissRecommendationHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const { type, id: rowKey, subscriptionId } = (await request.json()) as {
      type: string;
      id: string;
      subscriptionId: string;
    };

    if (!type || !rowKey || !subscriptionId) {
      return errorResponse('type, id, and subscriptionId are required', 400);
    }

    const tableName = TABLE_MAP[type];
    if (!tableName) {
      return errorResponse(`Unknown recommendation type: ${type}`, 400);
    }

    await markEntityStatus(tableName, subscriptionId, rowKey, 'dismissed');
    return jsonResponse({ message: 'Dismissed' });
  } catch (err) {
    context.error('Error dismissing recommendation:', err);
    return errorResponse('Failed to dismiss');
  }
}

async function restoreRecommendationHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const { type, id: rowKey, subscriptionId } = (await request.json()) as {
      type: string;
      id: string;
      subscriptionId: string;
    };

    if (!type || !rowKey || !subscriptionId) {
      return errorResponse('type, id, and subscriptionId are required', 400);
    }

    const tableName = TABLE_MAP[type];
    if (!tableName) {
      return errorResponse(`Unknown recommendation type: ${type}`, 400);
    }

    await markEntityStatus(tableName, subscriptionId, rowKey, 'active');
    return jsonResponse({ message: 'Restored to active' });
  } catch (err) {
    context.error('Error restoring recommendation:', err);
    return errorResponse('Failed to restore');
  }
}

app.http('getDismissed', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dismissed',
  handler: getDismissedHttp,
});

app.http('dismissRecommendation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'recommendations/dismiss',
  handler: dismissRecommendationHttp,
});

app.http('restoreRecommendation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'recommendations/restore',
  handler: restoreRecommendationHttp,
});
