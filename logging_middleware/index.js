'use strict';
/**
 * Logging Middleware
 * Reusable module that sends structured logs to the external evaluation log API.
 * Supports: stack (backend/frontend), level (debug/info/warn/error/fatal),
 *           package (handler/db/service/etc.), message.
 *
 * Usage:
 *   const { Log } = require('../logging_middleware');
 *   await Log('backend', 'info', 'handler', 'Request received');
 */
const https = require('https');
const http = require('http');
const LOG_API_URL = process.env.LOG_API_URL || 'http://20.207.122.201/evaluation-service/logs';
const AUTH_TOKEN  = process.env.AUTH_TOKEN  || '';   
const VALID_STACKS = new Set(['backend', 'frontend']);
const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
const VALID_PACKAGES = new Set([
  'cache', 'controller', 'cron_job', 'db', 'domain',
  'handler', 'repository', 'route', 'service',
  'api', 'component', 'hook', 'page', 'state', 'style',
  'auth', 'config', 'middleware', 'utils',
]);
/**
 * Perform a JSON POST request.
 * @param {string} url
 * @param {object} body
 * @param {object} headers
 * @returns {Promise<{status: number, data: object}>}
 */
function postJSON(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const options = {
      hostname : parsed.hostname,
      port     : parsed.port || (isHttps ? 443 : 80),
      path     : parsed.pathname + (parsed.search || ''),
      method   : 'POST',
      headers  : {
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    };
    const lib = isHttps ? https : http;
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, data: { raw } });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
/**
 * Send a log entry to the evaluation log API.
 *
 * @param {string} stack   - 'backend' | 'frontend'
 * @param {string} level   - 'debug' | 'info' | 'warn' | 'error' | 'fatal'
 * @param {string} pkg     - one of the allowed package names
 * @param {string} message - human-readable log message
 * @returns {Promise<{logID: string, message: string} | null>}
 */
async function Log(stack, level, pkg, message) {
  if (typeof stack   !== 'string' || !VALID_STACKS.has(stack.toLowerCase())) {
    throw new TypeError(`[logging_middleware] Invalid stack "${stack}". Must be one of: ${[...VALID_STACKS].join(', ')}`);
  }
  if (typeof level   !== 'string' || !VALID_LEVELS.has(level.toLowerCase())) {
    throw new TypeError(`[logging_middleware] Invalid level "${level}". Must be one of: ${[...VALID_LEVELS].join(', ')}`);
  }
  if (typeof pkg     !== 'string' || !VALID_PACKAGES.has(pkg.toLowerCase())) {
    throw new TypeError(`[logging_middleware] Invalid package "${pkg}". Must be one of: ${[...VALID_PACKAGES].join(', ')}`);
  }
  if (typeof message !== 'string' || message.trim() === '') {
    throw new TypeError('[logging_middleware] message must be a non-empty string');
  }
  const body = {
    stack  : stack.toLowerCase(),
    level  : level.toLowerCase(),
    package: pkg.toLowerCase(),
    message: message.trim(),
  };
  const headers = {};
  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }
  try {
    const result = await postJSON(LOG_API_URL, body, headers);
    if (result.status === 200) {
      return result.data;          
    }
    process.stderr.write(
      `[logging_middleware] API responded with status ${result.status}: ${JSON.stringify(result.data)}\n`
    );
    return null;
  } catch (err) {
    process.stderr.write(`[logging_middleware] Network error: ${err.message}\n`);
    return null;
  }
}
const createLogger = (stack, pkg) => ({
  debug : (msg) => Log(stack, 'debug', pkg, msg),
  info  : (msg) => Log(stack, 'info',  pkg, msg),
  warn  : (msg) => Log(stack, 'warn',  pkg, msg),
  error : (msg) => Log(stack, 'error', pkg, msg),
  fatal : (msg) => Log(stack, 'fatal', pkg, msg),
});
module.exports = {
  Log,
  createLogger,
  VALID_STACKS,
  VALID_LEVELS,
  VALID_PACKAGES,
};
