# AzureOptimize Pro — Deployment Guide

> **Time required:** ~20 minutes (fully automated)  
> **Prerequisites:** Azure CLI, Node.js 20+, PowerShell 7+, Owner role on the target tenant

---

## Overview

The entire deployment is two PowerShell commands:

```powershell
# Step 1: Set up Entra App Registration (once per tenant)
.\infra\Setup-Entra.ps1 -TenantId "<TENANT_ID>"

# Step 2: Deploy everything (infra + API + frontend + tests)
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId         "<TENANT_ID>" `
  -AdminPrincipalId "<YOUR_OBJECT_ID>" `
  -AppClientId      "<APP_CLIENT_ID>"
```

`Setup-Entra.ps1` outputs the exact command for Step 2 — just copy and paste it.

---

## Prerequisites

Install these tools before running anything:

```powershell
# Verify versions
az --version          # 2.50+
node --version        # v20.x
npm --version         # 10.x
pwsh --version        # 7+  (or powershell for Windows PS 5.1)
```

Install Azure CLI if missing:
```powershell
winget install Microsoft.AzureCLI
```

Install Node.js 20 if missing:
```powershell
winget install OpenJS.NodeJS.LTS
```

---

## Step 1 — Entra App Setup (run once per client tenant)

```powershell
cd "Cost Optimization Tool"
.\infra\Setup-Entra.ps1 -TenantId "<CLIENT_TENANT_ID>"
```

This script:
- Logs you in to the client's Azure tenant
- Creates (or reuses) an Entra App Registration named "AzureOptimize Pro"
- Grants admin consent automatically
- Configures the API scope for token audience validation
- **Outputs the exact deploy command** with all values pre-filled

Example output:
```
  App Client ID   : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  Admin Object ID : yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
  Tenant ID       : zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz

  Run the deployment now:
    .\Deploy-AzureCostOptimize.ps1 `
      -TenantId          "zzzz..." `
      -AdminPrincipalId  "yyyy..." `
      -AppClientId       "xxxx..." `
      -Location          "eastus" `
      -ResourceGroupName "rg-azureoptimize"
```

---

## Step 2 — Full Deployment

Copy the command from Step 1 output and run it:

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId          "<TENANT_ID>" `
  -AdminPrincipalId  "<ADMIN_OBJECT_ID>" `
  -AppClientId       "<APP_CLIENT_ID>" `
  -Location          "eastus" `
  -ResourceGroupName "rg-azureoptimize"
```

### What happens (fully automated):

| Step | Action | Time |
|------|--------|------|
| Pre-flight | Tool checks + project structure validation | <5s |
| 1 | Login to Azure | <30s |
| 2 | Provision infrastructure (Storage, Function App, Static Web App, Key Vault, Managed Identity) | 5-8 min |
| 3 | Assign Reader + Cost Management Reader + Monitoring Reader roles on all subscriptions | <1 min |
| 4 | Build TypeScript API + zip-deploy to Function App | 2-3 min |
| 5 | Build Next.js frontend + deploy to Static Web App | 2-3 min |
| 6 | Wait for Function App cold start | 30s |
| 7 | API health check (retries up to 5×) | <1 min |
| 8 | Automated smoke tests (auth, CORS, endpoints) | <1 min |

**Total: ~15-20 minutes**

### Expected final output:
```
  Dashboard URL  : https://wonderful-stone-abc123.azurestaticapps.net
  API URL        : https://func-azureoptimize-abc123.azurewebsites.net/api
  Resource Group : rg-azureoptimize
  Key Vault URI  : https://kv-azopt-abc123.vault.azure.net/
```

---

## Step 3 — Update Entra Redirect URI

After deployment, update the Entra App with the real dashboard URL:

```powershell
.\infra\Setup-Entra.ps1 `
  -TenantId      "<TENANT_ID>" `
  -DashboardUrl  "https://wonderful-stone-abc123.azurestaticapps.net" `
  -UpdateRedirectUri `
  -AppClientId   "<APP_CLIENT_ID>"
```

This adds `https://wonderful-stone-abc123.azurestaticapps.net/.auth/login/aad/callback`
as a valid redirect URI so users can log in from the production URL.

---

## Step 4 — First Login

1. Open the dashboard URL in a browser
2. Click **Sign in with Microsoft**
3. Log in with the admin account (the one whose Object ID you used)
4. You land on the Cost Dashboard

**First data:** Cost data and optimization scans run on a timer:
- Cost data: every 4 hours (first run after ~4h, or trigger manually)
- Idle resource scan: offset by 30 min from costs
- VM rightsizing: daily at 8am UTC
- AHB / Storage / Database scans: daily, staggered

> No manual trigger needed — data populates automatically on schedule.

---

## Updating the Tool

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId          "<TENANT_ID>" `
  -ResourceGroupName "rg-azureoptimize" `
  -Update
```

`-Update` redeploys the API and frontend code without touching infrastructure or data.

---

## Running Tests Independently

```powershell
.\infra\Test-Deploy.ps1 `
  -ApiUrl  "https://func-azureoptimize-abc123.azurewebsites.net/api" `
  -TenantId "<TENANT_ID>" `
  -Verbose
```

Tests cover:
- Health endpoint + environment configuration
- Authentication enforcement (all endpoints reject unauthenticated requests)
- Admin-only endpoint enforcement
- Input validation (400 responses for bad requests)
- Response time benchmarks
- CORS header presence

---

## Removing the Tool

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId          "<TENANT_ID>" `
  -ResourceGroupName "rg-azureoptimize" `
  -Remove
```

Deletes the resource group and all role assignments. Confirm with `yes` at the prompt.

> Export an Excel report first if the client wants to keep their savings history.

---

## Troubleshooting

### "Insufficient privileges to complete the operation"
You need Owner or User Access Administrator at the subscription level to assign roles.

```powershell
az role assignment list --assignee $(az ad signed-in-user show --query id -o tsv) --output table
```

### "TypeScript compilation failed"
The API TypeScript build failed. The error is shown above the failure message. Common cause:
run `cd api && npm install` then `npm run build` to see the exact error.

### Health check times out
The Function App on Consumption plan takes 30-60 seconds on cold start. The deploy
script retries 5 times. If it still fails, check the Function App in Azure Portal →
Monitor → Live Metrics.

### "SWA CLI not found"
The deploy script installs it automatically via `npm install -g @azure/static-web-apps-cli`.
If your network blocks npm global installs, install manually:
```powershell
npm install -g @azure/static-web-apps-cli
```

### Dashboard loads but shows "No data"
Cost data collects on a 4-hour timer. First run happens at the next scheduled interval.
Wait up to 4 hours, or check the Function App logs for timer trigger errors.

### Role assignment for Cost Management Reader fails
Some tenants require Management Group scope for Cost Management roles:
```powershell
$mgmtGroupId = az account management-group list --query "[0].name" -o tsv
$miOid = az identity show --name mi-azureoptimize-* --resource-group rg-azureoptimize --query principalId -o tsv
az role assignment create `
  --assignee $miOid `
  --role "Cost Management Reader" `
  --scope "/providers/Microsoft.Management/managementGroups/$mgmtGroupId"
```

---

## Quick Reference — Values to Record

After deployment, record these values for the client:

| Value | Where to find |
|---|---|
| Dashboard URL | Deploy script output |
| API URL | Deploy script output |
| Resource Group | `rg-azureoptimize` (default) |
| Tenant ID | Passed to deploy script |
| App Client ID | Output of Setup-Entra.ps1 |
| Admin Object ID | Output of Setup-Entra.ps1 |
