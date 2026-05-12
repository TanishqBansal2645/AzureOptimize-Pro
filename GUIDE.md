# AzureOptimize Pro — Project Guide

> **Version:** 1.0  
> **Last Updated:** 2026-05-12  
> **Price:** $1,000 one-time per client tenant  
> **Built by:** Tech Plus Talent

---

## What This Is

AzureOptimize Pro is a self-hosted Azure cost optimization platform that an Azure consultant deploys directly into a client's Azure tenant. It scans every subscription in the tenant, surfaces every category of waste and over-spend, tracks implemented savings, and generates monthly Excel reports — all with zero ongoing SaaS subscription fees and zero data leaving the client's environment.

---

## Why It Exists

Every major Azure cost tool (Cloudability, CloudHealth, Finout, nOps) charges a monthly subscription scaled to cloud spend — typically $500–$5,000+/month. AzureOptimize Pro replaces those tools with a one-time $1,000 deployment that runs entirely inside the client's own Azure tenant. The tool typically finds 25–40% cost savings within the first scan, meaning the license pays for itself within the first week of implemented recommendations.

---

## Architecture

```
Client's Azure Tenant
──────────────────────────────────────────────────────────────────
  Resource Group: rg-azureoptimize

  ┌─────────────────────────┐    ┌─────────────────────────────┐
  │  Azure Static Web App   │    │  Azure Function App         │
  │  (Next.js frontend)     │◄──►│  (Consumption plan)         │
  │  Free tier              │    │  Data collection + API      │
  └─────────────────────────┘    └─────────────────────────────┘
                                              │
              ┌───────────────────────────────┼────────────────────────┐
              │                               │                        │
  ┌───────────▼──────────┐    ┌──────────────▼──────────┐  ┌─────────▼────────┐
  │  Azure Storage        │    │  Azure Key Vault        │  │  Managed Identity│
  │  (Table + Blob)       │    │  (Config secrets)       │  │  Reader + CostMgmt│
  │  State, Excel exports │    │  Standard tier          │  │  all subscriptions│
  └───────────────────────┘    └─────────────────────────┘  └──────────────────┘

  Managed Identity has:
    - Reader role         → all subscriptions (resource inspection)
    - Cost Management Reader → all subscriptions (billing data)
    - Monitoring Reader   → all subscriptions (metrics)
──────────────────────────────────────────────────────────────────
```

### Infrastructure Cost Per Client Tenant

| Component | Tier | Est. Monthly |
|---|---|---|
| Azure Static Web App | Free | $0 |
| Azure Functions | Consumption | $0–2 |
| Azure Storage Account | LRS Standard | $1–2 |
| Azure Key Vault | Standard | <$1 |
| Managed Identity | Built-in | $0 |
| **Total** | | **~$2–5/month** |

The client pays this from their own Azure subscription. It is effectively free.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router, static export), TypeScript |
| UI Components | Tailwind CSS, shadcn/ui |
| Charts | Recharts |
| Backend | Azure Functions v4 (Node.js/TypeScript), Consumption plan |
| Database/State | Azure Table Storage (PartitionKey = tenantId/subscriptionId) |
| File Export | ExcelJS (server-side Excel generation) |
| Authentication | Azure Entra ID (MSAL) — SSO with client's Microsoft accounts |
| Azure SDKs | @azure/arm-costmanagement, @azure/arm-advisor, @azure/arm-resourcegraph, @azure/monitor-query, @azure/arm-resources, @azure/identity |
| Secrets | Azure Key Vault |
| Infrastructure | Bicep template + PowerShell installer |
| Code Deployment | GitHub Actions (auto-deploy on push to `main`) |

---

## Authentication Model

- **SSO via Azure Entra ID (MSAL)** — users log in with their existing Microsoft/Azure account
- **Admin:** set via `ADMIN_PRINCIPAL_ID` environment variable (Entra Object ID) — full access including settings
- **Analyst:** can view all data, mark recommendations as implemented — set per user in app settings
- **Viewer:** read-only, can download reports — set per user in app settings
- No passwords stored anywhere. No external auth service needed.

---

## Feature Modules

### Module 1 — Cost Dashboard
Real-time spend overview across all subscriptions in the tenant.

**Shows:**
- Month-to-date spend (total + per subscription)
- Forecasted end-of-month spend
- Month-over-month change ($ and %)
- Spend breakdown by service category (bar chart)
- Top 10 most expensive resource groups (table)
- Top 20 most expensive individual resources (table)
- Daily spend trend (line chart, last 30 days)

**Data source:** Azure Cost Management REST API

---

### Module 2 — Idle Resource Detector
Finds resources that are incurring cost but delivering no value.

**Detects:**
| Category | Detection Logic |
|---|---|
| Unattached managed disks | `diskState = Unattached` |
| Orphaned public IP addresses | No `ipConfiguration` association |
| Stopped VMs with billable disks | `powerState = deallocated` but Premium/Standard disk running |
| Empty App Service Plans | `numberOfSites = 0` |
| Snapshots older than 30 days | `timeCreated < now-30d` |
| Orphaned network interfaces | No VM association |
| Unused load balancers | No backend pool members |
| Unused application gateways | No backend targets |

**Shows per resource:** name, type, resource group, subscription, estimated monthly waste ($), recommended action, age.

**Data source:** Azure Resource Graph API

---

### Module 3 — VM Rightsizing Engine
Identifies virtual machines that are oversized relative to their actual workload.

**Analysis:**
- Queries Azure Monitor for CPU average + p95 over last 30 days
- Queries Azure Monitor for memory average + p95 over last 30 days
- Only recommends downsize if: p95 CPU < 40% AND p95 Memory < 60% (conservative)
- Looks up current SKU price and recommended SKU price via Azure Retail Prices API
- Calculates monthly saving = (current price − recommended price) × 730 hours

**Shows per VM:** current SKU, recommended SKU, CPU p95%, memory p95%, monthly saving ($), confidence (High/Medium)

**Data source:** Azure Monitor Metrics API + Azure Retail Prices API

---

### Module 4 — Reserved Instance Advisor
Recommends Reserved Instance purchases based on consistent usage patterns.

**Analysis:**
- Pulls existing Azure Advisor RI recommendations (already ML-computed by Microsoft)
- Enriches with payback period calculation = RI upfront cost ÷ monthly saving
- Shows 1-year vs 3-year options side by side
- Tracks existing RI utilization (expiring or underused RIs)

**Shows:** resource type, current on-demand cost, RI cost, monthly saving, payback period (months), recommended term.

**Data source:** Azure Advisor API + Azure Retail Prices API

---

### Module 5 — Azure Hybrid Benefit Scanner
Finds resources eligible for Azure Hybrid Benefit that are not using it.

**Scans for:**
- Windows Server VMs without `licenseType = Windows_Server` (saves ~40%)
- SQL Server on Azure VMs without `licenseType = AHUB` (saves ~55%)
- Azure SQL Database / Managed Instance without hybrid benefit enabled
- Windows Server node pools in AKS without hybrid benefit

**Shows per resource:** resource name, type, current monthly cost, estimated saving with AHB, PowerShell command to enable AHB (one-click copy).

**Data source:** Azure Resource Graph API

---

### Module 6 — Storage Optimizer
Identifies storage resources that are over-tiered or unused.

**Detects:**
- Premium managed disks that could downgrade to Standard SSD (low IOPS usage)
- Blob containers in Hot tier with no access in 30+ days (move to Cool/Archive)
- Log Analytics workspaces with retention > 30 days (default is billable after 31 days)
- Unused storage accounts (no read/write operations in 30 days)

**Data source:** Azure Monitor + Resource Graph API

---

### Module 7 — Database Optimizer
Finds underutilized and over-provisioned database resources.

**Detects:**
- Azure SQL databases with average DTU/vCore usage < 30% over 30 days
- SQL Elastic Pools with consistently low utilization
- Azure SQL without Hybrid Benefit applied
- Cosmos DB containers with provisioned throughput well above actual usage

**Data source:** Azure Monitor Metrics + Resource Graph API

---

### Module 8 — Budget Manager
Create and monitor spend budgets with threshold alerts.

**Features:**
- Create budgets at subscription or resource group scope
- Set alert thresholds (e.g., alert at 80% and 100%)
- Visual budget consumption bar per budget
- Budget vs actual trend chart
- Syncs budgets directly to Azure Cost Management API

**Data source:** Azure Cost Management API (Budgets)

---

### Module 9 — Savings Tracker
The single most important module for demonstrating ROI to clients.

**Features:**
- Every recommendation can be marked "Implemented" with one click
- Logs: date, category, resource, projected monthly saving, who implemented
- Running total: savings implemented this month / all time
- ROI card: license cost ($1,000) vs cumulative savings
- Shows payback date (date when savings exceeded license cost)

**Storage:** Azure Table Storage

---

### Module 10 — Monthly Excel Report
Generated on-demand or scheduled monthly. Sent via email or downloaded from dashboard.

**Tabs:**

| Tab | Contents |
|---|---|
| Executive Summary | Month, total spend, MoM delta, savings implemented, potential savings remaining |
| Savings Implemented | Date, resource, category, action taken, monthly saving ($) |
| Open Recommendations | Priority, category, resource, recommendation, est. saving ($), effort level |
| Cost Breakdown | By service, by resource group, top 20 resources |
| Budget Status | Budget name, limit, spent, % used, status |

**Format:** `.xlsx`, fully styled with colors, borders, and auto-fit columns.

---

## Cost Optimization Coverage — Complete List

The tool covers every major Azure cost optimization category:

### Compute
- [ ] Idle / deallocated VMs with billable disks
- [ ] Oversized VMs (CPU/memory underutilized)
- [ ] VMs without auto-shutdown in dev/test environments
- [ ] Spot VM eligibility for non-critical workloads

### Storage
- [ ] Unattached managed disks
- [ ] Old snapshots (>30 days)
- [ ] Premium disk downgrade opportunities
- [ ] Blob storage tier optimization (Hot→Cool→Archive)
- [ ] Unused storage accounts

### Networking
- [ ] Unused public IP addresses
- [ ] Idle load balancers (no backends)
- [ ] Unused application gateways
- [ ] Idle VPN gateways
- [ ] Orphaned network interfaces

### Databases
- [ ] Azure SQL low DTU/vCore utilization
- [ ] SQL Elastic Pool underutilization
- [ ] Cosmos DB over-provisioned throughput

### App Services
- [ ] Empty App Service Plans
- [ ] Oversized App Service Plans
- [ ] Stopped web apps on paid plans

### Licensing
- [ ] Azure Hybrid Benefit — Windows Server VMs
- [ ] Azure Hybrid Benefit — SQL Server VMs
- [ ] Azure Hybrid Benefit — Azure SQL PaaS
- [ ] Azure Hybrid Benefit — AKS Windows node pools
- [ ] Dev/Test subscription pricing eligibility

### Commitments
- [ ] Reserved Instance purchase recommendations (1yr / 3yr)
- [ ] Underused or expiring existing Reserved Instances
- [ ] Savings Plans recommendations

### Monitoring & Logging
- [ ] Log Analytics workspace excessive retention
- [ ] Over-collection of diagnostic logs
- [ ] App Insights sampling not configured

### Containers
- [ ] AKS node pools consistently underutilized
- [ ] Overprovisioned node VM sizes

---

## Data Flow

```
Azure APIs                    Azure Functions                  Frontend
──────────              ──────────────────────────────    ───────────────
Cost Management  ──────►  collect-costs (timer: 4h)    ──► Cost Dashboard
                           └── writes to Table Storage

Resource Graph   ──────►  scan-idle-resources (4h)     ──► Idle Resources
                           └── writes to Table Storage

Monitor Metrics  ──────►  analyze-rightsizing (daily)  ──► VM Rightsizing
                           └── writes to Table Storage

Advisor API      ──────►  fetch-recommendations (4h)   ──► RI Advisor
                           └── writes to Table Storage

Resource Graph   ──────►  scan-ahb (daily)             ──► AHB Scanner
                           └── writes to Table Storage

                          generate-excel (on-demand)    ──► Download Report
                           └── reads Table Storage
                           └── writes to Blob Storage
```

---

## Project Structure

```
azureoptimize-pro/
├── frontend/                    # Next.js 15 app (static export)
│   ├── app/
│   │   ├── (auth)/
│   │   │   └── login/
│   │   ├── dashboard/           # Cost Dashboard
│   │   ├── idle-resources/      # Idle Resource Detector
│   │   ├── rightsizing/         # VM Rightsizing
│   │   ├── reservations/        # RI Advisor
│   │   ├── hybrid-benefit/      # AHB Scanner
│   │   ├── storage/             # Storage Optimizer
│   │   ├── databases/           # Database Optimizer
│   │   ├── budgets/             # Budget Manager
│   │   ├── savings/             # Savings Tracker
│   │   └── reports/             # Excel Report Generator
│   ├── components/
│   │   ├── ui/                  # shadcn/ui components
│   │   ├── charts/              # Recharts wrappers
│   │   └── layout/              # Sidebar, Header, Nav
│   └── lib/
│       ├── auth.ts              # MSAL config
│       ├── api.ts               # API client
│       └── utils.ts
│
├── api/                         # Azure Functions v4
│   ├── src/
│   │   ├── functions/
│   │   │   ├── collectCosts.ts          # Timer: every 4h
│   │   │   ├── scanIdleResources.ts     # Timer: every 4h
│   │   │   ├── analyzeRightsizing.ts    # Timer: daily
│   │   │   ├── fetchRecommendations.ts  # Timer: every 4h
│   │   │   ├── scanAHB.ts               # Timer: daily
│   │   │   ├── scanStorage.ts           # Timer: daily
│   │   │   ├── scanDatabases.ts         # Timer: daily
│   │   │   ├── triggerRefresh.ts        # HTTP POST /api/refresh — runs all 8 scanners in parallel
│   │   │   ├── generateExcel.ts         # HTTP: on-demand Excel export
│   │   │   ├── getBudgets.ts            # HTTP: budget list + sync
│   │   │   ├── markImplemented.ts       # HTTP: mark recommendation implemented
│   │   │   ├── getSavings.ts            # HTTP: savings tracker data
│   │   │   └── health.ts                # HTTP GET /api/health — unauthenticated
│   │   └── lib/
│   │       ├── azure/
│   │       │   ├── costManagement.ts
│   │       │   ├── resourceGraph.ts
│   │       │   ├── monitorMetrics.ts
│   │       │   ├── advisor.ts
│   │       │   └── retailPrices.ts
│   │       ├── auth/
│   │       │   └── validateUser.ts
│   │       └── storage/
│   │           ├── tableClient.ts
│   │           └── blobClient.ts
│   └── package.json
│
└── infra/                       # Bicep templates
    ├── main.bicep               # Main deployment template
    ├── modules/
    │   ├── staticWebApp.bicep
    │   ├── functionApp.bicep
    │   ├── storage.bicep
    │   └── keyVault.bicep
    └── Deploy-AzureCostOptimize.ps1   # Installer script
```

---

## Deployment

See [SETUP.md](SETUP.md) for the full deployment guide.

**TL;DR — from Azure Cloud Shell:**
```powershell
irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1 | iex
```

**Code updates are automatic:** push to `main` on GitHub and GitHub Actions deploys both the API and frontend within ~3 minutes.

---

## Development Setup

### Prerequisites
- Node.js 20+
- Azure Functions Core Tools v4
- Azure CLI (`az` command)
- Git

### Local Development
```bash
# 1. Clone repo
git clone https://github.com/TanishqBansal2645/AzureOptimize-Pro.git

# 2. Install dependencies
cd frontend && npm install
cd ../api && npm install

# 3. Copy env files
cp frontend/.env.example frontend/.env.local
cp api/local.settings.json.example api/local.settings.json

# 4. Fill in env vars (see SETUP.md for values)

# 5. Login to Azure CLI
az login

# 6. Start both dev servers
# Terminal 1:
cd api && npm start
# Terminal 2:
cd frontend && npm run dev
```

---

## Environment Variables

### Frontend (`frontend/.env.local`)
```
NEXT_PUBLIC_AZURE_CLIENT_ID=         # Entra app registration client ID
NEXT_PUBLIC_AZURE_TENANT_ID=         # Azure tenant ID
NEXT_PUBLIC_AZURE_REDIRECT_URI=      # http://localhost:3000 (dev) or deployed URL
NEXT_PUBLIC_API_BASE_URL=            # Azure Functions URL
NEXT_PUBLIC_DEVELOPER_NAME=          # Optional: white-label developer name (falls back to "Tanishq Bansal")
NEXT_PUBLIC_ADMIN_PRINCIPAL_ID=      # Entra Object ID of the admin user IN THIS TENANT (see note below)
```

### API (`api/local.settings.json`)
```json
{
  "Values": {
    "AZURE_TENANT_ID": "",
    "STORAGE_ACCOUNT_NAME": "",
    "STORAGE_ACCOUNT_KEY": "",
    "ADMIN_PRINCIPAL_ID": "",        // Entra Object ID of the admin user IN THIS TENANT (see note below)
    "KEY_VAULT_URI": ""
  }
}
```

---

## Important: ADMIN_PRINCIPAL_ID for Guest Users

If the admin is a **guest user** (e.g. a consultant whose home tenant is different from the client tenant), their Object ID differs between tenants. You must use the OID **in the client's tenant**, not the home tenant OID.

**How to get the correct OID:**

```bash
# Replace the email with the guest user's UPN in the client tenant
az ad user show --id "user_gmail.com#EXT#@clienttenant.onmicrosoft.com" \
  --query id --output tsv
```

Or in the Azure Portal: Entra ID → Users → [search for the guest user] → Copy **Object ID**.

**Both env vars must match:** `ADMIN_PRINCIPAL_ID` on the Function App AND `NEXT_PUBLIC_ADMIN_PRINCIPAL_ID` on the Static Web App must be set to the same OID.

---

## Important: CORS Configuration

**Never configure App Service CORS** (portal → Function App → CORS) alongside this codebase. The isolated worker model sets CORS headers in function code; if App Service CORS is also configured, it intercepts responses and **suppresses the function-level headers**, breaking all browser API calls.

If you accidentally enable App Service CORS:
```bash
az functionapp cors remove --name <func-app-name> --resource-group <rg> --allowed-origins '*'
az functionapp cors remove --name <func-app-name> --resource-group <rg> --allowed-origins 'https://portal.azure.com'
```

The Bicep templates in this repo intentionally do **not** configure App Service CORS.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser shows CORS error | App Service CORS is configured | Remove all origins via `az functionapp cors remove` |
| 403 on `/api/refresh` or `/api/costs/refresh` | `ADMIN_PRINCIPAL_ID` points to wrong user | Get correct OID in client tenant (see above) |
| 500 on OPTIONS preflight | Never seen post-fix; was a 204→200 issue | Already fixed in `corsOptions.ts` |
| Functions show healthy but data is empty | Timers haven't run yet | Click **Refresh All** in the dashboard, wait 1–3 min |
| `az account set` fails | Wrong subscription ID | Ensure subscription belongs to the target tenant |
