import {
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const accountName = process.env['STORAGE_ACCOUNT_NAME'] ?? '';
const connectionString = process.env['STORAGE_CONNECTION_STRING'] ?? '';
const REPORTS_CONTAINER = 'reports';

function getBlobServiceClient(): BlobServiceClient {
  if (connectionString && connectionString !== '') {
    return BlobServiceClient.fromConnectionString(connectionString);
  }
  const url = `https://${accountName}.blob.core.windows.net`;
  return new BlobServiceClient(url, new DefaultAzureCredential());
}

async function ensureContainer(containerName: string): Promise<ContainerClient> {
  const client = getBlobServiceClient();
  const container = client.getContainerClient(containerName);
  try {
    await container.createIfNotExists();
  } catch {
    // Container may already exist — ignore
  }
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
  // Extract account key from connection string for SAS generation
  const match = connectionString.match(/AccountKey=([^;]+)/);
  if (!match) {
    // Without account key, return the blob URL directly (works with Managed Identity in prod via Azure Portal)
    return blobUrl;
  }

  const accountKey = match[1];
  const blobName = blobUrl.split(`/${REPORTS_CONTAINER}/`)[1];

  const sharedKeyCredential = new StorageSharedKeyCredential(
    accountName,
    accountKey
  );

  const expiresOn = new Date();
  expiresOn.setHours(expiresOn.getHours() + 1);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: REPORTS_CONTAINER,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn: new Date(),
      expiresOn,
      protocol: SASProtocol.Https,
    },
    sharedKeyCredential
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
