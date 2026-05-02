'use strict';

/**
 * Notification System — E2E Test Suite
 *
 * Run: node tests/notification.test.js
 *
 * Starts the server on a random port, exercises all endpoints,
 * tests edge cases, validates the priority inbox algorithm,
 * and shuts down cleanly.
 */

const http   = require('http');
const path   = require('path');

// Suppress server startup output during tests
const PORT   = 3099;
process.env.PORT = PORT;

// Import store helpers and priority inbox directly (unit-level)
const {
  createNotification,
  getNotificationsForUser,
  markAsRead,
  markAllAsRead,
  getRawNotificationsForUser,
  getAllUserIds,
} = require('../src/store/notificationStore');

const { topKPriorityInbox, computePriorityScore, MinHeap } = require('../src/services/priorityInbox');

// ---------------------------------------------------------------------------
// Lightweight test runner
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const logs = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`     → ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
}

// ---------------------------------------------------------------------------
// HTTP helper for integration tests
// ---------------------------------------------------------------------------
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port    : PORT,
      path,
      method,
      headers : { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Unit Tests — Priority Inbox Algorithm
// ---------------------------------------------------------------------------
console.log('\n=== Unit Tests: Priority Inbox ===\n');

(async () => {
  // --- MinHeap basic ---
  await test('MinHeap: push/pop returns items in ascending order', async () => {
    const h = new MinHeap((a, b) => a - b);
    [5, 3, 8, 1, 4].forEach(x => h.push(x));
    const out = [];
    while (h.size > 0) out.push(h.pop());
    assert(JSON.stringify(out) === JSON.stringify([1,3,4,5,8]), `Got ${out}`);
  });

  // --- Score computation ---
  await test('computePriorityScore: placement scores higher than event for same age', async () => {
    const time = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const sp   = computePriorityScore({ type: 'placement', createdAt: time });
    const se   = computePriorityScore({ type: 'event',     createdAt: time });
    assert(sp > se, `placement(${sp}) should > event(${se})`);
  });

  await test('computePriorityScore: newer notification scores higher (same type)', async () => {
    const old   = computePriorityScore({ type: 'result', createdAt: new Date(Date.now() - 10*3600000).toISOString() });
    const fresh = computePriorityScore({ type: 'result', createdAt: new Date(Date.now() - 1*3600000).toISOString()  });
    assert(fresh > old, `fresh(${fresh}) should > old(${old})`);
  });

  // --- topK ---
  await test('topKPriorityInbox: returns at most K items', async () => {
    const notifs = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`, type: i % 3 === 0 ? 'placement' : i % 3 === 1 ? 'result' : 'event',
      title: `Title ${i}`, body: `Body ${i}`,
      createdAt: new Date(Date.now() - i * 3600000).toISOString(),
    }));
    const result = topKPriorityInbox(notifs, 10);
    assertEqual(result.length, 10, `Expected 10, got ${result.length}`);
  });

  await test('topKPriorityInbox: result is sorted by priorityScore descending', async () => {
    const notifs = Array.from({ length: 15 }, (_, i) => ({
      id: `n${i}`,
      type: ['placement','result','event'][i % 3],
      title: `T${i}`, body: `B${i}`,
      createdAt: new Date(Date.now() - i * 1800000).toISOString(),
    }));
    const result = topKPriorityInbox(notifs, 10);
    for (let i = 1; i < result.length; i++) {
      assert(result[i-1].priorityScore >= result[i].priorityScore,
        `Not sorted at index ${i}: ${result[i-1].priorityScore} < ${result[i].priorityScore}`);
    }
  });

  await test('topKPriorityInbox: placement always ranks above event (same recency)', async () => {
    const t = new Date().toISOString();
    const notifs = [
      { id: 'e1', type: 'event',     title:'E', body:'b', createdAt: t },
      { id: 'p1', type: 'placement', title:'P', body:'b', createdAt: t },
    ];
    const result = topKPriorityInbox(notifs, 2);
    assertEqual(result[0].type, 'placement', `Top should be placement, got ${result[0].type}`);
  });

  await test('topKPriorityInbox: empty input returns empty array', async () => {
    const result = topKPriorityInbox([], 10);
    assertEqual(result.length, 0, 'Expected empty array');
  });

  await test('topKPriorityInbox: fewer than K items returns all', async () => {
    const notifs = [
      { id: 'a', type: 'placement', title:'A', body:'x', createdAt: new Date().toISOString() },
    ];
    const result = topKPriorityInbox(notifs, 10);
    assertEqual(result.length, 1, 'Should return 1 item');
  });

  // ---------------------------------------------------------------------------
  // Unit Tests — Store
  // ---------------------------------------------------------------------------
  console.log('\n=== Unit Tests: Notification Store ===\n');

  await test('createNotification: adds notification and delivers to target users', async () => {
    const allUsers = getAllUserIds();
    const notif    = createNotification('event', 'Test Event', 'Body here', [9999], allUsers);
    assert(notif.id, 'notif.id should be set');
    assertEqual(notif.type, 'event', 'Type mismatch');

    const { notifications: rows } = getNotificationsForUser(9999, {});
    const found = rows.find(r => r.notificationId === notif.id);
    assert(found, 'Notification should appear for target user');
  });

  await test('getNotificationsForUser: unreadOnly filter works', async () => {
    const allUsers = getAllUserIds();
    createNotification('result', 'Filter Test', 'body', [9998], allUsers);

    const { notifications: unread } = getNotificationsForUser(9998, { unreadOnly: true });
    assert(unread.every(n => !n.isRead), 'All should be unread');
  });

  await test('markAsRead: sets isRead true for correct user+notif', async () => {
    const allUsers = getAllUserIds();
    const notif  = createNotification('placement', 'Read Test', 'body', [9997], allUsers);
    const ok     = markAsRead(9997, notif.id);
    assert(ok, 'markAsRead should return true');

    const { notifications } = getNotificationsForUser(9997, {});
    const found = notifications.find(n => n.notificationId === notif.id);
    assert(found?.isRead, 'Should be marked read');
  });

  await test('markAsRead: returns false for unknown notification', async () => {
    const ok = markAsRead(1001, 'non-existent-id');
    assert(!ok, 'Should return false for unknown ID');
  });

  await test('markAllAsRead: marks all unread notifications for user', async () => {
    const count = markAllAsRead(1002);
    assert(typeof count === 'number', 'Should return a number');
    const { notifications } = getNotificationsForUser(1002, { unreadOnly: true });
    assertEqual(notifications.length, 0, 'All should be read now');
  });

  // ---------------------------------------------------------------------------
  // Integration Tests — HTTP API
  // ---------------------------------------------------------------------------
  console.log('\n=== Integration Tests: HTTP API ===\n');

  // Start server
  const app    = require('../src/app');
  // Give server 200ms to bind
  await new Promise(r => setTimeout(r, 200));

  await test('GET /health returns 200 ok', async () => {
    const { status, data } = await request('GET', '/health');
    assertEqual(status, 200, `Expected 200 got ${status}`);
    assertEqual(data.status, 'ok', 'Health status mismatch');
  });

  await test('GET /api/notifications without studentId returns 400', async () => {
    const { status } = await request('GET', '/api/notifications');
    assertEqual(status, 400, `Expected 400 got ${status}`);
  });

  await test('GET /api/notifications?studentId=1001 returns list', async () => {
    const { status, data } = await request('GET', '/api/notifications?studentId=1001');
    assertEqual(status, 200, `Expected 200 got ${status}`);
    assert(Array.isArray(data.notifications), 'notifications should be array');
    assert(data.total >= 0, 'total should be non-negative');
  });

  await test('POST /api/notifications with valid body returns 201', async () => {
    const { status, data } = await request('POST', '/api/notifications', {
      type: 'placement', title: 'Integration Test Notif', body: 'Test body', targetStudentIds: [1001],
    });
    assertEqual(status, 201, `Expected 201 got ${status}: ${JSON.stringify(data)}`);
    assert(data.id, 'id should be present');
  });

  await test('POST /api/notifications with invalid type returns 400', async () => {
    const { status } = await request('POST', '/api/notifications', {
      type: 'unknown', title: 'Bad Type', body: 'body',
    });
    assertEqual(status, 400, `Expected 400 got ${status}`);
  });

  await test('POST /api/notifications missing title returns 400', async () => {
    const { status } = await request('POST', '/api/notifications', {
      type: 'event', body: 'no title here',
    });
    assertEqual(status, 400, `Expected 400 got ${status}`);
  });

  await test('PATCH /api/notifications/read-all returns updatedCount', async () => {
    const { status, data } = await request('PATCH', '/api/notifications/read-all', { studentId: 1003 });
    assertEqual(status, 200, `Expected 200 got ${status}`);
    assert(typeof data.updatedCount === 'number', 'updatedCount should be number');
  });

  await test('PATCH /api/notifications/:id/read marks single notification read', async () => {
    // Get a notification for student 1004
    const { data } = await request('GET', '/api/notifications?studentId=1004');
    const notifId  = data.notifications[0]?.notificationId;
    if (!notifId) { console.log('     (no notifications to mark read — skipping)'); return; }

    const { status, data: rd } = await request('PATCH', `/api/notifications/${notifId}/read`, { studentId: 1004 });
    assertEqual(status, 200, `Expected 200 got ${status}`);
    assert(rd.isRead === true, 'isRead should be true');
  });

  await test('PATCH unknown notif/read returns 404', async () => {
    const { status } = await request('PATCH', '/api/notifications/bad-uuid/read', { studentId: 1001 });
    assertEqual(status, 404, `Expected 404 got ${status}`);
  });

  await test('GET /api/notifications/priority-inbox returns top 10 sorted', async () => {
    const { status, data } = await request('GET', '/api/notifications/priority-inbox?studentId=1001');
    assertEqual(status, 200, `Expected 200 got ${status}`);
    assert(Array.isArray(data.inbox), 'inbox should be array');
    assert(data.inbox.length <= 10, 'Should have at most 10 items');
    for (let i = 1; i < data.inbox.length; i++) {
      assert(data.inbox[i-1].priorityScore >= data.inbox[i].priorityScore,
        `Not sorted at ${i}: ${data.inbox[i-1].priorityScore} vs ${data.inbox[i].priorityScore}`);
    }
  });

  await test('GET /api/notifications/priority-inbox without studentId returns 400', async () => {
    const { status } = await request('GET', '/api/notifications/priority-inbox');
    assertEqual(status, 400, `Expected 400 got ${status}`);
  });

  await test('DELETE /api/notifications/:id removes notification', async () => {
    // Create a temp notif first
    const { data: notif } = await request('POST', '/api/notifications', {
      type: 'event', title: 'Delete Me', body: 'temp', targetStudentIds: [1001],
    });
    const { status } = await request('DELETE', `/api/notifications/${notif.id}`);
    assertEqual(status, 204, `Expected 204 got ${status}`);
  });

  await test('DELETE non-existent notification returns 404', async () => {
    const { status } = await request('DELETE', '/api/notifications/no-such-id');
    assertEqual(status, 404, `Expected 404 got ${status}`);
  });

  await test('GET unknown route returns 404', async () => {
    const { status } = await request('GET', '/api/unknown');
    assertEqual(status, 404, `Expected 404 got ${status}`);
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
})();
