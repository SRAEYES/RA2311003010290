# Campus Notification Backend

A production-grade backend system built for campus notifications.

## Quick Start

```bash
cd notification_app_be && npm install
AUTH_TOKEN=<token> node src/app.js
```

## Running Tests

```bash
# From project root
node logging_middleware/tests/logging.test.js
node vehicle_maintenance_scheduler/tests/scheduler.test.js
node notification_app_be/tests/notification.test.js
```

## Running Vehicle Scheduler

```bash
AUTH_TOKEN=<token> node vehicle_maintenance_scheduler/scheduler.js
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/notifications` | Create notification |
| GET | `/api/notifications?studentId=&page=&limit=&unreadOnly=` | List notifications |
| GET | `/api/notifications/priority-inbox?studentId=&k=` | Top-K priority inbox |
| PATCH | `/api/notifications/read-all` | Mark all as read |
| PATCH | `/api/notifications/:id/read` | Mark single as read |
| DELETE | `/api/notifications/:id` | Delete notification |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AUTH_TOKEN` | Bearer token from evaluation server |
| `PORT` | Server port (default: 3000) |
| `LOG_API_URL` | Log API endpoint (default: evaluation server) |

## Logging

All components use the logging middleware instead of console logs:

```js
const { Log, createLogger } = require('../logging_middleware');

const logger = createLogger('backend', 'handler');
await logger.info('Request received');
await Log('backend', 'error', 'db', 'Connection failed');
```
