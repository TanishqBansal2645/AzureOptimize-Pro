import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import {
  requireAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';
import { collectAndStoreCosts } from './collectCosts';
import { scanAndStoreIdleResources } from './scanIdleResources';
import { scanAndStoreAHB } from './scanAHB';
import { scanAndStoreStorage } from './scanStorage';
import { scanAndStoreDatabases } from './scanDatabases';
import { analyzeAndStoreRightsizing } from './analyzeRightsizing';
import { fetchAndStoreRecommendations } from './fetchRecommendations';
import { syncAndStoreBudgets } from './getBudgets';

async function triggerRefreshHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    return msg.includes('Admin') ? forbiddenResponse() : unauthorizedResponse();
  }

  context.log('Admin triggered full refresh of all scanners');

  const scanners = [
    { name: 'costs', fn: () => collectAndStoreCosts(context) },
    { name: 'idle-resources', fn: () => scanAndStoreIdleResources(context) },
    { name: 'ahb', fn: () => scanAndStoreAHB(context) },
    { name: 'storage', fn: () => scanAndStoreStorage(context) },
    { name: 'databases', fn: () => scanAndStoreDatabases(context) },
    { name: 'rightsizing', fn: () => analyzeAndStoreRightsizing(context) },
    { name: 'reservations', fn: () => fetchAndStoreRecommendations(context) },
    { name: 'budgets', fn: () => syncAndStoreBudgets(context) },
  ];

  const results = await Promise.allSettled(scanners.map((s) => s.fn()));

  const summary = scanners.map((s, i) => {
    const result = results[i];
    if (result.status === 'fulfilled') {
      return { scanner: s.name, status: 'ok' };
    } else {
      context.error(`Scanner ${s.name} failed:`, result.reason);
      return {
        scanner: s.name,
        status: 'error',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
    }
  });

  const allOk = summary.every((s) => s.status === 'ok');

  return jsonResponse(
    {
      message: allOk ? 'All scanners completed successfully' : 'Some scanners encountered errors',
      results: summary,
    },
    allOk ? 200 : 207
  );
}

app.http('triggerRefresh', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'refresh',
  handler: triggerRefreshHttp,
});
