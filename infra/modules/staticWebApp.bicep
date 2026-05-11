@description('Static Web App name')
param staticWebAppName string

@description('Azure region (Static Web Apps have limited regions)')
param location string

@description('Tenant ID')
param tenantId string

@description('App Client ID')
param appClientId string

@description('Function App URL for API backend')
param functionAppUrl string

@description('Admin user Entra Object ID')
param adminPrincipalId string

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
  }
}

// App settings for the Static Web App
resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2023-01-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    NEXT_PUBLIC_AZURE_TENANT_ID: tenantId
    NEXT_PUBLIC_AZURE_CLIENT_ID: appClientId
    NEXT_PUBLIC_AZURE_REDIRECT_URI: 'https://${staticWebApp.properties.defaultHostname}'
    NEXT_PUBLIC_API_BASE_URL: '${functionAppUrl}/api'
    NEXT_PUBLIC_ADMIN_PRINCIPAL_ID: adminPrincipalId
  }
}

output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output staticWebAppId string = staticWebApp.id
output deploymentToken string = staticWebApp.listSecrets().properties.apiKey
