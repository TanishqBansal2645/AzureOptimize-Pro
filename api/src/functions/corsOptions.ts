import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { CORS_HEADERS } from '../lib/auth/validateUser';

async function corsOptionsHandler(_request: HttpRequest): Promise<HttpResponseInit> {
  return {
    status: 204,
    headers: { ...CORS_HEADERS },
    body: '',
  };
}

app.http('corsOptionsHandler', {
  methods: ['OPTIONS'],
  authLevel: 'anonymous',
  route: '{*catchAll}',
  handler: corsOptionsHandler,
});
