'use strict';
/**
 * In-memory data store for notifications.
 * Simulates a database for the purposes of this evaluation.
 * In production this would be replaced with a PostgreSQL adapter.
 */
const { v4: uuidv4 } = require('uuid');
const notifications = new Map();
const userNotifications = new Map();
/**
 * Insert a new notification and fan-out to target students.
 * @param {string} type
 * @param {string} title
 * @param {string} body
 * @param {number[]} targetStudentIds  (empty = broadcast to all known users)
 * @param {Set<number>} allKnownUsers
 * @returns {object} the created notification
 */
function createNotification(type, title, body, targetStudentIds, allKnownUsers) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const notif = { id, type, title, body, createdAt: now };
  notifications.set(id, notif);
  const recipients = targetStudentIds.length > 0
    ? targetStudentIds
    : [...allKnownUsers];
  for (const userId of recipients) {
    const key = `${userId}::${id}`;
    userNotifications.set(key, {
      userId,
      notificationId : id,
      isRead         : false,
      readAt         : null,
      deliveredAt    : now,
    });
  }
  return notif;
}
/**
 * Get notifications for a specific student.
 * @param {number} userId
 * @param {{ page, limit, unreadOnly }} opts
 * @returns {{ total, notifications: object[] }}
 */
function getNotificationsForUser(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
  const rows = [];
  for (const [key, un] of userNotifications) {
    if (un.userId !== userId) continue;
    if (unreadOnly && un.isRead) continue;
    const notif = notifications.get(un.notificationId);
    if (!notif) continue;
    rows.push({
      notificationId : notif.id,
      type           : notif.type,
      title          : notif.title,
      body           : notif.body,
      isRead         : un.isRead,
      readAt         : un.readAt,
      createdAt      : notif.createdAt,
    });
  }
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total  = rows.length;
  const offset = (page - 1) * limit;
  return { total, notifications: rows.slice(offset, offset + limit) };
}
/**
 * Mark a single notification as read for a user.
 * @returns {boolean} true if found, false if not
 */
function markAsRead(userId, notificationId) {
  const key = `${userId}::${notificationId}`;
  const un  = userNotifications.get(key);
  if (!un) return false;
  un.isRead = true;
  un.readAt = new Date().toISOString();
  return true;
}
/**
 * Mark ALL notifications as read for a user.
 * @returns {number} count of updated records
 */
function markAllAsRead(userId) {
  let count = 0;
  const now = new Date().toISOString();
  for (const [, un] of userNotifications) {
    if (un.userId === userId && !un.isRead) {
      un.isRead = true;
      un.readAt = now;
      count++;
    }
  }
  return count;
}
/**
 * Delete a notification (admin action).
 * @returns {boolean}
 */
function deleteNotification(notificationId) {
  if (!notifications.has(notificationId)) return false;
  notifications.delete(notificationId);
  for (const [key, un] of userNotifications) {
    if (un.notificationId === notificationId) {
      userNotifications.delete(key);
    }
  }
  return true;
}
/**
 * Raw notifications list for a user (for priority inbox computation).
 * @param {number} userId
 * @returns {object[]}
 */
function getRawNotificationsForUser(userId) {
  const rows = [];
  for (const [, un] of userNotifications) {
    if (un.userId !== userId) continue;
    const notif = notifications.get(un.notificationId);
    if (!notif) continue;
    rows.push({ ...notif, isRead: un.isRead, deliveredAt: un.deliveredAt });
  }
  return rows;
}
/** Expose all known user IDs */
function getAllUserIds() {
  const ids = new Set();
  for (const [, un] of userNotifications) ids.add(un.userId);
  return ids;
}
/** Seed some initial notifications so the service is non-empty on startup */
function seed() {
  const now   = Date.now();
  const hour  = 3600 * 1000;
  const seeded = [
    { type: 'placement', title: 'TCS NQT Drive — 5th May', body: 'Register by 30th April. Eligible branches: CSE, IT, ECE.', hoursAgo: 1  },
    { type: 'result',    title: 'Semester 6 Results Published', body: 'Check your portal for grade cards.', hoursAgo: 3  },
    { type: 'event',     title: 'Technical Fest — CodeSprint 2026', body: 'Register before 3rd May. Cash prizes for top 3.', hoursAgo: 5  },
    { type: 'placement', title: 'Infosys SP Off-Campus',           body: 'Apply via official career portal by May 8.', hoursAgo: 7  },
    { type: 'result',    title: 'Project Viva Marks Upload',       body: 'Marks uploaded for Batch 2023. Check LMS.', hoursAgo: 10 },
    { type: 'event',     title: 'Alumni Talk — AI in Healthcare',  body: 'RSVP by May 4. Venue: Seminar Hall B.', hoursAgo: 12 },
    { type: 'placement', title: 'Wipro Elite NLTH Notification',   body: 'Test on May 6. Admit card available now.', hoursAgo: 20 },
    { type: 'event',     title: 'Hackathon 48h — Smart Cities',    body: 'Team registration closes May 5.', hoursAgo: 24 },
    { type: 'result',    title: 'Internship Assessment Results',   body: 'Check inbox for individual feedback.', hoursAgo: 30 },
    { type: 'placement', title: 'Accenture ASE Drive',             body: 'Aptitude test link sent to registered email.', hoursAgo: 40 },
    { type: 'event',     title: 'Guest Lecture — Web3 & DeFi',     body: 'Online session on May 7, 3 PM.', hoursAgo: 48 },
    { type: 'placement', title: 'Cognizant GenC Evolve',           body: 'Results of earlier round released.', hoursAgo: 50 },
  ];
  const studentIds = [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010];
  for (const s of seeded) {
    const id        = uuidv4();
    const createdAt = new Date(now - s.hoursAgo * hour).toISOString();
    notifications.set(id, { id, type: s.type, title: s.title, body: s.body, createdAt });
    for (const uid of studentIds) {
      const key = `${uid}::${id}`;
      userNotifications.set(key, {
        userId         : uid,
        notificationId : id,
        isRead         : false,
        readAt         : null,
        deliveredAt    : createdAt,
      });
    }
  }
}
seed();
module.exports = {
  createNotification,
  getNotificationsForUser,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getRawNotificationsForUser,
  getAllUserIds,
};
