import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
  Timer,
} from '@azure/functions';
import { SubscriptionClient } from '@azure/arm-resources-subscriptions';
import { credential } from '../lib/azure/credential';
import {
  findUnattachedDisks,
  findOrphanedPublicIPs,
  findEmptyAppServicePlans,
  findOldSnapshots,
  findOrphanedNICs,
  findIdleLoadBalancers,
  findLongStoppedVMs,
  IdleResource,
} from '../lib/azure/resourceGraph';
import { estimateIdleResourceCost } from '../lib/azure/retailPrices';
import {
  upsertIdleResource,
  getIdleResources,
  updateIdleResourceStatus,
  deleteStaleEntities,
  TABLES,
} from '../lib/storage/tableClient';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

function createRowKey(resourceId: string): string {
  return Buffer.from(resourceId.toLowerCase()).toString('base64').replace(/[/+=]/g, '_').slice(0, 512);
}

async function getSubscriptionIds(): Promise<string[]> {
  const subClient = new SubscriptionClient(credential);
  const ids: string[] = [];
  try {
    for await (const sub of subClient.subscriptions.list()) {
      if (sub.subscriptionId && sub.state === 'Enabled') {
        ids.push(sub.subscriptionId);
      }
    }
  } catch (err) {
    throw new Error(`Failed to list subscriptions: ${String(err)}`);
  }
  return ids;
}

export async function scanAndStoreIdleResources(context: InvocationContext): Promise<void> {
  context.log('Starting idle resource scan...');

  let subscriptionIds: string[];
  try {
    subscriptionIds = await getSubscriptionIds();
  } catch (err) {
    context.error('Failed to list subscriptions:', err);
    return;
  }
  if (subscriptionIds.length === 0) {
    context.warn('No subscriptions found');
    return;
  }

  const scanners: Array<() => Promise<IdleResource[]>> = [
    () => findUnattachedDisks(subscriptionIds),
    () => findOrphanedPublicIPs(subscriptionIds),
    () => findEmptyAppServicePlans(subscriptionIds),
    () => findOldSnapshots(subscriptionIds),
    () => findOrphanedNICs(subscriptionIds),
    () => findIdleLoadBalancers(subscriptionIds),
    () => findLongStoppedVMs(subscriptionIds),
  ];

  const results = await Promise.allSettled(scanners.map((s) => s()));
  const allResources: IdleResource[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allResources.push(...result.value);
    } else {
      context.error('Scanner failed:', result.reason);
    }
  }

  context.log(`Found ${allResources.length} idle resources`);

  const upsertedKeys = new Map<string, Set<string>>();

  for (const resource of allResources) {
    const estimatedCost = estimateIdleResourceCost(resource.type, resource.details as Record<string, unknown>);
    const rowKey = createRowKey(resource.id);

    try {
      await upsertIdleResource({
        partitionKey: resource.subscriptionId,
        rowKey,
        resourceId: resource.id,
        resourceType: resource.type,
        resourceName: resource.name,
        resourceGroup: resource.resourceGroup,
        subscriptionId: resource.subscriptionId,
        subscriptionName: '',
        location: resource.location,
        estimatedMonthlyCost: estimatedCost,
        detectedAt: new Date().toISOString(),
        status: 'active',
        details: JSON.stringify(resource.details),
      });
      if (!upsertedKeys.has(resource.subscriptionId)) upsertedKeys.set(resource.subscriptionId, new Set());
      upsertedKeys.get(resource.subscriptionId)!.add(rowKey);
    } catch (err) {
      context.error(`Failed to upsert idle resource ${resource.id}:`, err);
    }
  }

  for (const subscriptionId of subscriptionIds) {
    await deleteStaleEntities(
      TABLES.idleResources, subscriptionId,
      upsertedKeys.get(subscriptionId) ?? new Set<string>(),
      (msg, err) => context.error(msg, err)
    );
  }

  context.log('Idle resource scan complete');
}

async function scanIdleTimer(
  _myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  try {
    await scanAndStoreIdleResources(context);
  } catch (err) {
    context.error('Idle resource scan timer failed:', err);
  }
}

async function getIdleResourcesHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const category = request.query.get('category') ?? '';
    const resources = await getIdleResources();

    const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const filtered = (category
      ? resources.filter((r) =>
          r.resourceType.toLowerCase().includes(category.toLowerCase())
        )
      : resources
    ).filter((r) => {
      if (r.resourceType === 'Long-Stopped VM') {
        return (now - new Date(r.detectedAt).getTime()) >= SIXTY_DAYS_MS;
      }
      return true;
    });

    const parsed = filtered.map((r) => ({
      id: r.rowKey,
      resourceId: r.resourceId,
      resourceType: r.resourceType,
      resourceName: r.resourceName,
      resourceGroup: r.resourceGroup,
      subscriptionId: r.subscriptionId,
      location: r.location,
      estimatedMonthlyCost: r.estimatedMonthlyCost,
      detectedAt: r.detectedAt,
      status: r.status,
      details: JSON.parse(r.details || '{}') as unknown,
    }));

    const totalWaste = parsed.reduce((s, r) => s + r.estimatedMonthlyCost, 0);

    return jsonResponse({
      data: parsed.sort((a, b) => b.estimatedMonthlyCost - a.estimatedMonthlyCost),
      summary: {
        totalCount: parsed.length,
        totalMonthlyWaste: totalWaste,
        byCategory: parsed.reduce<Record<string, number>>((acc, r) => {
          acc[r.resourceType] = (acc[r.resourceType] ?? 0) + 1;
          return acc;
        }, {}),
      },
      lastScanned: resources[0]?.detectedAt ?? null,
    });
  } catch (err) {
    context.error('Error fetching idle resources:', err);
    return errorResponse('Failed to fetch idle resources');
  }
}

async function updateIdleResourceStatusHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = (await request.json()) as { ids: string[]; status: 'reviewed' | 'dismissed'; subscriptionId: string };
    const { ids, status, subscriptionId } = body;

    if (!ids || !Array.isArray(ids) || !status || !subscriptionId) {
      return errorResponse('ids (array), status, and subscriptionId are required', 400);
    }

    await Promise.all(
      ids.map((rowKey) => updateIdleResourceStatus(subscriptionId, rowKey, status))
    );

    return jsonResponse({ message: `${ids.length} resources marked as ${status}` });
  } catch (err) {
    context.error('Error updating idle resource status:', err);
    return errorResponse('Failed to update resource status');
  }
}

async function triggerIdleScan(
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
    await scanAndStoreIdleResources(context);
    return jsonResponse({ message: 'Idle resource scan triggered' });
  } catch (err) {
    context.error('Error triggering idle scan:', err);
    return errorResponse('Failed to trigger scan');
  }
}

app.timer('scanIdleTimer', {
  schedule: '0 30 */4 * * *',
  handler: scanIdleTimer,
  runOnStartup: false,
});

app.http('getIdleResources', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'idle-resources',
  handler: getIdleResourcesHttp,
});

app.http('updateIdleResourceStatus', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'idle-resources/status',
  handler: updateIdleResourceStatusHttp,
});

app.http('triggerIdleScan', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'idle-resources/refresh',
  handler: triggerIdleScan,
});
