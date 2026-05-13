import { ResourceManagementClient } from '@azure/arm-resources';
import { ComputeManagementClient } from '@azure/arm-compute';
import { SqlManagementClient } from '@azure/arm-sql';
import { credential } from './credential';

export interface RemediationResult {
  success: boolean;
  action: string;
  automated: boolean;
  details?: string;
  portalUrl?: string;
  powershellCommand?: string;
  cliCommand?: string;
}

// ARM API versions per idle resource type
const IDLE_API_VERSIONS: Record<string, string> = {
  'Unattached Disk':        '2023-10-02',
  'Old Snapshot':           '2023-10-02',
  'Orphaned Public IP':     '2023-11-01',
  'Orphaned NIC':           '2023-11-01',
  'Idle Load Balancer':     '2023-11-01',
  'Empty App Service Plan': '2024-04-01',
};

// ─── Idle Resource Deletion ────────────────────────────────────────────────────

export async function remediateIdleResource(
  subscriptionId: string,
  resourceId: string,
  resourceType: string
): Promise<RemediationResult> {
  const apiVersion = IDLE_API_VERSIONS[resourceType] ?? '2023-01-01';
  const client = new ResourceManagementClient(credential, subscriptionId);
  await client.resources.beginDeleteByIdAndWait(resourceId, apiVersion);
  return {
    success: true,
    automated: true,
    action: `Deleted ${resourceType}: ${resourceId.split('/').pop() ?? resourceId}`,
  };
}

// ─── VM Rightsizing ────────────────────────────────────────────────────────────

export async function remediateRightsizing(
  subscriptionId: string,
  resourceGroup: string,
  vmName: string,
  recommendedSku: string
): Promise<RemediationResult> {
  const client = new ComputeManagementClient(credential, subscriptionId);

  // Deallocate (stops the VM, waits for completion — typically 1-3 min)
  await client.virtualMachines.beginDeallocateAndWait(resourceGroup, vmName);

  // Resize to recommended SKU (fast, < 30 sec)
  await client.virtualMachines.beginUpdateAndWait(resourceGroup, vmName, {
    hardwareProfile: { vmSize: recommendedSku },
  });

  // Start the VM — fire-and-forget so we don't timeout waiting 3+ minutes
  client.virtualMachines.beginStart(resourceGroup, vmName).catch(() => {});

  return {
    success: true,
    automated: true,
    action: `VM ${vmName} resized to ${recommendedSku}. Start initiated.`,
    details: 'VM was deallocated, resized, and start was triggered. The VM will be online in 1-3 minutes.',
  };
}

// ─── Azure Hybrid Benefit ─────────────────────────────────────────────────────

export async function remediateAHBWindows(
  subscriptionId: string,
  resourceGroup: string,
  vmName: string
): Promise<RemediationResult> {
  const client = new ComputeManagementClient(credential, subscriptionId);
  await client.virtualMachines.beginUpdateAndWait(resourceGroup, vmName, {
    licenseType: 'Windows_Server',
  });
  return {
    success: true,
    automated: true,
    action: `Azure Hybrid Benefit enabled on ${vmName} (no restart required)`,
  };
}

// SQL VM AHB requires a SQL Server IaaS Agent extension update — generate command
export function remediateAHBSqlManual(
  resourceGroup: string,
  vmName: string,
  subscriptionId: string
): RemediationResult {
  return {
    success: true,
    automated: false,
    action: 'SQL VM AHB requires manual enablement via SQL IaaS Agent',
    powershellCommand: [
      `# Enable AHB on SQL VM`,
      `Set-AzContext -SubscriptionId "${subscriptionId}"`,
      `Update-AzSqlVM -ResourceGroupName "${resourceGroup}" -Name "${vmName}" -LicenseType "AHUB"`,
    ].join('\n'),
    portalUrl: `https://portal.azure.com/#resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.SqlVirtualMachine/sqlVirtualMachines/${vmName}/overview`,
  };
}

// ─── Storage Optimizations ────────────────────────────────────────────────────

// Downgrade Premium SSD disk to Standard SSD.
// Azure requires the VM to be deallocated before changing the disk SKU when it is attached
// to a running VM. This function checks the VM power state, stops it if needed, changes
// the SKU, then restarts the VM.
export async function remediateStorageDiskDowngrade(
  subscriptionId: string,
  resourceGroup: string,
  diskName: string
): Promise<RemediationResult> {
  const client = new ComputeManagementClient(credential, subscriptionId);

  // Check whether disk is attached and if so, what VM and whether it is running
  const disk = await client.disks.get(resourceGroup, diskName);
  const attachedVmId = disk.managedBy ?? null; // e.g. /subscriptions/.../virtualMachines/vm1

  let vmRg = resourceGroup;
  let vmName: string | null = null;
  let vmWasRunning = false;

  if (attachedVmId) {
    const parts = attachedVmId.split('/');
    const rgIdx = parts.findIndex((p) => p.toLowerCase() === 'resourcegroups');
    vmRg = rgIdx >= 0 ? parts[rgIdx + 1] : resourceGroup;
    vmName = parts[parts.length - 1];

    const vmView = await client.virtualMachines.instanceView(vmRg, vmName);
    const powerCode = vmView.statuses?.find((s) => s.code?.startsWith('PowerState/'))?.code ?? '';
    vmWasRunning = powerCode === 'PowerState/running';

    if (vmWasRunning) {
      // Must deallocate (not just stop) — a stopped-but-allocated VM still blocks SKU changes
      await client.virtualMachines.beginDeallocateAndWait(vmRg, vmName);
    }
  }

  // Change disk SKU — safe now whether attached (deallocated VM) or unattached
  await client.disks.beginUpdateAndWait(resourceGroup, diskName, {
    sku: { name: 'StandardSSD_LRS' },
  });

  // Start the VM again — fire-and-forget to avoid HTTP timeout
  if (vmWasRunning && vmName) {
    client.virtualMachines.beginStart(vmRg, vmName).catch(() => {});
  }

  const action = vmWasRunning
    ? `Disk ${diskName} downgraded to Standard SSD. VM '${vmName}' was deallocated before change and restart has been initiated.`
    : vmName
      ? `Disk ${diskName} downgraded to Standard SSD. VM '${vmName}' was already deallocated — no restart needed.`
      : `Disk ${diskName} downgraded to Standard SSD (unattached disk — changed directly).`;

  const details = vmWasRunning
    ? `VM was temporarily deallocated to allow the disk SKU change. Restart triggered — VM will be online in 1-3 minutes.`
    : vmName
      ? `VM was already in a deallocated state. SKU changed without any additional stop/start.`
      : `Disk was unattached. SKU changed directly with no VM impact.`;

  return { success: true, automated: true, action, details };
}

// Unused storage account — too risky to auto-delete; generate CLI command
export function remediateStorageAccountManual(
  resourceGroup: string,
  accountName: string,
  subscriptionId: string
): RemediationResult {
  return {
    success: true,
    automated: false,
    action: 'Storage account deletion requires manual verification',
    cliCommand: [
      `# Verify storage account is safe to delete`,
      `az storage account show --name "${accountName}" --resource-group "${resourceGroup}" --subscription "${subscriptionId}"`,
      ``,
      `# Then delete it`,
      `az storage account delete --name "${accountName}" --resource-group "${resourceGroup}" --subscription "${subscriptionId}" --yes`,
    ].join('\n'),
    portalUrl: `https://portal.azure.com/#resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${accountName}/overview`,
  };
}

// Reduce Log Analytics workspace retention via ARM REST
export async function remediateLogAnalyticsRetention(
  subscriptionId: string,
  resourceGroup: string,
  workspaceName: string
): Promise<RemediationResult> {
  const tokenResponse = await credential.getToken('https://management.azure.com/.default');
  const token = tokenResponse.token;
  const apiVersion = '2023-09-01';
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.OperationalInsights/workspaces/${workspaceName}?api-version=${apiVersion}`;

  const getResp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!getResp.ok) throw new Error(`GET workspace failed: ${getResp.status} ${getResp.statusText}`);
  const ws = await getResp.json() as { location: string; properties?: Record<string, unknown>; tags?: unknown };

  const patchBody = {
    location: ws.location,
    tags: ws.tags,
    properties: { ...(ws.properties ?? {}), retentionInDays: 31 },
  };

  const patchResp = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patchBody),
  });
  if (!patchResp.ok) throw new Error(`PUT workspace failed: ${patchResp.status} ${patchResp.statusText}`);

  return {
    success: true,
    automated: true,
    action: `Log Analytics workspace ${workspaceName} retention set to 31 days (free tier)`,
    details: 'Data older than 31 days will be removed gradually.',
  };
}

// ─── Database Optimizations ───────────────────────────────────────────────────

// Extract server name and database name from ARM resource ID
function parseSqlResourceId(resourceId: string): { serverName: string; databaseName: string } {
  // /subscriptions/.../resourceGroups/.../providers/Microsoft.Sql/servers/{server}/databases/{db}
  const parts = resourceId.split('/');
  const serverIdx = parts.findIndex((p) => p.toLowerCase() === 'servers');
  const dbIdx = parts.findIndex((p) => p.toLowerCase() === 'databases');
  return {
    serverName: serverIdx >= 0 ? parts[serverIdx + 1] : '',
    databaseName: dbIdx >= 0 ? parts[dbIdx + 1] : '',
  };
}

export async function remediateSqlDatabase(
  subscriptionId: string,
  resourceGroup: string,
  resourceId: string,
  recommendedCapacity: number,
  targetTier: string
): Promise<RemediationResult> {
  const { serverName, databaseName } = parseSqlResourceId(resourceId);
  if (!serverName || !databaseName) throw new Error('Could not parse SQL server/database name from resource ID');

  const client = new SqlManagementClient(credential, subscriptionId);
  const currentDb = await client.databases.get(resourceGroup, serverName, databaseName);

  await client.databases.beginCreateOrUpdateAndWait(resourceGroup, serverName, databaseName, {
    location: currentDb.location ?? 'eastus',
    sku: {
      name: targetTier === 'Basic' ? 'Basic' : 'Standard',
      tier: targetTier === 'Basic' ? 'Basic' : 'Standard',
      capacity: recommendedCapacity,
    },
  });

  return {
    success: true,
    automated: true,
    action: `SQL Database ${databaseName} scaled to ${targetTier} ${recommendedCapacity} DTU`,
    details: 'Brief connection interruption may have occurred during scaling.',
  };
}

// Cosmos DB serverless migration is complex — manual only
export function remediateCosmosManual(
  resourceGroup: string,
  accountName: string,
  subscriptionId: string
): RemediationResult {
  return {
    success: true,
    automated: false,
    action: 'Cosmos DB serverless migration requires manual steps in Azure Portal',
    portalUrl: `https://portal.azure.com/#resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB/databaseAccounts/${accountName}/overview`,
    powershellCommand: [
      `# Cosmos DB does not support in-place migration from Provisioned to Serverless.`,
      `# You must create a new Serverless account and migrate data.`,
      `# See: https://aka.ms/cosmos-serverless`,
    ].join('\n'),
  };
}
