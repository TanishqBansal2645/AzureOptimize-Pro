import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { HttpRequest } from '@azure/functions';

export interface UserClaims {
  oid: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

interface JwtPayload {
  oid?: string;
  sub?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  upn?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  iat?: number;
}

const tenantId = process.env['AZURE_TENANT_ID'] ?? '';
const clientId = process.env['AZURE_CLIENT_ID'] ?? '';
const adminPrincipalId = process.env['ADMIN_PRINCIPAL_ID'] ?? '';

const jwksClient = jwksRsa({
  jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxEntries: 10,
  cacheMaxAge: 600000,
  rateLimit: true,
});

function getSigningKey(header: jwt.JwtHeader): Promise<string> {
  return new Promise((resolve, reject) => {
    jwksClient.getSigningKey(header.kid ?? '', (err, key) => {
      if (err || !key) {
        reject(err ?? new Error('Signing key not found'));
      } else {
        resolve(key.getPublicKey());
      }
    });
  });
}

function verifyToken(token: string): Promise<JwtPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      (header, callback) => {
        getSigningKey(header)
          .then((key) => callback(null, key))
          .catch((err) => callback(err as Error));
      },
      {
        audience: `api://${clientId}`,
        issuer: [
          `https://login.microsoftonline.com/${tenantId}/v2.0`,
          `https://sts.windows.net/${tenantId}/`,
        ],
        algorithms: ['RS256'],
      },
      (err, decoded) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded as JwtPayload);
        }
      }
    );
  });
}

export async function validateUser(request: HttpRequest): Promise<UserClaims> {
  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);

  // In local dev mode with no tenant configured, allow bypass for testing
  if (process.env['NODE_ENV'] === 'development' && !tenantId) {
    return {
      oid: adminPrincipalId || 'dev-user',
      name: 'Dev User',
      email: 'dev@localhost',
      isAdmin: true,
    };
  }

  // verifyToken handles audience/issuer validation
  const claims = await verifyToken(token);

  const oid = claims.oid ?? claims.sub ?? '';
  const email =
    claims.preferred_username ?? claims.email ?? claims.upn ?? '';
  const name = claims.name ?? email;

  return {
    oid,
    name,
    email,
    isAdmin: oid === adminPrincipalId,
  };
}

export async function requireAdmin(request: HttpRequest): Promise<UserClaims> {
  const user = await validateUser(request);
  if (!user.isAdmin) {
    throw new Error('Admin access required');
  }
  return user;
}

export function unauthorizedResponse(message: string = 'Unauthorized') {
  return {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}

export function forbiddenResponse(message: string = 'Forbidden') {
  return {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}

export function errorResponse(message: string, status: number = 500) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}

export function jsonResponse(data: unknown, status: number = 200) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}
