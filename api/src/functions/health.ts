import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { CORS_HEADERS } from '../lib/auth/validateUser';

async function healthHandler(
  _request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Health check requested');
  return {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: {
        tenantId: process.env['AZURE_TENANT_ID'] ? 'configured' : 'missing',
        storageAccount: process.env['STORAGE_ACCOUNT_NAME'] ? 'configured' : 'missing',
        adminPrincipal: process.env['ADMIN_PRINCIPAL_ID'] ? 'configured' : 'missing',
      },
    }),
  };
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: healthHandler,
});
