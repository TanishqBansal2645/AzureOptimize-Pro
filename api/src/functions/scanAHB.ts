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
  findWindowsVMsWithoutAHB,
  findSQLVMsWithoutAHB,
} from '../lib/azure/resourceGraph';
import { getWindowsLicenseSaving } from '../lib/azure/retailPrices';
import {
  upsertAHB,
  getAHBRecommendations,
  markEntityStatus,
  TABLES,
} from '../lib/storage/tableClient';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

export async function scanAndStoreAHB(context: InvocationContext): Promise<void> {
  context.log('Starting Azure Hybrid Benefit scan...');

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

  let windowsVMs: Awaited<ReturnType<typeof findWindowsVMsWithoutAHB>> = [];
  let sqlVMs: Awaited<ReturnType<typeof findSQLVMsWithoutAHB>> = [];
  try {
    const results = await Promise.all([
      findWindowsVMsWithoutAHB(subscriptionIds),
      findSQLVMsWithoutAHB(subscriptionIds),
    ]);
    windowsVMs = results[0];
    sqlVMs = results[1];
  } catch (err) {
    context.error('Failed to fetch VMs for AHB scan:', err);
    return;
  }

  context.log(`Found ${windowsVMs.length} Windows VMs and ${sqlVMs.length} SQL VMs without AHB`);

  if (windowsVMs.length === 0 && sqlVMs.length === 0) {
    context.warn(
      'AHB scan: Resource Graph returned 0 Windows/SQL VMs without AHB. ' +
      'If you expect Windows VMs to appear, check: (1) VM is fully indexed in Resource Graph ' +
      '(new VMs can take 10-30 min), (2) VM does not already have licenseType=Windows_Server, ' +
      `(3) Managed Identity has Reader role on subscriptions: ${subscriptionIds.join(', ')}`
    );
  }

  for (const vm of windowsVMs) {
    try {
      const saving = await getWindowsLicenseSaving(vm.sku ?? '', vm.location);
      if (saving <= 0) {
        context.warn(`AHB: skipping ${vm.name} (${vm.sku} in ${vm.location}) — price lookup returned saving=$${saving}`);
        continue;
      }

      const rowKey = Buffer.from(vm.id)
        .toString('base64')
        .replace(/[/+=]/g, '_')
        .slice(0, 512);

      const psCommand =
        `Set-AzVM -ResourceGroupName '${vm.resourceGroup}' ` +
        `-Name '${vm.name}' -LicenseType Windows_Server`;

      await upsertAHB({
        partitionKey: vm.subscriptionId,
        rowKey,
        resourceId: vm.id,
        resourceName: vm.name,
        resourceType: 'Windows VM',
        resourceGroup: vm.resourceGroup,
        subscriptionId: vm.subscriptionId,
        subscriptionName: '',
        location: vm.location,
        sku: vm.sku ?? '',
        currentMonthlyCost: saving * 2,
        savingWithAHB: saving,
        powershellCommand: psCommand,
        scannedAt: new Date().toISOString(),
        status: 'active',
      });
    } catch (err) {
      context.error(`Error processing Windows VM ${vm.name}:`, err);
    }
  }

  for (const vm of sqlVMs) {
    try {
      const estimatedSaving = 200; // SQL AHB typically saves ~$200+/month per VM

      const rowKey = Buffer.from(vm.id)
        .toString('base64')
        .replace(/[/+=]/g, '_')
        .slice(0, 512);

      const psCommand =
        `Update-AzSqlVM -ResourceGroupName '${vm.resourceGroup}' ` +
        `-Name '${vm.name}' -LicenseType AHUB`;

      await upsertAHB({
        partitionKey: vm.subscriptionId,
        rowKey,
        resourceId: vm.id,
        resourceName: vm.name,
        resourceType: 'SQL VM',
        resourceGroup: vm.resourceGroup,
        subscriptionId: vm.subscriptionId,
        subscriptionName: '',
        location: vm.location,
        sku: '',
        currentMonthlyCost: estimatedSaving * 2,
        savingWithAHB: estimatedSaving,
        powershellCommand: psCommand,
        scannedAt: new Date().toISOString(),
        status: 'active',
      });
    } catch (err) {
      context.error(`Error processing SQL VM ${vm.name}:`, err);
    }
  }

  context.log('AHB scan complete');
}

async function ahbTimer(
  _myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  try {
    await scanAndStoreAHB(context);
  } catch (err) {
    context.error('AHB scan timer failed:', err);
  }
}

async function getAHBHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const recommendations = await getAHBRecommendations();

    const data = recommendations.map((r) => ({
      id: r.rowKey,
      resourceId: r.resourceId,
      resourceName: r.resourceName,
      resourceType: r.resourceType,
      resourceGroup: r.resourceGroup,
      subscriptionId: r.subscriptionId,
      location: r.location,
      sku: r.sku,
      currentMonthlyCost: r.currentMonthlyCost,
      savingWithAHB: r.savingWithAHB,
      powershellCommand: r.powershellCommand,
      scannedAt: r.scannedAt,
      status: r.status,
    }));

    const totalSaving = data.reduce((s, r) => s + r.savingWithAHB, 0);

    return jsonResponse({
      data: data.sort((a, b) => b.savingWithAHB - a.savingWithAHB),
      summary: {
        totalCount: data.length,
        totalMonthlySaving: totalSaving,
        windowsVMs: data.filter((r) => r.resourceType === 'Windows VM').length,
        sqlVMs: data.filter((r) => r.resourceType === 'SQL VM').length,
      },
      lastScanned: recommendations[0]?.scannedAt ?? null,
    });
  } catch (err) {
    context.error('Error fetching AHB recommendations:', err);
    return errorResponse('Failed to fetch AHB data');
  }
}

async function markAHBApplied(
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
    await markEntityStatus(TABLES.ahb, subscriptionId, rowKey, 'applied');
    return jsonResponse({ message: 'Marked as applied' });
  } catch (err) {
    context.error('Error marking AHB as applied:', err);
    return errorResponse('Failed to update status');
  }
}

app.timer('ahbTimer', {
  schedule: '0 0 9 * * *',
  handler: ahbTimer,
  runOnStartup: false,
});

app.http('getAHB', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'ahb',
  handler: getAHBHttp,
});

app.http('markAHBApplied', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ahb/implement',
  handler: markAHBApplied,
});

async function triggerAHBScan(
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
    await scanAndStoreAHB(context);
    return jsonResponse({ message: 'AHB scan triggered successfully' });
  } catch (err) {
    context.error('Error triggering AHB scan:', err);
    return errorResponse('Failed to trigger scan');
  }
}

app.http('triggerAHBScan', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ahb/refresh',
  handler: triggerAHBScan,
});
