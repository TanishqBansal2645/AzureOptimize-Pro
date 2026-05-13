#
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

    # If the deploy script's auto-update fails, manually update the redirect URI:
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

# --- Helper functions ---------------------------------------------------------

function Write-Step {
    param([int]$Step, [int]$Total, [string]$Message)
    Write-Host "`n  [$Step/$Total] $Message..." -ForegroundColor Cyan
}
function Write-Success { param([string]$Msg); Write-Host "    [OK]   $Msg" -ForegroundColor Green }
function Write-Warn    { param([string]$Msg); Write-Host "    [!]    $Msg" -ForegroundColor Yellow }
function Write-Fail    { param([string]$Msg); Write-Host "    [FAIL] $Msg" -ForegroundColor Red }

function Get-GraphToken {
    $token = az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv 2>$null
    if (-not $token) { throw "Could not obtain Microsoft Graph API token. Verify you are logged in to the correct tenant." }
    return $token
}

# --- Banner -------------------------------------------------------------------

Write-Host ""
Write-Host "  ================================================================" -ForegroundColor Blue
Write-Host "    AzureOptimize Pro - Entra App Registration Setup" -ForegroundColor Blue
Write-Host "  ================================================================" -ForegroundColor Blue
Write-Host ""

# ==============================================================================
# UpdateRedirectUri mode (2 steps)
# ==============================================================================

if ($UpdateRedirectUri) {
    if (-not $AppClientId) {
        Write-Fail "-AppClientId is required with -UpdateRedirectUri"
        exit 1
    }
    if (-not $DashboardUrl -or $DashboardUrl -eq "http://localhost:3000") {
        Write-Fail "-DashboardUrl is required with -UpdateRedirectUri (cannot be localhost)"
        exit 1
    }

    Write-Step 1 2 "Authenticating to tenant $TenantId"
    try {
        $currentTenant = az account show --query "tenantId" -o tsv 2>$null
        if ($currentTenant -ne $TenantId) { az login --tenant $TenantId --output none }
        Write-Success "Logged in to tenant $TenantId"
    }
    catch {
        Write-Fail "Login failed: $_"
        exit 1
    }

    Write-Step 2 2 "Updating SPA redirect URIs for app $AppClientId"
    try {
        $graphToken   = Get-GraphToken
        $graphHeaders = @{ Authorization = "Bearer $graphToken"; "Content-Type" = "application/json" }
        $spaBody      = @{ spa = @{ redirectUris = @($DashboardUrl, "$DashboardUrl/", "http://localhost:3000") } } | ConvertTo-Json -Depth 5
        Invoke-RestMethod -Method PATCH `
            -Uri "https://graph.microsoft.com/v1.0/applications(appId='$AppClientId')" `
            -Headers $graphHeaders -Body $spaBody | Out-Null
        Write-Success "SPA redirect URIs updated:"
        Write-Host "      $DashboardUrl" -ForegroundColor Gray
        Write-Host "      $DashboardUrl/" -ForegroundColor Gray
        Write-Host "      http://localhost:3000" -ForegroundColor Gray
    }
    catch {
        Write-Fail "Failed to update redirect URI: $_"
        Write-Host "    Ensure your account has Application Administrator (or higher) role in Entra." -ForegroundColor Yellow
        exit 1
    }

    Write-Host ""
    Write-Host "  ================================================================" -ForegroundColor Green
    Write-Host "    Redirect URI updated. Users can sign in at: $DashboardUrl" -ForegroundColor Green
    Write-Host "  ================================================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# ==============================================================================
# Normal mode (5 steps)
# ==============================================================================

# [1/5] Authenticate
Write-Step 1 5 "Authenticating to tenant $TenantId"
try {
    $currentTenant = az account show --query "tenantId" -o tsv 2>$null
    if ($currentTenant -ne $TenantId) { az login --tenant $TenantId --output none }
    Write-Success "Logged in to tenant $TenantId"
}
catch {
    Write-Fail "Login failed: $_"
    exit 1
}

Write-Host "    Getting your Entra Object ID..." -ForegroundColor Gray
$adminOid = az ad signed-in-user show --query "id" -o tsv 2>$null
if (-not $adminOid) {
    Write-Fail "Could not get signed-in user Object ID. Log in with a user account (not a service principal)."
    exit 1
}
Write-Success "Admin Object ID: $adminOid"

# [2/5] Create or find App Registration
Write-Step 2 5 "Creating or finding Entra App Registration"
$isNewApp      = $false
$existingAppId = az ad app list --display-name "AzureOptimize Pro" --query "[0].appId" -o tsv 2>$null

if ($existingAppId) {
    $AppClientId = $existingAppId.Trim()
    Write-Success "Found existing app 'AzureOptimize Pro' (Client ID: $AppClientId) - reusing"
}
else {
    $isNewApp = $true
    Write-Host "    No existing app found - creating 'AzureOptimize Pro'..." -ForegroundColor Gray

    $prev         = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $createResult = az ad app create `
        --display-name "AzureOptimize Pro" `
        --sign-in-audience "AzureADMyOrg" `
        --query "appId" -o tsv 2>&1
    $createEc     = $LASTEXITCODE
    $ErrorActionPreference = $prev

    # Parse GUID from output (handles warning lines mixed into output)
    $AppClientId = ($createResult |
        Where-Object { $_ -match "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }) |
        Select-Object -First 1
    if ($AppClientId) { $AppClientId = $AppClientId.Trim() }

    # Fallback: query by display name (handles az output interleaving on slow tenants)
    if (-not $AppClientId) {
        Write-Host "    Waiting for Entra to register the app (5s)..." -ForegroundColor Gray
        Start-Sleep -Seconds 5
        $AppClientId = (az ad app list --display-name "AzureOptimize Pro" --query "[0].appId" -o tsv 2>$null)
        if ($AppClientId) { $AppClientId = $AppClientId.Trim() }
    }

    if (-not $AppClientId) {
        Write-Fail "Failed to create the App Registration (az exit code: $createEc)"
        $createResult | Where-Object { $_ -match "error|Error|ERROR|forbidden|Forbidden" } |
            ForEach-Object { Write-Host "    Azure: $_" -ForegroundColor Red }
        Write-Host ""
        Write-Host "    Root cause: your account likely lacks the Application Administrator role." -ForegroundColor Yellow
        Write-Host "    Fix: Portal -> Entra ID -> Roles and administrators" -ForegroundColor Yellow
        Write-Host "         -> Application Administrator -> Add assignments -> add your account" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "    Or create manually:" -ForegroundColor Yellow
        Write-Host "    Portal -> Entra ID -> App Registrations -> New registration" -ForegroundColor Yellow
        Write-Host "    Name: AzureOptimize Pro | Account types: This org only" -ForegroundColor Yellow
        Write-Host "    Then re-run this script." -ForegroundColor Yellow
        exit 1
    }
    Write-Success "App Registration created (Client ID: $AppClientId)"
}

# [3/5] Configure SPA redirect URI + Service Principal (new apps only)
Write-Step 3 5 "Configuring SPA redirect URI and service principal"
try {
    $graphToken   = Get-GraphToken
    $graphHeaders = @{ Authorization = "Bearer $graphToken"; "Content-Type" = "application/json" }

    if ($isNewApp) {
        # Register localhost as the initial SPA redirect URI.
        # Deploy-AzureCostOptimize.ps1 updates this to the real URL after Bicep runs.
        $spaBody = @{ spa = @{ redirectUris = @("http://localhost:3000") } } | ConvertTo-Json -Depth 5
        Invoke-RestMethod -Method PATCH `
            -Uri "https://graph.microsoft.com/v1.0/applications(appId='$AppClientId')" `
            -Headers $graphHeaders -Body $spaBody | Out-Null
        Write-Success "SPA redirect URI set to http://localhost:3000 (deploy script auto-updates to production URL)"

        Write-Host "    Creating service principal..." -ForegroundColor Gray
        $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        az ad sp create --id $AppClientId --output none 2>$null
        $ErrorActionPreference = $prev
        Write-Success "Service principal created"

        Write-Host "    Granting initial admin consent (waiting 10s for SP propagation)..." -ForegroundColor Gray
        Start-Sleep -Seconds 10
        $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        az ad app permission admin-consent --id $AppClientId --output none 2>$null
        $ErrorActionPreference = $prev
        Write-Success "Initial admin consent granted"
    }
    else {
        Write-Success "Skipped - existing app retains its current redirect URIs and service principal"
    }
}
catch {
    Write-Fail "Step 3 failed: $_"
    Write-Host "    Ensure your account has Application Administrator role." -ForegroundColor Yellow
    exit 1
}

# [4/5] Configure ID token issuance and API scope
Write-Step 4 5 "Configuring ID token issuance and API scope (user_impersonation)"
try {
    # Enable ID token issuance (required for MSAL SSO implicit grant)
    $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    az ad app update --id $AppClientId --enable-id-token-issuance true --output none 2>$null
    $ErrorActionPreference = $prev
    Write-Success "ID token issuance enabled"

    $graphToken   = Get-GraphToken
    $graphHeaders = @{ Authorization = "Bearer $graphToken"; "Content-Type" = "application/json" }

    # GET existing app state to check whether user_impersonation scope already exists.
    # Reuse the existing scope ID to avoid duplicates - Graph replaces the entire array on PATCH.
    $appState = Invoke-RestMethod -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/applications(appId='$AppClientId')?`$select=api,identifierUris" `
        -Headers $graphHeaders
    $existingScope = $appState.api.oauth2PermissionScopes |
        Where-Object { $_.value -eq "user_impersonation" } | Select-Object -First 1

    if ($existingScope) {
        Write-Success "API scope 'user_impersonation' already exists (ID: $($existingScope.id)) - no change needed"
    }
    else {
        $scopeId = [System.Guid]::NewGuid().ToString()
        $apiBody = @{
            identifierUris = @("api://$AppClientId")
            api            = @{
                oauth2PermissionScopes = @(
                    @{
                        id                      = $scopeId
                        adminConsentDescription = "Allow the app to access AzureOptimize Pro API on behalf of the signed-in user"
                        adminConsentDisplayName = "Access AzureOptimize Pro API"
                        userConsentDescription  = "Allow the app to access AzureOptimize Pro API on your behalf"
                        userConsentDisplayName  = "Access AzureOptimize Pro API"
                        value                   = "user_impersonation"
                        type                    = "User"
                        isEnabled               = $true
                    }
                )
            }
        } | ConvertTo-Json -Depth 10
        Invoke-RestMethod -Method PATCH `
            -Uri "https://graph.microsoft.com/v1.0/applications(appId='$AppClientId')" `
            -Headers $graphHeaders -Body $apiBody | Out-Null
        Write-Success "API scope 'user_impersonation' created (Identifier URI: api://$AppClientId)"
    }

    # Ensure identifier URI is set even if scope already existed
    if ($appState.identifierUris -notcontains "api://$AppClientId") {
        $uriBody = @{ identifierUris = @("api://$AppClientId") } | ConvertTo-Json
        Invoke-RestMethod -Method PATCH `
            -Uri "https://graph.microsoft.com/v1.0/applications(appId='$AppClientId')" `
            -Headers $graphHeaders -Body $uriBody | Out-Null
        Write-Success "Identifier URI set to api://$AppClientId"
    }
}
catch {
    Write-Warn "Step 4 issue: $_ - The app was created; you may need to configure the API scope manually."
    Write-Host "    Portal -> App Registrations -> AzureOptimize Pro -> Expose an API -> Add scope" -ForegroundColor Gray
    # Non-fatal: continue to output results so deploy command can still be run
}

# [5/5] Grant admin consent for user_impersonation
Write-Step 5 5 "Granting admin consent for user_impersonation scope (all principals)"
try {
    $graphToken   = Get-GraphToken
    $graphHeaders = @{ Authorization = "Bearer $graphToken"; "Content-Type" = "application/json" }

    Write-Host "    Waiting for Entra propagation (10s)..." -ForegroundColor Gray
    Start-Sleep -Seconds 10

    $sp = Invoke-RestMethod -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId eq '$AppClientId'&`$select=id" `
        -Headers $graphHeaders
    if (-not $sp.value -or $sp.value.Count -eq 0) {
        throw "Service principal not found for appId '$AppClientId' - may not have propagated yet"
    }
    $spId = $sp.value[0].id

    $consentBody = @{
        clientId    = $spId
        consentType = "AllPrincipals"
        resourceId  = $spId
        scope       = "user_impersonation"
    } | ConvertTo-Json

    try {
        Invoke-RestMethod -Method POST `
            -Uri "https://graph.microsoft.com/v1.0/oauth2PermissionGrants" `
            -Headers $graphHeaders -Body $consentBody | Out-Null
        Write-Success "Admin consent granted for all principals in tenant"
    }
    catch {
        $errMsg = $_.ToString()
        if ($errMsg -match "409|already exists|Conflict") {
            Write-Success "Admin consent already exists for this app (no change needed)"
        }
        else {
            throw $_
        }
    }
}
catch {
    Write-Warn "Admin consent step: $_ - This may be OK if consent was already granted."
    Write-Host "    If users see a consent prompt on sign-in, grant manually:" -ForegroundColor Gray
    Write-Host "    Portal -> Enterprise Applications -> AzureOptimize Pro -> Permissions -> Grant admin consent" -ForegroundColor Gray
    # Non-fatal: sign-in still works, users just see a one-time consent prompt
}

# --- Output results -----------------------------------------------------------

Write-Host ""
Write-Host "  ================================================================" -ForegroundColor Green
Write-Host "    Entra App Setup Complete!" -ForegroundColor Green
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
Write-Host "  The deploy script automatically updates the SPA redirect URI after Bicep completes." -ForegroundColor Green
Write-Host "  If the auto-update fails, run this manually:" -ForegroundColor Cyan
Write-Host "    .\Setup-Entra.ps1 -TenantId `"$TenantId`" -DashboardUrl `"<DASHBOARD_URL>`" -UpdateRedirectUri -AppClientId `"$AppClientId`"" -ForegroundColor Gray
Write-Host ""

# Machine-parseable markers for Install.ps1 auto-detection (Write-Output so they go to stream 1)
Write-Output "##RESULT AppClientId=$AppClientId"
Write-Output "##RESULT AdminPrincipalId=$adminOid"

exit 0
