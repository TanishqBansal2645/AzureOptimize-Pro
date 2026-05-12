import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
  Timer,
} from '@azure/functions';
import { SubscriptionClient } from '@azure/arm-resources-subscriptions';
import { credential } from '../lib/azure/credential';
import { getAllSubscriptionCosts } from '../lib/azure/costManagement';
import { upsertCostData, getCostData } from '../lib/storage/tableClient';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

export async function collectAndStoreCosts(context: InvocationContext): Promise<void> {
  context.log('Starting cost data collection...');

  const subClient = new SubscriptionClient(credential);

  const subscriptions: Array<{ id: string; name: string }> = [];
  try {
    for await (const sub of subClient.subscriptions.list()) {
      if (sub.subscriptionId && sub.state === 'Enabled') {
        subscriptions.push({
          id: sub.subscriptionId,
          name: sub.displayName ?? sub.subscriptionId,
        });
      }
    }
  } catch (err) {
    context.error('Failed to list subscriptions:', err);
    return;
  }

  context.log(`Found ${subscriptions.length} active subscriptions`);

  if (subscriptions.length === 0) {
    context.warn('No active subscriptions found');
    return;
  }

  let costs;
  try {
    costs = await getAllSubscriptionCosts(subscriptions);
  } catch (err) {
    context.error('Failed to collect subscription costs:', err);
    return;
  }

  for (const cost of costs) {
    try {
      await upsertCostData({
        partitionKey: cost.subscriptionId,
        rowKey: cost.subscriptionId,
        subscriptionId: cost.subscriptionId,
        subscriptionName: cost.subscriptionName,
        month: new Date().toISOString().slice(0, 7),
        totalCost: cost.mtdTotal,
        forecastedCost: cost.forecastedTotal,
        previousMonthCost: cost.previousMonthTotal,
        currency: cost.currency,
        dailyData: JSON.stringify(cost.dailySpend),
        serviceData: JSON.stringify(cost.serviceBreakdown),
        resourceGroupData: JSON.stringify(cost.resourceGroupBreakdown),
        topResources: JSON.stringify(cost.topResources),
        collectedAt: cost.collectedAt,
      });
      context.log(`Stored cost data for ${cost.subscriptionName}`);
    } catch (err) {
      context.error(`Failed to store cost data for ${cost.subscriptionName}:`, err);
    }
  }

  context.log('Cost data collection complete');
}

// Timer trigger: every 4 hours
async function collectCostsTimer(
  _myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  try {
    await collectAndStoreCosts(context);
  } catch (err) {
    context.error('Cost collection timer failed:', err);
  }
}

// HTTP GET: return cached cost data
async function getCostsHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const subscriptionId = request.query.get('subscriptionId') ?? 'all';
    const costData = await getCostData(subscriptionId);

    if (costData.length === 0) {
      return jsonResponse({
        data: [],
        message: 'No cost data yet. Data collects every 4 hours.',
        lastUpdated: null,
      });
    }

    const parsed = costData.map((d) => ({
      subscriptionId: d.subscriptionId,
      subscriptionName: d.subscriptionName,
      month: d.month,
      mtdTotal: d.totalCost,
      forecastedTotal: d.forecastedCost,
      previousMonthTotal: d.previousMonthCost,
      currency: d.currency,
      dailySpend: JSON.parse(d.dailyData || '[]') as unknown[],
      serviceBreakdown: JSON.parse(d.serviceData || '[]') as unknown[],
      resourceGroupBreakdown: JSON.parse(d.resourceGroupData || '[]') as unknown[],
      topResources: JSON.parse(d.topResources || '[]') as unknown[],
      collectedAt: d.collectedAt,
    }));

    const lastUpdated = costData.reduce(
      (latest, d) =>
        !latest || d.collectedAt > latest ? d.collectedAt : latest,
      ''
    );

    return jsonResponse({ data: parsed, lastUpdated });
  } catch (err) {
    context.error('Error fetching cost data:', err);
    return errorResponse('Failed to fetch cost data');
  }
}

// HTTP POST: manually trigger cost collection (admin only)
async function triggerCostCollection(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = await validateUser(request);
    if (!user.isAdmin) {
      return errorResponse('Admin access required', 403);
    }
  } catch {
    return unauthorizedResponse();
  }

  try {
    await collectAndStoreCosts(context);
    return jsonResponse({ message: 'Cost data collection triggered successfully' });
  } catch (err) {
    context.error('Error triggering cost collection:', err);
    return errorResponse('Failed to trigger cost collection');
  }
}

app.timer('collectCostsTimer', {
  schedule: '0 0 */4 * * *',
  handler: collectCostsTimer,
  runOnStartup: false,
});

app.http('getCosts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'costs',
  handler: getCostsHttp,
});

app.http('triggerCostCollection', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'costs/refresh',
  handler: triggerCostCollection,
});
