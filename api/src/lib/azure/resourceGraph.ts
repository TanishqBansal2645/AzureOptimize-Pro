import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { credential } from './credential';

const client = new ResourceGraphClient(credential);

interface GraphResult {
  data?: unknown[];
  count?: number;
}

export async function runResourceGraphQuery(
  subscriptionIds: string[],
  query: string
): Promise<unknown[]> {
  if (subscriptionIds.length === 0) return [];

  try {
    const result = (await client.resources(
      { query, subscriptions: subscriptionIds },
      { resultFormat: 'objectArray' }
    )) as GraphResult;

    return (result.data as unknown[]) ?? [];
  } catch (err) {
    console.error('Resource Graph query error:', err);
    return [];
  }
}

export interface IdleResource {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  subscriptionId: string;
  location: string;
  sku?: string;
  sizeGB?: number;
  age?: number;
  details: Record<string, unknown>;
}

export async function findUnattachedDisks(
  subscriptionIds: string[]
): Promise<IdleResource[]> {
  const query = `
    Resources
    | where type =~ 'microsoft.compute/disks'
    | where properties.diskState =~ 'Unattached'
    | project id, name, resourceGroup, subscriptionId, location,
              sku=sku.name, sizeGB=properties.diskSizeGB,
              createdAt=properties.timeCreated
  `;
  const results = await runResourceGraphQuery(subscriptionIds, query);
  return (results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? ''),
    type: 'Unattached Disk',
    resourceGroup: String(r['resourceGroup'] ?? ''),
    subscriptionId: String(r['subscriptionId'] ?? ''),
    location: String(r['location'] ?? ''),
    sku: String(r['sku'] ?? ''),
    sizeGB: Number(r['sizeGB'] ?? 0),
    details: r,
  }));
}

export async function findOrphanedPublicIPs(
  subscriptionIds: string[]
): Promise<IdleResource[]> {
  const query = `
    Resources
    | where type =~ 'microsoft.network/publicipaddresses'
    | where isnull(properties.ipConfiguration)
    | project id, name, resourceGroup, subscriptionId, location, sku=sku.name
  `;
  const results = await runResourceGraphQuery(subscriptionIds, query);
  return (results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? ''),
    type: 'Orphaned Public IP',
    resourceGroup: String(r['resourceGroup'] ?? ''),
    subscriptionId: String(r['subscriptionId'] ?? ''),
    location: String(r['location'] ?? ''),
    sku: String(r['sku'] ?? ''),
    details: r,
  }));
}

export async function findEmptyAppServicePlans(
  subscriptionIds: string[]
): Promise<IdleResource[]> {
  const query = `
    Resources
    | where type =~ 'microsoft.web/serverfarms'
    | where properties.numberOfSites == 0
    | where sku.tier !in ('Free', 'Shared')
    | project id, name, resourceGroup, subscriptionId, location,
              tier=sku.tier, sku=sku.name
  `;
  const results = await runResourceGraphQuery(subscriptionIds, query);
  return (results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? ''),
    type: 'Empty App Service Plan',
    resourceGroup: String(r['resourceGroup'] ?? ''),
    subscriptionId: String(r['subscriptionId'] ?? ''),
    location: String(r['location'] ?? ''),
    sku: String(r['sku'] ?? ''),
    details: r,
  }));
}

export async function findOldSnapshots(
  subscriptionIds: string[]
): Promise<IdleResource[]> {
  const query = `
    Resources
    | where type =~ 'microsoft.compute/snapshots'
    | extend age = datetime_diff('day', now(), todatetime(properties.timeCreated))
    | where age > 30
    | project id, name, resourceGroup, subscriptionId, location,
              age, sizeGB=properties.diskSizeGB, createdAt=properties.timeCreated
  `;
  const results = await runResourceGraphQuery(subscriptionIds, query);
  return (results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? ''),
    type: 'Old Snapshot',
    resourceGroup: String(r['resourceGroup'] ?? ''),
    subscriptionId: String(r['subscriptionId'] ?? ''),
    location: String(r['location'] ?? ''),
    sizeGB: Number(r['sizeGB'] ?? 0),
    age: Number(r['age'] ?? 0),
    details: r,
  }));
}

export async function findOrphanedNICs(
  subscriptionIds: string[]
): Promise<IdleResource[]> {
  const query = `
    Resources
    | where type =~ 'microsoft.network/networkinterfaces'
    | where isnull(properties.virtualMachine)
    | project id, name, resourceGroup, subscriptionId, location
  `;
  const results = await runResourceGraphQuery(subscriptionIds, query);
  return (results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? ''),
    type: 'Orphaned NIC',
    resourceGroup: String(r['resourceGroup'] ?? ''),
    subscriptionId: String(r['subscriptionId'] ?? ''),
    location: String(r['location'] ?? ''),
    details: r,
  }));
}

export async function findIdleLoadBalancers(
  subscriptionIds: string[]
): Promise<IdleResource[]> {
  const query = `
    Resources
    | where type =~ 'microsoft.network/loadbalancers'
    | where array_length(properties.backendAddressPools) == 0
      or (properties.backendAddressPools[0].properties.backendIPConfigurations | isempty)
    | where sku.tier !in ('Basic')
    | project id, name, resourceGroup, subscriptionId, location, sku=sku.name
  `;
  const results = await runResourceGraphQuery(subscriptionIds, query);
  return (results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? ''),
    type: 'Idle Load Balancer',
    resourceGroup: String(r['resourceGroup'] ?? ''),
    subscriptionId: String(r['subscriptionId'] ?? ''),
    location: String(r['location'] ?? ''),
    sku: String(r['sku'] ?? ''),
    details: r,
  }));
}

export async function findWindowsVMsWithoutAHB(
  subscriptionIds: string[]
): Promise<IdleResource[]> {
  const query = `
    Resources
    | where type =~ 'microsoft.compute/virtualmachines'
    | where properties.storageProfile.osDisk.osType =~ 'Windows'
    | where isnull(properties.licenseType) or properties.licenseType !in ('Windows_Server', 'Windows_Client')
    | project id, name, resourceGroup, subscriptionId, location,
              sku=properties.hardwareProfile.vmSize
  `;
  const results = await runResourceGraphQuery(subscriptionIds, query);
  return (results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? ''),
    type: 'Windows VM without AHB',
    resourceGroup: String(r['resourceGroup'] ?? ''),
    subscriptionId: String(r['subscriptionId'] ?? ''),
    location: String(r['location'] ?? ''),
    sku: String(r['sku'] ?? ''),
    details: r,
  }));
}

export async function findSQLVMsWithoutAHB(
  subscriptionIds: string[]
): Promise<IdleResource[]> {
  const query = `
    Resources
    | where type =~ 'microsoft.sqlvirtualmachine/sqlvirtualmachines'
    | where properties.sqlServerLicenseType !in ('AHUB', 'DR')
    | project id, name, resourceGroup, subscriptionId, location
  `;
  const results = await runResourceGraphQuery(subscriptionIds, query);
  return (results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? ''),
    type: 'SQL VM without AHB',
    resourceGroup: String(r['resourceGroup'] ?? ''),
    subscriptionId: String(r['subscriptionId'] ?? ''),
    location: String(r['location'] ?? ''),
    details: r,
  }));
}

export async function findAllVMs(
  subscriptionIds: string[]
): Promise<Array<{
  id: string;
  name: string;
  resourceGroup: string;
  subscriptionId: string;
  location: string;
  sku: string;
  powerState: string;
}>> {
  const query = `
    Resources
    | where type =~ 'microsoft.compute/virtualmachines'
    | project id, name, resourceGroup, subscriptionId, location,
              sku=properties.hardwareProfile.vmSize,
              powerState=properties.extended.instanceView.powerState.code
  `;
  const results = await runResourceGraphQuery(subscriptionIds, query);
  return (results as Array<Record<string, unknown>>).map((r) => ({
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? ''),
    resourceGroup: String(r['resourceGroup'] ?? ''),
    subscriptionId: String(r['subscriptionId'] ?? ''),
    location: String(r['location'] ?? ''),
    sku: String(r['sku'] ?? ''),
    powerState: String(r['powerState'] ?? ''),
  }));
}

export async function findAzureSQLDatabases(
  subscriptionIds: string[]
): Promise<Array<Record<string, unknown>>> {
  const query = `
    Resources
    | where type =~ 'microsoft.sql/servers/databases'
    | where name !in ('master', 'model', 'tempdb')
    | project id, name, resourceGroup, subscriptionId, location,
              sku=sku.name, tier=sku.tier, capacity=sku.capacity
  `;
  return (await runResourceGraphQuery(subscriptionIds, query)) as Array<Record<string, unknown>>;
}

export async function findCosmosDBAccounts(
  subscriptionIds: string[]
): Promise<Array<Record<string, unknown>>> {
  const query = `
    Resources
    | where type =~ 'microsoft.documentdb/databaseaccounts'
    | project id, name, resourceGroup, subscriptionId, location,
              kind=properties.databaseAccountOfferType
  `;
  return (await runResourceGraphQuery(subscriptionIds, query)) as Array<Record<string, unknown>>;
}

export async function findPremiumDisks(
  subscriptionIds: string[]
): Promise<Array<Record<string, unknown>>> {
  const query = `
    Resources
    | where type =~ 'microsoft.compute/disks'
    | where sku.name =~ 'Premium_LRS'
    | where properties.diskState =~ 'Attached'
    | project id, name, resourceGroup, subscriptionId, location,
              sku=sku.name, sizeGB=properties.diskSizeGB,
              iopsLimit=properties.diskIOPSReadWrite
  `;
  return (await runResourceGraphQuery(subscriptionIds, query)) as Array<Record<string, unknown>>;
}

export async function findStorageAccounts(
  subscriptionIds: string[]
): Promise<Array<Record<string, unknown>>> {
  const query = `
    Resources
    | where type =~ 'microsoft.storage/storageaccounts'
    | project id, name, resourceGroup, subscriptionId, location,
              kind, tier=sku.tier, sku=sku.name
  `;
  return (await runResourceGraphQuery(subscriptionIds, query)) as Array<Record<string, unknown>>;
}

export async function findLogAnalyticsWorkspaces(
  subscriptionIds: string[]
): Promise<Array<Record<string, unknown>>> {
  const query = `
    Resources
    | where type =~ 'microsoft.operationalinsights/workspaces'
    | project id, name, resourceGroup, subscriptionId, location,
              retentionDays=properties.retentionInDays,
              dailyQuota=properties.workspaceCapping.dailyQuotaGb
  `;
  return (await runResourceGraphQuery(subscriptionIds, query)) as Array<Record<string, unknown>>;
}
