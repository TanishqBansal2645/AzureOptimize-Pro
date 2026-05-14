interface RetailPrice {
  retailPrice: number;
  unitPrice: number;
  armRegionName: string;
  location: string;
  effectiveStartDate: string;
  meterId: string;
  meterName: string;
  productId: string;
  skuId: string;
  productName: string;
  skuName: string;
  serviceName: string;
  serviceId: string;
  serviceFamily: string;
  unitOfMeasure: string;
  type: string;
  isPrimaryMeterRegion: boolean;
  armSkuName: string;
  currencyCode: string;
}

interface RetailPricesResponse {
  BillingCurrency: string;
  CustomerEntityId: string;
  CustomerEntityType: string;
  Items: RetailPrice[];
  NextPageLink?: string;
}

const PRICES_API = 'https://prices.azure.com/api/retail/prices';
const API_VERSION = '2023-01-01-preview';

async function fetchPrices(filter: string): Promise<RetailPrice[]> {
  const url = `${PRICES_API}?api-version=${API_VERSION}&$filter=${encodeURIComponent(filter)}`;

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
      throw new Error(`Retail Prices API returned ${resp.status}`);
    }
    const data = (await resp.json()) as RetailPricesResponse;
    return data.Items ?? [];
  } catch (err) {
    console.error('Retail Prices API error:', err);
    return [];
  }
}

export async function getVMPrice(
  skuName: string,
  region: string,
  osType: 'Windows' | 'Linux' = 'Windows'
): Promise<number> {
  // Fetch all consumption entries for this SKU — no server-side OS filter because
  // 'productName contains Windows' is unreliable across regions and SKU families.
  // Windows vs Linux is distinguished client-side via productName/skuName.
  const filter = `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and armSkuName eq '${skuName}' and priceType eq 'Consumption'`;

  const prices = await fetchPrices(filter);

  const isWindows = (p: RetailPrice): boolean =>
    p.productName.toLowerCase().includes('windows') ||
    p.skuName.toLowerCase().includes('windows');

  const eligible = osType === 'Windows'
    ? prices.filter(isWindows)
    : prices.filter((p) => !isWindows(p));

  // Exclude Spot and Low Priority — only PAYG on-demand rates are relevant for savings estimates
  const hourlyPrice = eligible
    .filter(
      (p) =>
        p.unitOfMeasure === '1 Hour' &&
        !p.skuName.toLowerCase().includes('spot') &&
        !p.skuName.toLowerCase().includes('low priority')
    )
    .sort((a, b) => a.retailPrice - b.retailPrice)[0];

  if (!hourlyPrice) {
    console.warn(
      `[retailPrices] no PAYG price found for ${skuName} ${osType} in ${region}. ` +
      `Total API items: ${prices.length}, after OS filter: ${eligible.length}`
    );
  }

  return hourlyPrice ? hourlyPrice.retailPrice * 730 : 0;
}

export async function getDiskPrice(
  skuName: string,
  sizeGB: number,
  region: string
): Promise<number> {
  const tierMap: Record<string, string> = {
    Premium_LRS: 'Premium SSD',
    StandardSSD_LRS: 'Standard SSD',
    Standard_LRS: 'Standard HDD',
    UltraSSD_LRS: 'Ultra Disk',
  };

  const tier = tierMap[skuName] ?? 'Standard SSD';
  const filter = `serviceName eq 'Storage' and productName contains '${tier}' and armRegionName eq '${region}' and priceType eq 'Consumption'`;

  const prices = await fetchPrices(filter);

  // Find best matching disk size tier
  const disksizes = [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32767];
  const targetSize = disksizes.find((s) => s >= sizeGB) ?? 32767;

  const matchingPrice = prices.find((p) =>
    p.skuName.toLowerCase().includes(String(targetSize))
  );

  return matchingPrice ? matchingPrice.retailPrice : estimateDiskCost(skuName, sizeGB);
}

function estimateDiskCost(skuName: string, sizeGB: number): number {
  // Fallback estimates per GB/month
  const ratePerGB: Record<string, number> = {
    Premium_LRS: 0.135,
    StandardSSD_LRS: 0.05,
    Standard_LRS: 0.02,
    UltraSSD_LRS: 0.3,
  };
  const rate = ratePerGB[skuName] ?? 0.05;
  return sizeGB * rate;
}

export async function getWindowsLicenseSaving(
  skuName: string,
  region: string
): Promise<{ saving: number; windowsPrice: number; linuxPrice: number }> {
  const [windowsPrice, linuxPrice] = await Promise.all([
    getVMPrice(skuName, region, 'Windows'),
    getVMPrice(skuName, region, 'Linux'),
  ]);
  return {
    saving: Math.max(0, windowsPrice - linuxPrice),
    windowsPrice,
    linuxPrice,
  };
}

function normalizeASPSkuForAPI(sku: string): string {
  // "P1v2" → "P1 v2", "P2v3" → "P2 v3"; "B1"/"S1" unchanged
  return sku.replace(/^([A-Za-z]+\d+)(v\d+)$/i, '$1 $2');
}

const ASP_PRICE_FALLBACK: Record<string, number> = {
  b1: 13.14, b2: 26.28, b3: 52.56,
  s1: 73.0, s2: 146.0, s3: 292.0,
  p1v2: 81.03, p2v2: 162.06, p3v2: 324.12,
  p1v3: 118.40, p2v3: 236.80, p3v3: 473.60,
};

export async function getASPPrice(sku: string, region: string): Promise<number> {
  const apiSku = normalizeASPSkuForAPI(sku);
  const filter = `serviceName eq 'Azure App Service' and armRegionName eq '${region}' and armSkuName eq '${apiSku}' and priceType eq 'Consumption'`;
  const prices = await fetchPrices(filter);

  const hourlyPrice = prices
    .filter((p) => p.unitOfMeasure === '1 Hour')
    .sort((a, b) => a.retailPrice - b.retailPrice)[0];

  if (hourlyPrice) return Math.round(hourlyPrice.retailPrice * 730 * 100) / 100;

  const fallback = ASP_PRICE_FALLBACK[sku.toLowerCase()] ?? 0;
  if (!fallback) {
    console.warn(`[retailPrices] no price found for ASP SKU ${sku} in ${region}`);
  }
  return fallback;
}

export async function getPublicIPCost(region: string): Promise<number> {
  const filter = `serviceName eq 'IP Addresses' and armRegionName eq '${region}' and priceType eq 'Consumption'`;
  const prices = await fetchPrices(filter);
  const staticIP = prices.find((p) => p.skuName.toLowerCase().includes('static'));
  return staticIP ? staticIP.retailPrice * 730 : 3.65; // ~$3.65/month fallback
}

export async function getSQLHybridBenefitSaving(
  edition: string,
  vCores: number,
  region: string
): Promise<number> {
  // SQL AHB saves the Windows SQL Server license cost
  // Typically 40-55% of total cost
  const filter = `serviceName eq 'SQL Database' and armRegionName eq '${region}' and priceType eq 'Consumption' and skuName contains '${vCores} vCore'`;
  const prices = await fetchPrices(filter);

  if (prices.length > 0) {
    const licenseIncluded = prices.find((p) =>
      p.skuName.toLowerCase().includes('license included')
    );
    const ahubPrice = prices.find((p) =>
      p.skuName.toLowerCase().includes('azure hybrid benefit') ||
      p.skuName.toLowerCase().includes('ahb')
    );

    if (licenseIncluded && ahubPrice) {
      return Math.max(0, licenseIncluded.retailPrice - ahubPrice.retailPrice) * 730;
    }
  }

  // Fallback: estimate based on vCores
  return vCores * 100; // ~$100/vCore/month saving estimate
}

// Estimates for idle resource costs when Retail Prices API isn't granular enough
export function estimateIdleResourceCost(
  resourceType: string,
  details: Record<string, unknown>
): number {
  switch (resourceType) {
    case 'Unattached Disk': {
      const sku = String(details['sku'] ?? 'Standard_LRS');
      const sizeGB = Number(details['sizeGB'] ?? 128);
      return estimateDiskCost(sku, sizeGB);
    }
    case 'Orphaned Public IP':
      return 3.65;
    case 'Empty App Service Plan': {
      const tier = String(details['tier'] ?? 'Standard').toLowerCase();
      if (tier.includes('premium')) return 150;
      if (tier.includes('standard')) return 75;
      if (tier.includes('basic')) return 25;
      return 50;
    }
    case 'Old Snapshot': {
      const sizeGB = Number(details['sizeGB'] ?? 128);
      return sizeGB * 0.05;
    }
    case 'Orphaned NIC':
      return 2;
    case 'Idle Load Balancer':
      return 18;
    default:
      return 10;
  }
}
