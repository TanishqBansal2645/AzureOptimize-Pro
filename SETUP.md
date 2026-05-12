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

#### Optional: Automate GitHub secrets and variables

Pass `-GitHubToken` to have the script automatically set 2 GitHub secrets + 7 repository variables and trigger the first deployment:

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId          "<TENANT_ID>" `
  -AdminPrincipalId  "<ADMIN_OBJECT_ID>" `
  -AppClientId       "<APP_CLIENT_ID>" `
  -GitHubToken       "ghp_..."
```

PAT scopes needed: `repo` (classic) or Actions read/write (fine-grained). Install PyNaCl first: `pip install PyNaCl`

Without `-GitHubToken`, the script saves all values to `%TEMP%\azopt-github-secrets\` and prints instructions to set them manually at:
- Secrets: `https://github.com/TanishqBansal2645/AzureOptimize-Pro/settings/secrets/actions`
- Variables: `https://github.com/TanishqBansal2645/AzureOptimize-Pro/settings/variables/actions`

See the **GitHub Actions Secrets and Variables Required** section at the end of this guide for the full list.

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

## Updating an Existing Deployment

### Code updates (automatic)
Every push to `main` triggers GitHub Actions — the API and frontend redeploy in ~3 minutes. No script needed.

### Infrastructure update (`-Update`)

Re-applies role assignments, verifies the deployment is healthy:

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 -TenantId "<TENANT_ID>" -Update
```

**What it does:**
| Step | Action |
|------|--------|
| 1 | Login |
| 2 | Read existing resource names |
| 3 | Re-apply all 4 RBAC roles on every subscription (idempotent) |
| 4 | Skip GitHub secrets (unchanged) |
| 5 | API health check |
| 6 | Smoke tests |

Use `-Update` after:
- Pulling new code that includes Bicep or RBAC changes (re-run roles)
- A role assignment was accidentally removed
- You want to verify the API is healthy without a full redeploy

> **Bicep infrastructure changes** (e.g. new storage settings, new role added to `storage.bicep`): re-run the full deploy command with the same params — Bicep is idempotent and won't delete existing data.

---

## Removing the Tool

> Export an Excel report first if the client wants their savings history.

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId          "<TENANT_ID>" `
  -ResourceGroupName "rg-azureoptimize" `
  -Remove
```

**What it does:** deletes all MI role assignments across all subscriptions, then deletes the resource group and all resources inside it. Prompts `Type 'yes' to confirm` before proceeding. The Entra App Registration is **not** deleted — remove it manually from Entra ID if you want a complete cleanup.

> Deletion of the resource group is async (`--no-wait`). Check completion in the Azure Portal under Resource Groups.

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

## GitHub Actions Secrets and Variables Required

The workflows need **2 encrypted secrets** and **7 plain repository variables**.

All are set automatically when `-GitHubToken` is passed to the deploy script.  
Without `-GitHubToken`, the script saves all values to `%TEMP%\azopt-github-secrets\` and prints URLs.

### Secrets — `Settings → Secrets and variables → Actions → Secrets`

| Secret | What it is | How to get it manually |
|--------|-----------|------------------------|
| `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | Function App publish profile (XML) | `az functionapp deployment list-publishing-profiles --name <app> --resource-group <rg> --xml` |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Static Web App deploy token | `az staticwebapp secrets list --name <swa> --resource-group <rg> --query "properties.apiKey" -o tsv` |

### Variables — `Settings → Secrets and variables → Actions → Variables`

| Variable | What it is |
|----------|-----------|
| `AZURE_FUNCTIONAPP_NAME` | Function App resource name (e.g. `func-azureoptimize-abc123`) |
| `NEXT_PUBLIC_AZURE_TENANT_ID` | Client's Azure tenant ID |
| `NEXT_PUBLIC_AZURE_CLIENT_ID` | Entra App Registration client ID |
| `NEXT_PUBLIC_AZURE_REDIRECT_URI` | Static Web App URL (e.g. `https://red-sand-xxx.azurestaticapps.net`) |
| `NEXT_PUBLIC_API_BASE_URL` | Function App API URL (e.g. `https://func-azureoptimize-xxx.azurewebsites.net/api`) |
| `NEXT_PUBLIC_ADMIN_PRINCIPAL_ID` | Entra Object ID of the admin user |
| `NEXT_PUBLIC_DEVELOPER_NAME` | (Optional) Developer name on login page footer |

> **Why variables?** The `NEXT_PUBLIC_*` values are baked into the Next.js bundle at build time. They must be injected via workflow environment variables — not Azure settings — so the build produces a binary that connects to the right tenant and API.

### GitHub PAT scopes (for `-GitHubToken`)

| PAT type | Required scopes |
|----------|----------------|
| Classic | `repo` (includes secrets, variables, workflows) |
| Fine-grained | Repository → Actions: Read and write |

> Install PyNaCl before using `-GitHubToken`: `pip install PyNaCl`

---

## Troubleshooting

### Login page shows wrong tenant / "Sign-in failed" on fresh deploy
The frontend `NEXT_PUBLIC_*` variables were not set before the GitHub Actions build ran. Check the repository variables at `Settings → Secrets and variables → Actions → Variables`. All 6 `NEXT_PUBLIC_*` variables must be present. If missing, set them and re-run the `Deploy Frontend` workflow manually.

### API deploy fails: "Could not find app 'func-azureoptimize-xxx'"
The `AZURE_FUNCTIONAPP_NAME` repository variable is missing or incorrect. Find the correct name:
```powershell
az functionapp list --resource-group rg-azureoptimize --query "[0].name" -o tsv
```
Set this as the `AZURE_FUNCTIONAPP_NAME` variable in GitHub Actions and re-run the `Deploy API` workflow.

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
