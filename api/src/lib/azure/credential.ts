import { DefaultAzureCredential } from '@azure/identity';

const miClientId = process.env['AZURE_CLIENT_ID_MI'];

export const credential = new DefaultAzureCredential(
  miClientId ? { managedIdentityClientId: miClientId } : undefined
);
