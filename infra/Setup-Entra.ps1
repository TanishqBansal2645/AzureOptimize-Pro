<#
.SYNOPSIS
    Automates the Entra App Registration setup required before deployment.

.DESCRIPTION
    Creates (or reuses) an Entra App Registration for AzureOptimize Pro
    and outputs the values needed for the main deploy script.

    Run this ONCE before Deploy-AzureCostOptimize.ps1. The script outputs
    the exact command to run next.

.PARAMETER TenantId
    The client's Azure tenant ID.

.PARAMETER DashboardUrl
    The Static Web App URL (if already known). Can be updated after
    first deployment by running this script again with -UpdateRedirectUri.

.PARAMETER UpdateRedirectUri
    If set, updates the redirect URI of an existing app registration.

.PARAMETER AppClientId
    The existing App Client ID to update (required with -UpdateRedirectUri).

.EXAMPLE
    # First run (before deployment)
    .\Setup-Entra.ps1 -TenantId "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

    # After deployment, update the redirect URI
    .\Setup-Entra.ps1 -TenantId "xxx" -DashboardUrl "https://xxx.azurestaticapps.net" -UpdateRedirectUri -AppClientId "yyy"
#>

param(
    [Parameter(Mandatory = $true)]
    [string] $TenantId,

    [string] $DashboardUrl = "http://localhost:3000",

    [switch] $UpdateRedirectUri,

    [string] $AppClientId = ""
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  AzureOptimize Pro - Entra App Registration Setup" -ForegroundColor Blue
Write-Host ""

# Login to the target tenant
Write-Host "  Logging in to tenant $TenantId..." -ForegroundColor Cyan
$currentTenant = az account show --query "tenantId" -o tsv 2>$null
if ($currentTenant -ne $TenantId) {
    az login --tenant $TenantId --output none
}

# Get the signed-in user's Object ID
Write-Host "  Getting your Object ID..." -ForegroundColor Cyan
$adminOid = az ad signed-in-user show --query "id" -o tsv
Write-Host "  Your Object ID: $adminOid" -ForegroundColor White

if ($UpdateRedirectUri) {
    # Update redirect URI of existing app
    if (-not $AppClientId) {
        Write-Host "  ERROR: -AppClientId is required with -UpdateRedirectUri" -ForegroundColor Red
        exit 1
    }
    if (-not $DashboardUrl -or $DashboardUrl -eq "http://localhost:3000") {
        Write-Host "  ERROR: -DashboardUrl is required with -UpdateRedirectUri" -ForegroundColor Red
        exit 1
    }

    Write-Host "  Updating redirect URI for app $AppClientId..." -ForegroundColor Cyan
    $callbackUrl = "$DashboardUrl/.auth/login/aad/callback"
    az ad app update `
        --id $AppClientId `
        --web-redirect-uris $callbackUrl "http://localhost:3000" `
        --output none

    Write-Host ""
    Write-Host "  v Redirect URI updated to: $callbackUrl" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# Check if app already exists
Write-Host "  Checking for existing AzureOptimize Pro app..." -ForegroundColor Cyan
$existingAppId = az ad app list --display-name "AzureOptimize Pro" --query "[0].appId" -o tsv 2>$null

if ($existingAppId) {
    Write-Host "  Found existing app: $existingAppId" -ForegroundColor Yellow
    $AppClientId = $existingAppId.Trim()
    Write-Host "  Reusing existing app registration." -ForegroundColor Cyan
}
else {
    # Create new app registration
    Write-Host "  Creating Entra App Registration..." -ForegroundColor Cyan

    $createResult = az ad app create `
        --display-name "AzureOptimize Pro" `
        --sign-in-audience "AzureADMyOrg" `
        --web-redirect-uris "http://localhost:3000" `
        --query "appId" -o tsv 2>&1

    $AppClientId = ($createResult |
        Where-Object { $_ -match "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }) |
        Select-Object -First 1
    if ($AppClientId) { $AppClientId = $AppClientId.Trim() }

    # Fallback: query by display name (handles race conditions or output interleaving)
    if (-not $AppClientId) {
        Start-Sleep -Seconds 5
        $AppClientId = (az ad app list --display-name "AzureOptimize Pro" --query "[0].appId" -o tsv 2>$null)
        if ($AppClientId) { $AppClientId = $AppClientId.Trim() }
    }

    if (-not $AppClientId) {
        Write-Host ""
        Write-Host "  ERROR: Failed to create the App Registration." -ForegroundColor Red
        $createResult | Where-Object { $_ -match "ERROR|error" } |
            ForEach-Object { Write-Host "  Azure: $_" -ForegroundColor Red }
        Write-Host ""
        Write-Host "  To fix this, assign yourself the 'Application Administrator' role:" -ForegroundColor Yellow
        Write-Host "    Portal -> Microsoft Entra ID -> Roles and administrators" -ForegroundColor Yellow
        Write-Host "    -> Find 'Application Administrator' -> Add assignments -> add your account" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Or create the App Registration manually in the Portal:" -ForegroundColor Yellow
        Write-Host "    Portal -> Microsoft Entra ID -> App registrations -> New registration" -ForegroundColor Yellow
        Write-Host "    Name: AzureOptimize Pro, Supported account types: This org only" -ForegroundColor Yellow
        Write-Host "    Then re-run this script." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "  App created. Client ID: $AppClientId" -ForegroundColor Green

    # Create service principal
    Write-Host "  Creating service principal..." -ForegroundColor Cyan
    az ad sp create --id $AppClientId --output none 2>$null

    # Grant admin consent
    Write-Host "  Granting admin consent..." -ForegroundColor Cyan
    Start-Sleep -Seconds 10  # Wait for SP to propagate
    az ad app permission admin-consent --id $AppClientId --output none 2>$null
}

# Configure ID token settings (required for MSAL SSO)
Write-Host "  Configuring ID token issuance..." -ForegroundColor Cyan
az ad app update `
    --id $AppClientId `
    --enable-id-token-issuance true `
    --output none 2>$null

# Set the app as a single-tenant API
Write-Host "  Exposing API scope (for token audience validation)..." -ForegroundColor Cyan
$apiUri = "api://$AppClientId"
az ad app update --id $AppClientId --identifier-uris $apiUri --output none 2>$null

# ─── Output results ───────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ================================================================" -ForegroundColor Green
Write-Host "  Entra App Setup Complete!" -ForegroundColor Green
Write-Host "  ================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  App Client ID   : $AppClientId" -ForegroundColor White
Write-Host "  Admin Object ID : $adminOid" -ForegroundColor White
Write-Host "  Tenant ID       : $TenantId" -ForegroundColor White
Write-Host ""
Write-Host "  Run the deployment now:" -ForegroundColor Cyan
Write-Host ""
Write-Host "    .\Deploy-AzureCostOptimize.ps1 ``" -ForegroundColor Yellow
Write-Host "      -TenantId          `"$TenantId`" ``" -ForegroundColor Yellow
Write-Host "      -AdminPrincipalId  `"$adminOid`" ``" -ForegroundColor Yellow
Write-Host "      -AppClientId       `"$AppClientId`" ``" -ForegroundColor Yellow
Write-Host "      -Location          `"eastus`" ``" -ForegroundColor Yellow
Write-Host "      -ResourceGroupName `"rg-azureoptimize`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "  After deployment, update the redirect URI:" -ForegroundColor Cyan
Write-Host "    .\Setup-Entra.ps1 -TenantId `"$TenantId`" -DashboardUrl `"<DASHBOARD_URL>`" -UpdateRedirectUri -AppClientId `"$AppClientId`"" -ForegroundColor Gray
Write-Host ""

# Machine-parseable markers for Install.ps1 auto-detection (Write-Output so they go to stream 1)
Write-Output "##RESULT AppClientId=$AppClientId"
Write-Output "##RESULT AdminPrincipalId=$adminOid"
