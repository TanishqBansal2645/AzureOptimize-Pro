@description('Location for all resources')
param location string = resourceGroup().location

@description('Unique suffix for resource names')
param uniqueSuffix string = substring(uniqueString(resourceGroup().id), 0, 6)

@description('Admin user Entra Object ID')
param adminPrincipalId string

@description('Entra app registration client ID')
param appClientId string

@description('Azure tenant ID')
param tenantId string

// ─── Variables ───────────────────────────────────────────────────────────────

var functionAppName = 'func-azureoptimize-${uniqueSuffix}'
var storageAccountName = 'stazopt${uniqueSuffix}'
var keyVaultName = 'kv-azopt-${uniqueSuffix}'
var staticWebAppName = 'swa-azureoptimize-${uniqueSuffix}'
var managedIdentityName = 'mi-azureoptimize-${uniqueSuffix}'
var appServicePlanName = 'asp-azureoptimize-${uniqueSuffix}'
var appInsightsName = 'ai-azureoptimize-${uniqueSuffix}'
var logWorkspaceName = 'log-azureoptimize-${uniqueSuffix}'

// ─── Managed Identity ────────────────────────────────────────────────────────

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: managedIdentityName
  location: location
}

// ─── Storage Account ─────────────────────────────────────────────────────────

module storage 'modules/storage.bicep' = {
  name: 'storageDeployment'
  params: {
    storageAccountName: storageAccountName
    location: location
    managedIdentityPrincipalId: managedIdentity.properties.principalId
  }
}

// ─── Key Vault ───────────────────────────────────────────────────────────────

module keyVault 'modules/keyVault.bicep' = {
  name: 'keyVaultDeployment'
  params: {
    keyVaultName: keyVaultName
    location: location
    tenantId: tenantId
    adminPrincipalId: adminPrincipalId
    managedIdentityPrincipalId: managedIdentity.properties.principalId
    storageConnectionString: storage.outputs.connectionString
    appClientId: appClientId
    adminObjectId: adminPrincipalId
  }
}

// ─── Log Analytics Workspace (for App Insights) ──────────────────────────────

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logWorkspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 31
    features: {
      searchVersion: 1
    }
  }
}

// ─── Application Insights ────────────────────────────────────────────────────

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

// ─── Function App ─────────────────────────────────────────────────────────────

module functionApp 'modules/functionApp.bicep' = {
  name: 'functionAppDeployment'
  params: {
    functionAppName: functionAppName
    appServicePlanName: appServicePlanName
    location: location
    storageAccountName: storageAccountName
    storageConnectionString: storage.outputs.connectionString
    managedIdentityId: managedIdentity.id
    managedIdentityClientId: managedIdentity.properties.clientId
    keyVaultUri: keyVault.outputs.keyVaultUri
    appInsightsConnectionString: appInsights.properties.ConnectionString
    tenantId: tenantId
    adminPrincipalId: adminPrincipalId
    appClientId: appClientId
  }
}

// ─── Static Web App ───────────────────────────────────────────────────────────

module staticWebApp 'modules/staticWebApp.bicep' = {
  name: 'staticWebAppDeployment'
  params: {
    staticWebAppName: staticWebAppName
    location: 'eastus2' // Static Web Apps not available in eastus
    tenantId: tenantId
    appClientId: appClientId
    functionAppUrl: functionApp.outputs.functionAppUrl
    adminPrincipalId: adminPrincipalId
  }
}

// ─── Outputs ─────────────────────────────────────────────────────────────────

output dashboardUrl string = staticWebApp.outputs.staticWebAppUrl
output functionAppUrl string = functionApp.outputs.functionAppUrl
output storageAccountName string = storageAccountName
output keyVaultUri string = keyVault.outputs.keyVaultUri
output managedIdentityId string = managedIdentity.id
output managedIdentityClientId string = managedIdentity.properties.clientId
output managedIdentityPrincipalId string = managedIdentity.properties.principalId
