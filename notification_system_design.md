# Notification System Design

## Stage 1 — API Design

### Technology Choice: WebSockets (Socket.IO)

Real-time delivery requires a persistent connection. WebSockets offer low-latency, bidirectional communication ideal for push notifications. SSE is a viable alternative but only supports server→client. Kafka/Redis Pub-Sub would be used at the broker layer in Stage 5.

---

### Core Endpoints

#### Create Notification

```
POST /api/notifications
Authorization: Bearer <token>
Content-Type: application/json

Request:
{
  "type": "placement",          // "placement" | "result" | "event"
  "title": "TCS Drive Tomorrow",
  "body": "Register by 6 PM",
  "targetStudentIds": [1, 2, 3] // array of user IDs, or empty for broadcast
}

Response 201:
{
  "notificationId": "uuid-v4",
  "type": "placement",
  "title": "TCS Drive Tomorrow",
  "body": "Register by 6 PM",
  "createdAt": "2026-05-02T10:00:00Z"
}

Errors:
  400  { "error": "type must be one of: placement, result, event" }
  500  { "error": "internal server error" }
```

---

#### Get Notifications for a Student

```
GET /api/notifications?studentId=<id>&page=<n>&limit=<n>&unreadOnly=<bool>
Authorization: Bearer <token>

Response 200:
{
  "page": 1,
  "limit": 20,
  "total": 152,
  "notifications": [
    {
      "notificationId": "uuid",
      "type": "placement",
      "title": "TCS Drive Tomorrow",
      "body": "Register by 6 PM",
      "isRead": false,
      "createdAt": "2026-05-02T10:00:00Z"
    }
  ]
}
```

---

#### Mark Single Notification as Read

```
PATCH /api/notifications/:notificationId/read
Authorization: Bearer <token>
Content-Type: application/json

Request: { "studentId": 1042 }

Response 200:
{ "notificationId": "uuid", "isRead": true }

Errors:
  404  { "error": "notification not found" }
```

---

#### Mark All Notifications as Read

```
PATCH /api/notifications/read-all
Authorization: Bearer <token>
Content-Type: application/json

Request: { "studentId": 1042 }

Response 200:
{ "updatedCount": 12 }
```

---

#### Delete Notification (optional)

```
DELETE /api/notifications/:notificationId
Authorization: Bearer <token>

Response 204: (no body)
Errors:
  404  { "error": "notification not found" }
```

---

#### Priority Inbox (Top 10)

```
GET /api/notifications/priority-inbox?studentId=<id>
Authorization: Bearer <token>

Response 200:
{
  "inbox": [
    {
      "notificationId": "uuid",
      "type": "placement",
      "priorityScore": 95.7,
      "title": "...",
      "isRead": false,
      "createdAt": "2026-05-02T10:00:00Z"
    },
    ...
  ]
}
```

---

### WebSocket Events

```
Client → Server:
  "subscribe"  { studentId: 1042 }

Server → Client:
  "notification" { notificationId, type, title, body, createdAt }
  "read_ack"     { notificationId }
```

---

## Stage 2 — Database Design

### Chosen Database: PostgreSQL

**Reasons**: ACID compliance, JSONB support, robust indexing, mature ecosystem.

---

### Schema

```sql
-- Users
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(255) NOT NULL,
  department    VARCHAR(100),
  batch_year    SMALLINT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications (global records, content only)
CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          VARCHAR(20) NOT NULL CHECK (type IN ('placement','result','event')),
  title         VARCHAR(500) NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Mapping: which student got which notification + read state
CREATE TABLE user_notifications (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, notification_id)
);
```

---

### Index Strategy

```sql
-- Unread notifications per student (most common query)
CREATE INDEX idx_un_user_unread
  ON user_notifications (user_id, is_read)
  WHERE is_read = FALSE;

-- Fetch recent notifications for a student (sorted)
CREATE INDEX idx_un_user_delivered
  ON user_notifications (user_id, delivered_at DESC);

-- Notification lookup by type (for priority inbox)
CREATE INDEX idx_notif_type_created
  ON notifications (type, created_at DESC);

-- Composite covering index for the main query pattern
CREATE INDEX idx_un_covering
  ON user_notifications (user_id, is_read, delivered_at DESC)
  INCLUDE (notification_id);
```

---

### Scaling Strategy

| Strategy | Detail |
|---|---|
| **Partitioning** | Partition `user_notifications` by `user_id % 10` (hash) or by `delivered_at` range (monthly) |
| **Read replicas** | Route SELECT queries to read replicas; writes to primary |
| **Redis cache** | Cache unread count per student; invalidate on `PATCH /read` |
| **Connection pooling** | PgBouncer in transaction mode in front of PostgreSQL |
| **Sharding** | At 100M+ rows: shard `user_notifications` by `user_id` using Citus or Vitess |

---

## Stage 3 — Query Optimization

### Given Slow Query

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

**Why it's slow:**
1. `SELECT *` fetches all columns including large `body` TEXT — unnecessary data transfer.
2. No composite index on `(studentID, isRead, createdAt)` — causes full table scan.
3. `ORDER BY createdAt DESC` without an index causes an in-memory sort.

**Fix — add composite partial index + rewrite query:**

```sql
-- Index (created in Stage 2)
CREATE INDEX idx_un_user_unread_date
  ON user_notifications (user_id, delivered_at DESC)
  WHERE is_read = FALSE;

-- Optimized query (using proper schema)
SELECT
  n.id            AS "notificationId",
  n.type,
  n.title,
  n.body,
  un.is_read      AS "isRead",
  un.delivered_at AS "createdAt"
FROM user_notifications un
JOIN notifications n ON n.id = un.notification_id
WHERE un.user_id = 1042
  AND un.is_read = FALSE
ORDER BY un.delivered_at DESC
LIMIT 20;
```

**Why faster:**
- Partial index `WHERE is_read = FALSE` is tiny — only unread rows indexed.
- Composite index satisfies both filter and sort — no separate sort step.
- Explicit column list avoids fetching unnecessary data.
- `LIMIT 20` stops scan early (cursor-based pagination can eliminate even that).

---

### Students with Placement Notifications in Last 7 Days

```sql
SELECT DISTINCT u.id, u.name, u.email
FROM users u
JOIN user_notifications un ON un.user_id = u.id
JOIN notifications n       ON n.id = un.notification_id
WHERE n.type = 'placement'
  AND n.created_at >= NOW() - INTERVAL '7 days'
ORDER BY u.name;
```

---

## Stage 4 — Performance Improvement

### Problems with Current Architecture
1. **Poll on every page load** → redundant DB hits (O(users × page_loads) queries/minute).
2. **No caching** → Every read fetches from PostgreSQL even for unchanged data.
3. **Large payloads** → Entire notification list transferred even when only 2-3 are new.

---

### Improvements

#### A. Redis Caching

```
Key: notif:unread_count:{userId}   TTL: 60s
Key: notif:inbox:{userId}:page:{n} TTL: 30s

On mark-read: DEL notif:unread_count:{userId}
On new notif: DEL notif:inbox:{userId}:*
```

Cache hit rate > 95% for read-heavy workloads. Reduces DB QPS by ~80%.

#### B. Cursor-Based Pagination

Replace `OFFSET`-based with cursor (last `delivered_at`) to avoid deep-page scan regression.

```
GET /api/notifications?studentId=1042&cursor=2026-05-01T10:00:00Z&limit=20
```

#### C. WebSocket Push Instead of Polling

- Client subscribes once on mount.
- Server pushes notification event on creation.
- Client appends to local state — no API call needed.

#### D. Lazy Loading / Infinite Scroll

- Fetch first 20 on load.
- Fetch next page only when user scrolls near bottom.
- Combine with cursor pagination.

---

### Trade-offs

| Approach | Benefit | Trade-off |
|---|---|---|
| Redis cache | Massive read throughput gain | Cache invalidation complexity |
| WebSockets | Zero-poll real-time | Connection state management |
| Cursor pagination | Stable perf at any page depth | Cannot jump to arbitrary page |
| Lazy loading | Reduced initial payload | Slightly more complex UI state |

---

## Stage 5 — Scaling to 50,000 Users

### Problem Statement

A `notify_all` call for 50,000 students currently:
- Processes sequentially (O(N) time in single process)
- No failure handling (one failure breaks the loop)
- Blocks the HTTP request thread

---

### Redesigned Architecture

```
HTTP Handler
     │
     ▼
[Message Broker — Kafka / RabbitMQ]
     │
     ├── Partition 0 → Worker 1 (students 0–12499)
     ├── Partition 1 → Worker 2 (students 12500–24999)
     ├── Partition 2 → Worker 3 (students 25000–37499)
     └── Partition 3 → Worker 4 (students 37500–49999)
           │
           ├── Insert into user_notifications (batch)
           ├── Push via WebSocket / FCM / email
           └── Dead-letter queue on failure → retry up to 3×
```

#### Key Design Decisions

| Concept | Decision |
|---|---|
| **Queue** | Kafka (ordered, durable, high-throughput) |
| **Fan-out** | Producer publishes one message; consumer fan-out service creates per-user records in bulk INSERT |
| **Retry** | Exponential back-off (1s, 4s, 16s); after 3 failures → Dead-Letter Queue |
| **Idempotency** | `UNIQUE (user_id, notification_id)` prevents duplicate delivery; use `INSERT ... ON CONFLICT DO NOTHING` |
| **Monitoring** | Prometheus metrics: queue depth, consumer lag, failure rate |
| **Batching** | Workers batch 500 inserts in a single transaction |

#### Handler Change

```js
// Before (blocking)
for (const student of 50000_students) {
  await sendNotification(student.id, data); // sequential
}

// After (async, non-blocking)
await kafkaProducer.send({
  topic: 'notify-all',
  messages: [{ value: JSON.stringify({ notificationData, targetGroup: 'all' }) }],
});
res.status(202).json({ message: 'Notification queued for delivery' });
```

---

## Stage 6 — Priority Inbox Algorithm

See implementation in `notification_app_be/src/services/priorityInbox.js`.

### Algorithm: Max-Heap (Priority Queue)

**Priority Score Formula:**
```
score = (typeWeight × 100) + recencyScore

typeWeight:
  placement → 3
  result    → 2
  event     → 1

recencyScore = max(0, 100 - hoursSinceCreation)
```

**Complexity**: O(n log k) where k = 10 (top-K heap)  
**Space**: O(k)

This ensures placement notifications always rank above result > event, and newer notifications of the same type rank higher.
