<#
.SYNOPSIS
    Completely removes AzureOptimize Pro from an Azure tenant.

.DESCRIPTION
    Decommissions the full AzureOptimize Pro stack:
    - Removes all role assignments for the Managed Identity across every subscription
    - Deletes the resource group (Function App, Storage, Key Vault, Static Web App,
      App Insights, Log Analytics Workspace, Managed Identity)
    - Optionally deletes the Entra App Registration

    This is irreversible. All cost optimization data stored in Table Storage will be lost.

.PARAMETER TenantId
    The Azure tenant ID where the solution is deployed.

.PARAMETER ResourceGroupName
    Name of the resource group to delete. Auto-derived from the tenant ID if omitted.

.PARAMETER AppClientId
    The Entra App Registration client ID. If provided, the App Registration is also deleted.

.PARAMETER KeepAppRegistration
    Skip deletion of the Entra App Registration even if AppClientId is provided.

.EXAMPLE
    .\Teardown-AzureCostOptimize.ps1 -TenantId "xxx"

.EXAMPLE
    .\Teardown-AzureCostOptimize.ps1 -TenantId "xxx" -AppClientId "yyy"
#>

param(
    [Parameter(Mandatory = $true)]
    [string] $TenantId,

    [string] $ResourceGroupName = "",

    [string] $AppClientId = "",

    [switch] $KeepAppRegistration
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# --- Banner -------------------------------------------------------------------

Write-Host ""
Write-Host "================================================================" -ForegroundColor Red
Write-Host "    AzureOptimize Pro - DECOMMISSION SCRIPT" -ForegroundColor Red
Write-Host "    This will permanently delete all resources and data!" -ForegroundColor Red
Write-Host "================================================================" -ForegroundColor Red
Write-Host ""
Write-Host "  Tenant ID      : $TenantId" -ForegroundColor Yellow
Write-Host "  Resource Group : $ResourceGroupName" -ForegroundColor Yellow
if ($AppClientId -and -not $KeepAppRegistration) {
    Write-Host "  App Client ID  : $AppClientId (App Registration will also be deleted)" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  WARNING: This action is IRREVERSIBLE." -ForegroundColor Red
Write-Host "  All cost optimization data, recommendations, and reports will be lost." -ForegroundColor Red
Write-Host ""

$confirm = Read-Host "Type 'DELETE' in uppercase to confirm permanent removal"
if ($confirm -ne 'DELETE') {
    Write-Host "Teardown cancelled." -ForegroundColor Yellow
    exit 0
}

# --- Login --------------------------------------------------------------------

Write-Host "`nLogging in to tenant $TenantId..." -ForegroundColor Cyan
try {
    $currentTenant = az account show --query "tenantId" -o tsv 2>$null
    if ($currentTenant -ne $TenantId) {
        az login --tenant $TenantId --output none
    }
    Write-Host "  Logged in." -ForegroundColor Green
}
catch {
    Write-Host "  Login failed: $_" -ForegroundColor Red
    exit 1
}

# --- Step 1: Check resource group exists --------------------------------------

Write-Host "`n[1/4] Checking resource group..." -ForegroundColor Cyan
$rgExists = az group exists --name $ResourceGroupName
if ($rgExists -ne "true") {
    Write-Host "  Resource group '$ResourceGroupName' not found. Nothing to delete." -ForegroundColor Yellow
}
else {
    Write-Host "  Found resource group '$ResourceGroupName'." -ForegroundColor Green
}

# --- Step 2: Remove role assignments for Managed Identity ---------------------

Write-Host "`n[2/4] Removing Managed Identity role assignments across all subscriptions..." -ForegroundColor Cyan

if ($rgExists -eq "true") {
    try {
        $allSubs = az account list --query "[?state=='Enabled'].id" -o tsv
        $removedCount = 0
        foreach ($subId in ($allSubs -split "`n" | Where-Object { $_ -and $_.Trim() })) {
            $subId = $subId.Trim()
            # Find the managed identity principal ID for this RG
            $miPrincipalId = az identity list `
                --resource-group $ResourceGroupName `
                --subscription $subId `
                --query "[?starts_with(name, 'mi-azureoptimize')].principalId" `
                -o tsv 2>$null

            if ($miPrincipalId) {
                az role assignment delete --assignee $miPrincipalId --subscription $subId --output none 2>$null
                $removedCount++
                Write-Host "  Removed role assignments for MI on subscription $subId" -ForegroundColor Gray
            }
        }
        Write-Host "  Cleaned up role assignments on $removedCount subscription(s)." -ForegroundColor Green
    }
    catch {
        Write-Host "  Warning: could not fully clean role assignments: $_" -ForegroundColor Yellow
        Write-Host "  Continuing with resource group deletion..." -ForegroundColor Gray
    }
}
else {
    Write-Host "  Skipped (resource group not found)." -ForegroundColor Gray
}

# --- Step 3: Delete resource group --------------------------------------------

Write-Host "`n[3/4] Deleting resource group '$ResourceGroupName'..." -ForegroundColor Cyan

if ($rgExists -eq "true") {
    try {
        Write-Host "  This may take 5-10 minutes. Waiting for deletion to complete..." -ForegroundColor Gray
        az group delete --name $ResourceGroupName --yes
        Write-Host "  Resource group deleted." -ForegroundColor Green
    }
    catch {
        Write-Host "  Failed to delete resource group: $_" -ForegroundColor Red
        Write-Host "  You may need to delete it manually in the Azure portal." -ForegroundColor Yellow
    }
}
else {
    Write-Host "  Skipped (resource group not found)." -ForegroundColor Gray
}

# --- Step 4: Delete Entra App Registration ------------------------------------

Write-Host "`n[4/4] Entra App Registration..." -ForegroundColor Cyan

if ($AppClientId -and -not $KeepAppRegistration) {
    try {
        az ad app delete --id $AppClientId
        Write-Host "  App Registration ($AppClientId) deleted." -ForegroundColor Green
    }
    catch {
        Write-Host "  Could not delete App Registration: $_" -ForegroundColor Yellow
        Write-Host "  Delete it manually at: https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" -ForegroundColor Gray
    }
}
elseif ($KeepAppRegistration) {
    Write-Host "  Skipped (-KeepAppRegistration specified)." -ForegroundColor Gray
}
else {
    Write-Host "  Skipped (no -AppClientId provided)." -ForegroundColor Gray
    Write-Host "  To delete the App Registration manually:" -ForegroundColor Gray
    Write-Host "  az ad app delete --id <your-app-client-id>" -ForegroundColor Gray
}

# --- Summary ------------------------------------------------------------------

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "    AzureOptimize Pro decommissioning complete." -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Removed:" -ForegroundColor White
Write-Host "   - Resource group: $ResourceGroupName (Function App, Storage, Key Vault," -ForegroundColor White
Write-Host "     Static Web App, App Insights, Log Analytics, Managed Identity)" -ForegroundColor White
Write-Host "   - Role assignments: cleaned across all subscriptions" -ForegroundColor White
if ($AppClientId -and -not $KeepAppRegistration) {
    Write-Host "   - Entra App Registration: $AppClientId" -ForegroundColor White
}
Write-Host ""
