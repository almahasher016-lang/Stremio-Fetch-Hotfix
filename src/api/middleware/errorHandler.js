export function errorHandler(err, req, res, _next) {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  const payload = {
    success: false,
    error: status >= 500 ? 'Internal server error' : err.message,
    requestId: req.id,
  };

  if (status < 500 && err.details) payload.details = err.details;

  if (status >= 500) {
    console.error('[error]', {
      requestId: req.id,
      path: req.originalUrl,
      message: err?.message,
      stack: err?.stack,
    });
  }

  res.status(status).setHeader('Cache-Control', 'no-store');
  res.json(payload);
}
