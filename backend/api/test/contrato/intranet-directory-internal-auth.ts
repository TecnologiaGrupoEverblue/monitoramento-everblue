// CÓPIA FIEL do contrato da Intranet (git_intranet_grupo_everblue/backend/lib/directory-internal-auth.ts,
// versão de 29/09/2026). Usada SÓ em teste, para provar que a assinatura do
// Monitoramento é aceita pelo verificador real. Não editar: atualizar copiando de novo.
import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;
const MAX_CLOCK_SKEW_SECONDS = 90;

export type VerifiedInternalDirectoryRequest = {
  clientId: string;
  userObjectId: string;
  nonce: string;
};

export class InternalDirectoryAuthError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function requiredHeader(request: Request, name: string) {
  const value = request.headers.get(name)?.trim();
  if (!value) throw new InternalDirectoryAuthError('INTERNAL_AUTH_REQUIRED');
  return value;
}

function masterSecret(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const value = environment.ACCESS_API_MASTER_SECRET?.trim() ?? '';
  if (value.length < 32) throw new InternalDirectoryAuthError('INTERNAL_AUTH_CONFIGURATION_MISSING');
  return value;
}

export function deriveDirectoryIntegrationSecret(
  clientId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const normalizedClientId = clientId.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalizedClientId)) throw new InternalDirectoryAuthError('INTERNAL_AUTH_CLIENT_INVALID');
  return createHmac('sha256', masterSecret(environment))
    .update(`everblue-directory:v1:${normalizedClientId}`, 'utf8')
    .digest('base64url');
}

export function canonicalDirectoryRequest(input: {
  method: string;
  pathname: string;
  clientId: string;
  userObjectId: string;
  timestamp: string;
  nonce: string;
}) {
  return [
    'v1',
    input.method.toUpperCase(),
    input.pathname,
    input.clientId.toLowerCase(),
    input.userObjectId.toLowerCase(),
    input.timestamp,
    input.nonce,
  ].join('\n');
}

export function verifyInternalDirectoryRequest(
  request: Request,
  options: {
    nowSeconds?: number;
    environment?: Readonly<Record<string, string | undefined>>;
  } = {},
): VerifiedInternalDirectoryRequest {
  const clientId = requiredHeader(request, 'x-everblue-client-id').toLowerCase();
  const userObjectId = requiredHeader(request, 'x-everblue-user-oid').toLowerCase();
  const timestamp = requiredHeader(request, 'x-everblue-timestamp');
  const nonce = requiredHeader(request, 'x-everblue-nonce');
  const suppliedSignature = requiredHeader(request, 'x-everblue-signature').toLowerCase();

  if (!UUID_PATTERN.test(clientId)) throw new InternalDirectoryAuthError('INTERNAL_AUTH_CLIENT_INVALID');
  if (!UUID_PATTERN.test(userObjectId)) throw new InternalDirectoryAuthError('INTERNAL_AUTH_SUBJECT_INVALID');
  if (!/^\d{10}$/.test(timestamp)) throw new InternalDirectoryAuthError('INTERNAL_AUTH_TIMESTAMP_INVALID');
  if (!NONCE_PATTERN.test(nonce)) throw new InternalDirectoryAuthError('INTERNAL_AUTH_NONCE_INVALID');
  if (!SIGNATURE_PATTERN.test(suppliedSignature)) throw new InternalDirectoryAuthError('INTERNAL_AUTH_SIGNATURE_INVALID');

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    throw new InternalDirectoryAuthError('INTERNAL_AUTH_EXPIRED');
  }

  const pathname = new URL(request.url).pathname;
  const canonical = canonicalDirectoryRequest({
    method: request.method,
    pathname,
    clientId,
    userObjectId,
    timestamp,
    nonce,
  });
  const expected = createHmac('sha256', deriveDirectoryIntegrationSecret(clientId, options.environment))
    .update(canonical, 'utf8')
    .digest();
  const supplied = Buffer.from(suppliedSignature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new InternalDirectoryAuthError('INTERNAL_AUTH_SIGNATURE_INVALID');
  }
  return { clientId, userObjectId, nonce };
}
