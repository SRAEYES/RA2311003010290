'use strict';
/**
 * Request logger middleware
 * Logs method, URL, status, and duration for every request via Logging Middleware.
 */
const path = require('path');
const { Log } = require(path.join(__dirname, '..', '..', '..', 'logging_middleware'));
/**
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                  next
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms    = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                : 'info';
    Log('backend', level, 'middleware',
      `${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`
    ).catch(() => {}); 
  });
  next();
}
module.exports = { requestLogger };
