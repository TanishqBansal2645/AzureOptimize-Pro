<#
.SYNOPSIS
    One-command installer for AzureOptimize Pro — run directly from Azure Cloud Shell.

.DESCRIPTION
    Downloads the AzureOptimize Pro repository, then runs the full automated setup:
      1. Clones (or updates) the GitHub repository
      2. Runs Setup-Entra.ps1 to create the Entra App Registration
      3. Runs Deploy-AzureCostOptimize.ps1 to provision infrastructure and deploy code

    Designed to be invoked from Azure Cloud Shell with a single command:

        irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1 | iex

    Or with parameters:

        $params = @{ Location = "westeurope"; ResourceGroupName = "rg-myoptimize" }
        irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1 | iex

.PARAMETER RepoUrl
    GitHub repository HTTPS clone URL.
    Default: https://github.com/TanishqBansal2645/AzureOptimize-Pro.git

.PARAMETER Branch
    Git branch to clone. Default: main

.PARAMETER Location
    Azure region for resource deployment. Default: eastus

.PARAMETER ResourceGroupName
    Resource group name. Default: rg-azureoptimize

.PARAMETER SkipTests
    Skip smoke tests after deployment.

.EXAMPLE
    # Full install (interactive — prompts for confirmation at each step)
    irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1 | iex

.EXAMPLE
    # Specify region and resource group
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/TanishqBansal2645/AzureOptimize-Pro/main/infra/Install.ps1))) -Location "westeurope" -ResourceGroupName "rg-costopt"
#>

param(
    [string] $RepoUrl = "https://github.com/TanishqBansal2645/AzureOptimize-Pro.git",
    [string] $Branch = "main",
    [string] $Location = "eastus",
    [string] $ResourceGroupName = "rg-azureoptimize",
    [switch] $SkipTests
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ─── Banner ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "================================================================" -ForegroundColor Blue
Write-Host "    AzureOptimize Pro - Cloud Shell Installer" -ForegroundColor Blue
Write-Host "    Automated setup from GitHub repository" -ForegroundColor Blue
Write-Host "================================================================" -ForegroundColor Blue
Write-Host ""

# ─── Check prerequisites ──────────────────────────────────────────────────────

Write-Host "Checking prerequisites..." -ForegroundColor Cyan

$missing = @()
foreach ($tool in @("az", "node", "npm", "git")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        $missing += $tool
    }
}

if ($missing.Count -gt 0) {
    Write-Host "  Missing required tools: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "  Azure Cloud Shell has all these pre-installed." -ForegroundColor Yellow
    Write-Host "  If running locally, install the missing tools and retry." -ForegroundColor Yellow
    exit 1
}

Write-Host "  All required tools found (az, node, npm, git)." -ForegroundColor Green

# ─── Verify Azure login ───────────────────────────────────────────────────────

Write-Host "`nVerifying Azure login..." -ForegroundColor Cyan
try {
    $account = az account show --output json 2>$null | ConvertFrom-Json
    if (-not $account) { throw "Not logged in" }
    $TenantId = $account.tenantId
    Write-Host "  Logged in as: $($account.user.name)" -ForegroundColor Green
    Write-Host "  Tenant: $TenantId" -ForegroundColor Green
    Write-Host "  Default subscription: $($account.name) ($($account.id))" -ForegroundColor Green
}
catch {
    Write-Host "  Not logged in to Azure. Run 'az login' first." -ForegroundColor Red
    exit 1
}

# ─── Clone / update repository ────────────────────────────────────────────────

$installDir = Join-Path $HOME "azureoptimize"

Write-Host "`nSetting up repository..." -ForegroundColor Cyan

if (Test-Path (Join-Path $installDir ".git")) {
    Write-Host "  Repository exists at $installDir — pulling latest changes..." -ForegroundColor Gray
    Push-Location $installDir
    git fetch origin $Branch --quiet
    git checkout $Branch --quiet
    git reset --hard "origin/$Branch" --quiet
    Pop-Location
    Write-Host "  Repository updated." -ForegroundColor Green
}
else {
    Write-Host "  Cloning $RepoUrl (branch: $Branch) to $installDir..." -ForegroundColor Gray
    git clone --branch $Branch --single-branch $RepoUrl $installDir --quiet
    Write-Host "  Repository cloned." -ForegroundColor Green
}

$infraPath = Join-Path $installDir "infra"

# ─── Step 1: Entra App Registration ───────────────────────────────────────────

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  STEP 1 of 2: Entra App Registration" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

$entraScript = Join-Path $infraPath "Setup-Entra.ps1"
if (-not (Test-Path $entraScript)) {
    Write-Host "  Setup-Entra.ps1 not found at $entraScript" -ForegroundColor Red
    exit 1
}

Write-Host "  Running Setup-Entra.ps1..." -ForegroundColor Gray

# Capture the output to extract AppClientId and AdminPrincipalId
$entraOutput = & $entraScript -TenantId $TenantId 2>&1
$entraExitCode = $LASTEXITCODE
$entraOutput | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }

# Stop if Setup-Entra failed (e.g. insufficient Entra permissions)
if ($entraExitCode -ne 0) {
    Write-Host ""
    Write-Host "  Entra setup failed (exit code $entraExitCode). See errors above." -ForegroundColor Red
    Write-Host "  Fix the issue and re-run this installer." -ForegroundColor Yellow
    exit 1
}

# Parse out the AppClientId and AdminPrincipalId from the script's structured output markers
$AppClientId = ($entraOutput | Select-String "##RESULT AppClientId=([0-9a-f-]+)" | ForEach-Object { $_.Matches[0].Groups[1].Value }) | Select-Object -Last 1
$AdminPrincipalId = ($entraOutput | Select-String "##RESULT AdminPrincipalId=([0-9a-f-]+)" | ForEach-Object { $_.Matches[0].Groups[1].Value }) | Select-Object -Last 1

if (-not $AdminPrincipalId) {
    $AdminPrincipalId = az ad signed-in-user show --query "id" -o tsv 2>$null
}

Write-Host "  App Client ID     : $AppClientId" -ForegroundColor Green
Write-Host "  Admin Principal ID: $AdminPrincipalId" -ForegroundColor Green

# ─── Step 2: Deploy infrastructure + code ─────────────────────────────────────

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  STEP 2 of 2: Infrastructure and Code Deployment" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

$deployScript = Join-Path $infraPath "Deploy-AzureCostOptimize.ps1"
if (-not (Test-Path $deployScript)) {
    Write-Host "  Deploy-AzureCostOptimize.ps1 not found at $deployScript" -ForegroundColor Red
    exit 1
}

$deployArgs = @{
    TenantId          = $TenantId
    AdminPrincipalId  = $AdminPrincipalId
    AppClientId       = $AppClientId
    Location          = $Location
    ResourceGroupName = $ResourceGroupName
}
if ($SkipTests) { $deployArgs['SkipTests'] = $true }

Push-Location $infraPath
try {
    & $deployScript @deployArgs
}
finally {
    Pop-Location
}

# ─── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "    Installation complete!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  To update the solution later (redeploy code only):" -ForegroundColor Cyan
Write-Host "  cd ~/azureoptimize && git pull && cd infra && .\Deploy-AzureCostOptimize.ps1 -TenantId $TenantId -Update" -ForegroundColor White
Write-Host ""
Write-Host "  To completely remove the solution:" -ForegroundColor Cyan
Write-Host "  cd ~/azureoptimize/infra && .\Teardown-AzureCostOptimize.ps1 -TenantId $TenantId -AppClientId $AppClientId" -ForegroundColor White
Write-Host ""
