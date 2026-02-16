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

function hasLatLng(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const lat =
    asNumber(obj.lat) ??
    asNumber(obj.latitude) ??
    asNumber(obj?.location?.lat) ??
    asNumber(obj?.geometry?.coordinates?.[1]);
  const lng =
    asNumber(obj.lng) ??
    asNumber(obj.lon) ??
    asNumber(obj.longitude) ??
    asNumber(obj?.location?.lng) ??
    asNumber(obj?.location?.lon) ??
    asNumber(obj?.geometry?.coordinates?.[0]);
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function findLockerRows(payload) {
  const rows = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === 'object' && hasLatLng(item)) rows.push(item);
        else walk(item);
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(payload);
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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
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
    await page.goto('https://sameday.ro/easybox/', { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // Try direct same-origin fetch from a challenge-solved browser context.
    await page.evaluate(async () => {
      const urls = [
        '/wp-admin/admin-ajax.php?action=get_ooh_lockers_request&country=Romania',
        '/api/easybox/locations?search=Bucuresti&limit=1000&type=locker'
      ];
      for (const url of urls) {
        try {
          await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: { accept: 'application/json,text/plain,*/*' }
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
          payload: captured
        },
        null,
        2
      )
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
