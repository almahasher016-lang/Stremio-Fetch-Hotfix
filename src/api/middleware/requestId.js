import { randomUUID } from 'node:crypto';

export function requestId(req, res, next) {
  const supplied = Array.isArray(req.headers['x-request-id'])
    ? req.headers['x-request-id'][0]
    : req.headers['x-request-id'];
  req.id = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
