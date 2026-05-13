# AzureOptimize Pro — Master Implementation Prompt

> Use this prompt when starting a new Claude Code session to build this project.
> Always read GUIDE.md and SETUP.md first for full context.

---

## Prompt

You are building **AzureOptimize Pro** — a self-hosted Azure cost optimization platform deployed into a client's Azure tenant via a single Bicep template + PowerShell installer script. It is sold by Azure consultants as a one-time $1,000 license per client tenant. No SaaS, no subscriptions, no data leaving the tenant.

Always read `GUIDE.md` and `SETUP.md` in this directory before writing any code. They are the source of truth for architecture, features, and setup. After any code change, update those two documents to stay in sync.

---

## Decisions Already Made (do not re-ask)

| Decision | Choice |
|---|---|
| Frontend hosting | Azure Static Web App (Free tier) |
| Backend | Azure Functions v4, Consumption plan |
| Database | Azure Table Storage (NOT CosmosDB) |
| Auth | Azure Entra ID SSO via MSAL |
| Admin setup | Via `ADMIN_PRINCIPAL_ID` env var (Entra Object ID) |
| License system | None — no license key required |
| Reports | Excel (.xlsx) via ExcelJS |
| AI features | None — no Azure OpenAI |
| Anomaly detection | Not included |
| Tagging compliance | Not included |
| Multi-subscription | Yes — all subscriptions in the tenant from day 1 |

---

## Infrastructure Cost Constraint

**This is a cost optimization tool — our own infrastructure must cost as little as possible.**

- Azure Static Web App: Free tier ($0)
- Azure Functions: Consumption plan (~$0–2/mo)
- Azure Storage Account: LRS Standard (~$1–2/mo) — use for BOTH Tables AND Blobs
- Azure Key Vault: Standard (<$1/mo)
- Managed Identity: Built-in ($0)
- **Target total: <$5/month per client tenant**
- No CosmosDB. No App Service. No Redis. No Service Bus. No premium tiers.

---

## Tech Stack

```
Frontend:    Next.js 15 (App Router, static export), TypeScript, strict mode
UI:          Tailwind CSS + shadcn/ui components + Recharts for charts
Backend:     Azure Functions v4, Node.js 22, TypeScript, strict mode
State:       Azure Table Storage (@azure/data-tables)
Reports:     ExcelJS
Auth:        Azure Entra ID (MSAL) — @azure/msal-node + @azure/msal-browser
Deployment:  Bicep (infra/main.bicep) + PowerShell (infra/Deploy-AzureCostOptimize.ps1)

Azure SDKs (all use DefaultAzureCredential / ManagedIdentityCredential):
  @azure/arm-costmanagement     — cost data
  @azure/arm-advisor            — RI recommendations
  @azure/arm-resourcegraph      — idle resources, AHB scan
  @azure/monitor-query          — VM metrics, storage metrics
  @azure/arm-resources          — subscription list
  @azure/arm-compute            — VM SKU details
  @azure/identity               — auth (DefaultAzureCredential)
  @azure/keyvault-secrets       — config secrets
  @azure/data-tables            — state storage
  @azure/storage-blob           — Excel report storage
```

---

## Project Structure

```
azureoptimize-pro/
├── frontend/                        # Next.js 15 static export
│   ├── app/
│   │   ├── (auth)/login/
│   │   ├── dashboard/               # Module 1: Cost Dashboard
│   │   ├── idle-resources/          # Module 2: Idle Resource Detector
│   │   ├── rightsizing/             # Module 3: VM Rightsizing
│   │   ├── reservations/            # Module 4: RI Advisor
│   │   ├── hybrid-benefit/          # Module 5: AHB Scanner
│   │   ├── storage/                 # Module 6: Storage Optimizer
│   │   ├── databases/               # Module 7: Database Optimizer
│   │   ├── budgets/                 # Module 8: Budget Manager
│   │   ├── savings/                 # Module 9: Savings Tracker
│   │   └── reports/                 # Module 10: Excel Report
│   ├── components/
│   │   ├── ui/                      # shadcn/ui
│   │   ├── charts/                  # Recharts wrappers
│   │   └── layout/                  # Sidebar, Header, Breadcrumb
│   └── lib/
│       ├── auth.ts                  # MSAL config + hooks
│       ├── api.ts                   # Typed API client
│       └── utils.ts                 # formatCurrency, formatDate, etc.
│
├── api/                             # Azure Functions v4
│   ├── src/functions/
│   │   ├── collectCosts.ts          # Timer: 0 */4 * * * (every 4h)
│   │   ├── scanIdleResources.ts     # Timer: 0 */4 * * *
│   │   ├── analyzeRightsizing.ts    # Timer: 0 8 * * * (daily 8am)
│   │   ├── fetchRecommendations.ts  # Timer: 0 */4 * * *
│   │   ├── scanAHB.ts               # Timer: 0 9 * * *
│   │   ├── scanStorage.ts           # Timer: 0 9 * * *
│   │   ├── scanDatabases.ts         # Timer: 0 9 * * *
│   │   ├── generateExcel.ts         # HTTP POST /api/reports/generate
│   │   ├── getBudgets.ts            # HTTP GET/POST /api/budgets
│   │   ├── markImplemented.ts       # HTTP POST /api/recommendations/{id}/implement
│   │   ├── getSavings.ts            # HTTP GET  /api/savings
│   │   ├── triggerRefresh.ts        # HTTP POST /api/refresh (admin only — run all 8 scanners in parallel)
│   │   └── health.ts                # HTTP GET  /api/health (unauthenticated)
│   └── src/lib/
│       ├── azure/
│       │   ├── costManagement.ts
│       │   ├── resourceGraph.ts
│       │   ├── monitorMetrics.ts
│       │   ├── advisor.ts
│       │   └── retailPrices.ts
│       ├── storage/
│       │   ├── tableClient.ts       # Azure Table Storage wrapper
│       │   └── blobClient.ts        # Azure Blob Storage wrapper
│       └── auth/
│           └── validateUser.ts      # Validate Entra token + check role
│
└── infra/
    ├── main.bicep
    ├── modules/
    │   ├── staticWebApp.bicep
    │   ├── functionApp.bicep
    │   ├── storage.bicep
    │   └── keyVault.bicep
    └── Deploy-AzureCostOptimize.ps1
```

---

## Module Build Order

Build strictly in this order. Complete each module (backend + frontend) before starting the next.

### 0. Project Scaffold
- [ ] Initialize Next.js 15 with TypeScript + Tailwind + shadcn/ui in `frontend/`
- [ ] Initialize Azure Functions v4 TypeScript project in `api/`
- [ ] Create `infra/main.bicep` with all resources
- [ ] Create `infra/Deploy-AzureCostOptimize.ps1` installer

### 1. Auth + App Shell
- [ ] MSAL configuration (Entra ID SSO)
- [ ] Login page with "Sign in with Microsoft" button
- [ ] Auth guard (redirect to login if not authenticated)
- [ ] Admin check (compare token Object ID against `ADMIN_PRINCIPAL_ID` env var)
- [ ] App layout: collapsible sidebar with nav links to all modules, header with user avatar + logout
- [ ] Dark/light mode toggle

### 2. Cost Dashboard (Module 1)
**Backend function:** `collectCosts.ts` (timer + HTTP GET `/api/costs`)
- Query Cost Management API: `usageDetails` for current month, grouped by `ServiceName`, `ResourceGroupName`
- Query for last 12 months of monthly totals for trend chart
- Store results in Azure Table Storage (`costs` table)
- Return cached data (max 4h old) on HTTP GET

**Frontend page:** `/dashboard`
- Spend summary cards: MTD Total, Forecasted Month-End, MoM Change ($), MoM Change (%)
- Top services bar chart (Recharts BarChart)
- Daily spend trend line chart (last 30 days)
- Top 10 resource groups table (name, subscription, MTD spend, % of total)
- Top 20 most expensive resources table
- Subscription selector (All / individual) in header
- Last refreshed timestamp + manual refresh button

### 3. Idle Resource Detector (Module 2)
**Backend function:** `scanIdleResources.ts` (timer + HTTP GET `/api/idle-resources`)

Resource Graph queries (one query per category, fan out to all subscriptions):

```kql
-- Unattached managed disks
Resources
| where type =~ 'microsoft.compute/disks'
| where properties.diskState =~ 'Unattached'
| project name, resourceGroup, subscriptionId, sku=sku.name,
          sizeGB=properties.diskSizeGB, location

-- Orphaned public IPs
Resources
| where type =~ 'microsoft.network/publicipaddresses'
| where isnull(properties.ipConfiguration)
| project name, resourceGroup, subscriptionId, sku=sku.name, location

-- Empty App Service Plans
Resources
| where type =~ 'microsoft.web/serverfarms'
| where properties.numberOfSites == 0
| project name, resourceGroup, subscriptionId, tier=sku.tier, location

-- Old snapshots (>30 days)
Resources
| where type =~ 'microsoft.compute/snapshots'
| extend age = datetime_diff('day', now(), todatetime(properties.timeCreated))
| where age > 30
| project name, resourceGroup, subscriptionId, age, sizeGB=properties.diskSizeGB

-- Orphaned NICs
Resources
| where type =~ 'microsoft.network/networkinterfaces'
| where isnull(properties.virtualMachine)
| project name, resourceGroup, subscriptionId, location
```

Enrich each result with estimated monthly cost (lookup from Retail Prices API or use SKU-based estimate table).

Store in Table Storage. Each row: `{ resourceId, type, name, resourceGroup, subscription, estimatedMonthlyCost, detectedAt, status: 'active'|'reviewed' }`.

**Frontend page:** `/idle-resources`
- Summary cards: total waste ($), count by category
- Filterable table: Category | Name | Resource Group | Subscription | Est. Monthly Waste | Age | Action
- Bulk select + "Mark as Reviewed" button (removes from active list)
- Category filter chips (Disks / Public IPs / App Plans / Snapshots / NICs)
- Sort by estimated waste (default: descending)

### 4. VM Rightsizing Engine (Module 3)
**Backend function:** `analyzeRightsizing.ts` (timer daily + HTTP GET `/api/rightsizing`)

For each VM across all subscriptions:
1. Get current SKU and location
2. Query Azure Monitor: `Percentage CPU` — avg and p95, last 30 days
3. Query Azure Monitor: `Available Memory Bytes` — avg and p95, last 30 days
4. Calculate memory utilization % = 1 - (availableBytes / totalBytes)
5. Only flag if: p95 CPU < 40% AND p95 Memory < 60%
6. Look up current SKU price via Retail Prices API
7. Find next smaller SKU in same family, look up its price
8. Monthly saving = (currentPrice - recommendedPrice) × 730

Store in Table Storage. Include confidence: High (p95 CPU < 25%, p95 Mem < 40%) or Medium (otherwise within threshold).

**Frontend page:** `/rightsizing`
- Summary card: total potential monthly savings
- Table: VM Name | Subscription | Current SKU | Recommended SKU | CPU p95% | Mem p95% | Monthly Saving | Confidence | Action
- Clicking a VM shows a modal with 30-day CPU + memory sparkline charts
- "Mark Implemented" button logs to Savings Tracker

### 5. Reserved Instance Advisor (Module 4)
**Backend function:** `fetchRecommendations.ts` (timer + HTTP GET `/api/reservations`)

- Pull `Microsoft.Advisor/recommendations` filtered to `category=Cost`
- Filter for recommendation types related to Reserved Instances and Savings Plans
- Enrich with 1yr vs 3yr pricing from Retail Prices API
- Calculate payback period = upfront cost ÷ monthly saving
- Also check existing reserved instances for underutilization or expiry within 60 days

**Frontend page:** `/reservations`
- Cards: Total Potential Saving, Existing RIs Expiring Soon, Underutilized RIs
- RI Recommendations table: Resource Type | Region | Term | Current Monthly | RI Monthly | Saving | Payback
- 1yr / 3yr toggle to compare
- Existing RIs panel: name, scope, expiry date, utilization %

### 6. Azure Hybrid Benefit Scanner (Module 5)
**Backend function:** `scanAHB.ts` (timer daily + HTTP GET `/api/ahb`)

Resource Graph queries:
```kql
-- Windows VMs without AHB
Resources
| where type =~ 'microsoft.compute/virtualmachines'
| where properties.storageProfile.osDisk.osType =~ 'Windows'
| where isnull(properties.licenseType) or properties.licenseType !in ('Windows_Server', 'Windows_Client')
| project name, resourceGroup, subscriptionId, sku=properties.hardwareProfile.vmSize, location

-- SQL VMs without AHB
Resources
| where type =~ 'microsoft.sqlvirtualmachine/sqlvirtualmachines'
| where properties.sqlServerLicenseType !in ('AHUB', 'DR')
| project name, resourceGroup, subscriptionId, location
```

For each eligible VM: look up current Windows license cost (Retail Prices API), calculate saving.

**Frontend page:** `/hybrid-benefit`
- Summary: total monthly saving available, # resources eligible
- Table: Resource Name | Type | SKU | Region | Monthly Saving | Status
- "Copy PowerShell" button per row: generates the `Set-AzVM -LicenseType Windows_Server` command

### 7. Storage Optimizer (Module 6)
**Backend function:** `scanStorage.ts` (timer daily + HTTP GET `/api/storage`)

Detects:
- Premium disks with avg IOPS < 20% of provisioned IOPS (downgrade to Standard SSD)
- Storage accounts with no read/write ops in 30 days (from Azure Monitor metrics)
- Log Analytics workspaces with retention > 31 days (billable after 31 days)

**Frontend page:** `/storage`
- Similar table pattern: resource, issue, estimated saving, action

### 8. Database Optimizer (Module 7)
**Backend function:** `scanDatabases.ts` (timer daily + HTTP GET `/api/databases`)

Detects:
- Azure SQL databases with avg DTU < 30% over 30 days
- SQL databases without Hybrid Benefit
- Cosmos DB containers with avg RU/s usage < 20% of provisioned

**Frontend page:** `/databases`
- Similar table pattern: resource, current tier, avg utilization, recommendation, saving

### 9. Budget Manager (Module 8)
**HTTP functions:** GET/POST `/api/budgets`

- List existing Azure Cost Management budgets
- Create new budget (scope: subscription or resource group, amount, period: monthly)
- Alert thresholds: 80% + 100%
- Sync to Azure Cost Management Budgets API

**Frontend page:** `/budgets`
- Grid of budget cards: name, scope, limit, spent, progress bar, status badge (On Track / At Risk / Over)
- "New Budget" button → modal form
- Each card: edit + delete

### 10. Savings Tracker (Module 9)
**HTTP functions:** GET `/api/savings`, POST `/api/recommendations/{id}/implement`

Table Storage: `savings` table
Row schema: `{ id, implementedAt, category, resourceName, resourceId, projectedMonthlySaving, implementedBy, notes }`

**Frontend page:** `/savings`
- Hero cards: Total Saved This Month ($), Total Saved All Time ($), ROI (Savings ÷ $1,000 license × 100%)
- Payback achieved badge (shown when cumulative savings > $1,000)
- Monthly savings bar chart (last 12 months)
- Savings log table: Date | Category | Resource | Monthly Saving | Implemented By

### 11. Excel Report Generator (Module 10)
**HTTP function:** POST `/api/reports/generate`

Uses ExcelJS to build a multi-tab `.xlsx` file:

```
Tab 1: Executive Summary
  - Client tenant name, report month, generated date
  - Key metrics table: Total Spend, MoM Change, Savings Implemented, Savings Still Available
  - Bold formatting, client-branded header row

Tab 2: Savings Implemented
  Columns: Date | Category | Resource Name | Description | Monthly Saving ($) | Annual Saving ($)
  - Subtotal row at bottom (bold)

Tab 3: Open Recommendations
  Columns: Priority | Category | Resource | Recommendation | Est. Monthly Saving | Est. Annual Saving | Effort
  - Sorted by Monthly Saving descending
  - Subtotal row
  - Color-coded Priority (High=red, Medium=amber, Low=green)

Tab 4: Cost Breakdown
  - Table 1: Spend by Service (this month vs last month, delta)
  - Table 2: Spend by Resource Group (top 20)
  - Table 3: Top 20 most expensive resources

Tab 5: Budget Status
  Columns: Budget Name | Scope | Monthly Limit | Spent | % Used | Status
  - Status cell: Green (On Track), Amber (At Risk >80%), Red (Over)

Styling:
  - Header rows: dark blue background, white text, bold
  - Alternating row colors (white / light gray)
  - Currency columns: formatted as $#,##0.00
  - Column widths: auto-fit
  - Freeze top row on each tab
```

Save to Azure Blob Storage, return download URL (valid 1 hour via SAS token).

**Frontend page:** `/reports`
- "Generate Report" button with month picker
- Download link after generation
- History of previously generated reports (list from Blob Storage)
- Schedule settings: enable monthly auto-generation, email recipients

---

## UI / UX Standards

**Tone:** Professional, clean, data-first. No clutter. Clients should feel confident.

**Layout:**
- Collapsible sidebar (icon-only collapsed, icon+label expanded)
- Sidebar navigation order: Dashboard → Idle Resources → VM Rightsizing → Reservations → Hybrid Benefit → Storage → Databases → Budgets → Savings → Reports
- Header: breadcrumb + subscription filter dropdown + refresh button + user avatar
- Main content: max-width container, 24px padding

**Cards pattern (use consistently):**
```
┌────────────────────────────────┐
│  Icon  Title               $X  │
│        Subtitle / context      │
└────────────────────────────────┘
```

**Tables pattern:**
- Sticky header
- Sortable columns (click header)
- Filter/search input above table
- Pagination (25 rows default)
- Row actions in last column (icon buttons)
- Empty state with helpful message when no data

**Colors (Tailwind):**
- Primary: blue-600
- Savings/positive: green-600
- Warning: amber-500
- Danger/waste: red-500
- Neutral: slate-*

**Loading states:** Skeleton loaders (not spinners) for table rows and cards.

**Currency:** All monetary values formatted as `$1,234.56` (USD, 2 decimal places).

**Dates:** `May 11, 2026` format for display, ISO 8601 for API responses.

---

## Code Standards

- TypeScript strict mode everywhere — no `any`, no `!` non-null assertions
- All Azure SDK calls use `DefaultAzureCredential` (works locally via `az login`, in prod via Managed Identity)
- `formatCurrency(amount: number): string` utility — use everywhere, never inline format
- Error handling: every API call wrapped in try/catch, return `{ error: string }` on failure
- Never auto-implement recommendations — always require human "Mark as Implemented" confirmation
- All Table Storage keys: `PartitionKey = subscriptionId`, `RowKey = resourceId_hash`
- Timer functions use UTC schedule
- Cost data freshness: show "Last updated X ago" on every data-heavy page; warn if >6 hours old

---

## Environment Variables

### Frontend (`frontend/.env.local` for dev, Static Web App settings for prod)
```
NEXT_PUBLIC_AZURE_CLIENT_ID=        # Entra app registration client ID
NEXT_PUBLIC_AZURE_TENANT_ID=        # Client tenant ID
NEXT_PUBLIC_AZURE_REDIRECT_URI=     # App URL
NEXT_PUBLIC_API_BASE_URL=           # Azure Functions URL
NEXT_PUBLIC_DEVELOPER_NAME=         # Optional: white-label developer name (falls back to "Tanishq Bansal")
```

### API (`api/local.settings.json` for dev, Function App settings for prod)
```json
{
  "Values": {
    "AzureWebJobsStorage": "",
    "AZURE_TENANT_ID": "",
    "STORAGE_ACCOUNT_NAME": "",
    "STORAGE_CONNECTION_STRING": "",
    "ADMIN_PRINCIPAL_ID": "",
    "KEY_VAULT_URI": ""
  }
}
```

---

## Bicep Template Requirements (`infra/main.bicep`)

Deploy in this order:
1. User-assigned Managed Identity (`mi-azureoptimize`)
2. Storage Account (`stazureoptimize{uniqueString}`) — Standard_LRS
3. Key Vault (`kv-azureoptimize-{uniqueString}`) — Standard SKU
4. App Service Plan — Consumption (Dynamic) for Functions
5. Function App — Node 20, linked to Storage, Key Vault refs for secrets, Managed Identity assigned
6. Static Web App — Free tier, linked to GitHub repo for CI/CD (or manual deploy)
7. Role assignments (at management group or subscription scope):
   - `Reader` on all subscriptions
   - `Cost Management Reader` on all subscriptions
   - `Monitoring Reader` on all subscriptions

---

## PowerShell Installer Requirements (`infra/Deploy-AzureCostOptimize.ps1`)

Parameters:
```powershell
param(
  [Parameter(Mandatory)] [string] $TenantId,
  [Parameter(Mandatory)] [string] $AdminPrincipalId,
  [Parameter(Mandatory)] [string] $AppClientId,
  [string] $Location = "eastus",
  [string] $ResourceGroupName = "",  # auto-derived from tenant ID if empty
  [switch] $Update,
  [switch] $Remove
)
```

Steps:
1. `az login --tenant $TenantId` (if not already logged in to this tenant)
2. Create resource group
3. `az deployment group create --template-file main.bicep`
4. Get all subscription IDs **in this tenant only**: `az account list --query "[?state=='Enabled' && tenantId=='$TenantId'].id" -o tsv`  
   ⚠️ Never use `[].id` — `az account list` returns subscriptions from ALL tenants the signed-in account has ever accessed, causing cross-tenant role assignment failures.
5. For each subscription: assign `Reader`, `Cost Management Reader`, `Monitoring Reader` to Managed Identity
6. Output dashboard URL
7. On `-Update`: redeploy only app code
8. On `-Remove`: `az group delete --name $ResourceGroupName --yes` + remove role assignments

---

## Start Here

When beginning a new session:

1. Read `GUIDE.md` and `SETUP.md` in full
2. Ask for the developer's local Azure subscription ID and tenant ID
3. Set up local dev environment (Next.js + Functions scaffold)
4. Start with **Module 0: Project Scaffold + Auth**, then proceed in order

Do not skip modules or work out of order — each module depends on the shared Table Storage schema and auth middleware established in earlier modules.
