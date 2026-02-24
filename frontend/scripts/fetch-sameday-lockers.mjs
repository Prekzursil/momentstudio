#!/usr/bin/env node

import process from 'node:process';
import { chromium } from '@playwright/test';

function parseArgs(argv) {
  const args = { timeout: 30 };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--timeout' && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) args.timeout = parsed;
      i += 1;
    }
  }
  return args;
}

function asNumber(v) {
  if (v == null) return null;
  const n = Number.parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object';
}

function readPath(source, path) {
  let current = source;
  for (const key of path) {
    if (!isObjectRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function firstNumeric(source, paths) {
  for (const path of paths) {
    const value = asNumber(readPath(source, path));
    if (value !== null) return value;
  }
  return null;
}

function hasLatLng(obj) {
  if (!isObjectRecord(obj)) return false;
  const lat = firstNumeric(obj, [
    ['lat'],
    ['latitude'],
    ['location', 'lat'],
    ['geometry', 'coordinates', 1],
  ]);
  const lng = firstNumeric(obj, [
    ['lng'],
    ['lon'],
    ['longitude'],
    ['location', 'lng'],
    ['location', 'lon'],
    ['geometry', 'coordinates', 0],
  ]);
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function collectLockerRows(node, rows) {
  if (Array.isArray(node)) {
    for (const item of node) {
      if (isObjectRecord(item) && hasLatLng(item)) {
        rows.push(item);
        continue;
      }
      collectLockerRows(item, rows);
    }
    return;
  }
  if (!isObjectRecord(node)) return;
  for (const value of Object.values(node)) {
    collectLockerRows(value, rows);
  }
}

function findLockerRows(payload) {
  const rows = [];
  collectLockerRows(payload, rows);
  return rows;
}

async function run() {
  const args = parseArgs(process.argv);
  const timeoutMs = Math.max(10000, args.timeout * 1000);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1365, height: 768 },
    locale: 'ro-RO',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let captured = null;
  let sourceUrl = null;

  const tryCapture = async (url, parser) => {
    if (captured) return;
    try {
      const payload = await parser();
      const rows = findLockerRows(payload);
      if (rows.length) {
        captured = payload;
        sourceUrl = url;
      }
    } catch {
      // Ignore and continue listening for the next response.
    }
  };

  page.on('response', (response) => {
    const url = response.url();
    if (!/sameday\.ro/i.test(url)) return;
    if (!/admin-ajax\.php|\/api\/easybox\/|\/api\/pudo\//i.test(url)) return;
    void tryCapture(url, async () => {
      const contentType = String(response.headers()['content-type'] || '').toLowerCase();
      if (contentType.includes('application/json')) return await response.json();
      return JSON.parse(await response.text());
    });
  });

  try {
    await page.goto('https://sameday.ro/easybox/', {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });

    // Try direct same-origin fetch from a challenge-solved browser context.
    await page.evaluate(async () => {
      const urls = [
        '/wp-admin/admin-ajax.php?action=get_ooh_lockers_request&country=Romania',
        '/api/easybox/locations?search=Bucuresti&limit=1000&type=locker',
      ];
      for (const url of urls) {
        try {
          await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: { accept: 'application/json,text/plain,*/*' },
          });
        } catch {
          // Keep trying the next URL.
        }
      }
    });

    const deadline = Date.now() + timeoutMs;
    while (!captured && Date.now() < deadline) {
      await page.waitForTimeout(500);
    }

    if (!captured) {
      throw new Error('No locker payload captured from Sameday map page');
    }

    process.stdout.write(
      JSON.stringify(
        {
          source_url: sourceUrl || 'https://sameday.ro/easybox/',
          payload: captured,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`fetch-sameday-lockers failed: ${msg}\n`);
  process.exit(1);
});
