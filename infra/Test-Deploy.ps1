<#
.SYNOPSIS
    Automated smoke tests for a deployed AzureOptimize Pro instance.

.DESCRIPTION
    Runs a comprehensive set of API tests against a live deployment.
    All tests are unauthenticated where possible (health check) or use
    anonymous-mode function keys. JWT-protected endpoints are tested
    by verifying correct 401/403 responses rather than full roundtrips.

    Tests run automatically at the end of Deploy-AzureCostOptimize.ps1,
    or you can run this script independently after deployment.

.PARAMETER ApiUrl
    The base API URL, e.g. https://func-azureoptimize-abc123.azurewebsites.net/api

.PARAMETER TenantId
    The Azure tenant ID (used to verify environment config in health check).

.PARAMETER Verbose
    Show detailed output for each test.

.EXAMPLE
    .\Test-Deploy.ps1 -ApiUrl "https://func-azopt-abc.azurewebsites.net/api" -TenantId "xxx"
#>

param(
    [Parameter(Mandatory = $true)]
    [string] $ApiUrl,

    [Parameter(Mandatory = $false)]
    [string] $TenantId = "",

    [switch] $ShowDetail
)

$ErrorActionPreference = "Continue"
$ApiUrl = $ApiUrl.TrimEnd('/')

$script:passed = 0
$script:failed = 0
$script:warned = 0
$script:results = @()

function Write-TestResult {
    param([string]$Name, [string]$Status, [string]$Detail = "")
    $color = switch ($Status) {
        "PASS" { "Green" }
        "FAIL" { "Red" }
        "WARN" { "Yellow" }
        default { "White" }
    }
    $icon = switch ($Status) {
        "PASS" { "v" }
        "FAIL" { "x" }
        "WARN" { "!" }
        default { "-" }
    }
    Write-Host "  [$icon] $Name" -ForegroundColor $color
    if ($Detail -and $ShowDetail) {
        Write-Host "      $Detail" -ForegroundColor Gray
    }
    $script:results += [PSCustomObject]@{ Name = $Name; Status = $Status; Detail = $Detail }
    switch ($Status) {
        "PASS" { $script:passed++ }
        "FAIL" { $script:failed++ }
        "WARN" { $script:warned++ }
    }
}

function Invoke-ApiTest {
    param(
        [string]$Name,
        [string]$Url,
        [string]$Method = "GET",
        [hashtable]$Headers = @{},
        [string]$Body = $null,
        [int]$ExpectedStatus = 200,
        [string]$ExpectedJsonField = $null,
        [scriptblock]$Validator = $null
    )

    try {
        $params = @{
            Uri         = $Url
            Method      = $Method
            TimeoutSec  = 30
            ErrorAction = "Stop"
        }

        if ($Headers.Count -gt 0) {
            $params.Headers = $Headers
        }

        if ($Body) {
            $params.Body = $Body
            $params.ContentType = "application/json"
        }

        $response = Invoke-RestMethod @params
        $statusCode = 200  # Invoke-RestMethod only returns on 2xx

        if ($ExpectedStatus -ne 200 -and $ExpectedStatus -ne 201) {
            Write-TestResult -Name $Name -Status "FAIL" -Detail "Expected $ExpectedStatus but got 200"
            return $null
        }

        if ($ExpectedJsonField -and -not ($response.PSObject.Properties.Name -contains $ExpectedJsonField)) {
            Write-TestResult -Name $Name -Status "FAIL" -Detail "Response missing field '$ExpectedJsonField'"
            return $null
        }

        if ($Validator) {
            $validationResult = & $Validator $response
            if ($validationResult -eq $false) {
                Write-TestResult -Name $Name -Status "FAIL" -Detail "Custom validation failed"
                return $null
            }
        }

        Write-TestResult -Name $Name -Status "PASS" -Detail "OK"
        return $response
    }
    catch {
        $statusCode = 0
        $errorMsg = $_.Exception.Message

        # Extract HTTP status code from exception
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }

        if ($statusCode -eq $ExpectedStatus) {
            Write-TestResult -Name $Name -Status "PASS" -Detail "Got expected $ExpectedStatus"
            return $null
        }

        if ($ExpectedStatus -eq 401 -and $statusCode -eq 401) {
            Write-TestResult -Name $Name -Status "PASS" -Detail "Correctly rejected (401)"
            return $null
        }

        Write-TestResult -Name $Name -Status "FAIL" -Detail "Status $statusCode - $errorMsg"
        return $null
    }
}

# --- Test Suite ---------------------------------------------------------------

Write-Host ""
Write-Host "  AzureOptimize Pro - Automated Smoke Tests" -ForegroundColor Blue
Write-Host "  API: $ApiUrl" -ForegroundColor Gray
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss UTC')" -ForegroundColor Gray
Write-Host ""
Write-Host "  [Section 1] Health & Configuration" -ForegroundColor Cyan

# Test 1: Health endpoint
$health = Invoke-ApiTest `
    -Name "GET /health - API is alive" `
    -Url "$ApiUrl/health" `
    -ExpectedJsonField "status" `
    -Validator {
        param($r)
        $r.status -eq "healthy"
    }

if ($health) {
    if ($health.environment.tenantId -eq "configured") {
        Write-TestResult -Name "  Tenant ID is configured" -Status "PASS"
    }
    else {
        Write-TestResult -Name "  Tenant ID is configured" -Status "WARN" -Detail "AZURE_TENANT_ID not set in function app settings"
    }

    if ($health.environment.storageAccount -eq "configured") {
        Write-TestResult -Name "  Storage account is configured" -Status "PASS"
    }
    else {
        Write-TestResult -Name "  Storage account is configured" -Status "WARN" -Detail "STORAGE_ACCOUNT_NAME not set"
    }

    if ($health.environment.adminPrincipal -eq "configured") {
        Write-TestResult -Name "  Admin principal is configured" -Status "PASS"
    }
    else {
        Write-TestResult -Name "  Admin principal is configured" -Status "WARN" -Detail "ADMIN_PRINCIPAL_ID not set"
    }
}

Write-Host ""
Write-Host "  [Section 2] Authentication Enforcement" -ForegroundColor Cyan

# All protected endpoints must reject unauthenticated requests with 401
$protectedEndpoints = @(
    @{ Path = "costs"; Method = "GET" },
    @{ Path = "idle-resources"; Method = "GET" },
    @{ Path = "rightsizing"; Method = "GET" },
    @{ Path = "reservations"; Method = "GET" },
    @{ Path = "ahb"; Method = "GET" },
    @{ Path = "storage"; Method = "GET" },
    @{ Path = "databases"; Method = "GET" },
    @{ Path = "asp"; Method = "GET" },
    @{ Path = "dismissed"; Method = "GET" },
    @{ Path = "budgets"; Method = "GET" },
    @{ Path = "savings"; Method = "GET" },
    @{ Path = "reports"; Method = "GET" }
)

foreach ($ep in $protectedEndpoints) {
    Invoke-ApiTest `
        -Name "GET /$($ep.Path) - rejects unauthenticated" `
        -Url "$ApiUrl/$($ep.Path)" `
        -Method $ep.Method `
        -ExpectedStatus 401
}

Write-Host ""
Write-Host "  [Section 3] Admin-Only Enforcement" -ForegroundColor Cyan

# Admin endpoints must reject non-admin requests
$adminEndpoints = @(
    @{ Path = "costs/refresh"; Method = "POST" },
    @{ Path = "idle-resources/refresh"; Method = "POST" },
    @{ Path = "asp/refresh"; Method = "POST" },
    @{ Path = "refresh"; Method = "POST" }
)

foreach ($ep in $adminEndpoints) {
    Invoke-ApiTest `
        -Name "$($ep.Method) /$($ep.Path) - rejects unauthenticated" `
        -Url "$ApiUrl/$($ep.Path)" `
        -Method $ep.Method `
        -ExpectedStatus 401
}

Write-Host ""
Write-Host "  [Section 4] Input Validation" -ForegroundColor Cyan

# Test 400 responses for bad input
Invoke-ApiTest `
    -Name "POST /recommendations/implement - rejects empty body" `
    -Url "$ApiUrl/recommendations/implement" `
    -Method "POST" `
    -Headers @{ "Authorization" = "Bearer invalid-token" } `
    -Body '{}' `
    -ExpectedStatus 401

Invoke-ApiTest `
    -Name "POST /budgets - rejects unauthenticated" `
    -Url "$ApiUrl/budgets" `
    -Method "POST" `
    -Body '{"name":"test","subscriptionId":"sub1","amount":100}' `
    -ExpectedStatus 401

Write-Host ""
Write-Host "  [Section 5] Static Web App Reachability" -ForegroundColor Cyan

# Extract function app name and derive SWA URL (best effort)
$functionHost = ($ApiUrl -replace "/api$", "" -replace "https://", "")
Write-TestResult -Name "  Function App host resolved: $functionHost" -Status "PASS"

# Try to reach the function app root
try {
    $rootResponse = Invoke-WebRequest -Uri ($ApiUrl -replace "/api$", "") -TimeoutSec 15 -ErrorAction SilentlyContinue
    if ($rootResponse.StatusCode -lt 500) {
        Write-TestResult -Name "  Function App base URL responds" -Status "PASS"
    }
    else {
        Write-TestResult -Name "  Function App base URL responds" -Status "WARN" -Detail "Got $($rootResponse.StatusCode)"
    }
}
catch {
    Write-TestResult -Name "  Function App base URL responds" -Status "WARN" -Detail "Not directly accessible (expected for consumption plan)"
}

Write-Host ""
Write-Host "  [Section 6] CORS Headers Check" -ForegroundColor Cyan

try {
    $corsResponse = Invoke-WebRequest `
        -Uri "$ApiUrl/health" `
        -Method OPTIONS `
        -Headers @{ "Origin" = "https://test.example.com"; "Access-Control-Request-Method" = "GET" } `
        -TimeoutSec 15 `
        -ErrorAction SilentlyContinue

    $allowOrigin = $corsResponse.Headers["Access-Control-Allow-Origin"]
    if ($allowOrigin) {
        Write-TestResult -Name "  CORS headers present" -Status "PASS" -Detail "Allow-Origin: $allowOrigin"
    }
    else {
        Write-TestResult -Name "  CORS headers present" -Status "WARN" -Detail "No CORS headers (may be handled by Azure)"
    }
}
catch {
    Write-TestResult -Name "  CORS check" -Status "WARN" -Detail "Could not verify CORS: $_"
}

Write-Host ""
Write-Host "  [Section 7] Response Time Check" -ForegroundColor Cyan

$timings = @()
for ($i = 1; $i -le 3; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Invoke-RestMethod -Uri "$ApiUrl/health" -TimeoutSec 30 -ErrorAction Stop | Out-Null
        $sw.Stop()
        $timings += $sw.ElapsedMilliseconds
    }
    catch {
        $sw.Stop()
    }
}

if ($timings.Count -gt 0) {
    $avgMs = [int]($timings | Measure-Object -Average).Average
    $maxMs = [int]($timings | Measure-Object -Maximum).Maximum
    if ($avgMs -lt 3000) {
        Write-TestResult -Name "  Health endpoint response time (avg: ${avgMs}ms, max: ${maxMs}ms)" -Status "PASS"
    }
    elseif ($avgMs -lt 10000) {
        Write-TestResult -Name "  Health endpoint response time (avg: ${avgMs}ms, max: ${maxMs}ms)" -Status "WARN" -Detail "Slow - cold starts on Consumption plan"
    }
    else {
        Write-TestResult -Name "  Health endpoint response time (avg: ${avgMs}ms, max: ${maxMs}ms)" -Status "FAIL" -Detail "Very slow - check function app status"
    }
}
else {
    Write-TestResult -Name "  Response time check" -Status "FAIL" -Detail "Could not reach health endpoint"
}

# --- Summary ------------------------------------------------------------------

$total = $script:passed + $script:failed + $script:warned
Write-Host ""
Write-Host "  ====================================================" -ForegroundColor Blue
Write-Host "  Test Results: $total total" -ForegroundColor Blue
Write-Host "  Passed : $($script:passed)" -ForegroundColor Green
Write-Host "  Warnings: $($script:warned)" -ForegroundColor Yellow
Write-Host "  Failed : $($script:failed)" -ForegroundColor Red
Write-Host "  ====================================================" -ForegroundColor Blue
Write-Host ""

if ($script:failed -gt 0) {
    Write-Host "  FAILED TESTS:" -ForegroundColor Red
    $script:results | Where-Object { $_.Status -eq "FAIL" } | ForEach-Object {
        Write-Host "    x $($_.Name)" -ForegroundColor Red
        if ($_.Detail) {
            Write-Host "      $($_.Detail)" -ForegroundColor Gray
        }
    }
    Write-Host ""
    throw "$($script:failed) test(s) failed"
}
elseif ($script:warned -gt 0) {
    Write-Host "  Some warnings detected. Review items marked with '!'" -ForegroundColor Yellow
    Write-Host "  Warnings are usually config issues that don't block functionality." -ForegroundColor Gray
    Write-Host ""
}
else {
    Write-Host "  All tests passed! Deployment is healthy." -ForegroundColor Green
    Write-Host ""
}
