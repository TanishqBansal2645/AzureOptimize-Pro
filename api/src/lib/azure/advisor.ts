import { AdvisorManagementClient } from '@azure/arm-advisor';
import { credential } from './credential';

export interface AdvisorRecommendation {
  id: string;
  type: string;
  category: string;
  impact: string;
  resourceId: string;
  subscriptionId: string;
  recommendationType: string;
  shortDescription: string;
  potentialBenefit: string;
  extendedProperties: Record<string, string>;
}

export async function getCostRecommendations(
  subscriptionId: string
): Promise<AdvisorRecommendation[]> {
  const client = new AdvisorManagementClient(credential, subscriptionId);
  const results: AdvisorRecommendation[] = [];

  try {
    const iter = client.recommendations.list({
      filter: "Category eq 'Cost'",
    });

    for await (const rec of iter) {
      const extProps: Record<string, string> = {};
      if (rec.extendedProperties) {
        for (const [k, v] of Object.entries(rec.extendedProperties)) {
          extProps[k] = String(v ?? '');
        }
      }

      results.push({
        id: rec.id ?? '',
        type: rec.type ?? '',
        category: rec.category ?? 'Cost',
        impact: rec.impact ?? 'Medium',
        resourceId: rec.resourceMetadata?.resourceId ?? '',
        subscriptionId,
        recommendationType: rec.recommendationTypeId ?? '',
        shortDescription: rec.shortDescription?.problem ?? '',
        potentialBenefit: rec.potentialBenefits ?? '',
        extendedProperties: extProps,
      });
    }
  } catch (err) {
    console.error(
      `Error fetching Advisor recommendations for ${subscriptionId}:`,
      err
    );
  }

  return results;
}

export async function getAHBAdvisorSavings(
  subscriptionIds: string[]
): Promise<Map<string, number>> {
  const savingsMap = new Map<string, number>();

  for (const subscriptionId of subscriptionIds) {
    const recommendations = await getCostRecommendations(subscriptionId);

    for (const rec of recommendations) {
      const isAHB =
        rec.shortDescription.toLowerCase().includes('hybrid') ||
        rec.recommendationType.toLowerCase().includes('hybrid') ||
        rec.potentialBenefit.toLowerCase().includes('hybrid') ||
        rec.shortDescription.toLowerCase().includes('ahb') ||
        rec.recommendationType.toLowerCase().includes('ahb');

      if (!isAHB || !rec.resourceId) continue;

      const props = rec.extendedProperties;
      const annual = parseFloat(
        props['annualSavingsAmount'] ?? props['estimatedAnnualSavings'] ?? '0'
      );
      const monthly =
        annual > 0
          ? annual / 12
          : parseFloat(props['savingsAmount'] ?? props['monthlySavings'] ?? '0');

      if (monthly > 0) {
        savingsMap.set(rec.resourceId.toLowerCase(), Math.round(monthly * 100) / 100);
      }
    }
  }

  return savingsMap;
}

export function parseReservationRecommendation(rec: AdvisorRecommendation): {
  isReservation: boolean;
  resourceType: string;
  region: string;
  term: '1Year' | '3Year';
  annualSavings: number;
  recommendedQuantity: number;
} {
  const recType = rec.recommendationType.toLowerCase();
  const shortDesc = rec.shortDescription.toLowerCase();

  const isReservation =
    recType.includes('reservation') ||
    shortDesc.includes('reserved instance') ||
    shortDesc.includes('savings plan') ||
    recType.includes('ri') ||
    shortDesc.includes('reserve');

  const props = rec.extendedProperties;

  const annualSavings = parseFloat(
    props['annualSavingsAmount'] ??
      props['savingsAmount'] ??
      props['estimatedAnnualSavings'] ??
      '0'
  );

  const term =
    props['term'] === 'P3Y' || props['lookbackPeriod'] === 'P3Y'
      ? '3Year'
      : '1Year';

  return {
    isReservation,
    resourceType: props['recommendationType'] ?? props['vmSize'] ?? 'Virtual Machine',
    region:
      props['region'] ?? props['location'] ?? props['armRegionName'] ?? '',
    term,
    annualSavings,
    recommendedQuantity: parseInt(props['recommendedQuantity'] ?? '1', 10) || 1,
  };
}
