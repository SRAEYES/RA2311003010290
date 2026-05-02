'use strict';
/**
 * Application entry point — Campus Notification Backend
 *
 * Start: node src/app.js
 * PORT defaults to 3000 (override with PORT env var)
 * AUTH_TOKEN env var must be set for logging middleware to send to the eval API
 */
const express = require('express');
const path    = require('path');
const { requestLogger } = require('./middleware/requestLogger');
const notificationsRouter = require('./routes/notifications');
const { Log, createLogger } = require(path.join(__dirname, '..', '..', 'logging_middleware'));
const app    = express();
const PORT   = process.env.PORT || 3000;
const logger  = createLogger('backend', 'route');
app.use(express.json());
app.use(requestLogger);
app.use('/api/notifications', notificationsRouter);
app.get('/health', async (req, res) => {
  await logger.info('Health check endpoint called');
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use(async (req, res) => {
  await Log('backend', 'warn', 'route', `404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
});
app.use(async (err, req, res, _next) => {
  await Log('backend', 'error', 'middleware', `Unhandled exception: ${err.message}`);
  res.status(500).json({ error: 'internal server error' });
});
app.listen(PORT, async () => {
  await Log('backend', 'info', 'config', `Notification service started on port ${PORT}`);
  console.log(`\n🚀 Notification Backend running at http:
  console.log(`   Health: http:
  console.log(`   API:    http:
});
module.exports = app; 
