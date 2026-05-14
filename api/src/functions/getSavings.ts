import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { getSavingsLog, insertSavings } from '../lib/storage/tableClient';
import {
  validateUser,
  unauthorizedResponse,
  errorResponse,
  jsonResponse,
} from '../lib/auth/validateUser';

// Simple UUID v4 without external dep - using crypto
function generateId(): string {
  const bytes = new Uint8Array(16);
  // Use a simple time-based approach since crypto may not be available
  const now = Date.now();
  bytes[0] = (now >> 24) & 0xff;
  bytes[1] = (now >> 16) & 0xff;
  bytes[2] = (now >> 8) & 0xff;
  bytes[3] = now & 0xff;
  for (let i = 4; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function getSavingsHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const savings = await getSavingsLog();

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const thisMonthSavings = savings.filter((s) =>
      s.implementedAt.startsWith(currentMonth)
    );

    const totalAllTime = savings.reduce((sum, s) => sum + s.projectedMonthlySaving, 0);
    const totalThisMonth = thisMonthSavings.reduce((sum, s) => sum + s.projectedMonthlySaving, 0);
    const licenseCost = 1000;
    const roi = totalAllTime / licenseCost;
    const paybackAchieved = totalAllTime >= licenseCost;

    // Monthly breakdown for last 12 months
    const monthlyBreakdown: Array<{ month: string; saving: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthSaving = savings
        .filter((s) => s.implementedAt.startsWith(month))
        .reduce((sum, s) => sum + s.projectedMonthlySaving, 0);
      monthlyBreakdown.push({ month, saving: monthSaving });
    }

    const data = savings.map((s) => ({
      id: s.rowKey,
      category: s.category,
      resourceName: s.resourceName,
      resourceId: s.resourceId,
      resourceGroup: s.resourceGroup,
      subscriptionId: s.subscriptionId,
      projectedMonthlySaving: s.projectedMonthlySaving,
      implementedBy: s.implementedBy,
      implementedByEmail: s.implementedByEmail,
      notes: s.notes,
      implementedAt: s.implementedAt,
    }));

    return jsonResponse({
      data,
      summary: {
        totalAllTime,
        totalThisMonth,
        licenseCost,
        roi: Math.round(roi * 100) / 100,
        paybackAchieved,
        monthlyBreakdown,
        paybackDate: paybackAchieved
          ? (() => {
              const sorted = [...savings].sort((a, b) =>
                a.implementedAt.localeCompare(b.implementedAt)
              );
              let running = 0;
              for (const s of sorted) {
                running += s.projectedMonthlySaving;
                if (running >= licenseCost) return s.implementedAt;
              }
              return null;
            })()
          : null,
      },
    });
  } catch (err) {
    context.error('Error fetching savings:', err);
    return errorResponse('Failed to fetch savings data');
  }
}

async function addSavingsEntry(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  let user;
  try {
    user = await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      category: string;
      resourceName: string;
      resourceId?: string;
      resourceGroup?: string;
      subscriptionId?: string;
      projectedMonthlySaving: number;
      notes?: string;
    };

    const { category, resourceName, projectedMonthlySaving } = body;
    if (!category || !resourceName || !projectedMonthlySaving) {
      return errorResponse('category, resourceName, and projectedMonthlySaving are required', 400);
    }

    const id = generateId();
    const now = new Date().toISOString();

    await insertSavings({
      partitionKey: body.subscriptionId ?? 'manual',
      rowKey: id,
      category,
      resourceName,
      resourceId: body.resourceId ?? '',
      resourceGroup: body.resourceGroup ?? '',
      subscriptionId: body.subscriptionId ?? '',
      projectedMonthlySaving,
      implementedBy: user.name,
      implementedByEmail: user.email,
      notes: body.notes ?? '',
      implementedAt: now,
    });

    context.log(`Savings entry added by ${user.email}: ${category} - ${resourceName}`);
    return jsonResponse({ message: 'Savings entry recorded', id }, 201);
  } catch (err) {
    context.error('Error adding savings entry:', err);
    return errorResponse('Failed to record savings');
  }
}

app.http('getSavings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'savings',
  handler: getSavingsHttp,
});

app.http('addSavings', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'savings',
  handler: addSavingsEntry,
});
