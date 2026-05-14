import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
  Timer,
} from '@azure/functions';
import { SubscriptionClient } from '@azure/arm-resources-subscriptions';
import { credential } from '../lib/azure/credential';
import { findAppServicePlansForRightsizing } from '../lib/azure/resourceGraph';
import { getASPMetrics } from '../lib/azure/monitorMetrics';
import { getASPPrice } from '../lib/azure/retailPrices';
import {
  upsertASPRightsizing,
  getASPRightsizing,
  markEntityStatus,
  TABLES,
} from '../lib/storage/tableClient';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

// ASP SKU families sorted smallest → largest within each tier family.
// findNextSmallerASP picks index-1 — only downgrades within the same family.
const ASP_FAMILIES: string[][] = [
  ['B1', 'B2', 'B3'],
  ['S1', 'S2', 'S3'],
  ['P1v2', 'P2v2', 'P3v2'],
  ['P1v3', 'P2v3', 'P3v3'],
];

function findNextSmallerASP(sku: string): string | null {
  for (const family of ASP_FAMILIES) {
    const idx = family.findIndex((s) => s.toLowerCase() === sku.toLowerCase());
    if (idx > 0) return family[idx - 1];
  }
  return null;
}

function getASPTier(sku: string): string {
  const lower = sku.toLowerCase();
  if (lower.startsWith('b')) return 'Basic';
  if (lower.startsWith('s')) return 'Standard';
  if (lower.includes('v2')) return 'PremiumV2';
  if (lower.includes('v3')) return 'PremiumV3';
  return 'Premium';
}

export async function analyzeAndStoreASP(context: InvocationContext): Promise<void> {
  context.log('Starting App Service Plan rightsizing analysis...');

  const subClient = new SubscriptionClient(credential);
  const subscriptionIds: string[] = [];
  try {
    for await (const sub of subClient.subscriptions.list()) {
      if (sub.subscriptionId && sub.state === 'Enabled') {
        subscriptionIds.push(sub.subscriptionId);
      }
    }
  } catch (err) {
    context.error('Failed to list subscriptions:', err);
    return;
  }

  if (subscriptionIds.length === 0) {
    context.warn('No subscriptions found');
    return;
  }

  let plans: Awaited<ReturnType<typeof findAppServicePlansForRightsizing>>;
  try {
    plans = await findAppServicePlansForRightsizing(subscriptionIds);
  } catch (err) {
    context.error('Failed to fetch App Service Plans:', err);
    return;
  }
  context.log(`Analyzing ${plans.length} App Service Plans...`);

  let analyzed = 0;
  for (const plan of plans) {
    try {
      const metrics = await getASPMetrics(plan.id);

      if (metrics.dataPoints === 0) {
        context.warn(`ASP: ${plan.name} (${plan.sku}) — skipped, no metrics (plan may be new)`);
        continue;
      }

      if (metrics.cpuAvg >= 20 || metrics.memoryAvg >= 20) {
        context.log(
          `ASP: ${plan.name} (${plan.sku}) — skipped, ` +
          `cpuAvg=${metrics.cpuAvg.toFixed(1)}% memAvg=${metrics.memoryAvg.toFixed(1)}% (threshold: both <20%)`
        );
        continue;
      }

      const recommendedSku = findNextSmallerASP(plan.sku);
      if (!recommendedSku) {
        context.log(`ASP: ${plan.name} (${plan.sku}) — skipped, already smallest in family`);
        continue;
      }

      const [currentPrice, recommendedPrice] = await Promise.all([
        getASPPrice(plan.sku, plan.location),
        getASPPrice(recommendedSku, plan.location),
      ]);

      if (currentPrice <= 0 || recommendedPrice <= 0 || recommendedPrice >= currentPrice) {
        context.warn(
          `ASP: ${plan.name} — skipped, price check failed. ` +
          `current=${plan.sku}=$${currentPrice}/mo recommended=${recommendedSku}=$${recommendedPrice}/mo`
        );
        continue;
      }

      const monthlySaving = currentPrice - recommendedPrice;

      const rowKey = Buffer.from(plan.id.toLowerCase())
        .toString('base64')
        .replace(/[/+=]/g, '_')
        .slice(0, 512);

      await upsertASPRightsizing({
        partitionKey: plan.subscriptionId,
        rowKey,
        resourceId: plan.id,
        aspName: plan.name,
        resourceGroup: plan.resourceGroup,
        subscriptionId: plan.subscriptionId,
        subscriptionName: '',
        location: plan.location,
        currentSku: plan.sku,
        recommendedSku,
        currentTier: plan.tier,
        recommendedTier: getASPTier(recommendedSku),
        numberOfSites: plan.numberOfSites,
        cpuAvg: Math.round(metrics.cpuAvg * 100) / 100,
        memoryAvg: Math.round(metrics.memoryAvg * 100) / 100,
        currentMonthlyCost: Math.round(currentPrice * 100) / 100,
        recommendedMonthlyCost: Math.round(recommendedPrice * 100) / 100,
        monthlySaving: Math.round(monthlySaving * 100) / 100,
        analyzedAt: new Date().toISOString(),
        status: 'active',
      });

      analyzed++;
    } catch (err) {
      context.error(`Error analyzing ASP ${plan.name}:`, err);
    }
  }

  context.log(`ASP analysis complete. Found ${analyzed} recommendations.`);
}

async function aspTimer(
  _myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  try {
    await analyzeAndStoreASP(context);
  } catch (err) {
    context.error('ASP analysis timer failed:', err);
  }
}

async function getASPHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const recommendations = await getASPRightsizing();

    const data = recommendations.map((r) => ({
      id: r.rowKey,
      resourceId: r.resourceId,
      aspName: r.aspName,
      resourceGroup: r.resourceGroup,
      subscriptionId: r.subscriptionId,
      location: r.location,
      currentSku: r.currentSku,
      recommendedSku: r.recommendedSku,
      currentTier: r.currentTier,
      recommendedTier: r.recommendedTier,
      numberOfSites: r.numberOfSites,
      cpuAvg: r.cpuAvg,
      memoryAvg: r.memoryAvg,
      currentMonthlyCost: r.currentMonthlyCost,
      recommendedMonthlyCost: r.recommendedMonthlyCost,
      monthlySaving: r.monthlySaving,
      analyzedAt: r.analyzedAt,
      status: r.status,
    }));

    const totalSaving = data.reduce((s, r) => s + r.monthlySaving, 0);

    return jsonResponse({
      data: data.sort((a, b) => b.monthlySaving - a.monthlySaving),
      summary: { totalCount: data.length, totalMonthlySaving: Math.round(totalSaving * 100) / 100 },
      lastAnalyzed: recommendations[0]?.analyzedAt ?? null,
    });
  } catch (err) {
    context.error('Error fetching ASP recommendations:', err);
    return errorResponse('Failed to fetch ASP data');
  }
}

async function markASPImplemented(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const { id: rowKey, subscriptionId } = (await request.json()) as {
      id: string;
      subscriptionId: string;
    };
    if (!rowKey || !subscriptionId) {
      return errorResponse('id and subscriptionId are required', 400);
    }
    await markEntityStatus(TABLES.asp, subscriptionId, rowKey, 'implemented');
    return jsonResponse({ message: 'Marked as implemented' });
  } catch (err) {
    context.error('Error marking ASP as implemented:', err);
    return errorResponse('Failed to update status');
  }
}

app.timer('aspTimer', {
  schedule: '0 30 8 * * *',
  handler: aspTimer,
  runOnStartup: false,
});

app.http('getASP', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'asp',
  handler: getASPHttp,
});

app.http('markASPImplemented', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'asp/implement',
  handler: markASPImplemented,
});

async function triggerASPAnalysis(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = await validateUser(request);
    if (!user.isAdmin) return errorResponse('Admin access required', 403);
  } catch {
    return unauthorizedResponse();
  }

  try {
    await analyzeAndStoreASP(context);
    return jsonResponse({ message: 'ASP analysis triggered successfully' });
  } catch (err) {
    context.error('Error triggering ASP analysis:', err);
    return errorResponse('Failed to trigger analysis');
  }
}

app.http('triggerASPAnalysis', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'asp/refresh',
  handler: triggerASPAnalysis,
});
