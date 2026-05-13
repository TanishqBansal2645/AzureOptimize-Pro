import { CostManagementClient } from '@azure/arm-costmanagement';
import { credential } from './credential';

export interface DailySpend {
  date: string;
  cost: number;
  currency: string;
}

export interface ServiceSpend {
  serviceName: string;
  cost: number;
  currency: string;
}

export interface ResourceGroupSpend {
  resourceGroupName: string;
  subscriptionId: string;
  cost: number;
  currency: string;
}

export interface ResourceSpend {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  cost: number;
  currency: string;
}

export interface CostSummary {
  subscriptionId: string;
  subscriptionName: string;
  mtdTotal: number;
  forecastedTotal: number;
  previousMonthTotal: number;
  currency: string;
  dailySpend: DailySpend[];
  serviceBreakdown: ServiceSpend[];
  resourceGroupBreakdown: ResourceGroupSpend[];
  topResources: ResourceSpend[];
  collectedAt: string;
}

function getClient(): CostManagementClient {
  return new CostManagementClient(credential);
}

function getMonthDateRange(offsetMonths: number = 0): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - offsetMonths, 1);
  const to =
    offsetMonths === 0
      ? now
      : new Date(now.getFullYear(), now.getMonth() - offsetMonths + 1, 0);
  return { from, to };
}

function parseCostRows(
  columns: Array<{ name?: string }>,
  rows: unknown[][]
): Record<string, number | string>[] {
  return rows.map((row) => {
    const obj: Record<string, number | string> = {};
    columns.forEach((col, i) => {
      if (col.name) obj[col.name] = row[i] as number | string;
    });
    return obj;
  });
}

export async function getCostSummary(
  subscriptionId: string,
  subscriptionName: string
): Promise<CostSummary> {
  const client = getClient();
  const scope = `/subscriptions/${subscriptionId}`;
  const currency = 'USD';

  const { from: mtdFrom, to: mtdTo } = getMonthDateRange(0);
  const { from: prevFrom, to: prevTo } = getMonthDateRange(1);

  // MTD spend by day
  let dailySpend: DailySpend[] = [];
  let serviceBreakdown: ServiceSpend[] = [];
  let resourceGroupBreakdown: ResourceGroupSpend[] = [];
  let mtdTotal = 0;
  let prevMonthTotal = 0;
  let forecastedTotal = 0;

  try {
    const dailyResult = await client.query.usage(scope, {
      type: 'Usage',
      timeframe: 'Custom',
      timePeriod: { from: mtdFrom, to: mtdTo },
      dataset: {
        granularity: 'Daily',
        aggregation: {
          totalCost: { name: 'Cost', function: 'Sum' },
        },
      },
    });

    if (dailyResult.columns && dailyResult.rows) {
      const parsed = parseCostRows(dailyResult.columns, dailyResult.rows as unknown[][]);
      dailySpend = parsed.map((r) => ({
        date: String(r['UsageDate'] ?? r['BillingPeriodStartDate'] ?? ''),
        cost: Number(r['Cost'] ?? 0),
        currency,
      }));
      mtdTotal = dailySpend.reduce((s, d) => s + d.cost, 0);
    }

    // Forecast: linear extrapolation for remaining days
    const daysElapsed = Math.max(1, mtdTo.getDate());
    const daysInMonth = new Date(
      mtdTo.getFullYear(),
      mtdTo.getMonth() + 1,
      0
    ).getDate();
    forecastedTotal = (mtdTotal / daysElapsed) * daysInMonth;
  } catch (err) {
    console.error(`Error fetching daily costs for ${subscriptionId}:`, err);
  }

  try {
    // Service breakdown
    const serviceResult = await client.query.usage(scope, {
      type: 'Usage',
      timeframe: 'Custom',
      timePeriod: { from: mtdFrom, to: mtdTo },
      dataset: {
        granularity: 'None',
        aggregation: {
          totalCost: { name: 'Cost', function: 'Sum' },
        },
        grouping: [{ type: 'Dimension', name: 'ServiceName' }],
      },
    });

    if (serviceResult.columns && serviceResult.rows) {
      const parsed = parseCostRows(serviceResult.columns, serviceResult.rows as unknown[][]);
      serviceBreakdown = parsed
        .filter((r) => Number(r['Cost']) > 0)
        .map((r) => ({
          serviceName: String(r['ServiceName'] ?? 'Other'),
          cost: Number(r['Cost'] ?? 0),
          currency,
        }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 15);
    }
  } catch (err) {
    console.error(`Error fetching service breakdown for ${subscriptionId}:`, err);
  }

  try {
    // Resource Group breakdown
    const rgResult = await client.query.usage(scope, {
      type: 'Usage',
      timeframe: 'Custom',
      timePeriod: { from: mtdFrom, to: mtdTo },
      dataset: {
        granularity: 'None',
        aggregation: {
          totalCost: { name: 'Cost', function: 'Sum' },
        },
        grouping: [{ type: 'Dimension', name: 'ResourceGroupName' }],
      },
    });

    if (rgResult.columns && rgResult.rows) {
      const parsed = parseCostRows(rgResult.columns, rgResult.rows as unknown[][]);
      resourceGroupBreakdown = parsed
        .filter((r) => Number(r['Cost']) > 0)
        .map((r) => ({
          resourceGroupName: String(r['ResourceGroupName'] ?? 'Other'),
          subscriptionId,
          cost: Number(r['Cost'] ?? 0),
          currency,
        }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 10);
    }
  } catch (err) {
    console.error(`Error fetching RG breakdown for ${subscriptionId}:`, err);
  }

  try {
    // Previous month total
    const prevResult = await client.query.usage(scope, {
      type: 'Usage',
      timeframe: 'Custom',
      timePeriod: { from: prevFrom, to: prevTo },
      dataset: {
        granularity: 'None',
        aggregation: {
          totalCost: { name: 'Cost', function: 'Sum' },
        },
      },
    });

    if (prevResult.columns && prevResult.rows && prevResult.rows.length > 0) {
      const parsed = parseCostRows(prevResult.columns, prevResult.rows as unknown[][]);
      prevMonthTotal = parsed.reduce((s, r) => s + Number(r['Cost'] ?? 0), 0);
    }
  } catch (err) {
    console.error(`Error fetching prev month cost for ${subscriptionId}:`, err);
  }

  // Top resources by cost (via resource-level grouping)
  const topResources: ResourceSpend[] = [];
  try {
    const resourceResult = await client.query.usage(scope, {
      type: 'Usage',
      timeframe: 'Custom',
      timePeriod: { from: mtdFrom, to: mtdTo },
      dataset: {
        granularity: 'None',
        aggregation: {
          totalCost: { name: 'Cost', function: 'Sum' },
        },
        grouping: [
          { type: 'Dimension', name: 'ResourceId' },
          { type: 'Dimension', name: 'ResourceType' },
          { type: 'Dimension', name: 'ResourceGroupName' },
        ],
      },
    });

    if (resourceResult.columns && resourceResult.rows) {
      const parsed = parseCostRows(resourceResult.columns, resourceResult.rows as unknown[][]);
      const sorted = parsed
        .filter((r) => Number(r['Cost']) > 0)
        .sort((a, b) => Number(b['Cost']) - Number(a['Cost']))
        .slice(0, 20);

      for (const r of sorted) {
        const resourceId = String(r['ResourceId'] ?? '');
        const parts = resourceId.split('/');
        topResources.push({
          resourceId,
          resourceName: parts[parts.length - 1] || resourceId,
          resourceType: String(r['ResourceType'] ?? ''),
          resourceGroup: String(r['ResourceGroupName'] ?? ''),
          subscriptionId,
          cost: Number(r['Cost'] ?? 0),
          currency,
        });
      }
    }
  } catch (err) {
    console.error(`Error fetching top resources for ${subscriptionId}:`, err);
  }

  return {
    subscriptionId,
    subscriptionName,
    mtdTotal,
    forecastedTotal,
    previousMonthTotal: prevMonthTotal,
    currency,
    dailySpend,
    serviceBreakdown,
    resourceGroupBreakdown,
    topResources,
    collectedAt: new Date().toISOString(),
  };
}

export async function getAllSubscriptionCosts(
  subscriptions: Array<{ id: string; name: string }>
): Promise<CostSummary[]> {
  const results = await Promise.allSettled(
    subscriptions.map((sub) => getCostSummary(sub.id, sub.name))
  );

  return results
    .filter((r, i) => {
      if (r.status === 'rejected') {
        console.error(
          `Failed to collect costs for subscription ${subscriptions[i]?.name} (${subscriptions[i]?.id}):`,
          r.reason
        );
        return false;
      }
      return true;
    })
    .map((r) => (r as PromiseFulfilledResult<CostSummary>).value);
}
