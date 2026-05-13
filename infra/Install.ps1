<#
.SYNOPSIS
    One-command installer for AzureOptimize Pro  -  run directly from Azure Cloud Shell.

.DESCRIPTION
    Handles all three deployment lifecycle operations from a single script:

    NEW INSTALL (default):
        irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1 | iex

    UPDATE (re-apply RBAC, verify health, update branding):
        & ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1))) -Update

    REMOVE (tear down all Azure resources):
        & ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1))) -Remove

.PARAMETER Update
    Re-apply RBAC roles, verify the deployment is healthy, and optionally update branding.
    Skips Entra setup and infrastructure re-deployment. Safe to run at any time.

.PARAMETER Remove
    Delete all Azure resources. Prompts for confirmation before proceeding.
    Does NOT delete the Entra App Registration  -  remove that manually if needed.

.PARAMETER GitHubToken
    GitHub Personal Access Token to automatically configure GitHub Actions secrets,
    environment variables, and trigger the first deployment.
    Required scopes: repo (classic PAT) or Actions read/write + Environments (fine-grained).
    Install PyNaCl first: pip install PyNaCl
    Only used during new installs (ignored for -Update and -Remove).

.PARAMETER CompanyName
    Optional company/client name shown in the header subtitle only.
    The sidebar always shows "AzureOptimize Pro" regardless of this setting.
    If omitted, no subtitle is shown in the header.

.PARAMETER DeveloperName
    Optional developer/consultant name shown on the login page footer.
    Falls back to "Tanishq Bansal" if omitted.

.PARAMETER Location
    Azure region for resource deployment. Default: eastus

.PARAMETER ResourceGroupName
    Resource group name. Default: rg-azureoptimize

.PARAMETER SkipTests
    Skip smoke tests after deployment.
#>

param(
    [switch] $Update,
    [switch] $Remove,
    [string] $GitHubToken = "",
    [string] $CompanyName = "",
    [string] $DeveloperName = "",
    [string] $Location = "eastus",
    [string] $ResourceGroupName = "rg-azureoptimize",
    [string] $RepoUrl = "https://github.com/TanishqBansal2645/AzureOptimize-Pro.git",
    [string] $Branch = "main",
    [switch] $SkipTests
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# --- Banner -------------------------------------------------------------------

Write-Host ""
Write-Host "================================================================" -ForegroundColor Blue
Write-Host "    AzureOptimize Pro - Cloud Shell Installer" -ForegroundColor Blue
if ($Update)      { Write-Host "    Mode: UPDATE" -ForegroundColor Yellow }
elseif ($Remove)  { Write-Host "    Mode: REMOVE" -ForegroundColor Red }
else              { Write-Host "    Mode: NEW INSTALL" -ForegroundColor Green }
Write-Host "================================================================" -ForegroundColor Blue
Write-Host ""

# --- Check prerequisites ------------------------------------------------------

Write-Host "Checking prerequisites..." -ForegroundColor Cyan

$requiredTools = if ($Remove) { @("az", "git") } else { @("az", "node", "npm", "git") }
$missing = @()
foreach ($tool in $requiredTools) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $missing += $tool }
}

if ($missing.Count -gt 0) {
    Write-Host "  Missing required tools: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "  Azure Cloud Shell has all these pre-installed." -ForegroundColor Yellow
    exit 1
}
Write-Host "  All required tools found." -ForegroundColor Green

# --- Verify Azure login -------------------------------------------------------

Write-Host "`nVerifying Azure login..." -ForegroundColor Cyan
try {
    $account = az account show --output json 2>$null | ConvertFrom-Json
    if (-not $account) { throw "Not logged in" }
    $TenantId = $account.tenantId
    Write-Host "  Logged in as: $($account.user.name)" -ForegroundColor Green
    Write-Host "  Tenant: $TenantId" -ForegroundColor Green
    Write-Host "  Subscription: $($account.name)" -ForegroundColor Green
}
catch {
    Write-Host "  Not logged in to Azure. Run 'az login' first." -ForegroundColor Red
    exit 1
}

# --- Clone / update repository ------------------------------------------------

$installDir = Join-Path $HOME "azureoptimize"

Write-Host "`nSetting up repository at $installDir..." -ForegroundColor Cyan

if (Test-Path (Join-Path $installDir ".git")) {
    Write-Host "  Pulling latest changes..." -ForegroundColor Gray
    Push-Location $installDir
    git fetch origin $Branch --quiet
    git checkout $Branch --quiet
    git reset --hard "origin/$Branch" --quiet
    Pop-Location
    Write-Host "  Repository updated." -ForegroundColor Green
}
else {
    Write-Host "  Cloning repository..." -ForegroundColor Gray
    git clone --branch $Branch --single-branch $RepoUrl $installDir --quiet
    Write-Host "  Repository cloned." -ForegroundColor Green
}

$infraPath = Join-Path $installDir "infra"
$deployScript = Join-Path $infraPath "Deploy-AzureCostOptimize.ps1"

# --- REMOVE mode --------------------------------------------------------------

if ($Remove) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host "  Removing AzureOptimize Pro from tenant $TenantId" -ForegroundColor Red
    Write-Host "  Resource group: $ResourceGroupName" -ForegroundColor Red
    Write-Host "================================================================" -ForegroundColor Red

    Push-Location $infraPath
    try {
        & $deployScript -TenantId $TenantId -ResourceGroupName $ResourceGroupName -Remove
    }
    finally {
        Pop-Location
    }
    exit 0
}

# --- UPDATE mode --------------------------------------------------------------

if ($Update) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  Updating AzureOptimize Pro in tenant $TenantId" -ForegroundColor Cyan
    Write-Host "  Resource group: $ResourceGroupName" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan

    $deployArgs = @{
        TenantId          = $TenantId
        ResourceGroupName = $ResourceGroupName
        Update            = $true
    }
    if ($CompanyName)   { $deployArgs['CompanyName']   = $CompanyName }
    if ($DeveloperName) { $deployArgs['DeveloperName'] = $DeveloperName }
    if ($SkipTests)     { $deployArgs['SkipTests']     = $true }

    Push-Location $infraPath
    try {
        & $deployScript @deployArgs
    }
    finally {
        Pop-Location
    }
    exit 0
}

# --- NEW INSTALL mode ---------------------------------------------------------

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  STEP 1 of 2: Entra App Registration" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

$entraScript = Join-Path $infraPath "Setup-Entra.ps1"
if (-not (Test-Path $entraScript)) {
    Write-Host "  Setup-Entra.ps1 not found." -ForegroundColor Red
    exit 1
}

Write-Host "  Running Setup-Entra.ps1..." -ForegroundColor Gray
$entraOutput = & $entraScript -TenantId $TenantId 2>&1
$entraExitCode = $LASTEXITCODE
$entraOutput | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }

if ($entraExitCode -ne 0) {
    Write-Host ""
    Write-Host "  Entra setup failed (exit code $entraExitCode). See errors above." -ForegroundColor Red
    exit 1
}

$AppClientId      = ($entraOutput | Select-String "##RESULT AppClientId=([0-9a-f-]+)"      | ForEach-Object { $_.Matches[0].Groups[1].Value }) | Select-Object -Last 1
$AdminPrincipalId = ($entraOutput | Select-String "##RESULT AdminPrincipalId=([0-9a-f-]+)" | ForEach-Object { $_.Matches[0].Groups[1].Value }) | Select-Object -Last 1

if (-not $AdminPrincipalId) {
    $AdminPrincipalId = az ad signed-in-user show --query "id" -o tsv 2>$null
}

Write-Host "  App Client ID     : $AppClientId" -ForegroundColor Green
Write-Host "  Admin Principal ID: $AdminPrincipalId" -ForegroundColor Green

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  STEP 2 of 2: Infrastructure and Code Deployment" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

$deployArgs = @{
    TenantId          = $TenantId
    AdminPrincipalId  = $AdminPrincipalId
    AppClientId       = $AppClientId
    Location          = $Location
    ResourceGroupName = $ResourceGroupName
}
if ($GitHubToken)   { $deployArgs['GitHubToken']   = $GitHubToken }
if ($CompanyName)   { $deployArgs['CompanyName']   = $CompanyName }
if ($DeveloperName) { $deployArgs['DeveloperName'] = $DeveloperName }
if ($SkipTests)     { $deployArgs['SkipTests']     = $true }

Push-Location $infraPath
try {
    & $deployScript @deployArgs
}
finally {
    Pop-Location
}

# --- Done ---------------------------------------------------------------------

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "    Installation complete!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Future operations (run from Cloud Shell):" -ForegroundColor Cyan
Write-Host ""
Write-Host "  UPDATE (after code changes or RBAC drift):" -ForegroundColor White
Write-Host "  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1))) -Update" -ForegroundColor Gray
Write-Host ""
Write-Host "  REMOVE (decommission the tool completely):" -ForegroundColor White
Write-Host "  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1))) -Remove" -ForegroundColor Gray
Write-Host ""
