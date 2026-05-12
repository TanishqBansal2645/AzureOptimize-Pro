<#
.SYNOPSIS
    Deploys AzureOptimize Pro to a client Azure tenant.

.DESCRIPTION
    Provisions the full AzureOptimize Pro Azure infrastructure:
    - Azure Static Web App (dashboard)
    - Azure Function App (API)
    - Azure Storage Account (data + reports)
    - Azure Key Vault (secrets)
    - User-Assigned Managed Identity
    - Role assignments across all subscriptions

    Code deployment is handled automatically by GitHub Actions on every push.
    This script handles only the one-time Azure infrastructure setup.

.PARAMETER TenantId
    The client's Azure tenant ID.

.PARAMETER AdminPrincipalId
    The Entra Object ID of the admin user.

.PARAMETER AppClientId
    The Entra App Registration client ID (for SSO).

.PARAMETER Location
    Azure region to deploy to. Default: eastus

.PARAMETER ResourceGroupName
    Name of the resource group. Default: rg-azureoptimize

.PARAMETER GitHubToken
    Optional GitHub Personal Access Token (contents: read+write) to automatically
    configure GitHub Actions secrets and trigger the first deployment.

.PARAMETER GitHubRepo
    GitHub repo in owner/repo format. Default: TanishqBansal2645/AzureOptimize-Pro

.PARAMETER CompanyName
    Optional company/client name displayed in the sidebar and header of the dashboard.
    If omitted, the Azure AD tenant display name is used automatically.
    Can also be set or updated at any time with -Update -CompanyName "New Name".

.PARAMETER Update
    Re-run infrastructure update only (preserves data, skips code deployment setup).

.PARAMETER Remove
    Delete all deployed Azure resources.

.PARAMETER SkipTests
    Skip the smoke tests after deployment.

.EXAMPLE
    # Fresh install with automatic GitHub setup
    .\Deploy-AzureCostOptimize.ps1 -TenantId "xxx" -AdminPrincipalId "yyy" -AppClientId "zzz" -GitHubToken "ghp_..."

    # Fresh install with company branding
    .\Deploy-AzureCostOptimize.ps1 -TenantId "xxx" -AdminPrincipalId "yyy" -AppClientId "zzz" -CompanyName "Contoso Ltd"

    # Update company name only
    .\Deploy-AzureCostOptimize.ps1 -TenantId "xxx" -Update -CompanyName "Contoso Ltd"
#>

param(
    [Parameter(Mandatory = $true)]
    [string] $TenantId,

    [Parameter(Mandatory = $false)]
    [string] $AdminPrincipalId = "",

    [Parameter(Mandatory = $false)]
    [string] $AppClientId = "",

    [string] $Location = "eastus",
    [string] $ResourceGroupName = "rg-azureoptimize",
    [string] $GitHubToken = "",
    [string] $GitHubRepo = "TanishqBansal2645/AzureOptimize-Pro",
    [string] $CompanyName = "",

    [switch] $Update,
    [switch] $Remove,
    [switch] $SkipTests
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ─── Helper Functions ─────────────────────────────────────────────────────────

function Write-Step {
    param([int]$Step, [int]$Total, [string]$Message)
    Write-Host "`n[$Step/$Total] $Message..." -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "  v $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  ! $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "  x $Message" -ForegroundColor Red
}

function Show-Banner {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Blue
    Write-Host "    AzureOptimize Pro - Deployment Script" -ForegroundColor Blue
    Write-Host "    Cost Optimization Platform v1.1" -ForegroundColor Blue
    Write-Host "================================================================" -ForegroundColor Blue
    Write-Host ""
}

function Set-GitHubSecret {
    param(
        [string] $Token,
        [string] $Repo,
        [string] $Name,
        [string] $Value
    )

    $pythonCode = @'
import sys, json, base64, urllib.request
from nacl.public import SealedBox, PublicKey
token, repo, name = sys.argv[1], sys.argv[2], sys.argv[3]
value = sys.stdin.buffer.read()
req = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/actions/secrets/public-key",
    headers={"Authorization": f"Bearer {token}", "User-Agent": "AzureOptimize-Deploy"})
with urllib.request.urlopen(req) as r:
    pk = json.loads(r.read())
box = SealedBox(PublicKey(base64.b64decode(pk["key"])))
enc = base64.b64encode(box.encrypt(value)).decode()
data = json.dumps({"encrypted_value": enc, "key_id": pk["key_id"]}).encode()
urllib.request.urlopen(urllib.request.Request(
    f"https://api.github.com/repos/{repo}/actions/secrets/{name}",
    data=data, method="PUT",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
             "User-Agent": "AzureOptimize-Deploy"}))
'@

    $pyScript = Join-Path $env:TEMP "azopt_gh_secret.py"
    Set-Content -Path $pyScript -Value $pythonCode -Encoding utf8

    try {
        $valueBytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        $result = $valueBytes | python $pyScript $Token $Repo $Name 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Exit code $LASTEXITCODE`: $result"
        }
    }
    finally {
        Remove-Item $pyScript -Force -ErrorAction SilentlyContinue
    }
}

# ─── Role Assignment Helpers (use az rest — az role assignment is unreliable) ──
# Uses deterministic UUIDs so re-running the script never creates duplicate assignments.

function Add-RoleAssignment {
    param(
        [string] $PrincipalId,
        [string] $RoleDefinitionId,   # Built-in role GUID (stable across all tenants)
        [string] $Scope               # e.g. /subscriptions/xxx
    )
    # Deterministic assignment ID: same principal+role+scope always = same GUID (idempotent)
    $seed  = "$PrincipalId|$RoleDefinitionId|$Scope"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($seed)
    $hash  = [System.Security.Cryptography.MD5]::Create().ComputeHash($bytes)
    $hash[6] = ($hash[6] -band 0x0F) -bor 0x30   # version 3
    $hash[8] = ($hash[8] -band 0x3F) -bor 0x80   # variant RFC 4122
    $assignmentId = [System.Guid]::new($hash).ToString()

    $bodyObj = [ordered]@{
        properties = [ordered]@{
            roleDefinitionId = "${Scope}/providers/Microsoft.Authorization/roleDefinitions/${RoleDefinitionId}"
            principalId      = $PrincipalId
            principalType    = "ServicePrincipal"
        }
    }
    $body = $bodyObj | ConvertTo-Json -Compress -Depth 3
    $url  = "https://management.azure.com${Scope}/providers/Microsoft.Authorization/roleAssignments/${assignmentId}?api-version=2022-04-01"
    az rest --method PUT --url $url --body $body --headers "Content-Type=application/json" --output none 2>$null
}

function Remove-MIRoleAssignments {
    param(
        [string] $PrincipalId,
        [string] $SubscriptionId
    )
    $url      = "https://management.azure.com/subscriptions/${SubscriptionId}/providers/Microsoft.Authorization/roleAssignments?`$filter=principalId eq '${PrincipalId}'&api-version=2022-04-01"
    $response = az rest --method GET --url $url 2>$null | ConvertFrom-Json
    if ($response -and $response.value) {
        foreach ($ra in $response.value) {
            $delUrl = "https://management.azure.com$($ra.id)?api-version=2022-04-01"
            az rest --method DELETE --url $delUrl --output none 2>$null
        }
    }
}

# ─── Remove Mode ──────────────────────────────────────────────────────────────

if ($Remove) {
    Show-Banner
    Write-Host "  REMOVE MODE - This will delete all resources!" -ForegroundColor Red
    $confirm = Read-Host "Type 'yes' to confirm deletion of resource group '$ResourceGroupName'"
    if ($confirm -ne 'yes') {
        Write-Host "Deletion cancelled." -ForegroundColor Yellow
        exit 0
    }

    Write-Host "`nLogging in to tenant $TenantId..." -ForegroundColor Cyan
    az login --tenant $TenantId --output none

    Write-Host "Removing role assignments for Managed Identity..." -ForegroundColor Cyan
    $subscriptions = az account list --query "[?tenantId=='$TenantId'].id" -o tsv
    $miPrincipalId = az identity list --resource-group $ResourceGroupName --query "[?starts_with(name, 'mi-azureoptimize')].principalId" -o tsv 2>$null
    if ($miPrincipalId) {
        foreach ($subId in ($subscriptions -split "`n" | Where-Object { $_.Trim() })) {
            Remove-MIRoleAssignments -PrincipalId $miPrincipalId.Trim() -SubscriptionId $subId.Trim()
        }
    }

    Write-Host "Deleting resource group '$ResourceGroupName'..." -ForegroundColor Cyan
    az group delete --name $ResourceGroupName --yes --no-wait
    Write-Success "Resource group deletion initiated (may take a few minutes)"
    exit 0
}

# ─── Pre-flight checks ────────────────────────────────────────────────────────

Show-Banner
Write-Host "Running pre-flight checks..." -ForegroundColor Cyan

$tools = @{
    "az"   = "Azure CLI"
    "node" = "Node.js"
    "npm"  = "npm"
}

foreach ($tool in $tools.Keys) {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Fail "$($tools[$tool]) not found. Install it and retry."
        exit 1
    }
}
Write-Success "All required tools found (az, node, npm)"

$scriptDir = $PSScriptRoot
$projectRoot = Split-Path $scriptDir -Parent
$apiPath = Join-Path $projectRoot "api"
$frontendPath = Join-Path $projectRoot "frontend"
$bicepPath = Join-Path $scriptDir "main.bicep"

foreach ($path in @($apiPath, $frontendPath, $bicepPath)) {
    if (-not (Test-Path $path)) {
        Write-Fail "Required path not found: $path"
        exit 1
    }
}
Write-Success "Project structure verified"

if (-not $Update) {
    if (-not $AdminPrincipalId) {
        Write-Fail "AdminPrincipalId is required for fresh deployment"
        Write-Host "  Get your Object ID: az ad signed-in-user show --query 'id' -o tsv"
        exit 1
    }
    if (-not $AppClientId) {
        Write-Fail "AppClientId is required for fresh deployment"
        Write-Host "  Create an Entra App Registration first, then pass its client ID"
        exit 1
    }
}

$totalSteps = 6

# ─── Step 1: Login ────────────────────────────────────────────────────────────

Write-Step 1 $totalSteps "Logging in to Azure tenant"
try {
    $currentTenant = az account show --query "tenantId" -o tsv 2>$null
    if ($currentTenant -ne $TenantId) {
        az login --tenant $TenantId --output none
    }
    Write-Success "Logged in to tenant $TenantId"
}
catch {
    Write-Fail "Login failed: $_"
    exit 1
}

# ─── Steps 2–3: Infrastructure (skip if -Update) ──────────────────────────────

if (-not $Update) {
    Write-Step 2 $totalSteps "Provisioning infrastructure (Bicep)"
    Write-Host "  This may take 5-10 minutes..." -ForegroundColor Gray

    try {
        az group create --name $ResourceGroupName --location $Location --output none

        $deployOutput = az deployment group create `
            --resource-group $ResourceGroupName `
            --template-file $bicepPath `
            --parameters "adminPrincipalId=$AdminPrincipalId" "appClientId=$AppClientId" "tenantId=$TenantId" `
            --output json --only-show-errors 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "Bicep deployment failed: $($deployOutput -join "`n")"
        }

        $deployOutput = ($deployOutput | Where-Object { $_ -notmatch "^WARNING" }) -join "" | ConvertFrom-Json

        $outputs = $deployOutput.properties.outputs
        $script:dashboardUrl = $outputs.dashboardUrl.value
        $script:functionAppUrl = $outputs.functionAppUrl.value
        $script:managedIdentityPrincipalId = $outputs.managedIdentityPrincipalId.value
        $script:storageAccountName = $outputs.storageAccountName.value
        $script:keyVaultUri = $outputs.keyVaultUri.value
        $script:functionAppName = ($script:functionAppUrl -replace "https://", "" -replace ".azurewebsites.net", "")

        Write-Success "Infrastructure deployed"
    }
    catch {
        Write-Fail "Bicep deployment failed: $_"
        exit 1
    }

    Write-Step 3 $totalSteps "Assigning roles on all subscriptions"
    try {
        $subscriptions = az account list --query "[?state=='Enabled' && tenantId=='$TenantId'].id" -o tsv
        $assignedCount = 0
        foreach ($subId in ($subscriptions -split "`n" | Where-Object { $_ -and $_.Trim() })) {
            $subId = $subId.Trim()
            try {
                $miId  = $script:managedIdentityPrincipalId
                $scope = "/subscriptions/$subId"
                # Reader — resource inspection across all subscriptions
                Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "acdd72a7-3385-48ef-bd42-f606fba81ae7" -Scope $scope
                # Cost Management Reader — billing and cost data
                Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "72fafb9e-0641-4937-9268-a91bfd8191a6" -Scope $scope
                # Monitoring Reader — Azure Monitor metrics
                Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "43d0d8ad-25c7-4714-9337-8ba259a9fe05" -Scope $scope
                # Contributor — write operations for automated remediation (VM resize, AHB, disk downgrade, etc.)
                Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "b24988ac-6180-42a0-ab88-20f7382dd24c" -Scope $scope
                $assignedCount++
            }
            catch {
                Write-Warn "Could not assign roles on $subId"
            }
        }
        Write-Success "Roles assigned on $assignedCount subscription(s)"
    }
    catch {
        Write-Warn "Role assignment step had issues: $_"
    }
}
else {
    Write-Step 2 $totalSteps "Reading existing deployment outputs"
    try {
        $deployOutput = az deployment group show `
            --resource-group $ResourceGroupName `
            --name "main" `
            --output json 2>$null | ConvertFrom-Json

        if (-not $deployOutput) {
            $script:functionAppName = az functionapp list --resource-group $ResourceGroupName --query "[0].name" -o tsv
            $script:functionAppUrl = "https://$($script:functionAppName).azurewebsites.net"
            $script:dashboardUrl = "https://$(az staticwebapp list --resource-group $ResourceGroupName --query '[0].defaultHostname' -o tsv)"
            $script:storageAccountName = az storage account list --resource-group $ResourceGroupName --query "[0].name" -o tsv
            $script:keyVaultUri = az keyvault list --resource-group $ResourceGroupName --query "[0].properties.vaultUri" -o tsv
        }
        else {
            $outputs = $deployOutput.properties.outputs
            $script:dashboardUrl = $outputs.dashboardUrl.value
            $script:functionAppUrl = $outputs.functionAppUrl.value
            $script:storageAccountName = $outputs.storageAccountName.value
            $script:keyVaultUri = $outputs.keyVaultUri.value
            $script:functionAppName = ($script:functionAppUrl -replace "https://", "" -replace ".azurewebsites.net", "")
        }
        Write-Success "Existing deployment info loaded"
    }
    catch {
        Write-Warn "Could not read all deployment outputs, continuing anyway: $_"
    }

    Write-Step 3 $totalSteps "Skipping infrastructure (update mode)"
    Write-Success "Skipped (update mode)"
}

# ─── Company Branding (optional) ─────────────────────────────────────────────

$trimmedCompanyName = $CompanyName.Trim()
if ($trimmedCompanyName -and $script:functionAppName) {
    Write-Host "  Setting company branding on Function App..." -ForegroundColor Gray
    try {
        az functionapp config appsettings set `
            --name $script:functionAppName `
            --resource-group $ResourceGroupName `
            --settings "COMPANY_NAME=$trimmedCompanyName" `
            --output none 2>$null
        Write-Success "Company name configured: $trimmedCompanyName"
    }
    catch {
        Write-Warn "Could not set COMPANY_NAME: $_"
    }
}

# ─── Step 4: Configure GitHub Actions deployment ──────────────────────────────

Write-Step 4 $totalSteps "Configuring GitHub Actions deployment"

$swaName = az staticwebapp list --resource-group $ResourceGroupName --query "[0].name" -o tsv
$deployToken = az staticwebapp secrets list --name $swaName --resource-group $ResourceGroupName --query "properties.apiKey" -o tsv
$publishProfile = az functionapp deployment list-publishing-profiles --name $script:functionAppName --resource-group $ResourceGroupName --xml

if ($GitHubToken) {
    Write-Host "  Setting GitHub secrets..." -ForegroundColor Gray

    try {
        Set-GitHubSecret -Token $GitHubToken -Repo $GitHubRepo -Name "AZURE_STATIC_WEB_APPS_API_TOKEN" -Value $deployToken
        Write-Host "  v AZURE_STATIC_WEB_APPS_API_TOKEN" -ForegroundColor Green

        Set-GitHubSecret -Token $GitHubToken -Repo $GitHubRepo -Name "AZURE_FUNCTIONAPP_PUBLISH_PROFILE" -Value $publishProfile
        Write-Host "  v AZURE_FUNCTIONAPP_PUBLISH_PROFILE" -ForegroundColor Green
    }
    catch {
        Write-Fail "Failed to set GitHub secrets: $_"
        Write-Host "  Ensure Python + PyNaCl is installed: pip install PyNaCl" -ForegroundColor Gray
        exit 1
    }

    Write-Host "  Triggering deployment workflows..." -ForegroundColor Gray
    $ghHeaders = @{
        Authorization          = "Bearer $GitHubToken"
        Accept                 = "application/vnd.github.v3+json"
        "X-GitHub-Api-Version" = "2022-11-28"
    }
    try {
        Invoke-RestMethod -Method POST -Uri "https://api.github.com/repos/$GitHubRepo/actions/workflows/deploy-api.yml/dispatches" `
            -Headers $ghHeaders -Body '{"ref":"main"}' -ContentType "application/json" | Out-Null
        Invoke-RestMethod -Method POST -Uri "https://api.github.com/repos/$GitHubRepo/actions/workflows/deploy-frontend.yml/dispatches" `
            -Headers $ghHeaders -Body '{"ref":"main"}' -ContentType "application/json" | Out-Null
        Write-Success "Deployment workflows triggered"
        Write-Host "  Track progress: https://github.com/$GitHubRepo/actions" -ForegroundColor Gray
        Write-Host "  Waiting 4 minutes for deployment to complete..." -ForegroundColor Gray
        Start-Sleep -Seconds 240
    }
    catch {
        Write-Warn "Could not trigger workflows automatically: $_"
        Write-Host "  Manually run: https://github.com/$GitHubRepo/actions" -ForegroundColor Cyan
        exit 0
    }
}
else {
    # Save credentials to temp files for manual GitHub setup
    $secretsDir = Join-Path $env:TEMP "azopt-github-secrets"
    New-Item -ItemType Directory -Path $secretsDir -Force | Out-Null
    Set-Content -Path (Join-Path $secretsDir "AZURE_STATIC_WEB_APPS_API_TOKEN.txt") -Value $deployToken -Encoding utf8
    Set-Content -Path (Join-Path $secretsDir "AZURE_FUNCTIONAPP_PUBLISH_PROFILE.xml") -Value $publishProfile -Encoding utf8

    Write-Success "Deployment credentials retrieved"
    Write-Host ""
    Write-Host "  ─── ACTION REQUIRED ────────────────────────────────────────" -ForegroundColor Yellow
    Write-Host "  Add 2 secrets at: https://github.com/$GitHubRepo/settings/secrets/actions" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1. AZURE_STATIC_WEB_APPS_API_TOKEN" -ForegroundColor White
    Write-Host "     $(Join-Path $secretsDir 'AZURE_STATIC_WEB_APPS_API_TOKEN.txt')" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  2. AZURE_FUNCTIONAPP_PUBLISH_PROFILE" -ForegroundColor White
    Write-Host "     $(Join-Path $secretsDir 'AZURE_FUNCTIONAPP_PUBLISH_PROFILE.xml')" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  After adding, push a commit or run workflows manually." -ForegroundColor Yellow
    Write-Host "  ────────────────────────────────────────────────────────────" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  TIP: Next time pass -GitHubToken to automate this step." -ForegroundColor Gray

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "    Infrastructure ready! Complete GitHub setup above." -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    exit 0
}

# ─── Step 5: Health check ─────────────────────────────────────────────────────

Write-Step 5 $totalSteps "API health check"
$maxRetries = 8
$retryDelay = 15
$healthOk = $false

for ($i = 1; $i -le $maxRetries; $i++) {
    try {
        $healthResponse = Invoke-RestMethod -Uri "$($script:functionAppUrl)/api/health" -Method GET -TimeoutSec 20
        if ($healthResponse.status -eq "healthy") {
            Write-Success "API is healthy (tenant: $($healthResponse.environment.tenantId))"
            $healthOk = $true
            break
        }
        else {
            Write-Warn "Unexpected status: $($healthResponse.status). Retrying ($i/$maxRetries)..."
        }
    }
    catch {
        if ($i -lt $maxRetries) {
            Write-Host "  Health check attempt $i/$maxRetries failed. Retrying in ${retryDelay}s..." -ForegroundColor Gray
            Start-Sleep -Seconds $retryDelay
        }
    }
}

if (-not $healthOk) {
    Write-Warn "Health check did not pass after $maxRetries attempts. API may still be starting."
    Write-Host "  Check deployment logs: https://github.com/$GitHubRepo/actions" -ForegroundColor Gray
}

# ─── Step 6: Smoke tests ──────────────────────────────────────────────────────

if (-not $SkipTests) {
    Write-Step 6 $totalSteps "Running automated smoke tests"
    $testScript = Join-Path $scriptDir "Test-Deploy.ps1"

    if (Test-Path $testScript) {
        try {
            & $testScript -ApiUrl "$($script:functionAppUrl)/api" -TenantId $TenantId
            Write-Success "All smoke tests passed"
        }
        catch {
            Write-Warn "Some smoke tests failed: $_"
            Write-Host "  Run Test-Deploy.ps1 manually to diagnose issues" -ForegroundColor Gray
        }
    }
    else {
        Write-Warn "Test script not found. Skipping."
    }
}
else {
    Write-Step 6 $totalSteps "Skipping tests (-SkipTests specified)"
    Write-Success "Skipped"
}

# ─── Summary ─────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "    AzureOptimize Pro deployed successfully!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard URL  : $($script:dashboardUrl)" -ForegroundColor White
Write-Host "  API URL        : $($script:functionAppUrl)/api" -ForegroundColor White
Write-Host "  Resource Group : $ResourceGroupName" -ForegroundColor White
Write-Host "  Key Vault URI  : $($script:keyVaultUri)" -ForegroundColor White
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
if (-not $Update) {
    Write-Host "  1. Update Entra App redirect URI:" -ForegroundColor White
    Write-Host "     az ad app update --id $AppClientId --web-redirect-uris 'http://localhost:3000' '$($script:dashboardUrl)'" -ForegroundColor Gray
}
Write-Host "  2. Open the dashboard and sign in with your Microsoft account" -ForegroundColor White
Write-Host "  3. First cost data appears within 4 hours (timer-triggered)" -ForegroundColor White
Write-Host "  4. Future code updates deploy automatically on git push" -ForegroundColor White
if (-not $trimmedCompanyName) {
    Write-Host ""
    Write-Host "  TIP: Set company branding anytime:" -ForegroundColor Gray
    Write-Host "  .\Deploy-AzureCostOptimize.ps1 -TenantId $TenantId -Update -CompanyName 'Your Company'" -ForegroundColor Gray
}
Write-Host ""
if (-not $Update) {
    Write-Host "  Record these values:" -ForegroundColor Yellow
    Write-Host "  - Dashboard URL    : $($script:dashboardUrl)" -ForegroundColor Yellow
    Write-Host "  - Storage Account  : $($script:storageAccountName)" -ForegroundColor Yellow
    Write-Host "  - Tenant ID        : $TenantId" -ForegroundColor Yellow
    Write-Host "  - App Client ID    : $AppClientId" -ForegroundColor Yellow
    Write-Host "  - Admin Object ID  : $AdminPrincipalId" -ForegroundColor Yellow
}
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
