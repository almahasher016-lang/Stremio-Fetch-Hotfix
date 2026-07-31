import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';
import { httpError } from '../../utils/httpError.js';

function tokenDigest(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest();
}

export function tokensMatch(supplied, expected) {
  const actualValue = String(supplied || '');
  const expectedValue = String(expected || '');
  const matched = timingSafeEqual(tokenDigest(actualValue), tokenDigest(expectedValue));
  return Boolean(actualValue) && Boolean(expectedValue) && matched;
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
