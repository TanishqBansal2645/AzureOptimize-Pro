import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import ExcelJS from 'exceljs';
import { validateUser, unauthorizedResponse, errorResponse, jsonResponse } from '../lib/auth/validateUser';
import { uploadExcelReport, generateSasUrl } from '../lib/storage/blobClient';
import { upsertReport, getReports } from '../lib/storage/tableClient';
import {
  getCostData,
  getSavingsLog,
  getIdleResources,
  getRightsizing,
  getAHBRecommendations,
  getStorageRecommendations,
  getDatabaseRecommendations,
  getBudgets,
} from '../lib/storage/tableClient';

// ─── Colour palette ───────────────────────────────────────────────────────────
const C = {
  darkBlue:   '1E3A5F',
  midBlue:    '2563EB',
  lightBlue:  'DBEAFE',
  green:      '16A34A',
  lightGreen: 'DCFCE7',
  amber:      'D97706',
  lightAmber: 'FEF3C7',
  red:        'DC2626',
  lightRed:   'FEE2E2',
  gray:       'F8FAFC',
  white:      'FFFFFF',
  border:     'E2E8F0',
} as const;

function formatUSD(value: number): string {
  return `$${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function applyHeaderStyle(row: ExcelJS.Row, bgHex: string = C.darkBlue): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: `FF${C.white}` }, size: 11, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgHex}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top:    { style: 'thin', color: { argb: `FF${C.border}` } },
      left:   { style: 'thin', color: { argb: `FF${C.border}` } },
      bottom: { style: 'thin', color: { argb: `FF${C.border}` } },
      right:  { style: 'thin', color: { argb: `FF${C.border}` } },
    };
    row.height = 22;
  });
}

function applyDataRow(row: ExcelJS.Row, isAlt: boolean): void {
  const bg = isAlt ? C.gray : C.white;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bg}` } };
    cell.border = {
      top:    { style: 'thin', color: { argb: `FF${C.border}` } },
      left:   { style: 'thin', color: { argb: `FF${C.border}` } },
      bottom: { style: 'thin', color: { argb: `FF${C.border}` } },
      right:  { style: 'thin', color: { argb: `FF${C.border}` } },
    };
    cell.alignment = { vertical: 'middle' };
    cell.font = { name: 'Calibri', size: 10 };
  });
}

function applySectionTitle(row: ExcelJS.Row, bgHex: string, fgHex: string = C.white): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 12, color: { argb: `FF${fgHex}` }, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgHex}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  row.height = 26;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function friendlyFileName(reportMonth: string): string {
  const [year, month] = reportMonth.split('-');
  const monthName = new Date(`${reportMonth}-01`).toLocaleDateString('en-US', { month: 'long' });
  return `AzureOptimize-Report-${monthName}-${year}.xlsx`;
}

async function generateExcelHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  let user;
  try {
    user = await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  let reportMonth = new Date().toISOString().slice(0, 7);
  let reportId = '';

  try {
    const body = (await request.json()) as { month?: string } | null;
    if (body?.month !== undefined) {
      if (!/^\d{4}-\d{2}$/.test(body.month)) {
        return errorResponse('month must be in YYYY-MM format', 400);
      }
      reportMonth = body.month;
    }

    reportId = generateId();
    const fileName = friendlyFileName(reportMonth);

    await upsertReport({
      partitionKey: 'reports',
      rowKey: reportId,
      reportMonth,
      generatedAt: new Date().toISOString(),
      generatedBy: user.email,
      blobUrl: '',
      sasUrl: '',
      status: 'generating',
      errorMessage: '',
    });

    const [costData, savings, idleResources, rightsizing, ahb, storage, databases, budgets] =
      await Promise.all([
        getCostData('all'),
        getSavingsLog(),
        getIdleResources(),
        getRightsizing(),
        getAHBRecommendations(),
        getStorageRecommendations(),
        getDatabaseRecommendations(),
        getBudgets(),
      ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AzureOptimize Pro';
    workbook.created = new Date();

    // ════════════════════════════════════════════════════════════════════════
    // TAB 1 — Cost & Savings Overview (all values)
    // ════════════════════════════════════════════════════════════════════════
    const overviewSheet = workbook.addWorksheet('Cost & Savings Overview');
    overviewSheet.columns = [
      { key: 'a', width: 34 },
      { key: 'b', width: 20 },
      { key: 'c', width: 20 },
      { key: 'd', width: 20 },
      { key: 'e', width: 20 },
    ];

    // Report title block
    const titleRow = overviewSheet.addRow(['AzureOptimize Pro — Cost & Savings Report']);
    titleRow.getCell(1).font = { bold: true, size: 18, color: { argb: `FF${C.darkBlue}` }, name: 'Calibri' };
    overviewSheet.addRow([`Period: ${reportMonth}`]).getCell(1).font = { size: 11, color: { argb: 'FF64748B' }, name: 'Calibri' };
    overviewSheet.addRow([`Generated: ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}`]).getCell(1).font = { size: 11, color: { argb: 'FF64748B' }, name: 'Calibri' };
    overviewSheet.addRow([`Generated By: ${user.email}`]).getCell(1).font = { size: 11, color: { argb: 'FF64748B' }, name: 'Calibri' };
    overviewSheet.addRow([]);

    // ── Section 1: Key Metrics ──
    const metricsTitle = overviewSheet.addRow(['KEY METRICS']);
    applySectionTitle(metricsTitle, C.midBlue);
    overviewSheet.mergeCells(`A${metricsTitle.number}:E${metricsTitle.number}`);

    const metricsHeader = overviewSheet.addRow(['Metric', 'Value', 'Previous Month', 'Change', 'Notes']);
    applyHeaderStyle(metricsHeader, C.darkBlue);

    const totalMTD      = costData.reduce((s, d) => s + d.totalCost, 0);
    const totalPrev     = costData.reduce((s, d) => s + d.previousMonthCost, 0);
    const totalForecast = costData.reduce((s, d) => s + d.forecastedCost, 0);
    const momChange     = totalMTD - totalPrev;
    const momPercent    = totalPrev > 0 ? (momChange / totalPrev) * 100 : 0;

    const monthlySavingsImpl = savings
      .filter((s) => s.implementedAt.startsWith(reportMonth))
      .reduce((sum, s) => sum + s.projectedMonthlySaving, 0);

    const allTimeSavingsImpl = savings.reduce((sum, s) => sum + s.projectedMonthlySaving, 0);

    const potentialSavings =
      idleResources.reduce((s, r) => s + r.estimatedMonthlyCost, 0) +
      rightsizing.reduce((s, r) => s + r.monthlySaving, 0) +
      ahb.reduce((s, r) => s + r.savingWithAHB, 0) +
      storage.reduce((s, r) => s + r.estimatedMonthlySaving, 0) +
      databases.reduce((s, r) => s + r.estimatedMonthlySaving, 0);

    const keyMetrics = [
      ['Azure Spend — Month to Date',        formatUSD(totalMTD),              formatUSD(totalPrev), `${momChange >= 0 ? '+' : ''}${formatUSD(momChange)} (${momPercent.toFixed(1)}%)`, ''],
      ['Azure Spend — Forecasted Month-End',  formatUSD(totalForecast),         '',                   '',                                                                               'Based on current run-rate'],
      ['Savings Implemented This Month',      formatUSD(monthlySavingsImpl),    '',                   '',                                                                               ''],
      ['Savings Implemented All Time',        formatUSD(allTimeSavingsImpl),    '',                   '',                                                                               ''],
      ['Open Savings Potential (Monthly)',    formatUSD(potentialSavings),      '',                   '',                                                                               'If all recommendations actioned'],
      ['Open Savings Potential (Annual)',     formatUSD(potentialSavings * 12), '',                   '',                                                                               ''],
      ['Subscriptions Analysed',             String(costData.length),          '',                   '',                                                                               ''],
    ];

    keyMetrics.forEach((row, i) => {
      const r = overviewSheet.addRow(row);
      applyDataRow(r, i % 2 === 0);
      r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      r.getCell(2).font = { bold: true, name: 'Calibri', size: 10 };
    });

    overviewSheet.addRow([]);

    // ── Section 2: Service Cost Breakdown ──
    const serviceTitle = overviewSheet.addRow(['TOP AZURE SERVICES BY SPEND']);
    applySectionTitle(serviceTitle, C.midBlue);
    overviewSheet.mergeCells(`A${serviceTitle.number}:E${serviceTitle.number}`);

    const serviceHeader = overviewSheet.addRow(['Service Name', 'This Month ($)', '', '', '']);
    applyHeaderStyle(serviceHeader, C.darkBlue);

    const allServices: Record<string, number> = {};
    for (const cd of costData) {
      const services = JSON.parse(cd.serviceData || '[]') as Array<{ serviceName: string; cost: number }>;
      for (const s of services) {
        allServices[s.serviceName] = (allServices[s.serviceName] ?? 0) + s.cost;
      }
    }

    Object.entries(allServices)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .forEach(([name, cost], i) => {
        const r = overviewSheet.addRow([name, cost]);
        applyDataRow(r, i % 2 === 0);
        r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        r.getCell(2).numFmt = '$#,##0.00';
      });

    overviewSheet.addRow([]);

    // ── Section 3: Budget Status ──
    const budgetTitle = overviewSheet.addRow(['BUDGET STATUS']);
    applySectionTitle(budgetTitle, C.midBlue);
    overviewSheet.mergeCells(`A${budgetTitle.number}:E${budgetTitle.number}`);

    const budgetHeader = overviewSheet.addRow(['Budget Name', 'Monthly Limit ($)', 'Spent ($)', '% Used', 'Status']);
    applyHeaderStyle(budgetHeader, C.darkBlue);

    budgets.forEach((b, i) => {
      const pct    = b.amount > 0 ? Math.round((b.currentSpend / b.amount) * 100) : 0;
      const status = pct >= 100 ? 'Over Budget' : pct >= 80 ? 'At Risk' : 'On Track';
      const r = overviewSheet.addRow([b.name, b.amount, b.currentSpend, `${pct}%`, status]);
      applyDataRow(r, i % 2 === 0);
      r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      r.getCell(2).numFmt = '$#,##0.00';
      r.getCell(3).numFmt = '$#,##0.00';

      const statusCell = r.getCell(5);
      if (status === 'Over Budget') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C.lightRed}` } };
        statusCell.font = { bold: true, color: { argb: `FF${C.red}` }, name: 'Calibri', size: 10 };
      } else if (status === 'At Risk') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C.lightAmber}` } };
        statusCell.font = { bold: true, color: { argb: `FF${C.amber}` }, name: 'Calibri', size: 10 };
      } else {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C.lightGreen}` } };
        statusCell.font = { bold: true, color: { argb: `FF${C.green}` }, name: 'Calibri', size: 10 };
      }
    });

    overviewSheet.views = [{ state: 'frozen', ySplit: 1 }];

    // ════════════════════════════════════════════════════════════════════════
    // TAB 2 — Recommendations (Open + Implemented)
    // ════════════════════════════════════════════════════════════════════════
    const recsSheet = workbook.addWorksheet('Recommendations');
    recsSheet.columns = [
      { key: 'a', width: 12 },  // Priority / Date
      { key: 'b', width: 22 },  // Category
      { key: 'c', width: 30 },  // Resource
      { key: 'd', width: 42 },  // Recommendation / Notes
      { key: 'e', width: 20 },  // Monthly $
      { key: 'f', width: 20 },  // Annual $
      { key: 'g', width: 22 },  // Effort / Implemented By
    ];

    // ── Open Recommendations ──
    const openRecs = [
      ...idleResources.map((r) => ({
        priority: r.estimatedMonthlyCost > 100 ? 'High' : 'Medium',
        category: 'Idle Resources',
        resource: r.resourceName,
        rec: `Delete ${r.resourceType}: ${r.resourceName}`,
        monthly: r.estimatedMonthlyCost,
        effort: 'Low',
      })),
      ...rightsizing.map((r) => ({
        priority: r.monthlySaving > 200 ? 'High' : 'Medium',
        category: 'VM Rightsizing',
        resource: r.vmName,
        rec: `Downsize ${r.currentSku} → ${r.recommendedSku}`,
        monthly: r.monthlySaving,
        effort: 'Medium',
      })),
      ...ahb.map((r) => ({
        priority: 'High',
        category: 'Azure Hybrid Benefit',
        resource: r.resourceName,
        rec: `Enable AHB on ${r.resourceType}: ${r.resourceName}`,
        monthly: r.savingWithAHB,
        effort: 'Low',
      })),
      ...storage.map((r) => ({
        priority: r.estimatedMonthlySaving > 50 ? 'High' : 'Low',
        category: 'Storage Optimization',
        resource: r.resourceName,
        rec: r.recommendation,
        monthly: r.estimatedMonthlySaving,
        effort: 'Low',
      })),
      ...databases.map((r) => ({
        priority: r.estimatedMonthlySaving > 100 ? 'High' : 'Medium',
        category: 'Database Optimization',
        resource: r.resourceName,
        rec: r.recommendation,
        monthly: r.estimatedMonthlySaving,
        effort: 'Medium',
      })),
    ].sort((a, b) => b.monthly - a.monthly);

    const openTotal = openRecs.reduce((s, r) => s + r.monthly, 0);

    const openSectionRow = recsSheet.addRow([
      `OPEN RECOMMENDATIONS — ${openRecs.length} items · ${formatUSD(openTotal)}/month potential`,
      '', '', '', '', '', '',
    ]);
    applySectionTitle(openSectionRow, C.amber, C.white);
    recsSheet.mergeCells(`A${openSectionRow.number}:G${openSectionRow.number}`);

    const openHeader = recsSheet.addRow(['Priority', 'Category', 'Resource', 'Recommendation', 'Monthly ($)', 'Annual ($)', 'Effort']);
    applyHeaderStyle(openHeader, C.darkBlue);

    let openSubtotal = 0;
    openRecs.forEach((rec, i) => {
      const r = recsSheet.addRow([rec.priority, rec.category, rec.resource, rec.rec, rec.monthly, rec.monthly * 12, rec.effort]);
      applyDataRow(r, i % 2 === 0);
      r.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
      r.getCell(5).numFmt = '$#,##0.00';
      r.getCell(6).numFmt = '$#,##0.00';

      // Colour-code priority cell
      const pCell = r.getCell(1);
      if (rec.priority === 'High') {
        pCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C.lightRed}` } };
        pCell.font = { bold: true, color: { argb: `FF${C.red}` }, name: 'Calibri', size: 10 };
      } else if (rec.priority === 'Medium') {
        pCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C.lightAmber}` } };
        pCell.font = { bold: true, color: { argb: `FF${C.amber}` }, name: 'Calibri', size: 10 };
      } else {
        pCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C.lightGreen}` } };
        pCell.font = { bold: true, color: { argb: `FF${C.green}` }, name: 'Calibri', size: 10 };
      }
      openSubtotal += rec.monthly;
    });

    // Open subtotal row
    const openSubRow = recsSheet.addRow(['TOTAL', '', '', '', openSubtotal, openSubtotal * 12, '']);
    applyHeaderStyle(openSubRow, C.amber);
    openSubRow.getCell(5).numFmt = '$#,##0.00';
    openSubRow.getCell(6).numFmt = '$#,##0.00';

    // Spacer
    recsSheet.addRow([]);

    // ── Implemented Recommendations ──
    const implSavings = savings.sort((a, b) =>
      new Date(b.implementedAt).getTime() - new Date(a.implementedAt).getTime()
    );
    const implTotal = implSavings.reduce((s, r) => s + r.projectedMonthlySaving, 0);

    const implSectionRow = recsSheet.addRow([
      `IMPLEMENTED RECOMMENDATIONS — ${implSavings.length} items · ${formatUSD(implTotal)}/month saved`,
      '', '', '', '', '', '',
    ]);
    applySectionTitle(implSectionRow, C.green, C.white);
    recsSheet.mergeCells(`A${implSectionRow.number}:G${implSectionRow.number}`);

    const implHeader = recsSheet.addRow(['Date', 'Category', 'Resource', 'Notes', 'Monthly ($)', 'Annual ($)', 'Implemented By']);
    applyHeaderStyle(implHeader, C.darkBlue);

    let implSubtotal = 0;
    implSavings.forEach((s, i) => {
      const r = recsSheet.addRow([
        s.implementedAt.slice(0, 10),
        s.category,
        s.resourceName,
        s.notes || '',
        s.projectedMonthlySaving,
        s.projectedMonthlySaving * 12,
        s.implementedBy,
      ]);
      applyDataRow(r, i % 2 === 0);
      r.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
      r.getCell(5).numFmt = '$#,##0.00';
      r.getCell(6).numFmt = '$#,##0.00';

      // Green tint on implemented rows
      r.eachCell((cell) => {
        if (!cell.fill || (cell.fill as ExcelJS.FillPattern).fgColor?.argb === `FF${C.gray}` ||
            (cell.fill as ExcelJS.FillPattern).fgColor?.argb === `FF${C.white}`) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: i % 2 === 0 ? 'FFF0FDF4' : `FF${C.white}` },
          };
        }
      });

      implSubtotal += s.projectedMonthlySaving;
    });

    // Implemented subtotal row
    const implSubRow = recsSheet.addRow(['TOTAL', '', '', '', implSubtotal, implSubtotal * 12, '']);
    applyHeaderStyle(implSubRow, C.green);
    implSubRow.getCell(5).numFmt = '$#,##0.00';
    implSubRow.getCell(6).numFmt = '$#,##0.00';

    recsSheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Generate and upload
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const blobUrl = await uploadExcelReport(fileName, buffer);
    const sasUrl = await generateSasUrl(blobUrl);

    await upsertReport({
      partitionKey: 'reports',
      rowKey: reportId,
      reportMonth,
      generatedAt: new Date().toISOString(),
      generatedBy: user.email,
      blobUrl,
      sasUrl,
      status: 'ready',
      errorMessage: '',
    });

    context.log(`Report generated by ${user.email}: ${fileName}`);
    return jsonResponse({ reportId, fileName, downloadUrl: sasUrl, reportMonth });
  } catch (err) {
    context.error('Error generating Excel report:', err);
    if (reportId) {
      upsertReport({
        partitionKey: 'reports',
        rowKey: reportId,
        reportMonth,
        generatedAt: new Date().toISOString(),
        generatedBy: user?.email ?? '',
        blobUrl: '',
        sasUrl: '',
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch((e: unknown) => context.error('Failed to update report status to failed:', e));
    }
    return errorResponse('Failed to generate report');
  }
}

async function getReportsHttp(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await validateUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const reports = await getReports();
    return jsonResponse({
      data: reports.map((r) => ({
        id: r.rowKey,
        reportMonth: r.reportMonth,
        generatedAt: r.generatedAt,
        generatedBy: r.generatedBy,
        downloadUrl: r.sasUrl || r.blobUrl,
        status: r.status,
      })),
    });
  } catch (err) {
    context.error('Error fetching reports:', err);
    return errorResponse('Failed to fetch reports');
  }
}

app.http('generateExcel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reports/generate',
  handler: generateExcelHttp,
});

app.http('getReports', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports',
  handler: getReportsHttp,
});
