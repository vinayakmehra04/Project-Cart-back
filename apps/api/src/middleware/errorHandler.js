/**
 * Global error handler — catches all unhandled errors
 * Must be the LAST middleware registered
 */
function errorHandler(err, req, res, _next) {
  console.error(`❌ [${req.method}] ${req.path}:`, err.message);

  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (err.code === '23505') {
    // PostgreSQL unique violation
    return res.status(409).json({ error: 'Resource already exists' });
  }

  const status = err.statusCode || err.status || 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message;

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
