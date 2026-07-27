import { timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';
import { httpError } from '../../utils/httpError.js';

function tokensMatch(supplied, expected) {
  const actualBytes = Buffer.from(String(supplied || ''), 'utf8');
  const expectedBytes = Buffer.from(String(expected || ''), 'utf8');
  if (!actualBytes.length || actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

function bearerToken(value) {
  const match = String(value || '').match(/^Bearer ([^\s]+)$/i);
  return match?.[1] || '';
}

export function suppliedAdminToken(req) {
  return bearerToken(req.headers.authorization)
    || req.headers['x-admin-token']
    // Transitional header support for the existing companion and browser UI.
    || req.headers['x-vault-token']
    || req.headers['x-registry-token']
    || '';
}

export function assertAdminAuth(req) {
  if (!config.admin.token) throw httpError(503, 'Administrative access is not configured');
  if (!tokensMatch(suppliedAdminToken(req), config.admin.token)) {
    throw httpError(401, 'A valid administrator token is required');
  }
}

export function requireAdminAuth(req, _res, next) {
  try {
    assertAdminAuth(req);
    next();
  } catch (error) {
    next(error);
  }
}
