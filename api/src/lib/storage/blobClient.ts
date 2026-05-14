import {
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob';
import { credential } from '../azure/credential';

const accountName = process.env['STORAGE_ACCOUNT_NAME'] ?? '';
const connectionString = process.env['STORAGE_CONNECTION_STRING'] ?? '';
const REPORTS_CONTAINER = 'reports';

function getBlobServiceClient(): BlobServiceClient {
  if (connectionString && connectionString !== '') {
    return BlobServiceClient.fromConnectionString(connectionString);
  }
  const url = `https://${accountName}.blob.core.windows.net`;
  return new BlobServiceClient(url, credential);
}

async function ensureContainer(containerName: string): Promise<ContainerClient> {
  const client = getBlobServiceClient();
  const container = client.getContainerClient(containerName);
  await container.createIfNotExists();
  return container;
}

export async function uploadExcelReport(
  fileName: string,
  buffer: Buffer
): Promise<string> {
  const container = await ensureContainer(REPORTS_CONTAINER);
  const blobClient = container.getBlockBlobClient(fileName);
  await blobClient.upload(buffer, buffer.length, {
    blobHTTPHeaders: {
      blobContentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  });
  return blobClient.url;
}

export async function generateSasUrl(blobUrl: string): Promise<string> {
  const blobName = blobUrl.split(`/${REPORTS_CONTAINER}/`)[1];
  const startsOn = new Date();
  const expiresOn = new Date();
  expiresOn.setHours(expiresOn.getHours() + 1);

  // Local dev: use account key from connection string
  const match = connectionString.match(/AccountKey=([^;]+)/);
  if (match) {
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, match[1]);
    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: REPORTS_CONTAINER,
        blobName,
        permissions: BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https,
      },
      sharedKeyCredential
    ).toString();
    return `${blobUrl}?${sasToken}`;
  }

  // Production: use user delegation key via Managed Identity
  // Requires Storage Blob Delegator role on the storage account
  const serviceClient = getBlobServiceClient();
  const userDelegationKey = await serviceClient.getUserDelegationKey(startsOn, expiresOn);
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: REPORTS_CONTAINER,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    userDelegationKey,
    accountName
  ).toString();
  return `${blobUrl}?${sasToken}`;
}

export async function listReportBlobs(): Promise<
  Array<{ name: string; url: string; createdOn: Date | undefined }>
> {
  const container = await ensureContainer(REPORTS_CONTAINER);
  const results: Array<{ name: string; url: string; createdOn: Date | undefined }> = [];

  for await (const blob of container.listBlobsFlat()) {
    const blobClient = container.getBlockBlobClient(blob.name);
    results.push({
      name: blob.name,
      url: blobClient.url,
      createdOn: blob.properties.createdOn,
    });
  }

  return results.sort(
    (a, b) =>
      (b.createdOn?.getTime() ?? 0) - (a.createdOn?.getTime() ?? 0)
  );
}

export async function deleteReportBlob(blobName: string): Promise<void> {
  const container = await ensureContainer(REPORTS_CONTAINER);
  const blobClient = container.getBlockBlobClient(blobName);
  await blobClient.deleteIfExists();
}
