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
  getCostRecommendations,
  parseReservationRecommendation,
} from '../lib/azure/advisor';
import { upsertReservation, getReservations } from '../lib/storage/tableClient';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

export async function fetchAndStoreRecommendations(context: InvocationContext): Promise<void> {
  context.log('Fetching RI recommendations from Azure Advisor...');

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

  for (const subscriptionId of subscriptionIds) {
    try {
      const recommendations = await getCostRecommendations(subscriptionId);
      context.log(`Found ${recommendations.length} cost recommendations for ${subscriptionId}`);

      for (const rec of recommendations) {
        const parsed = parseReservationRecommendation(rec);
        if (!parsed.isReservation || parsed.annualSavings <= 0) continue;

        const monthlySaving = parsed.annualSavings / 12;
        const oneMonthlyCost = monthlySaving * 0.4; // RI is ~40% less than on-demand

        const rowKey = Buffer.from(rec.id)
          .toString('base64')
          .replace(/[/+=]/g, '_')
          .slice(0, 512);

        try {
          await upsertReservation({
            partitionKey: subscriptionId,
            rowKey,
            advisorId: rec.id,
            resourceType: parsed.resourceType,
            region: parsed.region,
            scope: rec.resourceId || `/subscriptions/${subscriptionId}`,
            subscriptionId,
            currentMonthlyCost: oneMonthlyCost + monthlySaving,
            oneYearMonthlyCost: oneMonthlyCost,
            threeYearMonthlyCost: oneMonthlyCost * 0.8,
            oneYearSaving: monthlySaving,
            threeYearSaving: monthlySaving * 1.2,
            oneYearPaybackMonths:
              monthlySaving > 0 ? Math.round((oneMonthlyCost * 12) / monthlySaving) : 12,
            threeYearPaybackMonths:
              monthlySaving > 0 ? Math.round((oneMonthlyCost * 12 * 3) / (monthlySaving * 1.2 * 36)) : 24,
            term: parsed.term,
            fetchedAt: new Date().toISOString(),
            status: 'active',
          });
        } catch (err) {
          context.error(`Error upserting reservation recommendation ${rec.id}:`, err);
        }
      }
    } catch (err) {
      context.error(`Error processing recommendations for ${subscriptionId}:`, err);
    }
  }

  context.log('RI recommendation fetch complete');
}

async function fetchRecommendationsTimer(
  _myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  try {
    await fetchAndStoreRecommendations(context);
  } catch (err) {
    context.error('Recommendations fetch timer failed:', err);
  }
}

async function getReservationsHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const reservations = await getReservations();

    const data = reservations.map((r) => ({
      id: r.rowKey,
      advisorId: r.advisorId,
      resourceType: r.resourceType,
      region: r.region,
      scope: r.scope,
      subscriptionId: r.subscriptionId,
      currentMonthlyCost: r.currentMonthlyCost,
      oneYearMonthlyCost: r.oneYearMonthlyCost,
      threeYearMonthlyCost: r.threeYearMonthlyCost,
      oneYearSaving: r.oneYearSaving,
      threeYearSaving: r.threeYearSaving,
      oneYearPaybackMonths: r.oneYearPaybackMonths,
      threeYearPaybackMonths: r.threeYearPaybackMonths,
      term: r.term,
      fetchedAt: r.fetchedAt,
      status: r.status,
    }));

    const totalOneYearSaving = data.reduce((s, r) => s + r.oneYearSaving, 0);
    const totalThreeYearSaving = data.reduce((s, r) => s + r.threeYearSaving, 0);

    return jsonResponse({
      data: data.sort((a, b) => b.oneYearSaving - a.oneYearSaving),
      summary: {
        totalCount: data.length,
        totalOneYearMonthlySaving: totalOneYearSaving,
        totalThreeYearMonthlySaving: totalThreeYearSaving,
      },
      lastFetched: reservations[0]?.fetchedAt ?? null,
    });
  } catch (err) {
    context.error('Error fetching reservations:', err);
    return errorResponse('Failed to fetch reservation data');
  }
}

app.timer('fetchRecommendationsTimer', {
  schedule: '0 0 */6 * * *',
  handler: fetchRecommendationsTimer,
  runOnStartup: false,
});

app.http('getReservations', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reservations',
  handler: getReservationsHttp,
});

async function triggerReservationsFetch(
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
    await fetchAndStoreRecommendations(context);
    return jsonResponse({ message: 'Reservation recommendations refresh triggered successfully' });
  } catch (err) {
    context.error('Error triggering reservations refresh:', err);
    return errorResponse('Failed to trigger refresh');
  }
}

app.http('triggerReservationsFetch', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reservations/refresh',
  handler: triggerReservationsFetch,
});
