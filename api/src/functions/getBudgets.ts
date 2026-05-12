import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
  Timer,
} from '@azure/functions';
import { ConsumptionManagementClient } from '@azure/arm-consumption';
import { SubscriptionClient } from '@azure/arm-resources-subscriptions';
import { credential } from '../lib/azure/credential';
import {
  getBudgets,
  upsertBudget,
  deleteBudget,
} from '../lib/storage/tableClient';
import {
  validateUser,
  requireAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

// credential imported from shared module

async function syncBudgetsFromAzure(
  subscriptionIds: string[],
  context: InvocationContext
): Promise<void> {
  for (const subId of subscriptionIds) {
    try {
      const scope = `/subscriptions/${subId}`;
      const client = new ConsumptionManagementClient(credential, subId);
      const iter = client.budgets.list(scope);

      for await (const budget of iter) {
        if (!budget.id) continue;

        const rowKey = Buffer.from(budget.id)
          .toString('base64')
          .replace(/[/+=]/g, '_')
          .slice(0, 512);

        try {
          await upsertBudget({
            partitionKey: subId,
            rowKey,
            budgetId: budget.id,
            name: budget.name ?? '',
            scope,
            scopeType: 'subscription',
            amount: budget.amount ?? 0,
            timeGrain: 'Monthly',
            currentSpend: budget.currentSpend?.amount ?? 0,
            forecastedSpend: budget.forecastSpend?.amount ?? 0,
            startDate: budget.timePeriod?.startDate?.toISOString() ?? '',
            endDate: budget.timePeriod?.endDate?.toISOString() ?? '',
            alertThreshold80: true,
            alertThreshold100: true,
            contactEmails: JSON.stringify(
              budget.notifications
                ? Object.values(budget.notifications).flatMap(
                    (n) => n.contactEmails ?? []
                  )
                : []
            ),
            azureBudgetId: budget.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        } catch (err) {
          context.error(`Error upserting budget ${budget.name} for ${subId}:`, err);
        }
      }
    } catch (err) {
      context.error(`Error syncing budgets for ${subId}:`, err);
    }
  }
}

export async function syncAndStoreBudgets(context: InvocationContext): Promise<void> {
  context.log('Starting budget sync...');
  const subClient = new SubscriptionClient(credential);
  const subscriptionIds: string[] = [];
  try {
    for await (const sub of subClient.subscriptions.list()) {
      if (sub.subscriptionId && sub.state === 'Enabled') {
        subscriptionIds.push(sub.subscriptionId);
      }
    }
  } catch (err) {
    context.error('Failed to list subscriptions for budget sync:', err);
    return;
  }
  await syncBudgetsFromAzure(subscriptionIds, context);
  context.log('Budget sync complete');
}

// Timer trigger: sync budgets every 2 hours
async function syncBudgetsTimer(
  _myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  try {
    await syncAndStoreBudgets(context);
  } catch (err) {
    context.error('Budget sync timer failed:', err);
  }
}

async function getBudgetsHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const budgets = await getBudgets();

    const data = budgets.map((b) => ({
      id: b.rowKey,
      name: b.name,
      scope: b.scope,
      scopeType: b.scopeType,
      amount: b.amount,
      currentSpend: b.currentSpend,
      forecastedSpend: b.forecastedSpend,
      percentUsed: b.amount > 0 ? Math.round((b.currentSpend / b.amount) * 100) : 0,
      status:
        b.amount > 0
          ? b.currentSpend >= b.amount
            ? 'Over'
            : b.currentSpend >= b.amount * 0.8
            ? 'At Risk'
            : 'On Track'
          : 'On Track',
      startDate: b.startDate,
      endDate: b.endDate,
      contactEmails: JSON.parse(b.contactEmails || '[]') as string[],
      updatedAt: b.updatedAt,
    }));

    return jsonResponse({ data });
  } catch (err) {
    context.error('Error fetching budgets:', err);
    return errorResponse('Failed to fetch budget data');
  }
}

async function saveBudgetHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  let user;
  try {
    user = await requireAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    return msg.includes('Admin') ? forbiddenResponse() : unauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      name: string;
      subscriptionId: string;
      resourceGroup?: string;
      amount: number;
      contactEmails: string[];
    };

    const { name, subscriptionId, resourceGroup, amount, contactEmails } = body;

    if (!name || !subscriptionId || !amount) {
      return errorResponse('name, subscriptionId, and amount are required', 400);
    }

    const scope = resourceGroup
      ? `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`
      : `/subscriptions/${subscriptionId}`;

    const client = new ConsumptionManagementClient(credential, subscriptionId);

    const startDate = new Date();
    startDate.setDate(1);
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 3);

    const budgetResult = await client.budgets.createOrUpdate(scope, name, {
      category: 'Cost',
      amount,
      timeGrain: 'Monthly',
      timePeriod: {
        startDate,
        endDate,
      },
      notifications: {
        actual_80: {
          enabled: true,
          operator: 'GreaterThan',
          threshold: 80,
          contactEmails,
          locale: 'en-us',
        },
        actual_100: {
          enabled: true,
          operator: 'GreaterThan',
          threshold: 100,
          contactEmails,
          locale: 'en-us',
        },
      },
    });

    const rowKey = Buffer.from(budgetResult.id ?? name)
      .toString('base64')
      .replace(/[/+=]/g, '_')
      .slice(0, 512);

    await upsertBudget({
      partitionKey: subscriptionId,
      rowKey,
      budgetId: budgetResult.id ?? '',
      name,
      scope,
      scopeType: resourceGroup ? 'resourceGroup' : 'subscription',
      amount,
      timeGrain: 'Monthly',
      currentSpend: 0,
      forecastedSpend: 0,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      alertThreshold80: true,
      alertThreshold100: true,
      contactEmails: JSON.stringify(contactEmails),
      azureBudgetId: budgetResult.id ?? '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    context.log(`Budget created by ${user.email}: ${name}`);
    return jsonResponse({ message: 'Budget created successfully', id: rowKey }, 201);
  } catch (err) {
    context.error('Error saving budget:', err);
    return errorResponse('Failed to create budget');
  }
}

async function deleteBudgetHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  let user;
  try {
    user = await requireAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    return msg.includes('Admin') ? forbiddenResponse() : unauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      id: string;
      subscriptionId: string;
    };

    const { id: rowKey, subscriptionId } = body;
    if (!rowKey || !subscriptionId) {
      return errorResponse('id and subscriptionId are required', 400);
    }

    // Fetch the budget to get its Azure budget name and scope
    const allBudgets = await getBudgets();
    const budget = allBudgets.find((b) => b.rowKey === rowKey);

    if (budget?.azureBudgetId && budget.name && budget.scope) {
      try {
        const client = new ConsumptionManagementClient(credential, budget.partitionKey);
        await client.budgets.delete(budget.scope, budget.name);
        context.log(`Azure budget deleted: ${budget.name} in ${budget.scope}`);
      } catch (azureErr) {
        // Log but don't fail — the local record should still be cleaned up
        context.warn(`Could not delete Azure budget (may already be deleted): ${azureErr}`);
      }
    }

    await deleteBudget(subscriptionId, rowKey);
    context.log(`Budget deleted by ${user.email}: ${rowKey}`);
    return jsonResponse({ message: 'Budget deleted' });
  } catch (err) {
    context.error('Error deleting budget:', err);
    return errorResponse('Failed to delete budget');
  }
}

app.timer('syncBudgetsTimer', {
  schedule: '0 0 */2 * * *',
  handler: syncBudgetsTimer,
  runOnStartup: false,
});

app.http('getBudgets', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'budgets',
  handler: getBudgetsHttp,
});

app.http('saveBudget', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'budgets',
  handler: saveBudgetHttp,
});

app.http('deleteBudget', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'budgets',
  handler: deleteBudgetHttp,
});

async function triggerBudgetSync(
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
    await syncAndStoreBudgets(context);
    return jsonResponse({ message: 'Budget sync triggered successfully' });
  } catch (err) {
    context.error('Error triggering budget sync:', err);
    return errorResponse('Failed to trigger budget sync');
  }
}

app.http('triggerBudgetSync', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'budgets/refresh',
  handler: triggerBudgetSync,
});
