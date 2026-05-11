@description('Key Vault name')
param keyVaultName string

@description('Azure region')
param location string

@description('Tenant ID')
param tenantId string

@description('Admin user principal ID')
param adminPrincipalId string

@description('Managed identity principal ID')
param managedIdentityPrincipalId string

@description('Storage connection string secret value')
param storageConnectionString string

@description('App client ID')
param appClientId string

@description('Admin user Entra Object ID')
param adminObjectId string

// Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
  }
}

// Grant admin user Key Vault Administrator role
var keyVaultAdminRoleId = '00482a5a-887f-4fb3-b363-3b7fe8e74483'
resource adminKeyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, adminPrincipalId, keyVaultAdminRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultAdminRoleId)
    principalId: adminPrincipalId
    principalType: 'User'
  }
}

// Grant managed identity Key Vault Secrets User role
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
resource miKeyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, managedIdentityPrincipalId, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Store secrets
resource storageConnectionSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'storage-connection-string'
  properties: {
    value: storageConnectionString
  }
  dependsOn: [adminKeyVaultRole]
}

resource appClientIdSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'app-client-id'
  properties: {
    value: appClientId
  }
  dependsOn: [adminKeyVaultRole]
}

resource adminObjectIdSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'admin-principal-id'
  properties: {
    value: adminObjectId
  }
  dependsOn: [adminKeyVaultRole]
}

output keyVaultUri string = keyVault.properties.vaultUri
output keyVaultId string = keyVault.id
