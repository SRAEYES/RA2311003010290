'use strict';

/**
 * Notification Routes
 * All routes are under /api/notifications
 */

const express = require('express');
const router  = express.Router();
const path    = require('path');

const {
  createNotification,
  getNotificationsForUser,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getRawNotificationsForUser,
  getAllUserIds,
} = require('../store/notificationStore');

const { topKPriorityInbox } = require('../services/priorityInbox');
const { Log, createLogger }  = require(path.join(__dirname, '..', '..', '..', 'logging_middleware'));

const logger = createLogger('backend', 'handler');

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------
const VALID_TYPES = new Set(['placement', 'result', 'event']);

function validateType(type) {
  return VALID_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// POST /api/notifications  — create a new notification
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  await logger.info(`POST /api/notifications — body: ${JSON.stringify(req.body)}`);

  const { type, title, body, targetStudentIds = [] } = req.body;

  if (!type || !validateType(type)) {
    await Log('backend', 'warn', 'handler', `Invalid notification type supplied: ${type}`);
    return res.status(400).json({ error: 'type must be one of: placement, result, event' });
  }
  if (!title || !body) {
    await Log('backend', 'warn', 'handler', 'Missing title or body in notification request');
    return res.status(400).json({ error: 'title and body are required' });
  }

  try {
    const allUsers = getAllUserIds();
    const notif    = createNotification(type, title, body, targetStudentIds, allUsers);

    await Log('backend', 'info', 'service', `Notification created: ${notif.id} type=${type}`);
    return res.status(201).json(notif);
  } catch (err) {
    await Log('backend', 'error', 'handler', `Error creating notification: ${err.message}`);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/notifications/priority-inbox?studentId=&k=
// IMPORTANT: This route must be BEFORE /:notificationId routes
// ---------------------------------------------------------------------------
router.get('/priority-inbox', async (req, res) => {
  const studentId = parseInt(req.query.studentId, 10);
  const k         = parseInt(req.query.k, 10) || 10;

  await logger.info(`GET /priority-inbox studentId=${studentId} k=${k}`);

  if (!studentId || isNaN(studentId)) {
    await Log('backend', 'warn', 'handler', 'priority-inbox called without valid studentId');
    return res.status(400).json({ error: 'studentId is required' });
  }

  try {
    const raw   = getRawNotificationsForUser(studentId);
    const inbox = topKPriorityInbox(raw, k);

    await Log('backend', 'info', 'service',
      `Priority inbox for student ${studentId}: top ${inbox.length} of ${raw.length}`);

    return res.status(200).json({ inbox });
  } catch (err) {
    await Log('backend', 'error', 'handler', `Priority inbox error: ${err.message}`);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/notifications?studentId=&page=&limit=&unreadOnly=
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const studentId  = parseInt(req.query.studentId, 10);
  const page       = parseInt(req.query.page, 10) || 1;
  const limit      = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const unreadOnly = req.query.unreadOnly === 'true';

  await logger.info(`GET /api/notifications studentId=${studentId} page=${page} limit=${limit} unreadOnly=${unreadOnly}`);

  if (!studentId || isNaN(studentId)) {
    await Log('backend', 'warn', 'handler', 'GET notifications called without valid studentId');
    return res.status(400).json({ error: 'studentId query param is required' });
  }

  try {
    const result = getNotificationsForUser(studentId, { page, limit, unreadOnly });
    await Log('backend', 'debug', 'handler',
      `Returned ${result.notifications.length} notifications for student ${studentId}`);
    return res.status(200).json({ page, limit, ...result });
  } catch (err) {
    await Log('backend', 'error', 'handler', `Error fetching notifications: ${err.message}`);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/notifications/read-all — mark all as read
// ---------------------------------------------------------------------------
router.patch('/read-all', async (req, res) => {
  const { studentId } = req.body;

  await logger.info(`PATCH /read-all for studentId=${studentId}`);

  if (!studentId) {
    await Log('backend', 'warn', 'handler', 'read-all called without studentId');
    return res.status(400).json({ error: 'studentId is required in request body' });
  }

  try {
    const updatedCount = markAllAsRead(parseInt(studentId, 10));
    await Log('backend', 'info', 'service',
      `Marked ${updatedCount} notifications as read for student ${studentId}`);
    return res.status(200).json({ updatedCount });
  } catch (err) {
    await Log('backend', 'error', 'handler', `Error in read-all: ${err.message}`);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/notifications/:notificationId/read — mark single as read
// ---------------------------------------------------------------------------
router.patch('/:notificationId/read', async (req, res) => {
  const { notificationId } = req.params;
  const { studentId }      = req.body;

  await logger.info(`PATCH /${notificationId}/read for studentId=${studentId}`);

  if (!studentId) {
    await Log('backend', 'warn', 'handler', 'mark-read called without studentId');
    return res.status(400).json({ error: 'studentId is required in request body' });
  }

  try {
    const ok = markAsRead(parseInt(studentId, 10), notificationId);
    if (!ok) {
      await Log('backend', 'warn', 'handler',
        `Notification ${notificationId} not found for student ${studentId}`);
      return res.status(404).json({ error: 'notification not found for this student' });
    }
    await Log('backend', 'info', 'service',
      `Notification ${notificationId} marked read for student ${studentId}`);
    return res.status(200).json({ notificationId, isRead: true });
  } catch (err) {
    await Log('backend', 'error', 'handler', `Error marking read: ${err.message}`);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/notifications/:notificationId
// ---------------------------------------------------------------------------
router.delete('/:notificationId', async (req, res) => {
  const { notificationId } = req.params;

  await logger.info(`DELETE /api/notifications/${notificationId}`);

  try {
    const ok = deleteNotification(notificationId);
    if (!ok) {
      await Log('backend', 'warn', 'handler', `Delete: notification ${notificationId} not found`);
      return res.status(404).json({ error: 'notification not found' });
    }
    await Log('backend', 'info', 'service', `Notification ${notificationId} deleted`);
    return res.status(204).send();
  } catch (err) {
    await Log('backend', 'error', 'handler', `Error deleting notification: ${err.message}`);
    return res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;
