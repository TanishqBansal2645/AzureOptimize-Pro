<#
.SYNOPSIS
    Deploys AzureOptimize Pro to a client Azure tenant.

.DESCRIPTION
    Deploys the full AzureOptimize Pro stack:
    - Azure Static Web App (dashboard)
    - Azure Function App (API)
    - Azure Storage Account (data + reports)
    - Azure Key Vault (secrets)
    - User-Assigned Managed Identity
    - Role assignments across all subscriptions

    After infrastructure is provisioned, automatically:
    - Builds and deploys the API (TypeScript compile + zip deploy)
    - Builds and deploys the frontend (Next.js static export + SWA deploy)
    - Runs automated smoke tests to verify everything is working

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

.PARAMETER Update
    Switch to redeploy app code only (preserves data, skips infrastructure).

.PARAMETER Remove
    Switch to remove all deployed resources.

.PARAMETER SkipTests
    Skip the automated smoke tests after deployment.

.EXAMPLE
    .\Deploy-AzureCostOptimize.ps1 -TenantId "xxx" -AdminPrincipalId "yyy" -AppClientId "zzz"
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
    Write-Host "    Cost Optimization Platform v1.0" -ForegroundColor Blue
    Write-Host "================================================================" -ForegroundColor Blue
    Write-Host ""
}

function Invoke-Step {
    param([string]$Name, [scriptblock]$Action)
    try {
        & $Action
        Write-Success $Name
    }
    catch {
        Write-Fail "$Name failed: $_"
        throw
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
    $subscriptions = az account list --query "[].id" -o tsv
    foreach ($subId in $subscriptions) {
        $mi = az identity list --resource-group $ResourceGroupName --subscription $subId --query "[?starts_with(name, 'mi-azureoptimize')].principalId" -o tsv 2>$null
        if ($mi) {
            az role assignment delete --assignee $mi --subscription $subId --output none 2>$null
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

# Check required tools
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

# Verify project structure
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

# Validate required parameters
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

$totalSteps = 8

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

# ─── Step 2: Infrastructure (skip if -Update) ─────────────────────────────────

if (-not $Update) {
    Write-Step 2 $totalSteps "Provisioning infrastructure (Bicep)"
    Write-Host "  This may take 5-10 minutes..." -ForegroundColor Gray

    try {
        az group create --name $ResourceGroupName --location $Location --output none

        $deployOutput = az deployment group create `
            --resource-group $ResourceGroupName `
            --template-file $bicepPath `
            --parameters "adminPrincipalId=$AdminPrincipalId" "appClientId=$AppClientId" "tenantId=$TenantId" `
            --output json 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "Bicep deployment failed: $deployOutput"
        }

        $deployOutput = $deployOutput | ConvertFrom-Json

        $outputs = $deployOutput.properties.outputs
        $script:dashboardUrl = $outputs.dashboardUrl.value
        $script:functionAppUrl = $outputs.functionAppUrl.value
        $script:managedIdentityPrincipalId = $outputs.managedIdentityPrincipalId.value
        $script:storageAccountName = $outputs.storageAccountName.value
        $script:keyVaultUri = $outputs.keyVaultUri.value

        # Derive function app name from URL
        $script:functionAppName = ($script:functionAppUrl -replace "https://", "" -replace ".azurewebsites.net", "")

        Write-Success "Infrastructure deployed"
    }
    catch {
        Write-Fail "Bicep deployment failed: $_"
        exit 1
    }

    # Step 3: Assign roles
    Write-Step 3 $totalSteps "Assigning Reader roles on all subscriptions"
    try {
        $subscriptions = az account list --query "[?state=='Enabled'].id" -o tsv
        $assignedCount = 0
        foreach ($subId in ($subscriptions -split "`n" | Where-Object { $_ -and $_.Trim() })) {
            $subId = $subId.Trim()
            try {
                az role assignment create --assignee $script:managedIdentityPrincipalId --role "Reader" --scope "/subscriptions/$subId" --output none 2>$null
                az role assignment create --assignee $script:managedIdentityPrincipalId --role "Cost Management Reader" --scope "/subscriptions/$subId" --output none 2>$null
                az role assignment create --assignee $script:managedIdentityPrincipalId --role "Monitoring Reader" --scope "/subscriptions/$subId" --output none 2>$null
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
    # On -Update: read existing outputs
    Write-Step 2 $totalSteps "Reading existing deployment outputs"
    try {
        $deployOutput = az deployment group show `
            --resource-group $ResourceGroupName `
            --name "main" `
            --output json 2>$null | ConvertFrom-Json

        if (-not $deployOutput) {
            # Try to get from resource list
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

# ─── Step 4: Build & Deploy API ───────────────────────────────────────────────

Write-Step 4 $totalSteps "Building and deploying API"
Write-Host "  Compiling TypeScript..." -ForegroundColor Gray

$zipPath = Join-Path $env:TEMP "azureoptimize-api.zip"

try {
    Push-Location $apiPath

    # Install all deps (including dev for TypeScript compile)
    npm install --silent
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

    # Compile TypeScript
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "TypeScript compilation failed - check for type errors above" }

    # Install production-only deps for packaging
    Write-Host "  Packaging for deployment..." -ForegroundColor Gray

    # Create a temp staging directory
    $stagingDir = Join-Path $env:TEMP "azureoptimize-api-staging"
    if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
    New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

    # Copy everything needed
    Copy-Item -Path (Join-Path $apiPath "dist") -Destination (Join-Path $stagingDir "dist") -Recurse
    Copy-Item -Path (Join-Path $apiPath "package.json") -Destination $stagingDir
    Copy-Item -Path (Join-Path $apiPath "host.json") -Destination $stagingDir

    # Install production dependencies in staging
    Push-Location $stagingDir
    npm install --production --silent
    if ($LASTEXITCODE -ne 0) { throw "npm install --production failed" }
    Pop-Location

    # Create zip
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path "$stagingDir\*" -DestinationPath $zipPath -CompressionLevel Optimal

    # Deploy to Azure
    Write-Host "  Deploying to Function App '$($script:functionAppName)'..." -ForegroundColor Gray
    az functionapp deployment source config-zip `
        --resource-group $ResourceGroupName `
        --name $script:functionAppName `
        --src $zipPath `
        --output none

    if ($LASTEXITCODE -ne 0) { throw "Function App zip deploy failed" }

    Pop-Location
    Write-Success "API built and deployed"
}
catch {
    if ((Get-Location).Path -ne $projectRoot) { Pop-Location }
    Write-Fail "API deployment failed: $_"
    exit 1
}
finally {
    # Cleanup temp files
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue }
}

# ─── Step 5: Build & Deploy Frontend ──────────────────────────────────────────

Write-Step 5 $totalSteps "Building and deploying frontend"

try {
    Push-Location $frontendPath

    # Write production env file
    $envContent = @"
NEXT_PUBLIC_AZURE_CLIENT_ID=$AppClientId
NEXT_PUBLIC_AZURE_TENANT_ID=$TenantId
NEXT_PUBLIC_AZURE_REDIRECT_URI=$($script:dashboardUrl)
NEXT_PUBLIC_API_BASE_URL=$($script:functionAppUrl)/api
NEXT_PUBLIC_ADMIN_PRINCIPAL_ID=$AdminPrincipalId
"@
    Set-Content -Path (Join-Path $frontendPath ".env.production") -Value $envContent -Encoding utf8

    Write-Host "  Installing frontend dependencies..." -ForegroundColor Gray
    npm install --silent
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

    Write-Host "  Building Next.js static export..." -ForegroundColor Gray
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Next.js build failed" }

    # Deploy to Static Web App
    $swaName = az staticwebapp list --resource-group $ResourceGroupName --query "[0].name" -o tsv
    $deployToken = az staticwebapp secrets list --name $swaName --resource-group $ResourceGroupName --query "properties.apiKey" -o tsv

    if (-not $deployToken) {
        throw "Could not retrieve Static Web App deployment token"
    }

    # Check for SWA CLI
    $swaCli = Get-Command swa -ErrorAction SilentlyContinue
    if (-not $swaCli) {
        Write-Host "  Installing SWA CLI..." -ForegroundColor Gray
        npm install -g @azure/static-web-apps-cli --silent
    }

    Write-Host "  Deploying to Static Web App '$swaName'..." -ForegroundColor Gray
    swa deploy ./out --deployment-token $deployToken --env production

    if ($LASTEXITCODE -ne 0) { throw "SWA deploy failed" }

    Pop-Location
    Write-Success "Frontend built and deployed"
}
catch {
    if ((Get-Location).Path -ne $projectRoot) { Pop-Location }
    Write-Warn "Frontend deployment failed: $_"
    Write-Host "  You can deploy the frontend manually later with 'swa deploy'" -ForegroundColor Gray
}

# ─── Step 6: Wait for API warm-up ─────────────────────────────────────────────

Write-Step 6 $totalSteps "Waiting for API to warm up (30s)"
Write-Host "  Azure Functions on Consumption plan need ~30s to start..." -ForegroundColor Gray
Start-Sleep -Seconds 30

# ─── Step 7: Health check ─────────────────────────────────────────────────────

Write-Step 7 $totalSteps "API health check"
$maxRetries = 5
$retryDelay = 15
$healthOk = $false

for ($i = 1; $i -le $maxRetries; $i++) {
    try {
        $healthResponse = Invoke-RestMethod -Uri "$($script:functionAppUrl)/api/health" -Method GET -TimeoutSec 20
        if ($healthResponse.status -eq "healthy") {
            Write-Success "API is healthy (tenant: $($healthResponse.environment.tenantId), storage: $($healthResponse.environment.storageAccount))"
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
}

# ─── Step 8: Automated Tests ──────────────────────────────────────────────────

if (-not $SkipTests) {
    Write-Step 8 $totalSteps "Running automated smoke tests"
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
        Write-Warn "Test script not found at $testScript. Skipping tests."
    }
}
else {
    Write-Step 8 $totalSteps "Skipping tests (-SkipTests specified)"
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
    Write-Host "  1. Update Entra App redirect URI to: $($script:dashboardUrl)/.auth/login/aad/callback" -ForegroundColor White
    Write-Host "     Command: az ad app update --id $AppClientId --web-redirect-uris '$($script:dashboardUrl)/.auth/login/aad/callback'" -ForegroundColor Gray
}
Write-Host "  2. Open the dashboard and sign in with your Microsoft account" -ForegroundColor White
Write-Host "  3. First cost data appears within 4 hours (timer-triggered)" -ForegroundColor White
Write-Host "  4. To trigger data collection immediately, use the Admin refresh endpoints" -ForegroundColor White
Write-Host ""
Write-Host "  Record these values for the client:" -ForegroundColor Yellow
Write-Host "  - Dashboard URL    : $($script:dashboardUrl)" -ForegroundColor Yellow
Write-Host "  - Storage Account  : $($script:storageAccountName)" -ForegroundColor Yellow
if (-not $Update) {
    Write-Host "  - Tenant ID        : $TenantId" -ForegroundColor Yellow
    Write-Host "  - App Client ID    : $AppClientId" -ForegroundColor Yellow
    Write-Host "  - Admin Object ID  : $AdminPrincipalId" -ForegroundColor Yellow
}
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
