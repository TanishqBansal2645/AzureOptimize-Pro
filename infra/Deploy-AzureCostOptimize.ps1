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
    Name of the resource group. Auto-derived from the last 6 chars of the tenant ID if
    not specified (e.g. tenant 98b65c17-... -> rg-azureoptimize-a188e9).
    Each client tenant produces a unique, deterministic name. Override only if needed.

.PARAMETER GitHubToken
    Optional GitHub Personal Access Token to automatically configure GitHub Actions
    secrets, repository variables, and trigger the first deployment.
    Required scopes: repo (classic PAT) or Actions read/write (fine-grained PAT).
    PyNaCl is installed automatically when this token is provided.

.PARAMETER GitHubRepo
    GitHub repo in owner/repo format. Default: TanishqBansal2645/AzureOptimize-Pro

.PARAMETER ClientEnvironment
    GitHub Environment name for this client deployment. Secrets and variables are stored
    in this environment (isolated from other clients). Defaults to ResourceGroupName.
    Example: rg-azureoptimize-a188e9 (matches the auto-derived ResourceGroupName)

.PARAMETER CompanyName
    Optional company/client name displayed in the header subtitle only.
    The sidebar always shows "AzureOptimize Pro" regardless of this setting.
    If omitted, no subtitle is shown in the header.
    Can also be set or updated at any time with -Update -CompanyName "New Name".

.PARAMETER DeveloperName
    Optional developer/consultant name shown in the login page footer.
    Falls back to "Tanishq Bansal" if omitted.
    Can also be updated at any time with -Update -DeveloperName "Your Name".

.PARAMETER Update
    Re-run infrastructure update only (preserves data, skips code deployment setup).

.PARAMETER Remove
    Delete all deployed Azure resources.

.PARAMETER SkipTests
    Skip the smoke tests after deployment.

.EXAMPLE
    # Fresh install with automatic GitHub setup
    .\Deploy-AzureCostOptimize.ps1 -TenantId "xxx" -AdminPrincipalId "yyy" -AppClientId "zzz" -GitHubToken "ghp_..."

    # Fresh install with all branding
    .\Deploy-AzureCostOptimize.ps1 -TenantId "xxx" -AdminPrincipalId "yyy" -AppClientId "zzz" -CompanyName "Contoso Ltd" -DeveloperName "Tanishq Bansal"

    # Update branding only (no infrastructure re-deploy)
    .\Deploy-AzureCostOptimize.ps1 -TenantId "xxx" -Update -CompanyName "Contoso Ltd" -DeveloperName "Tanishq Bansal"
#>

param(
    [Parameter(Mandatory = $true)]
    [string] $TenantId,

    [Parameter(Mandatory = $false)]
    [string] $AdminPrincipalId = "",

    [Parameter(Mandatory = $false)]
    [string] $AppClientId = "",

    [string] $Location = "eastus",
    [string] $ResourceGroupName = "",
    [string] $GitHubToken = "",
    [string] $GitHubRepo = "TanishqBansal2645/AzureOptimize-Pro",
    [string] $ClientEnvironment = "",
    [string] $CompanyName = "",
    [string] $DeveloperName = "",

    [switch] $Update,
    [switch] $Remove,
    [switch] $SkipTests,
    [switch] $Force    # Skip confirmation prompt (for scripted / CI use)
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$script:tmpDir = if ($env:TEMP) { $env:TEMP } elseif ($env:TMPDIR) { $env:TMPDIR } else { "/tmp" }
if (-not $GitHubToken -and $env:GITHUB_TOKEN) { $GitHubToken = $env:GITHUB_TOKEN }

if (-not $ResourceGroupName) {
    $tenantSuffix      = $TenantId.Replace("-", "").Substring(26, 6)
    $ResourceGroupName = "rg-azureoptimize-$tenantSuffix"
}
if (-not $ClientEnvironment) { $ClientEnvironment = $ResourceGroupName }

# --- Helper Functions ---------------------------------------------------------

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

function Start-SleepWithHeartbeat {
    param([int]$Seconds, [string]$Message = "Waiting")
    $elapsed = 0
    while ($elapsed -lt $Seconds) {
        $wait = [Math]::Min(30, $Seconds - $elapsed)
        Start-Sleep -Seconds $wait
        $elapsed += $wait
        if ($elapsed -lt $Seconds) {
            Write-Host "  ... $Message (${elapsed}s / ${Seconds}s)" -ForegroundColor DarkGray
        }
    }
}

function New-GitHubEnvironment {
    param([string] $Token, [string] $Repo, [string] $EnvName)
    $headers = @{
        Authorization          = "Bearer $Token"
        Accept                 = "application/vnd.github.v3+json"
        "User-Agent"           = "AzureOptimize-Deploy"
        "X-GitHub-Api-Version" = "2022-11-28"
    }
    Invoke-RestMethod -Method PUT `
        -Uri "https://api.github.com/repos/$Repo/environments/$EnvName" `
        -Headers $headers -Body '{}' -ContentType "application/json" | Out-Null
}

function Set-GitHubVariable {
    param(
        [string] $Token,
        [string] $Repo,
        [string] $Name,
        [string] $Value,
        [string] $EnvName = ""
    )
    $headers = @{
        Authorization          = "Bearer $Token"
        Accept                 = "application/vnd.github.v3+json"
        "User-Agent"           = "AzureOptimize-Deploy"
        "X-GitHub-Api-Version" = "2022-11-28"
    }
    $body = @{ name = $Name; value = $Value } | ConvertTo-Json -Compress
    # Route to environment-scoped or repo-level URL
    if ($EnvName) {
        $baseUrl = "https://api.github.com/repos/$Repo/environments/$EnvName/variables"
    } else {
        $baseUrl = "https://api.github.com/repos/$Repo/actions/variables"
    }
    # Try PATCH (update existing), fall back to POST (create new)
    try {
        Invoke-RestMethod -Method PATCH `
            -Uri "$baseUrl/$Name" `
            -Headers $headers -Body $body -ContentType "application/json" | Out-Null
    }
    catch {
        Invoke-RestMethod -Method POST `
            -Uri $baseUrl `
            -Headers $headers -Body $body -ContentType "application/json" | Out-Null
    }
}

function Set-GitHubSecret {
    param(
        [string] $Token,
        [string] $Repo,
        [string] $Name,
        [string] $Value,
        [string] $EnvName = ""
    )

    $pythonCode = @'
import sys, json, base64, urllib.request
from nacl.public import SealedBox, PublicKey
token, repo, name = sys.argv[1], sys.argv[2], sys.argv[3]
env_name = sys.argv[4] if len(sys.argv) > 4 else ""
value_file = sys.argv[5]
with open(value_file, 'rb') as f:
    value = f.read()
if env_name:
    pk_url = f"https://api.github.com/repos/{repo}/environments/{env_name}/secrets/public-key"
    secret_url = f"https://api.github.com/repos/{repo}/environments/{env_name}/secrets/{name}"
else:
    pk_url = f"https://api.github.com/repos/{repo}/actions/secrets/public-key"
    secret_url = f"https://api.github.com/repos/{repo}/actions/secrets/{name}"
req = urllib.request.Request(pk_url, headers={"Authorization": f"Bearer {token}", "User-Agent": "AzureOptimize-Deploy"})
with urllib.request.urlopen(req) as r:
    pk = json.loads(r.read())
box = SealedBox(PublicKey(base64.b64decode(pk["key"])))
enc = base64.b64encode(box.encrypt(value)).decode()
data = json.dumps({"encrypted_value": enc, "key_id": pk["key_id"]}).encode()
urllib.request.urlopen(urllib.request.Request(
    secret_url, data=data, method="PUT",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
             "User-Agent": "AzureOptimize-Deploy"}))
'@

    $pyScript   = Join-Path $script:tmpDir "azopt_gh_secret.py"
    $valueFile  = Join-Path $script:tmpDir "azopt_gh_value.bin"
    Set-Content -Path $pyScript -Value $pythonCode -Encoding utf8
    # Write value as real bytes to a temp file - avoids PowerShell pipe byte corruption
    [System.IO.File]::WriteAllBytes($valueFile, [System.Text.Encoding]::UTF8.GetBytes($Value))

    try {
        $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        $result = python3 $pyScript $Token $Repo $Name $EnvName $valueFile 2>&1
        $pyEc = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP
        if ($pyEc -ne 0) {
            throw "Exit code $pyEc`: $result"
        }
    }
    finally {
        Remove-Item $pyScript   -Force -ErrorAction SilentlyContinue
        Remove-Item $valueFile  -Force -ErrorAction SilentlyContinue
    }
}

# --- Role Assignment Helpers (use az rest  -  az role assignment is unreliable) --
# Uses deterministic UUIDs so re-running the script never creates duplicate assignments.

function Add-RoleAssignment {
    param(
        [string] $PrincipalId,
        [string] $RoleDefinitionId,   # Built-in role GUID (stable across all tenants)
        [string] $Scope               # e.g. /subscriptions/xxx
    )
    # Temporarily relax ErrorActionPreference so az.exe stderr doesn't throw NativeCommandError
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = az role assignment create `
        --assignee-object-id $PrincipalId `
        --role $RoleDefinitionId `
        --scope $Scope `
        --assignee-principal-type ServicePrincipal `
        --output none 2>&1
    $ec = $LASTEXITCODE
    $ErrorActionPreference = $prev

    if ($ec -eq 0) { return $true }

    $msg = ($output | Out-String).Trim()
    # Idempotent success - assignment already exists
    if ($msg -match 'RoleAssignmentExists') { return $true }
    # Subscription inaccessible from current auth context - caller should skip entire sub
    if ($msg -match 'SubscriptionNotFound' -or $msg -match 'AuthorizationFailed' -or $msg -match 'InvalidAuthenticationTokenTenant') { return $false }
    # Role doesn't exist on this subscription type (e.g. Cost Management on VS subs) - skip this role only
    if ($msg -match 'RoleDefinitionDoesNotExist') { return $true }
    throw $msg
}

function Remove-MIRoleAssignments {
    param(
        [string] $PrincipalId,
        [string] $SubscriptionId
    )
    $url  = "https://management.azure.com/subscriptions/${SubscriptionId}/providers/Microsoft.Authorization/roleAssignments?`$filter=principalId eq '${PrincipalId}'&api-version=2022-04-01"
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $raw  = az rest --method GET --url $url 2>&1
    $ec   = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($ec -ne 0) { return }   # inaccessible subscription - nothing to clean up
    $response = ($raw | Where-Object { $_ -notmatch '^WARNING' } | Out-String | ConvertFrom-Json -ErrorAction SilentlyContinue)
    if ($response -and $response.value) {
        foreach ($ra in $response.value) {
            $delUrl = "https://management.azure.com$($ra.id)?api-version=2022-04-01"
            $prev2 = $ErrorActionPreference; $ErrorActionPreference = "Continue"
            az rest --method DELETE --url $delUrl --output none 2>&1 | Out-Null
            $ErrorActionPreference = $prev2
        }
    }
}

# --- Remove Mode --------------------------------------------------------------

if ($Remove) {
    Show-Banner
    Write-Host "  REMOVE MODE" -ForegroundColor Red
    Write-Host "  Deletes all Azure resources, Entra App Registration, and GitHub environments for '$ResourceGroupName'." -ForegroundColor Red
    Write-Host ""

    if (-not $Force) {
        $confirm = Read-Host "  Type 'yes' to confirm"
        if ($confirm -ne 'yes') {
            Write-Host "`n  Deletion cancelled. No changes made." -ForegroundColor Yellow
            exit 0
        }
    }
    else {
        Write-Warn "-Force specified: skipping confirmation prompt"
    }

    # [1/5] Login
    Write-Step 1 5 "Logging in to tenant $TenantId"
    try {
        $currentTenant = az account show --query "tenantId" -o tsv 2>$null
        if ($currentTenant -ne $TenantId) { az login --tenant $TenantId --output none }
        Write-Success "Logged in (tenant: $TenantId)"
    }
    catch {
        Write-Fail "Login failed: $_"
        exit 1
    }

    # [2/5] Remove RBAC
    Write-Step 2 5 "Removing Managed Identity role assignments from all subscriptions"
    try {
        $subList       = az account list --output json --only-show-errors | ConvertFrom-Json
        $subscriptions = @($subList | Where-Object { $_.tenantId -eq $TenantId } | Select-Object -ExpandProperty id)
        Write-Host "  Found $($subscriptions.Count) subscription(s) in tenant $TenantId" -ForegroundColor Gray

        $miJson        = az identity list --resource-group $ResourceGroupName --output json 2>$null
        $miObj         = $miJson | ConvertFrom-Json -ErrorAction SilentlyContinue |
                         Where-Object { $_.name -like 'mi-azureoptimize*' } | Select-Object -First 1
        $miPrincipalId = if ($miObj) { $miObj.principalId } else { $null }

        if ($miPrincipalId) {
            Write-Host "  Managed Identity : $($miObj.name)" -ForegroundColor Gray
            Write-Host "  Principal ID     : $miPrincipalId" -ForegroundColor Gray
            $cleanedCount = 0
            foreach ($subId in $subscriptions) {
                if (-not $subId -or -not $subId.Trim()) { continue }
                Write-Host "    Removing from subscription $($subId.Trim())..." -ForegroundColor Gray
                Remove-MIRoleAssignments -PrincipalId $miPrincipalId -SubscriptionId $subId.Trim()
                $cleanedCount++
            }
            Write-Success "Role assignments removed from $cleanedCount subscription(s)"
        }
        else {
            Write-Warn "Managed Identity not found in '$ResourceGroupName' - RBAC cleanup skipped"
        }
    }
    catch {
        Write-Warn "RBAC cleanup error: $_ - continuing"
    }

    # [3/5] Delete Entra App Registration
    Write-Step 3 5 "Deleting Entra App Registration 'AzureOptimize Pro'"
    try {
        $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        $appId   = (az ad app list --display-name "AzureOptimize Pro" --query "[0].appId" -o tsv 2>$null)
        $ErrorActionPreference = $prevEAP
        if ($appId) {
            $appId = $appId.Trim()
            $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
            az ad app delete --id $appId --output none 2>$null
            $ErrorActionPreference = $prevEAP
            Write-Success "Entra App Registration deleted (app ID: $appId)"
        }
        else {
            Write-Warn "App Registration 'AzureOptimize Pro' not found - already deleted or never created"
        }
    }
    catch {
        Write-Warn "Could not delete Entra App Registration: $_"
        Write-Host "  Delete manually: Portal -> Entra ID -> App Registrations -> AzureOptimize Pro -> Delete" -ForegroundColor Gray
    }

    # [4/5] Delete resource group
    Write-Step 4 5 "Deleting resource group '$ResourceGroupName'"
    $prevEAP   = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $delOutput = az group delete --name $ResourceGroupName --yes --no-wait 2>&1
    $delEc     = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP

    if ($delEc -eq 0) {
        Write-Success "Resource group deletion initiated (async - monitor in Azure Portal > Resource Groups)"
    }
    elseif (($delOutput | Out-String) -match "ResourceGroupNotFound|could not be found|was not found") {
        Write-Warn "Resource group '$ResourceGroupName' was not found - already deleted or never created"
    }
    else {
        Write-Fail "az group delete failed (exit code: $delEc)"
        Write-Host "  $($delOutput | Out-String)" -ForegroundColor Red
        exit 1
    }

    # [5/5] Delete GitHub environments
    Write-Step 5 5 "Deleting GitHub environments"
    $resolvedToken = if ($GitHubToken) { $GitHubToken } elseif ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } else { $null }
    if ($resolvedToken) {
        $ghRemoveHeaders = @{
            Authorization          = "Bearer $resolvedToken"
            Accept                 = "application/vnd.github.v3+json"
            "X-GitHub-Api-Version" = "2022-11-28"
            "User-Agent"           = "AzureOptimize-Deploy"
        }
        foreach ($envName in @($ClientEnvironment, "default")) {
            try {
                Invoke-RestMethod -Method DELETE `
                    -Uri "https://api.github.com/repos/$GitHubRepo/environments/$envName" `
                    -Headers $ghRemoveHeaders | Out-Null
                Write-Success "GitHub environment '$envName' deleted"
            }
            catch {
                $errMsg = $_.ToString()
                if ($errMsg -match "404|Not Found") {
                    Write-Warn "GitHub environment '$envName' not found - already deleted or never created"
                }
                else {
                    Write-Warn "Could not delete '$envName': $errMsg"
                }
            }
        }
    }
    else {
        Write-Warn "No GitHub token provided - GitHub environments not deleted"
        Write-Host "  Set `$env:GITHUB_TOKEN and re-run -Remove, or delete manually:" -ForegroundColor Gray
        Write-Host "  https://github.com/$GitHubRepo/settings/environments" -ForegroundColor Gray
    }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "    Decommission complete!" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# --- Pre-flight checks --------------------------------------------------------

Show-Banner
Write-Host "Running pre-flight checks..." -ForegroundColor Cyan

# Update mode only needs az; full deploy also needs node + npm
$tools = if ($Update) {
    @{ "az" = "Azure CLI" }
} else {
    @{ "az" = "Azure CLI"; "node" = "Node.js"; "npm" = "npm" }
}

foreach ($tool in $tools.Keys) {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Fail "$($tools[$tool]) not found. Install it and retry."
        exit 1
    }
}
Write-Success "Required tools found ($($tools.Keys -join ', '))"

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
$trimmedCompanyName  = $CompanyName.Trim()
$trimmedDeveloperName = $DeveloperName.Trim()

# --- Step 1: Login ------------------------------------------------------------

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

# --- Steps 2-3: Infrastructure (skip if -Update) ------------------------------

if (-not $Update) {
    Write-Step 2 $totalSteps "Provisioning infrastructure (Bicep)"
    Write-Host "  This may take 5-15 minutes. Status is printed every 30s to keep Cloud Shell alive." -ForegroundColor Gray

    try {
        az group create --name $ResourceGroupName --location $Location --output none

        az deployment group create `
            --resource-group $ResourceGroupName `
            --name main `
            --template-file $bicepPath `
            --parameters "adminPrincipalId=$AdminPrincipalId" "appClientId=$AppClientId" "tenantId=$TenantId" "companyName=$trimmedCompanyName" "developerName=$trimmedDeveloperName" `
            --no-wait --output none --only-show-errors

        if ($LASTEXITCODE -ne 0) { throw "Failed to start Bicep deployment" }

        Write-Host "  Deployment started. Polling every 30s..." -ForegroundColor Gray
        $biStart = Get-Date
        while ($true) {
            Start-Sleep -Seconds 30
            $biElapsed = [int]($(Get-Date) - $biStart).TotalSeconds
            $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
            $state = az deployment group show `
                --resource-group $ResourceGroupName --name main `
                --query "properties.provisioningState" -o tsv 2>$null
            $ErrorActionPreference = $prevEAP
            Write-Host "  ... [$([math]::Round($biElapsed/60,1)) min] Deployment: $state" -ForegroundColor DarkGray
            if ($state -eq "Succeeded") { break }
            if ($state -eq "Failed" -or $state -eq "Canceled") {
                $errJson = az deployment group show `
                    --resource-group $ResourceGroupName --name main `
                    --query "properties.error" -o json 2>$null
                throw "Bicep deployment $state`: $errJson"
            }
            if ($biElapsed -gt 1200) { throw "Bicep deployment timed out after 20 minutes" }
        }

        $deployOutput = (az deployment group show `
            --resource-group $ResourceGroupName --name main `
            --output json --only-show-errors 2>&1 |
            Where-Object { $_ -notmatch "^WARNING" }) -join "" | ConvertFrom-Json

        $outputs = $deployOutput.properties.outputs
        $script:dashboardUrl = $outputs.dashboardUrl.value
        $script:functionAppUrl = $outputs.functionAppUrl.value
        $script:managedIdentityPrincipalId = $outputs.managedIdentityPrincipalId.value
        $script:storageAccountName = $outputs.storageAccountName.value
        $script:keyVaultUri = $outputs.keyVaultUri.value
        $script:functionAppName = ($script:functionAppUrl -replace "https://", "" -replace ".azurewebsites.net", "")

        Write-Success "Infrastructure deployed"

        # Automatically update Entra App SPA redirect URI now that dashboard URL is known.
        # MUST use Graph API / --set spa= (NOT --web-redirect-uris which sets the wrong platform
        # and causes a silent redirect loop after login even though AADSTS50011 is resolved).
        if ($AppClientId -and $script:dashboardUrl) {
            Write-Host "  Updating Entra App SPA redirect URIs..." -ForegroundColor Gray
            try {
                $graphToken = (az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv 2>$null)
                $graphHeaders = @{ Authorization = "Bearer $graphToken"; "Content-Type" = "application/json" }
                $spaBody = @{ spa = @{ redirectUris = @($script:dashboardUrl, "$($script:dashboardUrl)/", "http://localhost:3000") } } | ConvertTo-Json -Depth 5
                Invoke-RestMethod -Method PATCH `
                    -Uri "https://graph.microsoft.com/v1.0/applications(appId='$AppClientId')" `
                    -Headers $graphHeaders -Body $spaBody | Out-Null
                Write-Success "SPA redirect URI set to $($script:dashboardUrl)"
            }
            catch {
                Write-Warn "Could not auto-update redirect URI: $_"
                Write-Host "  Run manually after deployment:" -ForegroundColor Yellow
                Write-Host "  .\Setup-Entra.ps1 -TenantId `"$TenantId`" -AppClientId `"$AppClientId`" -DashboardUrl `"$($script:dashboardUrl)`" -UpdateRedirectUri" -ForegroundColor Gray
            }
        }
    }
    catch {
        Write-Fail "Bicep deployment failed: $_"
        exit 1
    }

    Write-Step 3 $totalSteps "Assigning roles on all subscriptions"
    try {
        $subscriptions = (az account list --output json --only-show-errors | ConvertFrom-Json |
            Where-Object { $_.state -eq 'Enabled' -and $_.tenantId -eq $TenantId }).id
        $assignedCount = 0
        foreach ($subId in ($subscriptions -split "`n" | Where-Object { $_ -and $_.Trim() })) {
            $subId = $subId.Trim()
            try {
                $miId  = $script:managedIdentityPrincipalId
                $scope = "/subscriptions/$subId"
                # Reader  -  resource inspection across all subscriptions
                $ok = Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "acdd72a7-3385-48ef-bd42-f606fba81ae7" -Scope $scope
                if ($ok -eq $false) { continue }   # inaccessible subscription - skip silently
                # Cost Management Reader  -  billing and cost data
                Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "72fafb9e-0641-4937-9268-a91bfd8191a6" -Scope $scope | Out-Null
                # Monitoring Reader  -  Azure Monitor metrics
                Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "43d0d8ad-25c7-4714-9337-8ba259a9fe05" -Scope $scope | Out-Null
                # Contributor  -  write operations for automated remediation (VM resize, AHB, disk downgrade, etc.)
                Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "b24988ac-6180-42a0-ab88-20f7382dd24c" -Scope $scope | Out-Null
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
            $faList  = az functionapp list     --resource-group $ResourceGroupName --output json 2>$null | ConvertFrom-Json
            $swaList = az staticwebapp list    --resource-group $ResourceGroupName --output json 2>$null | ConvertFrom-Json
            $stList  = az storage account list --resource-group $ResourceGroupName --output json 2>$null | ConvertFrom-Json
            $kvList  = az keyvault list        --resource-group $ResourceGroupName --output json 2>$null | ConvertFrom-Json
            $faMatch  = $faList  | Where-Object { $_.name -like 'func-azureoptimize*' } | Select-Object -First 1
            $swaMatch = $swaList | Where-Object { $_.name -like 'swa-azureoptimize*'  } | Select-Object -First 1
            $stMatch  = $stList  | Where-Object { $_.name -like 'stazopt*'            } | Select-Object -First 1
            $kvMatch  = $kvList  | Where-Object { $_.name -like 'kv-azopt*'           } | Select-Object -First 1
            if (-not $faMatch)  { $faMatch  = $faList[0]  }
            if (-not $swaMatch) { $swaMatch = $swaList[0] }
            if (-not $stMatch)  { $stMatch  = $stList[0]  }
            if (-not $kvMatch)  { $kvMatch  = $kvList[0]  }
            $script:functionAppName    = $faMatch.name
            $script:functionAppUrl     = "https://$($script:functionAppName).azurewebsites.net"
            $swaHost                   = $swaMatch.defaultHostname
            $script:dashboardUrl       = "https://$swaHost"
            $script:storageAccountName = $stMatch.name
            $script:keyVaultUri        = $kvMatch.properties.vaultUri
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

    Write-Step 3 $totalSteps "Re-applying role assignments on all subscriptions"
    try {
        $miPrincipalId = (az identity list --resource-group $ResourceGroupName --output json 2>$null |
            ConvertFrom-Json | Where-Object { $_.name -like 'mi-azureoptimize*' } | Select-Object -First 1).principalId
        if ($miPrincipalId) {
            $script:managedIdentityPrincipalId = $miPrincipalId.Trim()
            $subscriptions = (az account list --output json --only-show-errors | ConvertFrom-Json |
                Where-Object { $_.state -eq 'Enabled' -and $_.tenantId -eq $TenantId }).id
            $assignedCount = 0
            foreach ($subId in ($subscriptions -split "`n" | Where-Object { $_ -and $_.Trim() })) {
                $subId = $subId.Trim()
                try {
                    $miId  = $script:managedIdentityPrincipalId
                    $scope = "/subscriptions/$subId"
                    $ok = Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "acdd72a7-3385-48ef-bd42-f606fba81ae7" -Scope $scope
                    if ($ok -eq $false) { continue }   # inaccessible subscription - skip silently
                    Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "72fafb9e-0641-4937-9268-a91bfd8191a6" -Scope $scope | Out-Null
                    Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "43d0d8ad-25c7-4714-9337-8ba259a9fe05" -Scope $scope | Out-Null
                    Add-RoleAssignment -PrincipalId $miId -RoleDefinitionId "b24988ac-6180-42a0-ab88-20f7382dd24c" -Scope $scope | Out-Null
                    $assignedCount++
                }
                catch {
                    Write-Warn "Could not re-apply roles on $subId"
                }
            }
            Write-Success "Roles verified on $assignedCount subscription(s)"
        }
        else {
            Write-Warn "Could not find Managed Identity in '$ResourceGroupName'  -  skipping RBAC re-apply"
        }
    }
    catch {
        Write-Warn "RBAC re-apply had issues: $_"
    }
}

# --- Branding (optional  -  update mode only; fresh installs go via Bicep) ------

if ($Update) {
    $swaNameForBranding = az staticwebapp list --resource-group $ResourceGroupName --query "[0].name" -o tsv 2>$null

    if ($trimmedCompanyName -and $script:functionAppName) {
        Write-Host "  Setting COMPANY_NAME on Function App..." -ForegroundColor Gray
        try {
            az functionapp config appsettings set `
                --name $script:functionAppName `
                --resource-group $ResourceGroupName `
                --settings "COMPANY_NAME=$trimmedCompanyName" `
                --output none 2>$null
            Write-Success "Company name set: $trimmedCompanyName"
        }
        catch { Write-Warn "Could not set COMPANY_NAME: $_" }
    }

    if ($trimmedDeveloperName -and $swaNameForBranding) {
        Write-Host "  Setting NEXT_PUBLIC_DEVELOPER_NAME on Static Web App..." -ForegroundColor Gray
        try {
            az staticwebapp appsettings set `
                --name $swaNameForBranding `
                --resource-group $ResourceGroupName `
                --setting-names "NEXT_PUBLIC_DEVELOPER_NAME=$trimmedDeveloperName" `
                --output none 2>$null
            Write-Success "Developer name set: $trimmedDeveloperName (active on next deployment)"
        }
        catch { Write-Warn "Could not set NEXT_PUBLIC_DEVELOPER_NAME: $_" }
    }
}

# --- Step 4: Configure GitHub Actions deployment ------------------------------

Write-Step 4 $totalSteps "Configuring GitHub Actions deployment"

if ($Update) {
    Write-Success "Skipped (update mode  -  existing GitHub secrets unchanged)"
}
else {

if ($GitHubToken) {
    Write-Host "  Ensuring PyNaCl is installed..." -ForegroundColor Gray
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    pip3 install PyNaCl --quiet 2>&1 | Out-Null
    $ErrorActionPreference = $prevEAP
}

$swaName     = az staticwebapp list --resource-group $ResourceGroupName --query "[0].name" -o tsv
$deployToken = az staticwebapp secrets list --name $swaName --resource-group $ResourceGroupName --query "properties.apiKey" -o tsv

# Fetch publish profile with retry+timeout - az can hang indefinitely on a freshly created app
Write-Host "  Fetching function app publish profile..." -ForegroundColor Gray
$publishProfile = $null
for ($ppRetry = 1; $ppRetry -le 6; $ppRetry++) {
    $ppJob = Start-Job -ScriptBlock {
        param($fn, $rg)
        az functionapp deployment list-publishing-profiles --name $fn --resource-group $rg --xml --only-show-errors 2>$null
    } -ArgumentList $script:functionAppName, $ResourceGroupName
    $ppDone = Wait-Job $ppJob -Timeout 40
    if ($ppDone) {
        $ppOut = (Receive-Job $ppJob | Where-Object { $_ -notmatch "^WARNING" }) -join "`n"
        Remove-Job $ppJob -Force
        if ($ppOut -match "<publishData") { $publishProfile = $ppOut; break }
    } else {
        Stop-Job $ppJob -PassThru | Remove-Job -Force
    }
    Write-Host "  ... Attempt $ppRetry/6 timed out or returned empty. Retrying in 20s..." -ForegroundColor DarkGray
    Start-SleepWithHeartbeat -Seconds 20 -Message "waiting for Kudu/SCM to initialize"
}
if (-not $publishProfile) { throw "Could not fetch publish profile after 6 attempts. Try re-running with -Update after a few minutes." }

if ($GitHubToken) {
    $ghHeaders = @{
        Authorization          = "Bearer $GitHubToken"
        Accept                 = "application/vnd.github.v3+json"
        "X-GitHub-Api-Version" = "2022-11-28"
    }

    Write-Host "  Creating GitHub environments '$ClientEnvironment' and 'default'..." -ForegroundColor Gray
    try {
        New-GitHubEnvironment -Token $GitHubToken -Repo $GitHubRepo -EnvName $ClientEnvironment
        New-GitHubEnvironment -Token $GitHubToken -Repo $GitHubRepo -EnvName "default"
        Write-Host "  v Environments ready" -ForegroundColor Green
    }
    catch {
        $errMsg = $_.ToString()
        if ($errMsg -match "403") {
            Write-Warn "Could not create GitHub environments (403 Forbidden)."
            Write-Host "  Your PAT needs the Environments permission." -ForegroundColor Yellow
            Write-Host "  Classic PAT: 'repo' scope  |  Fine-grained PAT: Actions + Environments (read/write)" -ForegroundColor Yellow
            Write-Host "  Create environments manually at: https://github.com/$GitHubRepo/settings/environments" -ForegroundColor Yellow
        } else {
            Write-Warn "Could not create GitHub environments: $errMsg"
        }
    }

    Write-Host "  Setting GitHub secrets..." -ForegroundColor Gray
    try {
        # Set secrets in client-specific environment AND in 'default' (for push-triggered deploys)
        foreach ($envTarget in @($ClientEnvironment, "default")) {
            Set-GitHubSecret -Token $GitHubToken -Repo $GitHubRepo -Name "AZURE_STATIC_WEB_APPS_API_TOKEN" -Value $deployToken -EnvName $envTarget
            Set-GitHubSecret -Token $GitHubToken -Repo $GitHubRepo -Name "AZURE_FUNCTIONAPP_PUBLISH_PROFILE" -Value $publishProfile -EnvName $envTarget
        }
        Write-Host "  v AZURE_STATIC_WEB_APPS_API_TOKEN" -ForegroundColor Green
        Write-Host "  v AZURE_FUNCTIONAPP_PUBLISH_PROFILE" -ForegroundColor Green
    }
    catch {
        Write-Fail "Failed to set GitHub secrets: $_"
        Write-Host "  Ensure PyNaCl is installed: pip3 install PyNaCl" -ForegroundColor Gray
        exit 1
    }

    Write-Host "  Setting GitHub environment variables..." -ForegroundColor Gray
    $envVars = [ordered]@{
        "AZURE_FUNCTIONAPP_NAME"         = $script:functionAppName
        "NEXT_PUBLIC_AZURE_TENANT_ID"    = $TenantId
        "NEXT_PUBLIC_AZURE_CLIENT_ID"    = $AppClientId
        "NEXT_PUBLIC_AZURE_REDIRECT_URI" = $script:dashboardUrl
        "NEXT_PUBLIC_API_BASE_URL"       = "$($script:functionAppUrl)/api"
        "NEXT_PUBLIC_ADMIN_PRINCIPAL_ID" = $AdminPrincipalId
    }
    if ($trimmedDeveloperName) { $envVars["NEXT_PUBLIC_DEVELOPER_NAME"] = $trimmedDeveloperName }

    foreach ($varName in $envVars.Keys) {
        try {
            # Set in client-specific environment AND in 'default' so push-triggered deploys work
            foreach ($envTarget in @($ClientEnvironment, "default")) {
                Set-GitHubVariable -Token $GitHubToken -Repo $GitHubRepo -Name $varName -Value $envVars[$varName] -EnvName $envTarget
            }
            Write-Host "  v $varName" -ForegroundColor Green
        }
        catch {
            Write-Warn "Could not set variable ${varName}: $_"
        }
    }

    Write-Host "  Triggering deployment workflows (environment: $ClientEnvironment)..." -ForegroundColor Gray
    $dispatchBody = @{ ref = "main"; inputs = @{ client_environment = $ClientEnvironment } } | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Method POST -Uri "https://api.github.com/repos/$GitHubRepo/actions/workflows/deploy-api.yml/dispatches" `
            -Headers $ghHeaders -Body $dispatchBody -ContentType "application/json" | Out-Null
        Invoke-RestMethod -Method POST -Uri "https://api.github.com/repos/$GitHubRepo/actions/workflows/deploy-frontend.yml/dispatches" `
            -Headers $ghHeaders -Body $dispatchBody -ContentType "application/json" | Out-Null
        Write-Success "Deployment workflows triggered"
        Write-Host "  Track progress: https://github.com/$GitHubRepo/actions" -ForegroundColor Gray
        Write-Host "  Waiting 8 minutes for GitHub Actions deployment to complete..." -ForegroundColor Gray
        Start-SleepWithHeartbeat -Seconds 480 -Message "GitHub Actions deploying"
    }
    catch {
        Write-Warn "Could not trigger workflows automatically: $_"
        Write-Host "  Manually run: https://github.com/$GitHubRepo/actions" -ForegroundColor Cyan
        exit 0
    }
}
else {
    # Save credentials to temp files for manual GitHub setup
    $secretsDir = Join-Path $script:tmpDir "azopt-github-secrets"
    New-Item -ItemType Directory -Path $secretsDir -Force | Out-Null
    Set-Content -Path (Join-Path $secretsDir "AZURE_STATIC_WEB_APPS_API_TOKEN.txt") -Value $deployToken -Encoding utf8
    Set-Content -Path (Join-Path $secretsDir "AZURE_FUNCTIONAPP_PUBLISH_PROFILE.xml") -Value $publishProfile -Encoding utf8

    $varValues = @"
AZURE_FUNCTIONAPP_NAME=$($script:functionAppName)
NEXT_PUBLIC_AZURE_TENANT_ID=$TenantId
NEXT_PUBLIC_AZURE_CLIENT_ID=$AppClientId
NEXT_PUBLIC_AZURE_REDIRECT_URI=$($script:dashboardUrl)
NEXT_PUBLIC_API_BASE_URL=$($script:functionAppUrl)/api
NEXT_PUBLIC_ADMIN_PRINCIPAL_ID=$AdminPrincipalId
NEXT_PUBLIC_DEVELOPER_NAME=$trimmedDeveloperName
"@
    Set-Content -Path (Join-Path $secretsDir "github-variables.txt") -Value $varValues -Encoding utf8

    Write-Success "Deployment credentials retrieved"
    Write-Host ""
    Write-Host "  --- ACTION REQUIRED -----------------------------------------" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  STEP A: Create a GitHub Environment named '$ClientEnvironment'" -ForegroundColor White
    Write-Host "  https://github.com/$GitHubRepo/settings/environments" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  STEP B: Add 2 Secrets to the '$ClientEnvironment' environment" -ForegroundColor White
    Write-Host ""
    Write-Host "  1. AZURE_STATIC_WEB_APPS_API_TOKEN" -ForegroundColor White
    Write-Host "     $(Join-Path $secretsDir 'AZURE_STATIC_WEB_APPS_API_TOKEN.txt')" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  2. AZURE_FUNCTIONAPP_PUBLISH_PROFILE" -ForegroundColor White
    Write-Host "     $(Join-Path $secretsDir 'AZURE_FUNCTIONAPP_PUBLISH_PROFILE.xml')" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  STEP C: Add 7 Variables to the '$ClientEnvironment' environment" -ForegroundColor White
    Write-Host "  All values saved to: $(Join-Path $secretsDir 'github-variables.txt')" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  STEP D: Also create a 'default' environment with the same secrets and variables" -ForegroundColor White
    Write-Host "  (enables automatic redeploy on git push to main)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  STEP E: Trigger the workflows manually, passing client_environment = $ClientEnvironment" -ForegroundColor White
    Write-Host "  https://github.com/$GitHubRepo/actions/workflows/deploy-api.yml" -ForegroundColor Cyan
    Write-Host "  https://github.com/$GitHubRepo/actions/workflows/deploy-frontend.yml" -ForegroundColor Cyan
    Write-Host "  -------------------------------------------------------------" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  TIP: Next time pass -GitHubToken to automate this step." -ForegroundColor Gray

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "    Infrastructure ready! Complete GitHub setup above." -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    exit 0
}

} # end if (-not $Update) for Step 4

# --- Step 5: Health check -----------------------------------------------------

Write-Step 5 $totalSteps "API health check"
$maxRetries = 25
$retryDelay = 45
$healthOk = $false

Write-Host "  Waiting up to ~18 minutes for cold start (Consumption plan)..." -ForegroundColor Gray

for ($i = 1; $i -le $maxRetries; $i++) {
    try {
        $healthResponse = Invoke-RestMethod -Uri "$($script:functionAppUrl)/api/health" -Method GET -TimeoutSec 30
        if ($healthResponse.status -eq "healthy") {
            Write-Success "API is healthy (tenant: $($healthResponse.environment.tenantId))"
            $healthOk = $true
            break
        }
        else {
            Write-Warn "Unexpected status: $($healthResponse.status). Retrying ($i/$maxRetries)..."
            if ($i -lt $maxRetries) { Start-SleepWithHeartbeat -Seconds $retryDelay -Message "health check" }
        }
    }
    catch {
        if ($i -lt $maxRetries) {
            Write-Host "  Health check attempt $i/$maxRetries failed. Retrying in ${retryDelay}s..." -ForegroundColor Gray
            Start-SleepWithHeartbeat -Seconds $retryDelay -Message "health check"
        }
    }
}

if (-not $healthOk) {
    Write-Warn "Health check did not pass after $maxRetries attempts. API may still be starting."
    Write-Host "  Check deployment logs: https://github.com/$GitHubRepo/actions" -ForegroundColor Gray
}

# --- Step 6: Smoke tests ------------------------------------------------------

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

# --- Summary -----------------------------------------------------------------

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
    Write-Host "  1. Entra App SPA redirect URI was updated automatically." -ForegroundColor White
    Write-Host "     If login fails with AADSTS50011 or loops back to login, run:" -ForegroundColor Gray
    Write-Host "     .\Setup-Entra.ps1 -TenantId `"$TenantId`" -AppClientId `"$AppClientId`" -DashboardUrl `"$($script:dashboardUrl)`" -UpdateRedirectUri" -ForegroundColor Gray
}
Write-Host "  2. Open the dashboard and sign in with your Microsoft account" -ForegroundColor White
Write-Host "  3. First cost data appears within 4 hours (timer-triggered)" -ForegroundColor White
Write-Host "  4. Future code updates deploy automatically on git push" -ForegroundColor White
if (-not $trimmedCompanyName -or -not $trimmedDeveloperName) {
    Write-Host ""
    Write-Host "  TIP: Set branding anytime with -Update:" -ForegroundColor Gray
    Write-Host "  .\Deploy-AzureCostOptimize.ps1 -TenantId $TenantId -Update -CompanyName 'Your Company' -DeveloperName 'Your Name'" -ForegroundColor Gray
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

exit 0

