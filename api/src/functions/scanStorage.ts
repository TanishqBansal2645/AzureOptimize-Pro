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
  findPremiumDisks,
  findStorageAccounts,
  findLogAnalyticsWorkspaces,
} from '../lib/azure/resourceGraph';
import {
  getStorageAccountMetrics,
  getDiskIOPSMetrics,
} from '../lib/azure/monitorMetrics';
import {
  upsertStorageRecommendation,
  getStorageRecommendations,
  markEntityStatus,
  deleteStaleEntities,
  TABLES,
} from '../lib/storage/tableClient';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

export async function scanAndStoreStorage(context: InvocationContext): Promise<void> {
  context.log('Starting storage optimization scan...');

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

  const upsertedKeys = new Map<string, Set<string>>();
  let allScansOk = true;

  function trackKey(subscriptionId: string, rowKey: string): void {
    if (!upsertedKeys.has(subscriptionId)) upsertedKeys.set(subscriptionId, new Set());
    upsertedKeys.get(subscriptionId)!.add(rowKey);
  }

  // Check premium disks for low IOPS usage
  try {
    const premiumDisks = await findPremiumDisks(subscriptionIds);
    context.log(`Checking ${premiumDisks.length} premium disks for IOPS usage...`);

    for (const disk of premiumDisks as Array<Record<string, unknown>>) {
      try {
        const diskId = String(disk['id'] ?? '');
        const provisionedIops = Number(disk['iopsLimit'] ?? 120);
        const sizeGB = Number(disk['sizeGB'] ?? 128);
        const diskState = String(disk['diskState'] ?? 'Unknown').toLowerCase();
        const isUnattached = diskState === 'unattached';

        // Unattached disks have zero I/O by definition — skip the metrics call
        // (the metrics endpoint errors for detached disks, which would set avgIopsPercent=100)
        let avgIopsPercent: number;
        if (isUnattached) {
          avgIopsPercent = 0;
        } else {
          const ioMetrics = await getDiskIOPSMetrics(diskId, provisionedIops);
          avgIopsPercent = ioMetrics.avgIopsPercent;
        }

        if (avgIopsPercent < 20) {
          const premiumCost = sizeGB * 0.135;
          const standardSSDCost = sizeGB * 0.05;
          const saving = premiumCost - standardSSDCost;

          if (saving > 0) {
            const rowKey = Buffer.from(diskId.toLowerCase())
              .toString('base64')
              .replace(/[/+=]/g, '_')
              .slice(0, 512);

            const issue = isUnattached
              ? 'Disk is unattached — Premium SSD with no I/O activity'
              : `Average IOPS usage is ${Math.round(avgIopsPercent)}% of provisioned`;

            await upsertStorageRecommendation({
              partitionKey: String(disk['subscriptionId'] ?? ''),
              rowKey,
              resourceId: diskId,
              resourceName: String(disk['name'] ?? ''),
              resourceType: 'Premium Disk',
              resourceGroup: String(disk['resourceGroup'] ?? ''),
              subscriptionId: String(disk['subscriptionId'] ?? ''),
              subscriptionName: '',
              issue,
              recommendation: 'Downgrade from Premium SSD to Standard SSD',
              estimatedMonthlySaving: Math.round(saving * 100) / 100,
              details: JSON.stringify({ avgIopsPercent, sizeGB, diskState }),
              scannedAt: new Date().toISOString(),
              status: 'active',
            });
            trackKey(String(disk['subscriptionId'] ?? ''), rowKey);
          }
        }
      } catch (err) {
        context.error(`Error processing premium disk:`, err);
      }
    }
  } catch (err) {
    context.error('Error scanning premium disks:', err);
    allScansOk = false;
  }

  // Check storage accounts for no activity
  try {
    const storageAccounts = await findStorageAccounts(subscriptionIds);
    context.log(`Checking ${storageAccounts.length} storage accounts for inactivity...`);

    for (const account of storageAccounts as Array<Record<string, unknown>>) {
      try {
        const accountId = String(account['id'] ?? '');
        const metrics = await getStorageAccountMetrics(accountId);

        if (!metrics.hasTransactions) {
          const rowKey = Buffer.from(accountId.toLowerCase())
            .toString('base64')
            .replace(/[/+=]/g, '_')
            .slice(0, 512);

          await upsertStorageRecommendation({
            partitionKey: String(account['subscriptionId'] ?? ''),
            rowKey,
            resourceId: accountId,
            resourceName: String(account['name'] ?? ''),
            resourceType: 'Storage Account',
            resourceGroup: String(account['resourceGroup'] ?? ''),
            subscriptionId: String(account['subscriptionId'] ?? ''),
            subscriptionName: '',
            issue: 'No read/write operations in the last 30 days',
            recommendation: 'Review and delete if no longer needed',
            estimatedMonthlySaving: 5,
            details: JSON.stringify({ avgTransactionsPerDay: metrics.avgTransactionsPerDay }),
            scannedAt: new Date().toISOString(),
            status: 'active',
          });
          trackKey(String(account['subscriptionId'] ?? ''), rowKey);
        }
      } catch (err) {
        context.error('Error processing storage account:', err);
      }
    }
  } catch (err) {
    context.error('Error scanning storage accounts:', err);
    allScansOk = false;
  }

  // Check Log Analytics workspaces for excessive retention
  try {
    const workspaces = await findLogAnalyticsWorkspaces(subscriptionIds);
    context.log(`Checking ${workspaces.length} Log Analytics workspaces...`);

    for (const ws of workspaces as Array<Record<string, unknown>>) {
      try {
        const retentionDays = Number(ws['retentionDays'] ?? 30);
        if (retentionDays <= 31) continue;

        const extraDays = retentionDays - 31;
        const estimatedSaving = extraDays * 0.1 * 10; // ~$0.10/GB/day estimate for 10 GB workspace

        const wsId = String(ws['id'] ?? '');
        const rowKey = Buffer.from(wsId.toLowerCase())
          .toString('base64')
          .replace(/[/+=]/g, '_')
          .slice(0, 512);

        await upsertStorageRecommendation({
          partitionKey: String(ws['subscriptionId'] ?? ''),
          rowKey,
          resourceId: wsId,
          resourceName: String(ws['name'] ?? ''),
          resourceType: 'Log Analytics Workspace',
          resourceGroup: String(ws['resourceGroup'] ?? ''),
          subscriptionId: String(ws['subscriptionId'] ?? ''),
          subscriptionName: '',
          issue: `Data retention set to ${retentionDays} days (free tier is 31 days)`,
          recommendation: `Reduce retention to 31 days to avoid charges`,
          estimatedMonthlySaving: Math.round(estimatedSaving * 100) / 100,
          details: JSON.stringify({ retentionDays, extraDays }),
          scannedAt: new Date().toISOString(),
          status: 'active',
        });
        trackKey(String(ws['subscriptionId'] ?? ''), rowKey);
      } catch (err) {
        context.error('Error processing Log Analytics workspace:', err);
      }
    }
  } catch (err) {
    context.error('Error scanning Log Analytics workspaces:', err);
    allScansOk = false;
  }

  if (allScansOk) {
    for (const subscriptionId of subscriptionIds) {
      await deleteStaleEntities(
        TABLES.storage, subscriptionId,
        upsertedKeys.get(subscriptionId) ?? new Set<string>(),
        (msg, err) => context.error(msg, err)
      );
    }
  }

  context.log('Storage scan complete');
}

async function storageTimer(
  _myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  try {
    await scanAndStoreStorage(context);
  } catch (err) {
    context.error('Storage scan timer failed:', err);
  }
}

async function getStorageHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const recommendations = await getStorageRecommendations();

    const data = recommendations.map((r) => ({
      id: r.rowKey,
      resourceId: r.resourceId,
      resourceName: r.resourceName,
      resourceType: r.resourceType,
      resourceGroup: r.resourceGroup,
      subscriptionId: r.subscriptionId,
      issue: r.issue,
      recommendation: r.recommendation,
      estimatedMonthlySaving: r.estimatedMonthlySaving,
      details: JSON.parse(r.details || '{}') as unknown,
      scannedAt: r.scannedAt,
      status: r.status,
    }));

    const totalSaving = data.reduce((s, r) => s + r.estimatedMonthlySaving, 0);

    return jsonResponse({
      data: data.sort((a, b) => b.estimatedMonthlySaving - a.estimatedMonthlySaving),
      summary: {
        totalCount: data.length,
        totalMonthlySaving: totalSaving,
        byType: data.reduce<Record<string, number>>((acc, r) => {
          acc[r.resourceType] = (acc[r.resourceType] ?? 0) + 1;
          return acc;
        }, {}),
      },
      lastScanned: recommendations[0]?.scannedAt ?? null,
    });
  } catch (err) {
    context.error('Error fetching storage recommendations:', err);
    return errorResponse('Failed to fetch storage data');
  }
}

async function markStorageImplemented(
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
    await markEntityStatus(TABLES.storage, subscriptionId, rowKey, 'implemented');
    return jsonResponse({ message: 'Marked as implemented' });
  } catch (err) {
    context.error('Error marking storage rec as implemented:', err);
    return errorResponse('Failed to update status');
  }
}

app.timer('storageTimer', {
  schedule: '0 30 9 * * *',
  handler: storageTimer,
  runOnStartup: false,
});

app.http('getStorage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'storage',
  handler: getStorageHttp,
});

app.http('markStorageImplemented', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'storage/implement',
  handler: markStorageImplemented,
});

async function triggerStorageScan(
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
    await scanAndStoreStorage(context);
    return jsonResponse({ message: 'Storage scan triggered successfully' });
  } catch (err) {
    context.error('Error triggering storage scan:', err);
    return errorResponse('Failed to trigger scan');
  }
}

app.http('triggerStorageScan', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'storage/refresh',
  handler: triggerStorageScan,
});
