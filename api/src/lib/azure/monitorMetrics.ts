import { MetricsQueryClient, TimeSeriesElement } from '@azure/monitor-query';
import type { Metric } from '@azure/monitor-query';
import { credential } from './credential';

const client = new MetricsQueryClient(credential);

export interface VMMetrics {
  vmResourceId: string;
  cpuAvg: number;
  cpuP95: number;
  cpuMax: number;
  memoryAvg: number;
  memoryP95: number;
  memoryMax: number;
  dataPoints: number;
}

export interface StorageMetrics {
  resourceId: string;
  hasTransactions: boolean;
  avgTransactionsPerDay: number;
}

export interface DiskMetrics {
  resourceId: string;
  avgIopsPercent: number;
  maxIopsPercent: number;
  provisionedIops: number;
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function extractMetricValues(
  metrics: Metric[],
  metricName: string
): number[] {
  const metric = metrics.find(
    (m) => m.name.toLowerCase() === metricName.toLowerCase()
  );
  if (!metric) return [];

  const values: number[] = [];
  for (const ts of metric.timeseries as TimeSeriesElement[]) {
    for (const dp of ts.data ?? []) {
      const val = dp.average ?? dp.maximum ?? dp.minimum ?? null;
      if (val !== null && val !== undefined) {
        values.push(val);
      }
    }
  }
  return values;
}

export async function getVMMetrics(
  vmResourceId: string,
  totalMemoryBytes: number
): Promise<VMMetrics> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    const result = await client.queryResource(
      vmResourceId,
      ['Percentage CPU', 'Available Memory Bytes'],
      {
        timespan: { startTime: thirtyDaysAgo, endTime: new Date() },
        granularity: 'PT1H',
        aggregations: ['Average', 'Maximum', 'Minimum'],
      }
    );

    const cpuValues = extractMetricValues(result.metrics, 'Percentage CPU');
    const memAvailableValues = extractMetricValues(
      result.metrics,
      'Available Memory Bytes'
    );

    // Convert available memory to utilization %
    const memUtilValues =
      totalMemoryBytes > 0
        ? memAvailableValues.map(
            (avail) => ((totalMemoryBytes - avail) / totalMemoryBytes) * 100
          )
        : memAvailableValues.map(() => 0);

    return {
      vmResourceId,
      cpuAvg: cpuValues.length > 0 ? cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length : 0,
      cpuP95: calculatePercentile(cpuValues, 95),
      cpuMax: cpuValues.length > 0 ? Math.max(...cpuValues) : 0,
      memoryAvg:
        memUtilValues.length > 0
          ? memUtilValues.reduce((a, b) => a + b, 0) / memUtilValues.length
          : 0,
      memoryP95: calculatePercentile(memUtilValues, 95),
      memoryMax: memUtilValues.length > 0 ? Math.max(...memUtilValues) : 0,
      dataPoints: cpuValues.length,
    };
  } catch (err) {
    console.error(`Error fetching VM metrics for ${vmResourceId}:`, err);
    return {
      vmResourceId,
      cpuAvg: 0,
      cpuP95: 100,
      cpuMax: 100,
      memoryAvg: 0,
      memoryP95: 100,
      memoryMax: 100,
      dataPoints: 0,
    };
  }
}

export async function getStorageAccountMetrics(
  storageResourceId: string
): Promise<StorageMetrics> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    const result = await client.queryResource(
      storageResourceId,
      ['Transactions'],
      {
        timespan: { startTime: thirtyDaysAgo, endTime: new Date() },
        granularity: 'P1D',
        aggregations: ['Total'],
      }
    );

    const txValues: number[] = [];
    for (const metric of result.metrics) {
      for (const ts of metric.timeseries as TimeSeriesElement[]) {
        for (const dp of ts.data ?? []) {
          if (dp.total !== undefined && dp.total !== null) {
            txValues.push(dp.total);
          }
        }
      }
    }

    const avgPerDay =
      txValues.length > 0
        ? txValues.reduce((a, b) => a + b, 0) / txValues.length
        : 0;

    return {
      resourceId: storageResourceId,
      hasTransactions: txValues.some((v) => v > 0),
      avgTransactionsPerDay: avgPerDay,
    };
  } catch (err) {
    console.error(`Error fetching storage metrics for ${storageResourceId}:`, err);
    return {
      resourceId: storageResourceId,
      hasTransactions: true, // Assume active if we can't query
      avgTransactionsPerDay: 1,
    };
  }
}

export async function getDiskIOPSMetrics(
  diskResourceId: string,
  provisionedIops: number
): Promise<DiskMetrics> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    const result = await client.queryResource(
      diskResourceId,
      ['Composite Disk Read Operations/sec', 'Composite Disk Write Operations/sec'],
      {
        timespan: { startTime: thirtyDaysAgo, endTime: new Date() },
        granularity: 'PT1H',
        aggregations: ['Average', 'Maximum'],
      }
    );

    const readIops = extractMetricValues(
      result.metrics,
      'Composite Disk Read Operations/sec'
    );
    const writeIops = extractMetricValues(
      result.metrics,
      'Composite Disk Write Operations/sec'
    );

    const combinedIops = readIops.map((r, i) => r + (writeIops[i] ?? 0));
    const iopsPercent =
      provisionedIops > 0
        ? combinedIops.map((v) => (v / provisionedIops) * 100)
        : [0];

    return {
      resourceId: diskResourceId,
      avgIopsPercent:
        iopsPercent.reduce((a, b) => a + b, 0) / Math.max(1, iopsPercent.length),
      maxIopsPercent: Math.max(...iopsPercent, 0),
      provisionedIops,
    };
  } catch (err) {
    console.error(`Error fetching disk IOPS metrics for ${diskResourceId}:`, err);
    return {
      resourceId: diskResourceId,
      avgIopsPercent: 100,
      maxIopsPercent: 100,
      provisionedIops,
    };
  }
}

export async function getSQLDatabaseMetrics(
  sqlResourceId: string
): Promise<{ avgDtuPercent: number; maxDtuPercent: number }> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    const result = await client.queryResource(
      sqlResourceId,
      ['dtu_consumption_percent', 'cpu_percent'],
      {
        timespan: { startTime: thirtyDaysAgo, endTime: new Date() },
        granularity: 'PT1H',
        aggregations: ['Average', 'Maximum'],
      }
    );

    let values = extractMetricValues(result.metrics, 'dtu_consumption_percent');
    if (values.length === 0) {
      values = extractMetricValues(result.metrics, 'cpu_percent');
    }

    return {
      avgDtuPercent:
        values.length > 0
          ? values.reduce((a, b) => a + b, 0) / values.length
          : 50,
      maxDtuPercent: values.length > 0 ? Math.max(...values) : 50,
    };
  } catch (err) {
    console.error(`Error fetching SQL metrics for ${sqlResourceId}:`, err);
    return { avgDtuPercent: 50, maxDtuPercent: 50 };
  }
}
