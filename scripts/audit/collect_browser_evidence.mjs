#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));

function parseArgs(argv) {
  const out = {};
  const allowedKeys = new Set(["base-url", "routes-json", "output-dir", "max-routes", "route-samples"]);
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

function resolveMaxRoutes(value, logger = console) {
  const token = value === undefined ? undefined : String(value);
  const parsed = Number.parseInt(token ?? "", 10);
  const maxRoutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 30;

  if (token !== undefined && maxRoutes === 30 && parsed !== 30) {
    logger?.warn?.(`Invalid --max-routes value "${token}"; defaulting to 30.`);
  }

  return maxRoutes;
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

function classifyConsoleMessage(message, level) {
  const text = String(message || "").toLowerCase();
  const normalizedLevel = String(level || "").toLowerCase();
  const noisyPatterns = [
    "/api/",
    "net::err_connection_refused",
    "failed to load resource",
    "status of 404",
    "httperrorresponse",
    "failed to fetch",
    "networkerror when attempting to fetch resource",
    "xmlhttprequest",
    "response with status",
    "unexpected token '<'",
    "unexpected token <",
    "is not valid json"
  ];
  if (noisyPatterns.some((pattern) => text.includes(pattern))) {
    return { skip: false, severity: "s4", level: normalizedLevel };
  }
  return { skip: false, severity: toSeverity(normalizedLevel), level: normalizedLevel };
}

function placeholderKeys(pathTemplate) {
  const matches = String(pathTemplate || "").matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g);
  return Array.from(matches, (match) => String(match[1] || "")).filter(Boolean);
}

function materializeRoute(routeTemplate, routeSamples) {
  const template = String(routeTemplate || "/");
  const keys = placeholderKeys(template);
  if (!keys.length) {
    return {
      resolvedRoute: template,
      unresolvedPlaceholder: false,
      unresolvedKeys: []
    };
  }

  const sample = routeSamples[template];
  if (!sample || typeof sample !== "object") {
    return {
      resolvedRoute: template,
      unresolvedPlaceholder: true,
      unresolvedKeys: keys
    };
  }

  let resolvedRoute = template;
  const unresolvedKeys = [];
  for (const key of keys) {
    const raw = sample[key];
    const value = String(raw ?? "").trim();
    if (!value) {
      unresolvedKeys.push(key);
      continue;
    }
    resolvedRoute = resolvedRoute.replaceAll(`:${key}`, encodeURIComponent(value));
  }
  return {
    resolvedRoute,
    unresolvedPlaceholder: unresolvedKeys.length > 0 || placeholderKeys(resolvedRoute).length > 0,
    unresolvedKeys
  };
}

async function loadRouteSamples(routeSamplesPath) {
  const fallbackPath = new URL("./fixtures/route-samples.json", import.meta.url);
  const target = routeSamplesPath ? path.resolve(routeSamplesPath) : fallbackPath;
  try {
    const payload = JSON.parse(await fs.readFile(target, "utf-8"));
    if (!payload || typeof payload !== "object") {
      return {};
    }
    return payload;
  } catch {
    return {};
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = String(args["base-url"] || "").trim().replace(/\/$/, "");
  const routesJsonPath = String(args["routes-json"] || "").trim();
  const outputDir = String(args["output-dir"] || "").trim();
  const routeSamplesPath = String(args["route-samples"] || "").trim();
  const maxRoutes = resolveMaxRoutes(args["max-routes"]);

  if (!baseUrl || !routesJsonPath || !outputDir) {
    throw new Error("Required args: --base-url --routes-json --output-dir");
  }

  const routesPayload = JSON.parse(await fs.readFile(routesJsonPath, "utf-8"));
  const routes = Array.isArray(routesPayload?.routes) ? routesPayload.routes.slice(0, maxRoutes) : [];
  const routeSamples = await loadRouteSamples(routeSamplesPath);

  await fs.mkdir(outputDir, { recursive: true });
  const screenshotDir = path.join(outputDir, "screenshots");
  await fs.mkdir(screenshotDir, { recursive: true });

  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const seoSnapshot = [];
  const consoleErrors = [];
  const layoutSignals = [];

  for (const route of routes) {
    const routeTemplate = String(route?.full_path || "/");
    const surface = String(route?.surface || "storefront");
    const materialized = materializeRoute(routeTemplate, routeSamples);
    const resolvedPath = materialized.resolvedRoute.startsWith("/") ? materialized.resolvedRoute : `/${materialized.resolvedRoute}`;
    const url = `${baseUrl}${resolvedPath}`;
    const slug = routeSlug(resolvedPath || routeTemplate);
    const screenshotPath = path.join("screenshots", `${slug}.png`);
    const screenshotAbsPath = path.join(outputDir, screenshotPath);
    const routeConsole = [];
    const routePageErrors = [];

    if (materialized.unresolvedPlaceholder) {
      seoSnapshot.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        unresolved_placeholder: true,
        unresolved_keys: materialized.unresolvedKeys,
        url: null,
        screenshot: null,
        title: null,
        description: null,
        og_description: null,
        canonical: null,
        robots: null,
        indexable: null,
        h1_count: 0,
        h1_texts: [],
        route_heading_count: 0,
        word_count_initial_html: 0,
        meaningful_text_block_count: 0,
        internal_link_count: 0,
        skipped_reason: "unresolved_placeholder"
      });
      layoutSignals.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        unresolved_placeholder: true,
        surface,
        sticky_count: 0,
        scrollable_count: 0,
        nested_scrollables_count: 0,
        skipped_reason: "unresolved_placeholder"
      });
      continue;
    }

    const onConsole = (msg) => {
      routeConsole.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        level: String(msg.type() || "info"),
        text: String(msg.text() || ""),
      });
    };
    const onPageError = (err) => {
      routePageErrors.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
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
        const description = document.querySelector("meta[name='description']")?.getAttribute("content") || null;
        const ogDescription = document.querySelector("meta[property='og:description']")?.getAttribute("content") || null;
        const title = document.title || null;
        const h1Nodes = Array.from(document.querySelectorAll("h1"));
        const h1Texts = h1Nodes.map((node) => (node.textContent || "").trim()).filter(Boolean);
        const routeHeadingCount = document.querySelectorAll("[data-route-heading='true']").length;

        const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const wordCount = bodyText ? bodyText.split(" ").filter(Boolean).length : 0;
        const candidateBlocks = Array.from(document.querySelectorAll("main p, article p, section p, li, h2, h3"))
          .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
          .filter((text) => text.length >= 40);
        const meaningfulTextBlocks = candidateBlocks.filter((text) => text.split(" ").filter(Boolean).length >= 8);

        const internalLinks = Array.from(document.querySelectorAll("a[href]")).filter((anchor) => {
          const href = String(anchor.getAttribute("href") || "").trim();
          if (!href) return false;
          if (href.startsWith("#")) return false;
          try {
            const url = new URL(href, window.location.origin);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
              return false;
            }
            return url.origin === window.location.origin;
          } catch {
            return false;
          }
        });
        const noindex = String(robots || "").toLowerCase().includes("noindex");
        return {
          title,
          description,
          og_description: ogDescription,
          canonical,
          robots,
          indexable: !noindex,
          h1_count: h1Nodes.length,
          h1_texts: h1Texts.slice(0, 5),
          route_heading_count: routeHeadingCount,
          word_count_initial_html: wordCount,
          meaningful_text_block_count: meaningfulTextBlocks.length,
          internal_link_count: internalLinks.length,
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
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        unresolved_placeholder: false,
        surface,
        url,
        screenshot: screenshotPath,
        ...seo,
      });
      layoutSignals.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        unresolved_placeholder: false,
        surface,
        ...layout,
      });
    } catch (err) {
      const message = String(err?.message || err || "unknown browser error");
      seoSnapshot.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        unresolved_placeholder: false,
        surface,
        url,
        screenshot: null,
        title: null,
        description: null,
        og_description: null,
        canonical: null,
        robots: null,
        indexable: null,
        h1_count: 0,
        h1_texts: [],
        route_heading_count: 0,
        word_count_initial_html: 0,
        meaningful_text_block_count: 0,
        internal_link_count: 0,
        error: message,
      });
      layoutSignals.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        unresolved_placeholder: false,
        surface,
        sticky_count: 0,
        scrollable_count: 0,
        nested_scrollables_count: 0,
        error: message,
      });
      routeConsole.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        level: "error",
        text: message,
      });
    } finally {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    }

    for (const item of routeConsole) {
      const classification = classifyConsoleMessage(item.text, item.level);
      if (classification.skip) {
        continue;
      }
      consoleErrors.push({
        route: item.route,
        route_template: item.route_template,
        resolved_route: item.resolved_route,
        surface,
        level: classification.level,
        severity: classification.severity,
        text: item.text,
      });
    }
    for (const item of routePageErrors) {
      const classification = classifyConsoleMessage(item.text, item.level);
      if (classification.skip) {
        continue;
      }
      consoleErrors.push({
        route: item.route,
        route_template: item.route_template,
        resolved_route: item.resolved_route,
        surface,
        level: classification.level,
        severity: classification.severity === "s4" ? "s4" : "s2",
        text: item.text,
      });
    }
  }

  await browser.close();

  await fs.writeFile(path.join(outputDir, "seo-snapshot.json"), `${JSON.stringify(seoSnapshot, null, 2)}\n`, "utf-8");
  await fs.writeFile(path.join(outputDir, "console-errors.json"), `${JSON.stringify(consoleErrors, null, 2)}\n`, "utf-8");
  await fs.writeFile(path.join(outputDir, "layout-signals.json"), `${JSON.stringify(layoutSignals, null, 2)}\n`, "utf-8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const message = String(err?.message || err || "unknown error");
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

export { parseArgs, resolveMaxRoutes };
