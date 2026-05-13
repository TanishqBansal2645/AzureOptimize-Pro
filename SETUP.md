# AzureOptimize Pro — Deployment Guide

> **Time required:** ~30–45 minutes (mostly waiting for Azure cold start — Consumption plan takes 15–27 min)  
> **Prerequisites:** Azure Cloud Shell (or local: Azure CLI + PowerShell 7+)  
> **Required role:** Owner on the target Azure subscription  
> **Resource group name:** Auto-derived from the client's tenant ID — e.g. tenant `98b65c17-...` → `rg-azureoptimize-a188e9`. Each client gets a unique, isolated resource group with no extra input needed. Override with `-ResourceGroupName` if you prefer a custom name.

---

## Quick Commands

Run these from the **client's Azure Cloud Shell**. Set the token once per session, then use the relevant command.

```powershell
# 1. Set GitHub token (once per session — stays in memory, never written to disk)
$env:GITHUB_TOKEN = "ghp_..."

# 2. Fresh install (Entra + infrastructure + GitHub Actions setup + first deploy)
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1)))

# 3. Update (re-apply RBAC, verify health — run after code changes or role drift)
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1))) -Update

# 4. Decommission (delete all Azure resources — prompts for confirmation)
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1))) -Remove
```

---

## Overview

Three operations cover the full lifecycle — all are single commands from the client's Azure Cloud Shell:

| Operation | When to use | Command |
|-----------|-------------|---------|
| **Install** | New client tenant | `& ([scriptblock]::Create((irm .../Install.ps1)))` |
| **Update** | After code changes, RBAC drift | `... -Update` |
| **Remove** | End of engagement | `... -Remove` |

See the **Cloud Shell Commands** section below for the exact commands.

Code (API + frontend) deploys automatically via GitHub Actions on every push to `main`.  
The install script handles everything else: Entra App Registration, Azure infrastructure, GitHub Actions setup.

---

## Cloud Shell Commands (Primary Method)

All three lifecycle operations are single commands run from the **client's Azure Cloud Shell**. No tools to install, no parameters to remember.

### New Install
```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1)))
```
Creates the Entra App Registration and provisions all Azure infrastructure. Takes ~8 minutes. Without a GitHub token it prints manual GitHub setup instructions and exits — you then set up GitHub Actions and run the workflows yourself.

To also configure GitHub automatically and trigger the first full deployment (recommended), set your GitHub PAT as an environment variable first — this avoids typing it in the command and is safe because it stays in memory, not in a file:
```powershell
$env:GITHUB_TOKEN = "ghp_..."   # set once per Cloud Shell session
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1)))
```
The script reads `$env:GITHUB_TOKEN` automatically and installs PyNaCl on its own — no manual setup needed.

With a GitHub token the full install (infra + code deploy + health check) takes **~30–45 minutes** — most of the wait is the Consumption plan cold start (15–27 min).

### Update
Re-applies RBAC roles and verifies the deployment is healthy. Run this after pulling new code or if a role assignment was accidentally removed.
```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1))) -Update
```

### Remove (Decommission)
Deletes all Azure resources. Prompts `Type 'yes' to confirm` before proceeding.
```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1))) -Remove
```

The script fully cleans up all resources automatically — no manual steps needed:

| Item | Handled by script |
|------|------------------|
| Managed Identity RBAC on all subscriptions | Yes — removed automatically |
| Resource group + all resources inside it | Yes — deleted (async) |
| Entra App Registration 'AzureOptimize Pro' | Yes — deleted automatically |
| GitHub environments (`rg-*`, `default`) | Yes — deleted (requires `$env:GITHUB_TOKEN` to be set) |

If `$env:GITHUB_TOKEN` is not set, GitHub environments are skipped with a warning and the manual URL is printed.

### If Cloud Shell disconnects mid-run (nohup approach)

A fresh install takes 30–45 minutes. Run the script in the background with `nohup` — it keeps running on Azure's servers even if your browser tab closes or your network drops. All output goes to a log file you can read at any time.

**Fresh install:**
```bash
# In bash (Cloud Shell default shell)
export GITHUB_TOKEN="ghp_..."

# Download the script and run in background
curl -s https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1 > ~/Install.ps1
nohup pwsh -File ~/Install.ps1 > /dev/null 2>&1 &
echo "Deploy running (PID $!). Watching log — Ctrl+C to stop watching (deploy keeps running):"
tail -f ~/azopt.log
```

**If you get disconnected:** reconnect to Cloud Shell and run:
```bash
tail -f ~/azopt.log      # follow live output
# or
cat ~/azopt.log          # see the full log from the start
```

**Update** (repo already cloned):
```bash
cd ~/azureoptimize && git pull origin main --quiet
nohup pwsh -File ~/azureoptimize/infra/Install.ps1 -Update > /dev/null 2>&1 &
tail -f ~/azopt.log
```

**Remove** — run interactively (has a confirmation prompt, completes in under 2 minutes):
```bash
pwsh
./azureoptimize/infra/Install.ps1 -Remove
```

All three commands auto-detect the tenant from your active Azure login. No need to pass `-TenantId` manually.

---

## Manual Install

### Prerequisites

```powershell
az --version     # 2.50+
node --version   # v22.x  (fresh install only — not needed for Update or Remove)
pwsh --version   # 7+  (Windows PowerShell 5.1 also works)
```

### Step 1 — Entra App Setup

```powershell
cd "Cost Optimization Tool"
.\infra\Setup-Entra.ps1 -TenantId "<CLIENT_TENANT_ID>"
```

Creates (or reuses) the Entra App Registration and prints the exact deploy command. The script runs 5 steps with clear pass/fail output:

| Step | Action |
|------|--------|
| 1/5 | Authenticate to tenant + get admin Object ID |
| 2/5 | Create or find 'AzureOptimize Pro' App Registration |
| 3/5 | Configure SPA redirect URI and service principal (new apps only) |
| 4/5 | Enable ID token issuance and expose `user_impersonation` API scope |
| 5/5 | Grant admin consent for all principals in tenant |

Each step prints `[OK]` on success or `[FAIL]` with the exact reason and fix on failure. Steps 4 and 5 are non-fatal — the app still works even if they warn (users see a one-time consent prompt on first sign-in).

### Step 2 — Infrastructure Deployment

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId          "<TENANT_ID>" `
  -AdminPrincipalId  "<ADMIN_OBJECT_ID>" `
  -AppClientId       "<APP_CLIENT_ID>"
```

> `Location` and `ResourceGroupName` use auto-derived defaults (`eastus` and `rg-azureoptimize-<tenant-suffix>`). Override only if needed.

**What it provisions:**

| Step | Action | Time |
|------|--------|------|
| 1 | Login to Azure | <30s |
| 2 | Bicep: Storage, Function App, Static Web App, Key Vault, Managed Identity | 5–8 min |
| 3 | RBAC: Reader + Cost Management Reader + Monitoring Reader + **Contributor** on all tenant subscriptions | <1 min |
| 4 | Configure GitHub Actions secrets (if `-GitHubToken` provided) and trigger first deploy | 8 min |
| 5 | API health check (retries 25×, up to 18 min — covers Consumption plan cold start of 15–27 min) | ≤18 min |
| 6 | Smoke tests | <1 min |

> **Contributor role:** Required for automated remediation (deleting idle resources, resizing VMs, enabling AHB, scaling databases). Without it, scanning and reporting work normally, but the Implement button will fail with a permissions error.

**Total: ~30–45 minutes** (most of the wait is the Consumption plan cold start: 15–27 min from deploy completion to first HTTP response)

#### Optional: Branding

Both branding fields are empty by default. `DeveloperName` falls back to "Tanishq Bansal" if omitted; `CompanyName` simply shows nothing in the header if omitted. Pass them to set values at deploy time:

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
| `-CompanyName` | `COMPANY_NAME` (Function App) | Header subtitle only | *(not shown)* |
| `-DeveloperName` | `NEXT_PUBLIC_DEVELOPER_NAME` (Static Web App) | Login page footer | `"Tanishq Bansal"` |

#### Optional: Automate GitHub secrets and variables

Pass `-GitHubToken` to have the script automatically create a GitHub Environment for this client, set 2 secrets + 7 variables inside it, and trigger the first deployment:

```powershell
.\infra\Deploy-AzureCostOptimize.ps1 `
  -TenantId          "<TENANT_ID>" `
  -AdminPrincipalId  "<ADMIN_OBJECT_ID>" `
  -AppClientId       "<APP_CLIENT_ID>" `
  -GitHubToken       "ghp_..."
```

PAT scopes needed: `repo` (classic) or Actions read/write (fine-grained). PyNaCl is installed automatically by the deploy script.

Each client gets its own GitHub Environment (named after the resource group, e.g. `rg-azureoptimize-a188e9`). Client credentials are fully isolated from each other inside the same repo. The `default` environment is also updated so that automatic deploys on push always target the most recently configured client.

Without `-GitHubToken`, the script saves all values to `/tmp/azopt-github-secrets/` and prints step-by-step instructions to set up the environment manually at:
`https://github.com/TanishqBansal2645/AzureOptimize-Pro/settings/environments`

See the **GitHub Actions Secrets and Variables Required** section at the end of this guide for the full list.

### Step 3 — Update Entra Redirect URI

> **The deploy script does this automatically** — the SPA redirect URI is set right after Bicep finishes. This step is only needed if the auto-update failed, or if the Static Web App URL changes later (e.g. after recreating the SWA).

```powershell
.\infra\Setup-Entra.ps1 `
  -TenantId         "<TENANT_ID>" `
  -AppClientId      "<APP_CLIENT_ID>" `
  -DashboardUrl     "<STATIC_WEB_APP_URL>" `
  -UpdateRedirectUri
```

Or via Azure CLI (manual fallback):

```powershell
# IMPORTANT: must use --set spa=... (Single-page application platform), NOT --web-redirect-uris
# MSAL Browser uses Authorization Code + PKCE which Azure AD only allows for SPA-platform URIs.
# Adding to web.redirectUris fixes the AADSTS50011 login error but the auth-code exchange
# still fails silently, leaving no account in cache → redirect loop back to login page.
az ad app update `
  --id "<APP_CLIENT_ID>" `
  --set "spa={`"redirectUris`":[`"<STATIC_WEB_APP_URL>`",`"<STATIC_WEB_APP_URL>/`",`"http://localhost:3000`"]}"
```

> Add both the bare URL and the trailing-slash variant. Replace `<STATIC_WEB_APP_URL>` with the exact URL from `az staticwebapp list -g <resource-group> --query "[0].defaultHostname" -o tsv` prefixed with `https://`.

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
  -TenantId "<TENANT_ID>" `
  -Remove
```

**What it does:** removes all MI RBAC role assignments across all subscriptions, deletes the Entra App Registration, deletes the resource group (async), and deletes the GitHub environments (`rg-*` and `default`). Prompts `Type 'yes' to confirm` before proceeding. GitHub environment deletion requires `$env:GITHUB_TOKEN` to be set — if missing, those two environments are skipped with a warning.

> Resource group deletion is async (`--no-wait`). Check completion in the Azure Portal under Resource Groups.

---

## Branding

Two optional branding fields — empty by default. `COMPANY_NAME` shows nothing if not set; `NEXT_PUBLIC_DEVELOPER_NAME` falls back to "Tanishq Bansal". The tool works out of the box without either; set them when ready.

| Setting | Where shown | Deploy param | Fallback |
|---------|-------------|-------------|---------|
| `COMPANY_NAME` (Function App) | Header subtitle only (sidebar always shows "AzureOptimize Pro") | `-CompanyName` | *(not shown if empty)* |
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
  --name <functionapp-name> --resource-group <resource-group> `
  --settings "COMPANY_NAME=Contoso Ltd"
```

**Direct CLI (Static Web App):**
```powershell
az staticwebapp appsettings set `
  --name <swa-name> --resource-group <resource-group> `
  --setting-names "NEXT_PUBLIC_DEVELOPER_NAME=Tanishq Bansal"
```

---

## GitHub Actions Secrets and Variables Required

Each client deployment uses a **GitHub Environment** — an isolated set of secrets and variables inside the same repo. No client can see or overwrite another client's values.

All are set automatically when `-GitHubToken` is passed to the deploy script.  
Without `-GitHubToken`, the script saves all values to `/tmp/azopt-github-secrets/` and prints manual setup instructions.

### Architecture: GitHub Environments

The deploy script creates two environments per client deployment:

| Environment | Used by | Purpose |
|-------------|---------|---------|
| `rg-azureoptimize-{suffix}` (e.g. `rg-azureoptimize-a188e9`) | `workflow_dispatch` triggered by deploy script | Client-specific isolated credentials |
| `default` | Push-triggered runs (no dispatch input) | Always updated to the most recently deployed client — ensures `git push` auto-deploys correctly |

Workflows read `environment: ${{ inputs.client_environment \|\| 'default' }}`. When the deploy script triggers them it passes `client_environment: rg-azureoptimize-a188e9`; automatic push-triggered runs fall back to `default`.

To re-deploy for a specific client after a code update: run the workflows manually from GitHub Actions → Run workflow → set `client_environment` to their environment name.

### Secrets per environment — `Settings → Environments → {env} → Secrets`

| Secret | What it is | How to get it manually |
|--------|-----------|------------------------|
| `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | Function App publish profile (XML) | `az functionapp deployment list-publishing-profiles --name <app> --resource-group <rg> --xml` |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Static Web App deploy token | `az staticwebapp secrets list --name <swa> --resource-group <rg> --query "properties.apiKey" -o tsv` |

### Variables per environment — `Settings → Environments → {env} → Variables`

| Variable | What it is |
|----------|-----------|
| `AZURE_FUNCTIONAPP_NAME` | Function App resource name (e.g. `func-azureoptimize-abc123`) |
| `NEXT_PUBLIC_AZURE_TENANT_ID` | Client's Azure tenant ID |
| `NEXT_PUBLIC_AZURE_CLIENT_ID` | Entra App Registration client ID |
| `NEXT_PUBLIC_AZURE_REDIRECT_URI` | Static Web App URL (e.g. `https://red-sand-xxx.azurestaticapps.net`) |
| `NEXT_PUBLIC_API_BASE_URL` | Function App API URL (e.g. `https://func-azureoptimize-xxx.azurewebsites.net/api`) |
| `NEXT_PUBLIC_ADMIN_PRINCIPAL_ID` | Entra Object ID of the admin user |
| `NEXT_PUBLIC_DEVELOPER_NAME` | (Optional) Developer name on login page footer |

> **Why variables and not Azure settings?** The `NEXT_PUBLIC_*` values are baked into the Next.js bundle at build time. They must be injected via workflow environment variables — not Azure runtime settings — so the build produces a binary that connects to the right tenant and API.

### GitHub PAT scopes (for `-GitHubToken`)

| PAT type | Required scopes |
|----------|----------------|
| Classic | `repo` (includes secrets, variables, environments, workflows) |
| Fine-grained | Repository → Actions: Read and write; Environments: Read and write |

> PyNaCl is installed automatically by the install script whenever `-GitHubToken` is used (or `$env:GITHUB_TOKEN` is set). No manual step required.

**If environment creation fails with 403:** The PAT is missing the Environments permission. The script will print a warning and the URL to create environments manually — secrets and variables will still be saved to `/tmp/azopt-github-secrets/`. Create the environments at `Settings → Environments`, then set secrets/variables manually using those files, and re-run the workflows.

---

## Troubleshooting

### Sign-in fails: "AADSTS50011: redirect URI does not match" — or login succeeds but redirects back to login page
Both symptoms have the same root cause: the Static Web App URL is not registered as a **Single-page application** (SPA) redirect URI in the Entra App Registration.

- **AADSTS50011** — URL is not registered at all (Microsoft rejects the redirect before login).
- **Redirect loop after login** — URL is registered under the wrong platform (`web` instead of `spa`). MSAL Browser uses Authorization Code + PKCE, which Azure AD only permits for SPA-platform URIs. A `web`-platform URI fixes the AADSTS50011 error but the auth-code exchange silently fails, so no account is stored in cache and `AuthGuard` bounces the user back to login.

Fix — register the URL under the SPA platform:

```powershell
$url = "https://$(az staticwebapp list -g <resource-group> --query '[0].defaultHostname' -o tsv)"
$appId = "<APP_CLIENT_ID>"   # or: az ad app list --filter "displayName eq 'AzureOptimize Pro'" --query "[0].appId" -o tsv
az ad app update --id $appId `
  --set "spa={`"redirectUris`":[`"$url`",`"$url/`",`"http://localhost:3000`"]}"
```

> This error also appears when the Entra App Registration is registered in a different tenant than the one being deployed to. Verify `NEXT_PUBLIC_AZURE_TENANT_ID` in the GitHub environment matches the target tenant.

### Login page shows wrong tenant / "Sign-in failed" on fresh deploy
The frontend `NEXT_PUBLIC_*` variables were not set before the GitHub Actions build ran. Check the environment variables at `Settings → Environments → {your-environment} → Variables`. The 5 required variables must be present: `NEXT_PUBLIC_AZURE_TENANT_ID`, `NEXT_PUBLIC_AZURE_CLIENT_ID`, `NEXT_PUBLIC_AZURE_REDIRECT_URI`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_ADMIN_PRINCIPAL_ID`. If missing, set them and re-run the `Deploy Frontend` workflow manually (set `client_environment` to the environment name).

### API deploy fails: "Could not find app 'func-azureoptimize-xxx'"
The `AZURE_FUNCTIONAPP_NAME` repository variable is missing or incorrect. Find the correct name:
```powershell
az functionapp list --resource-group <resource-group> --query "[0].name" -o tsv
```
Set this as the `AZURE_FUNCTIONAPP_NAME` variable in GitHub Actions and re-run the `Deploy API` workflow.

### "Insufficient privileges to complete the operation"
You need Owner or User Access Administrator on the subscription to assign RBAC roles.

```powershell
az role assignment list --assignee $(az ad signed-in-user show --query id -o tsv) --output table
```

### Health check times out after deployment
Function App on Consumption plan can take **15–27 minutes** on a fresh deployment cold start (the first 2 startup attempts crash before App Insights initialises; the 3rd succeeds, showing `StartupCount=3`). The deploy script retries for ~18 minutes. If still failing after that window:

```powershell
az functionapp log tail --name <app-name> --resource-group <resource-group>
```

You can also check App Insights for startup traces:
```powershell
# In Azure Portal → Application Insights → Logs:
traces | where timestamp > ago(30m) | where message contains "StartupCount" | order by timestamp desc
```
A successful start shows `StartupCount=3` (two fast-crash attempts before the host stabilises). If no `StartupCount` trace appears at all after 20 minutes, check the eventlog via Kudu (`https://<app>.scm.azurewebsites.net/api/vfs/LogFiles/eventlog.xml`) for IIS EventID 1005 (crash) vs 1032 (started).

### API returns "Site Not Found" HTML after redeployment
**Symptom:** `/api/health` returns an Azure-branded HTML 404 page ("404 Web Site not found") rather than JSON — even after a successful GitHub Actions deployment and confirmed host startup in App Insights.

**Cause:** Azure's front-end routing layer (AFE) has a stale entry for this function app hostname. This can happen after `az functionapp restart` is used, and the corrupted entry can **survive a delete + recreate of the app with the same name**.

**Diagnosis:**
```powershell
# If the response Content-Type is text/html, it is an AFE-level 404, not an app-level 404
Invoke-WebRequest https://<app>.azurewebsites.net/api/health -UseBasicParsing | Select StatusCode, @{n='ct';e={$_.Headers.'Content-Type'}}

# Confirm timer triggers are still working (proves the host is alive despite HTTP being broken)
# In App Insights → Logs:
traces | where timestamp > ago(1h) | where message startswith "Executed" | order by timestamp desc
```

**Fix:**
1. Create a new function app with a **different name** (the new hostname gets a fresh, clean AFE routing entry):
```powershell
az functionapp create --name <new-name> --resource-group <resource-group> `
  --consumption-plan-location eastus --runtime node --runtime-version 22 `
  --functions-version 4 --storage-account <storage-account> --os-type Windows
```
2. Copy all app settings and assign the managed identity from the old app.
3. Update the GitHub Actions environment (`Settings → Environments → {env}`):
   - `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` → new app's publish profile
   - `AZURE_FUNCTIONAPP_NAME` → new app name
   - `NEXT_PUBLIC_API_BASE_URL` → `https://<new-name>.azurewebsites.net/api`
4. Run the **Deploy API** workflow (this uses `azure/functions-action@v1` which handles `WEBSITE_RUN_FROM_PACKAGE=1` correctly — do not use `az functionapp deployment source config-zip` or `az webapp deploy` directly, as they conflict with that setting).
5. Run the **Deploy Frontend** workflow to rebuild the Next.js bundle with the new API URL.
6. Delete the old broken app once the new one is confirmed healthy.

> **Do NOT** use `az functionapp restart` at any point — it de-registers the HTTP routing entry and makes the situation worse.

### Frontend deploy fails: "deployment_token provided was invalid"
The `AZURE_STATIC_WEB_APPS_API_TOKEN` secret in the GitHub environment has expired or was never set for that environment. Refresh it:

```powershell
# Get fresh token
$swaName = az staticwebapp list -g <resource-group> --query "[0].name" -o tsv
$token = az staticwebapp secrets list --name $swaName --resource-group <resource-group> --query "properties.apiKey" -o tsv

# Encrypt and push to GitHub — update BOTH environments
pip3 install PyNaCl -q
$clientEnv = "<resource-group>"   # e.g. "rg-azureoptimize-a188e9"
$headers = @{Authorization="token <YOUR_PAT>"; "Accept"="application/vnd.github+json"}
foreach ($env in @($clientEnv, "default")) {
    $key = Invoke-RestMethod -Uri "https://api.github.com/repos/TanishqBansal2645/AzureOptimize-Pro/environments/$env/secrets/public-key" -Headers $headers
    $enc = python3 -c "
import base64; from nacl import public
box = public.SealedBox(public.PublicKey(base64.b64decode('$($key.key)')))
print(base64.b64encode(box.encrypt(b'$token')).decode())"
    $body = @{encrypted_value=$enc; key_id=$key.key_id} | ConvertTo-Json
    Invoke-RestMethod -Uri "https://api.github.com/repos/TanishqBansal2645/AzureOptimize-Pro/environments/$env/secrets/AZURE_STATIC_WEB_APPS_API_TOKEN" -Method Put -Headers $headers -Body $body -ContentType "application/json"
    Write-Host "$env updated"
}
```

Then re-run the Deploy Frontend workflow from GitHub Actions.

> Always update BOTH the client environment AND `default` — the workflow uses the client environment when triggered manually by the deploy script, and `default` on push-triggered runs.

### Pages load but show "Failed to load [data]" after login
Symptom: login works, dashboard loads, but data cards show error messages. This means the frontend is calling the wrong API URL — typically the previous function app that has since been deleted or renamed.

**Cause:** The frontend bundle bakes in `NEXT_PUBLIC_API_BASE_URL` at build time. If the variable was updated in GitHub but the frontend was not successfully redeployed, the old URL is still in the bundle.

**Fix:**
1. Verify the correct API URL: `az functionapp list -g <resource-group> --query "[0].defaultHostname" -o tsv`
2. Check the GitHub environment variable matches: `Settings → Environments → {env} → Variables → NEXT_PUBLIC_API_BASE_URL`
3. Check the last Deploy Frontend run in GitHub Actions — if it failed, fix the failure (usually expired SWA token, see above) and redeploy
4. Trigger redeploy: GitHub Actions → Deploy Frontend → Run workflow → `client_environment: <your-environment-name>` (e.g. `rg-azureoptimize-a188e9`)

### "Dashboard loads but shows No data"
Cost data collects on 4-hour timers. Wait up to 4 hours, or trigger a manual refresh via the dashboard's Refresh button.

### Cost Management Reader role assignment fails
Some tenants require Management Group scope:
```powershell
$mgmtGroupId = az account management-group list --query "[0].name" -o tsv
$miOid = az identity list --resource-group <resource-group> --query "[0].principalId" -o tsv
az role assignment create `
  --assignee $miOid `
  --role "Cost Management Reader" `
  --scope "/providers/Microsoft.Management/managementGroups/$mgmtGroupId"
```

### Implement button returns "Remediation failed: insufficient permissions"
The Managed Identity is missing the Contributor role on one or more subscriptions. Re-run the deploy script with `-Update` to re-apply RBAC, or assign manually:
```powershell
$miOid = az identity list --resource-group <resource-group> --query "[0].principalId" -o tsv
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
| Dashboard URL | Deploy script output / `az staticwebapp list -g <resource-group> --query "[0].defaultHostname" -o tsv` |
| API URL | `https://<functionapp-name>.azurewebsites.net/api` |
| Resource Group | Auto-derived: `rg-azureoptimize-<tenant-suffix>` (printed by deploy script) |
| Tenant ID | Passed to deploy script |
| App Client ID | Output of Setup-Entra.ps1 |
| Admin Object ID | Output of Setup-Entra.ps1 |
