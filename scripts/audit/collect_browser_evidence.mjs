#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

function parseArgs(argv) {
  const out = {};
  const allowedKeys = new Set(["base-url", "routes-json", "output-dir", "max-routes"]);
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    if (!allowedKeys.has(key)) {
      continue;
    }
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
    out[key] = value;
  }
  return out;
}

function routeSlug(routePath) {
  const clean = (routePath || "/").replace(/^\//, "").replace(/\/+/g, "-");
  return clean ? clean.replace(/[^a-zA-Z0-9._-]/g, "_") : "root";
}

function toSeverity(level) {
  const raw = String(level || "").toLowerCase();
  if (raw === "error") return "s2";
  if (raw === "warning" || raw === "warn") return "s3";
  return "s4";
}

function isLikelyApiNoise(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("/api/") ||
    text.includes("net::err_connection_refused") ||
    text.includes("failed to load resource") ||
    text.includes("status of 404")
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = String(args["base-url"] || "").trim().replace(/\/$/, "");
  const routesJsonPath = String(args["routes-json"] || "").trim();
  const outputDir = String(args["output-dir"] || "").trim();
  const maxRoutes = Math.max(1, Number.parseInt(String(args["max-routes"] || "30"), 10));

  if (!baseUrl || !routesJsonPath || !outputDir) {
    throw new Error("Required args: --base-url --routes-json --output-dir");
  }

  const routesPayload = JSON.parse(await fs.readFile(routesJsonPath, "utf-8"));
  const routes = Array.isArray(routesPayload?.routes) ? routesPayload.routes.slice(0, maxRoutes) : [];

  await fs.mkdir(outputDir, { recursive: true });
  const screenshotDir = path.join(outputDir, "screenshots");
  await fs.mkdir(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const seoSnapshot = [];
  const consoleErrors = [];
  const layoutSignals = [];

  for (const route of routes) {
    const fullPath = String(route?.full_path || "/");
    const surface = String(route?.surface || "storefront");
    const url = `${baseUrl}${fullPath.startsWith("/") ? fullPath : `/${fullPath}`}`;
    const slug = routeSlug(fullPath);
    const screenshotPath = path.join("screenshots", `${slug}.png`);
    const screenshotAbsPath = path.join(outputDir, screenshotPath);
    const routeConsole = [];
    const routePageErrors = [];

    const onConsole = (msg) => {
      routeConsole.push({
        route: fullPath,
        level: String(msg.type() || "info"),
        text: String(msg.text() || ""),
      });
    };
    const onPageError = (err) => {
      routePageErrors.push({
        route: fullPath,
        level: "error",
        text: String(err?.message || err || ""),
      });
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      await page.screenshot({ path: screenshotAbsPath, fullPage: true });

      const seo = await page.evaluate(() => {
        const canonical = document.querySelector("link[rel='canonical']")?.getAttribute("href") || null;
        const robots = document.querySelector("meta[name='robots']")?.getAttribute("content") || null;
        const title = document.title || null;
        const h1Nodes = Array.from(document.querySelectorAll("h1"));
        const h1Texts = h1Nodes.map((node) => (node.textContent || "").trim()).filter(Boolean);
        return {
          title,
          canonical,
          robots,
          h1_count: h1Nodes.length,
          h1_texts: h1Texts.slice(0, 5),
        };
      });

      const layout = await page.evaluate(() => {
        const allElements = Array.from(document.querySelectorAll("*"));
        const stickyElements = allElements.filter((el) => getComputedStyle(el).position === "sticky");
        const scrollables = allElements.filter((el) => {
          const style = getComputedStyle(el);
          const overflowY = style.overflowY;
          const scrollable = (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 8;
          return scrollable;
        });
        const nestedScrollables = scrollables.filter((el) => {
          const parent = el.parentElement;
          if (!parent) return false;
          const style = getComputedStyle(parent);
          const overflowY = style.overflowY;
          return (overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight + 8;
        });
        return {
          sticky_count: stickyElements.length,
          scrollable_count: scrollables.length,
          nested_scrollables_count: nestedScrollables.length,
        };
      });

      seoSnapshot.push({
        route: fullPath,
        surface,
        url,
        screenshot: screenshotPath,
        ...seo,
      });
      layoutSignals.push({
        route: fullPath,
        surface,
        ...layout,
      });
    } catch (err) {
      const message = String(err?.message || err || "unknown browser error");
      seoSnapshot.push({
        route: fullPath,
        surface,
        url,
        screenshot: null,
        title: null,
        canonical: null,
        robots: null,
        h1_count: 0,
        h1_texts: [],
        error: message,
      });
      layoutSignals.push({
        route: fullPath,
        surface,
        sticky_count: 0,
        scrollable_count: 0,
        nested_scrollables_count: 0,
        error: message,
      });
      routeConsole.push({
        route: fullPath,
        level: "error",
        text: message,
      });
    } finally {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    }

    for (const item of routeConsole) {
      if (isLikelyApiNoise(item.text)) {
        continue;
      }
      consoleErrors.push({
        route: item.route,
        surface,
        level: item.level,
        severity: toSeverity(item.level),
        text: item.text,
      });
    }
    for (const item of routePageErrors) {
      if (isLikelyApiNoise(item.text)) {
        continue;
      }
      consoleErrors.push({
        route: item.route,
        surface,
        level: item.level,
        severity: "s2",
        text: item.text,
      });
    }
  }

  await browser.close();

  await fs.writeFile(path.join(outputDir, "seo-snapshot.json"), `${JSON.stringify(seoSnapshot, null, 2)}\n`, "utf-8");
  await fs.writeFile(path.join(outputDir, "console-errors.json"), `${JSON.stringify(consoleErrors, null, 2)}\n`, "utf-8");
  await fs.writeFile(path.join(outputDir, "layout-signals.json"), `${JSON.stringify(layoutSignals, null, 2)}\n`, "utf-8");
}

main().catch((err) => {
  const message = String(err?.message || err || "unknown error");
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
