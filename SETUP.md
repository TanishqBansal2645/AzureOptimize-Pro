# AzureOptimize Pro — Deployment Guide

> **Time required:** ~15 minutes  
> **Prerequisites:** Azure Cloud Shell (or local: Azure CLI + PowerShell 7+)  
> **Required role:** Owner on the target Azure subscription

---

## Overview

Deployment is two PowerShell commands run from the client's Azure tenant:

```powershell
# Step 1 — Create the Entra App Registration (once per tenant)
.\infra\Setup-Entra.ps1 -TenantId "<TENANT_ID>"

# Step 2 — Provision all Azure infrastructure
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId         "<TENANT_ID>" `
  -AdminPrincipalId "<ADMIN_OBJECT_ID>" `
  -AppClientId      "<APP_CLIENT_ID>"
```

Step 1 outputs the exact Step 2 command — just copy and paste.

Code (API + frontend) deploys automatically via GitHub Actions on every push to `main`.  
The deploy script handles only Azure infrastructure: storage, function app, key vault, managed identity, and RBAC.

---

## One-Command Install (Cloud Shell)

The fastest path — run this directly in the client's Azure Cloud Shell:

```powershell
irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1 | iex
```

This clones the repo, runs Setup-Entra, and runs Deploy automatically. No tools to install.

---

## Manual Install

### Prerequisites

```powershell
az --version     # 2.50+
node --version   # v20.x
pwsh --version   # 7+  (Windows PowerShell 5.1 also works)
```

### Step 1 — Entra App Setup

```powershell
cd "Cost Optimization Tool"
.\infra\Setup-Entra.ps1 -TenantId "<CLIENT_TENANT_ID>"
```

Creates the Entra App Registration, grants admin consent, and prints the exact deploy command.

### Step 2 — Infrastructure Deployment

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId          "<TENANT_ID>" `
  -AdminPrincipalId  "<ADMIN_OBJECT_ID>" `
  -AppClientId       "<APP_CLIENT_ID>" `
  -Location          "eastus" `
  -ResourceGroupName "rg-azureoptimize"
```

**What it provisions:**

| Step | Action | Time |
|------|--------|------|
| 1 | Login to Azure | <30s |
| 2 | Bicep: Storage, Function App, Static Web App, Key Vault, Managed Identity | 5–8 min |
| 3 | RBAC: Reader + Cost Management Reader + Monitoring Reader + **Contributor** on all tenant subscriptions | <1 min |
| 4 | Configure GitHub Actions secrets (if `-GitHubToken` provided) and trigger first deploy | 4 min |
| 5 | API health check (retries 8×) | <2 min |
| 6 | Smoke tests | <1 min |

> **Contributor role:** Required for automated remediation (deleting idle resources, resizing VMs, enabling AHB, scaling databases). Without it, scanning and reporting work normally, but the Implement button will fail with a permissions error.

**Total: ~12–15 minutes**

#### Optional: Branding

Both branding fields are always initialised (empty by default, with fallbacks) — pass them to set values at deploy time:

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId          "<TENANT_ID>" `
  -AdminPrincipalId  "<ADMIN_OBJECT_ID>" `
  -AppClientId       "<APP_CLIENT_ID>" `
  -CompanyName       "Contoso Ltd" `
  -DeveloperName     "Tanishq Bansal"
```

| Param | Sets | Shown on | Fallback if empty |
|-------|------|---------|------------------|
| `-CompanyName` | `COMPANY_NAME` (Function App) | Sidebar + header | Azure AD tenant name |
| `-DeveloperName` | `NEXT_PUBLIC_DEVELOPER_NAME` (Static Web App) | Login page footer | `"Tanishq Bansal"` |

#### Optional: Automate GitHub secrets

Pass `-GitHubToken` (a GitHub PAT with Contents + Workflows + Secrets read/write) to have the script set the two GitHub Actions secrets and trigger the first deployment automatically:

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId          "<TENANT_ID>" `
  -AdminPrincipalId  "<ADMIN_OBJECT_ID>" `
  -AppClientId       "<APP_CLIENT_ID>" `
  -GitHubToken       "ghp_..."
```

Without `-GitHubToken`, the script prints the two secrets to add manually at  
`https://github.com/TanishqBansal2645/AzureOptimize-Pro/settings/secrets/actions`.

### Step 3 — Update Entra Redirect URI

After the first deployment, add the production URL to the Entra App:

```powershell
.\infra\Setup-Entra.ps1 `
  -TenantId         "<TENANT_ID>" `
  -AppClientId      "<APP_CLIENT_ID>" `
  -DashboardUrl     "<STATIC_WEB_APP_URL>" `
  -UpdateRedirectUri
```

Or via Azure CLI:

```powershell
az ad app update `
  --id "<APP_CLIENT_ID>" `
  --web-redirect-uris "http://localhost:3000" "<STATIC_WEB_APP_URL>"
```

### Step 4 — First Login

1. Open the Static Web App URL in a browser
2. Click **Sign in with Microsoft**
3. Log in with the admin account (matching `AdminPrincipalId`)
4. Cost data populates on a timer — first results within 4 hours

---

## Updating Code

Code updates happen automatically when you push to `main` on GitHub. GitHub Actions handles the build and deploy for both API and frontend.

To update infrastructure only:

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 -TenantId "<TENANT_ID>" -Update
```

---

## Removing the Tool

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId          "<TENANT_ID>" `
  -ResourceGroupName "rg-azureoptimize" `
  -Remove
```

Deletes the resource group, all resources, and all MI role assignments. Confirm with `yes`.

> Export an Excel report first if the client wants their savings history.

---

## Branding

Two optional branding fields are initialised empty on every fresh deploy and have code fallbacks, so the tool works out of the box and you customise them when ready.

| Setting | Where shown | Deploy param | Fallback |
|---------|-------------|-------------|---------|
| `COMPANY_NAME` (Function App) | Sidebar + header subtitle | `-CompanyName` | Azure AD tenant display name |
| `NEXT_PUBLIC_DEVELOPER_NAME` (Static Web App) | Login page footer | `-DeveloperName` | `"Tanishq Bansal"` |

**Set during deployment:**
```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId "<TENANT_ID>" -AdminPrincipalId "<OID>" -AppClientId "<CID>" `
  -CompanyName "Contoso Ltd" `
  -DeveloperName "Tanishq Bansal"
```

**Update branding only (no infrastructure re-deploy):**
```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId "<TENANT_ID>" -Update `
  -CompanyName "Contoso Ltd" `
  -DeveloperName "Tanishq Bansal"
```

> `NEXT_PUBLIC_DEVELOPER_NAME` is a build-time variable — the new value takes effect on the next GitHub Actions deployment after the setting is updated.

**Direct CLI (Function App):**
```powershell
az functionapp config appsettings set `
  --name <functionapp-name> --resource-group rg-azureoptimize `
  --settings "COMPANY_NAME=Contoso Ltd"
```

**Direct CLI (Static Web App):**
```powershell
az staticwebapp appsettings set `
  --name <swa-name> --resource-group rg-azureoptimize `
  --setting-names "NEXT_PUBLIC_DEVELOPER_NAME=Tanishq Bansal"
```

---

## GitHub Actions Secrets Required

| Secret | What it is | How to get it |
|--------|-----------|---------------|
| `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | Function App publish profile (XML) | `az functionapp deployment list-publishing-profiles --name <app> --resource-group <rg> --xml` |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Static Web App deploy token | `az staticwebapp secrets list --name <swa> --resource-group <rg> --query "properties.apiKey" -o tsv` |

Both are set automatically when `-GitHubToken` is passed to the deploy script.

---

## Troubleshooting

### "Insufficient privileges to complete the operation"
You need Owner or User Access Administrator on the subscription to assign RBAC roles.

```powershell
az role assignment list --assignee $(az ad signed-in-user show --query id -o tsv) --output table
```

### Health check times out after deployment
Function App on Consumption plan takes 30–60 seconds on cold start. The deploy script retries 8 times. If still failing, check:
```powershell
az functionapp log tail --name <app-name> --resource-group rg-azureoptimize
```

### "Dashboard loads but shows No data"
Cost data collects on 4-hour timers. Wait up to 4 hours, or trigger a manual refresh via the dashboard's Refresh button.

### Cost Management Reader role assignment fails
Some tenants require Management Group scope:
```powershell
$mgmtGroupId = az account management-group list --query "[0].name" -o tsv
$miOid = az identity list --resource-group rg-azureoptimize --query "[0].principalId" -o tsv
az role assignment create `
  --assignee $miOid `
  --role "Cost Management Reader" `
  --scope "/providers/Microsoft.Management/managementGroups/$mgmtGroupId"
```

### Implement button returns "Remediation failed: insufficient permissions"
The Managed Identity is missing the Contributor role on one or more subscriptions. Re-run the deploy script with `-Update` to re-apply RBAC, or assign manually:
```powershell
$miOid = az identity list --resource-group rg-azureoptimize --query "[0].principalId" -o tsv
$subId = "<SUBSCRIPTION_ID>"
az role assignment create `
  --assignee $miOid `
  --role "Contributor" `
  --scope "/subscriptions/$subId"
```

---

## Quick Reference — Values to Record After Deployment

| Value | Where to find |
|-------|---------------|
| Dashboard URL | Deploy script output / `az staticwebapp list -g rg-azureoptimize --query "[0].defaultHostname" -o tsv` |
| API URL | `https://<functionapp-name>.azurewebsites.net/api` |
| Resource Group | `rg-azureoptimize` (default) |
| Tenant ID | Passed to deploy script |
| App Client ID | Output of Setup-Entra.ps1 |
| Admin Object ID | Output of Setup-Entra.ps1 |
