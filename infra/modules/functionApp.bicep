@description('Function App name')
param functionAppName string

@description('App Service Plan name')
param appServicePlanName string

@description('Azure region')
param location string

@description('Storage account name')
param storageAccountName string

@description('Managed Identity resource ID')
param managedIdentityId string

@description('Managed Identity client ID')
param managedIdentityClientId string

@description('Key Vault URI')
param keyVaultUri string

@description('App Insights connection string')
param appInsightsConnectionString string

@description('Tenant ID')
param tenantId string

@description('Admin principal ID')
param adminPrincipalId string

@description('App Client ID')
param appClientId string

@description('Storage account connection string (required for bootstrap settings on Consumption plan)')
param storageConnectionString string

// Consumption App Service Plan
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  kind: 'functionapp'
  properties: {
    reserved: false
  }
}

// Function App
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: storageConnectionString
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: storageConnectionString
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: functionAppName
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'AZURE_TENANT_ID'
          value: tenantId
        }
        {
          name: 'AZURE_CLIENT_ID'
          value: appClientId
        }
        {
          name: 'STORAGE_ACCOUNT_NAME'
          value: storageAccountName
        }
        {
          name: 'STORAGE_CONNECTION_STRING'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/storage-connection-string/)'
        }
        {
          name: 'ADMIN_PRINCIPAL_ID'
          value: adminPrincipalId
        }
        {
          name: 'KEY_VAULT_URI'
          value: keyVaultUri
        }
        {
          name: 'AZURE_CLIENT_ID_MI'
          value: managedIdentityClientId
        }
        {
          name: 'CORS_ORIGINS'
          value: '*'
        }
      ]
      cors: {
        allowedOrigins: [
          'https://portal.azure.com'
          '*'
        ]
        supportCredentials: false
      }
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      nodeVersion: '~20'
    }
    httpsOnly: true
  }
}

output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output functionAppId string = functionApp.id
