'use strict';

/**
 * Vehicle Maintenance Scheduler Microservice
 *
 * Solves the 0/1 Knapsack problem for each depot:
 *   - duration → weight
 *   - impact   → value
 *   - MechanicHours → capacity
 *
 * No external algorithm libraries used.
 * Uses the Logging Middleware for all output.
 *
 * Run: node scheduler.js
 * Required env vars: AUTH_TOKEN
 */

const http  = require('http');
const https = require('https');
const path  = require('path');
const { Log, createLogger } = require(path.join(__dirname, '..', 'logging_middleware'));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASE_URL    = 'http://20.207.122.201/evaluation-service';
const AUTH_TOKEN  = process.env.AUTH_TOKEN || '';

const logger = createLogger('backend', 'service');

// ---------------------------------------------------------------------------
// HTTP GET helper
// ---------------------------------------------------------------------------
function getJSON(url, token) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const options = {
      hostname : parsed.hostname,
      port     : parsed.port || (isHttps ? 443 : 80),
      path     : parsed.pathname,
      method   : 'GET',
      headers  : {
        'Authorization': `Bearer ${token}`,
        'Accept'       : 'application/json',
      },
    };
    const lib = isHttps ? https : http;
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
        }
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse failed: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helper: truncate message to eval API's 48-char limit
// ---------------------------------------------------------------------------
function msg(s) {
  return s.length > 48 ? s.slice(0, 45) + '...' : s;
}

// ---------------------------------------------------------------------------
// 0/1 Knapsack — 2D bottom-up DP (correct backtracking)
// Complexity: O(n * W) time, O(n * W) space
// ---------------------------------------------------------------------------
/**
 * @param {Array<{TaskID: string, Duration: number, Impact: number}>} vehicles
 * @param {number} capacity  (mechanic hours budget)
 * @returns {{ selectedTasks: string[], totalImpact: number, totalDuration: number }}
 */
function knapsack01(vehicles, capacity) {
  const n = vehicles.length;

  // dp[i][j] = max impact using first i items with capacity j
  // Use flat Uint32Array for memory efficiency
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(capacity + 1));

  for (let i = 1; i <= n; i++) {
    const { Duration: w, Impact: v } = vehicles[i - 1];
    for (let j = 0; j <= capacity; j++) {
      dp[i][j] = dp[i - 1][j]; // don't take item i
      if (j >= w && dp[i - 1][j - w] + v > dp[i][j]) {
        dp[i][j] = dp[i - 1][j - w] + v; // take item i
      }
    }
  }

  // Backtrack through 2D table to find selected items
  const selected = [];
  let rem = capacity;
  for (let i = n; i >= 1 && rem > 0; i--) {
    if (dp[i][rem] !== dp[i - 1][rem]) {
      // item i-1 was selected
      selected.push(vehicles[i - 1].TaskID);
      rem -= vehicles[i - 1].Duration;
    }
  }

  const totalImpact   = dp[n][capacity];
  const totalDuration = capacity - rem;

  return { selectedTasks: selected, totalImpact, totalDuration };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await logger.info('Vehicle Maintenance Scheduler starting');

  if (!AUTH_TOKEN) {
    await Log('backend', 'fatal', 'config', 'AUTH_TOKEN environment variable is not set');
    throw new Error('AUTH_TOKEN must be set. E.g. AUTH_TOKEN=<your_token> node scheduler.js');
  }

  // --- Fetch depots ---
  await logger.info('Fetching depot list from API');
  let depots;
  try {
    const resp = await getJSON(`${BASE_URL}/depots`, AUTH_TOKEN);
    depots = resp.depots;
    await Log('backend', 'info', 'service', msg(`Fetched ${depots.length} depots`));
  } catch (err) {
    await Log('backend', 'fatal', 'repository', msg(`Depots fetch failed: ${err.message}`));
    throw err;
  }

  // --- Fetch vehicles ---
  await logger.info('Fetching vehicle list from API');
  let vehicles;
  try {
    const resp = await getJSON(`${BASE_URL}/vehicles`, AUTH_TOKEN);
    vehicles = resp.vehicles;
    await Log('backend', 'info', 'service', msg(`Fetched ${vehicles.length} vehicles`));
  } catch (err) {
    await Log('backend', 'fatal', 'repository', msg(`Vehicles fetch failed: ${err.message}`));
    throw err;
  }

  // --- Solve knapsack per depot ---
  const results = [];

  for (const depot of depots) {
    const { ID, MechanicHours } = depot;

    await Log('backend', 'debug', 'service',
      msg(`Depot ${ID} budget=${MechanicHours}h`));

    if (MechanicHours <= 0) {
      await Log('backend', 'warn', 'service', msg(`Depot ${ID} has zero hours`));
      results.push({ depotID: ID, mechanicHours: MechanicHours, selectedTasks: [], totalImpact: 0, totalDuration: 0 });
      continue;
    }

    const startTime = Date.now();
    const { selectedTasks, totalImpact, totalDuration } = knapsack01(vehicles, MechanicHours);
    const elapsed   = Date.now() - startTime;

    await Log('backend', 'info', 'service',
      msg(`Depot ${ID}: ${selectedTasks.length} tasks impact=${totalImpact}`));

    results.push({
      depotID      : ID,
      mechanicHours: MechanicHours,
      selectedTasks,
      totalImpact,
      totalDuration,
    });
  }

  // --- Output ---
  await Log('backend', 'info', 'service', msg('Scheduler complete - printing results'));
  console.log('\n========== VEHICLE MAINTENANCE SCHEDULER RESULTS ==========\n');
  for (const r of results) {
    console.log(`Depot ${r.depotID}  (Budget: ${r.mechanicHours}h)`);
    console.log(`  Total Impact   : ${r.totalImpact}`);
    console.log(`  Total Duration : ${r.totalDuration}h`);
    console.log(`  Tasks Selected : ${r.selectedTasks.length}`);
    console.log(`  Task IDs       :`);
    r.selectedTasks.forEach((id, i) => console.log(`    ${i + 1}. ${id}`));
    console.log();
  }
  console.log('===========================================================\n');

  return results;
}

main().catch(async (err) => {
  await Log('backend', 'fatal', 'handler', msg(`Unhandled error: ${err.message}`));
  process.exit(1);
});

module.exports = { knapsack01 }; // exported for tests
