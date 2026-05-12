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
  findAzureSQLDatabases,
  findCosmosDBAccounts,
} from '../lib/azure/resourceGraph';
import { getSQLDatabaseMetrics } from '../lib/azure/monitorMetrics';
import {
  upsertDatabaseRecommendation,
  getDatabaseRecommendations,
  markEntityStatus,
  TABLES,
} from '../lib/storage/tableClient';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

export async function scanAndStoreDatabases(context: InvocationContext): Promise<void> {
  context.log('Starting database optimization scan...');

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

  // Scan Azure SQL databases
  try {
    const sqlDbs = await findAzureSQLDatabases(subscriptionIds);
    context.log(`Checking ${sqlDbs.length} Azure SQL databases...`);

    for (const db of sqlDbs) {
      try {
        const dbId = String(db['id'] ?? '');
        const sku = String(db['sku'] ?? 'Standard');
        const tier = String(db['tier'] ?? 'Standard');

        // Skip free / serverless tiers
        if (tier.toLowerCase() === 'free' || sku.toLowerCase().includes('serverless')) {
          continue;
        }

        const metrics = await getSQLDatabaseMetrics(dbId);

        if (metrics.avgDtuPercent < 30) {
          const currentCapacity = Number(db['capacity'] ?? 10);
          const recommendedCapacity = Math.max(5, Math.floor(currentCapacity / 2));
          const estimatedSaving = (currentCapacity - recommendedCapacity) * 15;

          const rowKey = Buffer.from(dbId)
            .toString('base64')
            .replace(/[/+=]/g, '_')
            .slice(0, 512);

          await upsertDatabaseRecommendation({
            partitionKey: String(db['subscriptionId'] ?? ''),
            rowKey,
            resourceId: dbId,
            resourceName: String(db['name'] ?? ''),
            resourceType: 'Azure SQL Database',
            resourceGroup: String(db['resourceGroup'] ?? ''),
            subscriptionId: String(db['subscriptionId'] ?? ''),
            subscriptionName: '',
            currentTier: `${tier} ${currentCapacity} DTU`,
            avgUtilization: Math.round(metrics.avgDtuPercent * 100) / 100,
            recommendation: `Downsize to ${recommendedCapacity} DTU or consider Serverless tier`,
            estimatedMonthlySaving: Math.round(estimatedSaving * 100) / 100,
            details: JSON.stringify({
              avgDtuPercent: metrics.avgDtuPercent,
              maxDtuPercent: metrics.maxDtuPercent,
              currentCapacity,
              recommendedCapacity,
              sku,
              tier,
            }),
            scannedAt: new Date().toISOString(),
            status: 'active',
          });
        }
      } catch (err) {
        context.error(`Error processing SQL database ${db['name']}:`, err);
      }
    }
  } catch (err) {
    context.error('Error scanning SQL databases:', err);
  }

  // Scan Cosmos DB accounts (basic check)
  try {
    const cosmosAccounts = await findCosmosDBAccounts(subscriptionIds);
    context.log(`Found ${cosmosAccounts.length} Cosmos DB accounts`);

    for (const account of cosmosAccounts) {
      try {
        const accountId = String(account['id'] ?? '');
        const kind = String(account['kind'] ?? '');

        if (kind.toLowerCase().includes('serverless')) continue;

        const rowKey = Buffer.from(accountId)
          .toString('base64')
          .replace(/[/+=]/g, '_')
          .slice(0, 512);

        await upsertDatabaseRecommendation({
          partitionKey: String(account['subscriptionId'] ?? ''),
          rowKey,
          resourceId: accountId,
          resourceName: String(account['name'] ?? ''),
          resourceType: 'Cosmos DB Account',
          resourceGroup: String(account['resourceGroup'] ?? ''),
          subscriptionId: String(account['subscriptionId'] ?? ''),
          subscriptionName: '',
          currentTier: 'Provisioned Throughput',
          avgUtilization: 0,
          recommendation: 'Review throughput utilization. Consider switching to Serverless if usage is low.',
          estimatedMonthlySaving: 0,
          details: JSON.stringify({ kind }),
          scannedAt: new Date().toISOString(),
          status: 'active',
        });
      } catch (err) {
        context.error(`Error processing Cosmos DB account ${account['name']}:`, err);
      }
    }
  } catch (err) {
    context.error('Error scanning Cosmos DB:', err);
  }

  context.log('Database scan complete');
}

async function databasesTimer(
  _myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  try {
    await scanAndStoreDatabases(context);
  } catch (err) {
    context.error('Databases scan timer failed:', err);
  }
}

async function getDatabasesHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const recommendations = await getDatabaseRecommendations();

    const data = recommendations.map((r) => ({
      id: r.rowKey,
      resourceId: r.resourceId,
      resourceName: r.resourceName,
      resourceType: r.resourceType,
      resourceGroup: r.resourceGroup,
      subscriptionId: r.subscriptionId,
      currentTier: r.currentTier,
      avgUtilization: r.avgUtilization,
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
      },
      lastScanned: recommendations[0]?.scannedAt ?? null,
    });
  } catch (err) {
    context.error('Error fetching database recommendations:', err);
    return errorResponse('Failed to fetch database data');
  }
}

async function markDatabaseImplemented(
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
    await markEntityStatus(TABLES.databases, subscriptionId, rowKey, 'implemented');
    return jsonResponse({ message: 'Marked as implemented' });
  } catch (err) {
    context.error('Error marking database rec as implemented:', err);
    return errorResponse('Failed to update status');
  }
}

app.timer('databasesTimer', {
  schedule: '0 0 10 * * *',
  handler: databasesTimer,
  runOnStartup: false,
});

app.http('getDatabases', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'databases',
  handler: getDatabasesHttp,
});

app.http('markDatabaseImplemented', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'databases/implement',
  handler: markDatabaseImplemented,
});

async function triggerDatabasesScan(
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
    await scanAndStoreDatabases(context);
    return jsonResponse({ message: 'Database scan triggered successfully' });
  } catch (err) {
    context.error('Error triggering database scan:', err);
    return errorResponse('Failed to trigger scan');
  }
}

app.http('triggerDatabasesScan', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'databases/refresh',
  handler: triggerDatabasesScan,
});
