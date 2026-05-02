'use strict';

/**
 * Tests for Vehicle Maintenance Scheduler
 * Run: node tests/scheduler.test.js
 */

const { knapsack01 } = require('../scheduler');

let passed = 0;
let failed = 0;

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

console.log('\n=== Vehicle Scheduler – Knapsack Tests ===\n');

(async () => {
  // --- Basic correctness ---
  await test('small input - classic 0/1 knapsack', async () => {
    const vehicles = [
      { TaskID: 'a', Duration: 2, Impact: 6 },
      { TaskID: 'b', Duration: 2, Impact: 10 },
      { TaskID: 'c', Duration: 3, Impact: 12 },
    ];
    const { totalImpact, selectedTasks } = knapsack01(vehicles, 5);
    // Optimal: b + c = impact 22, duration 5
    assert(totalImpact === 22, `Expected 22, got ${totalImpact}`);
    assert(selectedTasks.length === 2, `Expected 2 tasks, got ${selectedTasks.length}`);
  });

  // --- Edge: zero capacity ---
  await test('edge case - zero mechanic hours', async () => {
    const vehicles = [
      { TaskID: 'x', Duration: 1, Impact: 100 },
    ];
    const { totalImpact, selectedTasks } = knapsack01(vehicles, 0);
    assert(totalImpact === 0, `Expected 0 impact, got ${totalImpact}`);
    assert(selectedTasks.length === 0, 'Should select no tasks');
  });

  // --- Edge: all tasks exceed budget ---
  await test('edge case - all tasks exceed budget', async () => {
    const vehicles = [
      { TaskID: 'p', Duration: 10, Impact: 50 },
      { TaskID: 'q', Duration: 20, Impact: 70 },
    ];
    const { totalImpact, selectedTasks } = knapsack01(vehicles, 5);
    assert(totalImpact === 0, `Expected 0 impact, got ${totalImpact}`);
    assert(selectedTasks.length === 0, 'Should select no tasks');
  });

  // --- Edge: exactly one task fits ---
  await test('edge case - exactly one task fits within budget', async () => {
    const vehicles = [
      { TaskID: 'r', Duration: 5, Impact: 10 },
      { TaskID: 's', Duration: 3, Impact: 7 },
    ];
    const { totalImpact } = knapsack01(vehicles, 5);
    assert(totalImpact === 10, `Expected 10, got ${totalImpact}`);
  });

  // --- Performance: large input ---
  await test('performance - 1000 tasks with capacity 500', async () => {
    const vehicles = Array.from({ length: 1000 }, (_, i) => ({
      TaskID  : `task_${i}`,
      Duration: (i % 10) + 1,
      Impact  : (i % 20) + 1,
    }));
    const start = Date.now();
    const { totalImpact } = knapsack01(vehicles, 500);
    const elapsed = Date.now() - start;
    assert(totalImpact > 0, 'Expected positive total impact');
    assert(elapsed < 5000, `Should complete in <5s, took ${elapsed}ms`);
    console.log(`     (Completed in ${elapsed}ms, total impact: ${totalImpact})`);
  });

  // --- Result integrity: duration not exceeded ---
  await test('selected tasks total duration does not exceed capacity', async () => {
    const vehicles = [
      { TaskID: 'v1', Duration: 3, Impact: 9 },
      { TaskID: 'v2', Duration: 4, Impact: 5 },
      { TaskID: 'v3', Duration: 5, Impact: 7 },
      { TaskID: 'v4', Duration: 2, Impact: 10 },
    ];
    const capacity = 8;
    const { selectedTasks, totalDuration } = knapsack01(vehicles, capacity);
    const durMap = Object.fromEntries(vehicles.map(v => [v.TaskID, v.Duration]));
    const sumDur = selectedTasks.reduce((s, id) => s + (durMap[id] || 0), 0);
    assert(sumDur <= capacity, `Duration ${sumDur} exceeds capacity ${capacity}`);
    assert(totalDuration === sumDur, `totalDuration mismatch: ${totalDuration} vs ${sumDur}`);
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
