import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { credential } from '../lib/azure/credential';
import { jsonResponse } from '../lib/auth/validateUser';

async function resolveTenantName(): Promise<string> {
  try {
    const token = await credential.getToken('https://management.azure.com/.default');
    const res = await fetch(
      'https://management.azure.com/tenants?api-version=2022-12-01',
      { headers: { Authorization: `Bearer ${token.token}` } }
    );
    if (!res.ok) return '';
    const body = await res.json() as { value?: Array<{ displayName?: string }> };
    return body.value?.[0]?.displayName ?? '';
  } catch {
    return '';
  }
}

async function getConfigHttp(
  _request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const envName = (process.env['COMPANY_NAME'] ?? '').trim();
    if (envName) {
      return jsonResponse({ companyName: envName });
    }

    const tenantName = await resolveTenantName();
    return jsonResponse({ companyName: tenantName });
  } catch (err) {
    context.error('Error resolving config:', err);
    return jsonResponse({ companyName: '' });
  }
}

app.http('getConfig', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'config',
  handler: getConfigHttp,
});
