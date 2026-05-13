import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
  Timer,
} from '@azure/functions';
import { SubscriptionClient } from '@azure/arm-resources-subscriptions';
import { ComputeManagementClient } from '@azure/arm-compute';
import { credential } from '../lib/azure/credential';
import { findAllVMs } from '../lib/azure/resourceGraph';
import { getVMMetrics } from '../lib/azure/monitorMetrics';
import { getVMPrice } from '../lib/azure/retailPrices';
import {
  upsertRightsizing,
  getRightsizing,
  markEntityStatus,
  TABLES,
} from '../lib/storage/tableClient';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

// credential imported from shared module

// VM family downgrade mapping: larger → smaller equivalent SKU
const VM_FAMILY_DOWNGRADES: Record<string, string[]> = {
  Standard_D: [
    'Standard_D2s_v5', 'Standard_D4s_v5', 'Standard_D8s_v5',
    'Standard_D16s_v5', 'Standard_D32s_v5', 'Standard_D48s_v5', 'Standard_D64s_v5',
  ],
  Standard_E: [
    'Standard_E2s_v5', 'Standard_E4s_v5', 'Standard_E8s_v5',
    'Standard_E16s_v5', 'Standard_E32s_v5', 'Standard_E48s_v5', 'Standard_E64s_v5',
  ],
  Standard_F: [
    'Standard_F2s_v2', 'Standard_F4s_v2', 'Standard_F8s_v2',
    'Standard_F16s_v2', 'Standard_F32s_v2', 'Standard_F48s_v2', 'Standard_F64s_v2', 'Standard_F72s_v2',
  ],
  Standard_B: [
    'Standard_B1ms', 'Standard_B2ms', 'Standard_B4ms',
    'Standard_B8ms', 'Standard_B12ms', 'Standard_B16ms', 'Standard_B20ms',
  ],
};

function findNextSmaller(currentSku: string): string | null {
  for (const family of Object.values(VM_FAMILY_DOWNGRADES)) {
    const index = family.findIndex(
      (s) => s.toLowerCase() === currentSku.toLowerCase()
    );
    if (index > 0) {
      return family[index - 1];
    }
  }
  return null;
}

async function getVMMemoryGB(
  subscriptionId: string,
  resourceGroup: string,
  vmName: string,
  sku: string
): Promise<number> {
  try {
    const computeClient = new ComputeManagementClient(credential, subscriptionId);
    const vm = await computeClient.virtualMachines.get(resourceGroup, vmName);
    const skuInfo = vm.hardwareProfile?.vmSize ?? sku;
    // Try to get VM sizes list for accurate memory
    const sizes = computeClient.virtualMachines.listAvailableSizes(resourceGroup, vmName);
    for await (const size of sizes) {
      if (size.name?.toLowerCase() === skuInfo.toLowerCase()) {
        return (size.memoryInMB ?? 0) / 1024;
      }
    }
  } catch {
    // Fallback: estimate from SKU name
  }
  return estimateMemoryFromSku(sku);
}

function estimateMemoryFromSku(sku: string): number {
  const lower = sku.toLowerCase();
  const match = lower.match(/(\d+)s?_v\d+/);
  if (match) {
    const cores = parseInt(match[1], 10);
    if (lower.includes('_e')) return cores * 8;
    if (lower.includes('_d')) return cores * 4;
    if (lower.includes('_f')) return cores * 2;
    if (lower.includes('_b')) return cores * 4;
    return cores * 4;
  }
  return 4; // Default 4 GB
}

export async function analyzeAndStoreRightsizing(context: InvocationContext): Promise<void> {
  context.log('Starting VM rightsizing analysis...');

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

  let vms: Awaited<ReturnType<typeof findAllVMs>>;
  try {
    vms = await findAllVMs(subscriptionIds);
  } catch (err) {
    context.error('Failed to fetch VMs for rightsizing analysis:', err);
    return;
  }
  context.log(`Analyzing ${vms.length} VMs...`);

  let analyzed = 0;
  for (const vm of vms) {
    try {
      const memoryGB = await getVMMemoryGB(
        vm.subscriptionId,
        vm.resourceGroup,
        vm.name,
        vm.sku
      );
      const totalMemoryBytes = memoryGB * 1024 * 1024 * 1024;

      const metrics = await getVMMetrics(vm.id, totalMemoryBytes);

      // Skip VMs with no monitoring data (deallocated/newly created — no meaningful signal)
      if (metrics.dataPoints === 0) continue;

      // Only flag if both p95 CPU < 40% AND p95 Memory < 60%
      if (metrics.cpuP95 >= 40 || metrics.memoryP95 >= 60) {
        continue;
      }

      const recommendedSku = findNextSmaller(vm.sku);
      if (!recommendedSku) continue;

      const [currentPrice, recommendedPrice] = await Promise.all([
        getVMPrice(vm.sku, vm.location, 'Linux'),
        getVMPrice(recommendedSku, vm.location, 'Linux'),
      ]);

      if (currentPrice <= 0 || recommendedPrice <= 0 || recommendedPrice >= currentPrice) {
        continue;
      }

      const monthlySaving = currentPrice - recommendedPrice;
      const confidence =
        metrics.cpuP95 < 25 && metrics.memoryP95 < 40 ? 'High' : 'Medium';

      const rowKey = Buffer.from(vm.id)
        .toString('base64')
        .replace(/[/+=]/g, '_')
        .slice(0, 512);

      await upsertRightsizing({
        partitionKey: vm.subscriptionId,
        rowKey,
        resourceId: vm.id,
        vmName: vm.name,
        resourceGroup: vm.resourceGroup,
        subscriptionId: vm.subscriptionId,
        subscriptionName: '',
        location: vm.location,
        currentSku: vm.sku,
        recommendedSku,
        cpuAvg: Math.round(metrics.cpuAvg * 100) / 100,
        cpuP95: Math.round(metrics.cpuP95 * 100) / 100,
        memoryAvg: Math.round(metrics.memoryAvg * 100) / 100,
        memoryP95: Math.round(metrics.memoryP95 * 100) / 100,
        currentMonthlyCost: Math.round(currentPrice * 100) / 100,
        recommendedMonthlyCost: Math.round(recommendedPrice * 100) / 100,
        monthlySaving: Math.round(monthlySaving * 100) / 100,
        confidence,
        analyzedAt: new Date().toISOString(),
        status: 'active',
      });

      analyzed++;
    } catch (err) {
      context.error(`Error analyzing VM ${vm.name}:`, err);
    }
  }

  context.log(`Rightsizing analysis complete. Found ${analyzed} recommendations.`);
}

async function rightsizingTimer(
  _myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  try {
    await analyzeAndStoreRightsizing(context);
  } catch (err) {
    context.error('Rightsizing analysis timer failed:', err);
  }
}

async function getRightsizingHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const subscriptionId = request.query.get('subscriptionId') ?? undefined;
    const recommendations = await getRightsizing(subscriptionId);

    const data = recommendations.map((r) => ({
      id: r.rowKey,
      resourceId: r.resourceId,
      vmName: r.vmName,
      resourceGroup: r.resourceGroup,
      subscriptionId: r.subscriptionId,
      location: r.location,
      currentSku: r.currentSku,
      recommendedSku: r.recommendedSku,
      cpuAvg: r.cpuAvg,
      cpuP95: r.cpuP95,
      memoryAvg: r.memoryAvg,
      memoryP95: r.memoryP95,
      currentMonthlyCost: r.currentMonthlyCost,
      recommendedMonthlyCost: r.recommendedMonthlyCost,
      monthlySaving: r.monthlySaving,
      confidence: r.confidence,
      analyzedAt: r.analyzedAt,
      status: r.status,
    }));

    const totalSaving = data.reduce((s, r) => s + r.monthlySaving, 0);

    return jsonResponse({
      data: data.sort((a, b) => b.monthlySaving - a.monthlySaving),
      summary: { totalCount: data.length, totalMonthlySaving: totalSaving },
      lastAnalyzed: recommendations[0]?.analyzedAt ?? null,
    });
  } catch (err) {
    context.error('Error fetching rightsizing recommendations:', err);
    return errorResponse('Failed to fetch rightsizing data');
  }
}

async function markRightsizingImplemented(
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
    await markEntityStatus(TABLES.rightsizing, subscriptionId, rowKey, 'implemented');
    return jsonResponse({ message: 'Marked as implemented' });
  } catch (err) {
    context.error('Error marking rightsizing as implemented:', err);
    return errorResponse('Failed to update status');
  }
}

app.timer('rightsizingTimer', {
  schedule: '0 0 8 * * *',
  handler: rightsizingTimer,
  runOnStartup: false,
});

app.http('getRightsizing', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'rightsizing',
  handler: getRightsizingHttp,
});

app.http('markRightsizingImplemented', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'rightsizing/implement',
  handler: markRightsizingImplemented,
});

async function triggerRightsizingAnalysis(
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
    await analyzeAndStoreRightsizing(context);
    return jsonResponse({ message: 'Rightsizing analysis triggered successfully' });
  } catch (err) {
    context.error('Error triggering rightsizing analysis:', err);
    return errorResponse('Failed to trigger analysis');
  }
}

app.http('triggerRightsizingAnalysis', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'rightsizing/refresh',
  handler: triggerRightsizingAnalysis,
});
