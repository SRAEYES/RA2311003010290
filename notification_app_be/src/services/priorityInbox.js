'use strict';
/**
 * Priority Inbox — Stage 6
 *
 * Returns the top-K notifications for a student based on:
 *   priorityScore = (typeWeight × 100) + recencyScore
 *
 * typeWeight:  placement=3, result=2, event=1
 * recencyScore = max(0, 100 - hoursSinceCreation)
 *
 * Algorithm: Min-Heap of size K → O(n log k) time, O(k) space
 * No external libraries used.
 */
class MinHeap {
  constructor(comparator) {
    this._data = [];
    this._cmp  = comparator; 
  }
  get size() { return this._data.length; }
  peek() { return this._data[0]; }
  push(item) {
    this._data.push(item);
    this._bubbleUp(this._data.length - 1);
  }
  pop() {
    const top  = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0) {
      this._data[0] = last;
      this._siftDown(0);
    }
    return top;
  }
  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._cmp(this._data[i], this._data[parent]) < 0) {
        [this._data[i], this._data[parent]] = [this._data[parent], this._data[i]];
        i = parent;
      } else break;
    }
  }
  _siftDown(i) {
    const n = this._data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this._cmp(this._data[l], this._data[smallest]) < 0) smallest = l;
      if (r < n && this._cmp(this._data[r], this._data[smallest]) < 0) smallest = r;
      if (smallest === i) break;
      [this._data[i], this._data[smallest]] = [this._data[smallest], this._data[i]];
      i = smallest;
    }
  }
}
const TYPE_WEIGHT = { placement: 3, result: 2, event: 1 };
/**
 * Compute a priority score for a notification.
 * @param {{ type: string, createdAt: string }} notif
 * @returns {number}
 */
function computePriorityScore(notif) {
  const weight       = TYPE_WEIGHT[notif.type] ?? 1;
  const hoursPassed  = (Date.now() - new Date(notif.createdAt).getTime()) / 3_600_000;
  const recencyScore = Math.max(0, 100 - hoursPassed);
  return weight * 100 + recencyScore;
}
/**
 * Return top K notifications by priority score.
 * @param {object[]} notifications  Raw notifications for a user
 * @param {number}   k              Default 10
 * @returns {object[]}  Sorted descending by priorityScore
 */
function topKPriorityInbox(notifications, k = 10) {
  const heap = new MinHeap((a, b) => a.priorityScore - b.priorityScore);
  for (const notif of notifications) {
    const priorityScore = computePriorityScore(notif);
    const entry = { ...notif, priorityScore: Math.round(priorityScore * 100) / 100 };
    if (heap.size < k) {
      heap.push(entry);
    } else if (heap.peek().priorityScore < priorityScore) {
      heap.pop();
      heap.push(entry);
    }
  }
  const result = [];
  while (heap.size > 0) result.unshift(heap.pop());
  return result;
}
module.exports = { topKPriorityInbox, computePriorityScore, MinHeap };
