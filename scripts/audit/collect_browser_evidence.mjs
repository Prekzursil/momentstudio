#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..", "..");

function parseArgs(argv) {
  const out = {};
  const allowedKeys = new Set([
    "base-url",
    "routes-json",
    "output-dir",
    "max-routes",
    "route-samples",
    "api-base-url",
    "auth-mode",
    "owner-identifier",
    "owner-password",
  ]);
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

function isPathWithinRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolvePathUnderBase(rootPath, ...segments) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(root, ...segments);
  if (!isPathWithinRoot(root, candidate)) {
    throw new Error(`Refusing path outside root "${root}": ${candidate}`);
  }
  return candidate;
}

function resolvePathUnderAllowedBases(rawPath, allowedRoots, label) {
  const token = rawPath instanceof URL ? fileURLToPath(rawPath) : String(rawPath || "").trim();
  if (!token) {
    throw new Error(`${label} path cannot be empty.`);
  }
  const normalizedRoots = allowedRoots.map((root) => path.resolve(root));
  const candidatePaths = path.isAbsolute(token)
    ? [path.resolve(token)]
    : normalizedRoots.map((root) => path.resolve(root, token));
  const candidate = candidatePaths.find((item) => normalizedRoots.some((root) => isPathWithinRoot(root, item)));
  if (!candidate) {
    throw new Error(`${label} must be within allowed roots (${normalizedRoots.join(", ")}): ${token}`);
  }
  return candidate;
}

async function readUtf8FileUnderAllowedBases(rawPath, allowedRoots, label) {
  const safePath = resolvePathUnderAllowedBases(rawPath, allowedRoots, label);
  return fs.readFile(safePath, "utf-8");
}

async function ensureDirectoryUnderBase(rootPath, ...segments) {
  const safePath = resolvePathUnderBase(rootPath, ...segments);
  await fs.mkdir(safePath, { recursive: true });
  return safePath;
}

async function writeUtf8FileUnderBase(rootPath, relativePath, payload) {
  const safePath = resolvePathUnderBase(rootPath, relativePath);
  await fs.writeFile(safePath, payload, "utf-8");
}

function normalizeUrl(raw) {
  let value = String(raw || "").trim();
  if (!value) return "";
  while (value.endsWith("/")) {
    value = value.slice(0, -1);
  }
  return value;
}

function normalizeAuthMode(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "none";
  if (value === "none" || value === "owner") return value;
  return "none";
}

function parseMaxRoutes(value) {
  if (value === undefined) {
    return { token: undefined, parsed: Number.NaN };
  }
  const token = String(value);
  return { token, parsed: Number.parseInt(token, 10) };
}

function resolveMaxRoutes(value, logger = console) {
  const { token, parsed } = parseMaxRoutes(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  if (token !== undefined && parsed !== 30) {
    logger?.warn?.(`Invalid --max-routes value "${token}"; defaulting to 30.`);
  }
  return 30;
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
  if (text.includes("was preloaded using link preload but not used within a few seconds from the window's load event")) {
    return { skip: true, severity: "s4", level: normalizedLevel };
  }
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
    "is not valid json",
    "challenges.cloudflare.com",
    "private access token challenge",
    "cloudflare",
    "turnstile",
    "executing inline script violates the following content security policy directive",
    "the action has been blocked"
  ];
  if (noisyPatterns.some((pattern) => text.includes(pattern))) {
    return { skip: false, severity: "s4", level: normalizedLevel };
  }
  return { skip: false, severity: toSeverity(normalizedLevel), level: normalizedLevel };
}

function normalizeResourceFailureUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value.split("#", 1)[0];
  }
}

function buildResourceFailureKey({ source, statusCode, url, resourceType, method, failureText }) {
  return [
    String(source || ""),
    String(statusCode ?? ""),
    normalizeResourceFailureUrl(url),
    String(resourceType || ""),
    String(method || ""),
    String(failureText || ""),
  ].join("|");
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

  const resolved = resolveTemplateWithSample(template, keys, sample);
  const unresolvedPlaceholder = hasUnresolvedPlaceholderKeys(resolved.resolvedRoute, resolved.unresolvedKeys);
  return {
    resolvedRoute: resolved.resolvedRoute,
    unresolvedPlaceholder,
    unresolvedKeys: resolved.unresolvedKeys
  };
}

function resolveTemplateWithSample(template, keys, sample) {
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
  return { resolvedRoute, unresolvedKeys };
}

function hasUnresolvedPlaceholderKeys(resolvedRoute, unresolvedKeys) {
  if (unresolvedKeys.length > 0) return true;
  return placeholderKeys(resolvedRoute).length > 0;
}

async function loadRouteSamples(routeSamplesPath, allowedRoots) {
  const fallbackPath = new URL("./fixtures/route-samples.json", import.meta.url);
  const target = routeSamplesPath || fallbackPath;
  try {
    const payload = JSON.parse(await readUtf8FileUnderAllowedBases(target, allowedRoots, "--route-samples"));
    if (!payload || typeof payload !== "object") {
      return {};
    }
    return payload;
  } catch {
    return {};
  }
}

function readSlugFromCollection(payload) {
  if (Array.isArray(payload)) {
    const first = payload.find((item) => item && typeof item === "object" && String(item.slug || "").trim());
    return first ? String(first.slug).trim() : "";
  }
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const first = items.find((item) => item && typeof item === "object" && String(item.slug || "").trim());
  return first ? String(first.slug).trim() : "";
}

function readSeriesSlug(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const direct = String(item.series_slug || "").trim();
    if (direct) return direct;
    const nested = String(item.series?.slug || "").trim();
    if (nested) return nested;
    const rawSeries = String(item.series || "").trim();
    if (rawSeries) return rawSeries;
  }
  return "";
}

function readFirstObjectFromItems(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.find((item) => item && typeof item === "object") || null;
}

function readFirstTruthyField(item, fields) {
  for (const field of fields) {
    const value = String(item[field] || "").trim();
    if (value) return value;
  }
  return "";
}

function readOrderSample(payload) {
  const first = readFirstObjectFromItems(payload);
  if (!first) return { orderId: "", receiptToken: "" };
  const orderId = readFirstTruthyField(first, ["id", "order_id"]);
  const receiptToken = readFirstTruthyField(first, ["receipt_share_token", "receipt_token", "token", "share_token"]);
  return { orderId, receiptToken };
}

async function fetchJson(context, url, accessToken = "") {
  try {
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
    const response = await context.request.get(url, headers ? { headers } : undefined);
    if (!response.ok()) {
      return { ok: false, data: null };
    }
    const data = await response.json();
    return { ok: true, data };
  } catch {
    return { ok: false, data: null };
  }
}

async function hydrateRouteSamplesFromApi(context, { apiBaseUrl, routeSamples, accessToken }) {
  const apiRoot = normalizeUrl(apiBaseUrl);
  if (!apiRoot) return routeSamples;

  const hydrated = routeSamples && typeof routeSamples === "object" ? { ...routeSamples } : {};

  const setSample = (routeTemplate, key, value) => {
    const token = String(value || "").trim();
    if (!token) {
      delete hydrated[routeTemplate];
      return;
    }
    hydrated[routeTemplate] = { [key]: token };
  };

  const hydratePublicSamples = async () => {
    const categories = await fetchJson(context, `${apiRoot}/catalog/categories`);
    if (categories.ok) {
      setSample("/shop/:category", "category", readSlugFromCollection(categories.data));
    }

    const products = await fetchJson(context, `${apiRoot}/catalog/products?limit=1`);
    if (products.ok) {
      setSample("/products/:slug", "slug", readSlugFromCollection(products.data));
    }

    const blogPosts = await fetchJson(context, `${apiRoot}/blog/posts?limit=20`);
    if (!blogPosts.ok) {
      return;
    }
    setSample("/blog/:slug", "slug", readSlugFromCollection(blogPosts.data));
    setSample("/blog/series/:series", "series", readSeriesSlug(blogPosts.data));
  };

  const hydrateAdminSamples = async () => {
    if (!accessToken) return;
    const adminOrders = await fetchJson(context, `${apiRoot}/orders/admin/search?limit=1`, accessToken);
    if (!adminOrders.ok) return;
    const sample = readOrderSample(adminOrders.data);
    setSample("/admin/orders/:orderId", "orderId", sample.orderId);
    setSample("/receipt/:token", "token", sample.receiptToken);
  };

  await hydratePublicSamples();
  await hydrateAdminSamples();

  return hydrated;
}

function placeholderKeys(pathTemplate) {
  const matches = String(pathTemplate || "").matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g);
  return Array.from(matches, (match) => String(match[1] || "")).filter(Boolean);
}

async function installApiRewrite(context, { baseUrl, apiBaseUrl }) {
  if (!baseUrl || !apiBaseUrl) return;
  const baseOrigin = new URL(baseUrl).origin;
  const apiOrigin = new URL(apiBaseUrl).origin;
  const apiPrefix = "/api/v1/";
  if (baseOrigin === apiOrigin) return;

  await context.route("**/*", async (route) => {
    const request = route.request();
    const rawUrl = request.url();
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      await route.continue();
      return;
    }

    if (parsed.origin === baseOrigin && parsed.pathname.startsWith(apiPrefix)) {
      const rewritten = `${apiOrigin}${parsed.pathname}${parsed.search}`;
      await route.continue({ url: rewritten });
      return;
    }
    await route.continue();
  });
}

async function primeOwnerSession(context, { apiBaseUrl, ownerIdentifier, ownerPassword }) {
  if (!apiBaseUrl || !ownerIdentifier || !ownerPassword) {
    throw new Error("Owner auth mode requires --api-base-url, --owner-identifier, and --owner-password.");
  }

  const loginUrl = `${normalizeUrl(apiBaseUrl)}/auth/login`;
  const response = await context.request.post(loginUrl, {
    data: {
      identifier: ownerIdentifier,
      password: ownerPassword,
      remember: false,
      captcha_token: null,
    },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok()) {
    const details = payload && typeof payload === "object" ? JSON.stringify(payload).slice(0, 500) : "";
    const suffix = details ? `: ${details}` : "";
    throw new Error(`Owner login failed (${response.status()})${suffix}`);
  }

  const tokens = payload?.tokens;
  if (!tokens?.access_token || !tokens?.refresh_token) {
    if (payload?.two_factor_token) {
      throw new Error("Owner login requires 2FA; configure the owner test profile without forced 2FA for audit crawls.");
    }
    throw new Error("Owner login did not return auth tokens.");
  }

  await context.addInitScript((authTokens) => {
    try {
      globalThis.sessionStorage.setItem("auth_tokens", JSON.stringify(authTokens));
    } catch {
      // noop
    }
  }, tokens);

  return {
    accessToken: String(tokens.access_token || ""),
    refreshToken: String(tokens.refresh_token || ""),
  };
}

async function collectVisibilityProbe(page) {
  return page.evaluate(() => {
    const normalizeText = (value) => String(value || "").replaceAll(/\s+/g, " ").trim();
    const isVisiblyRendered = (el) => {
      if (!el) return false;
      const style = globalThis.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number.parseFloat(style.opacity || "1") === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const main = document.querySelector("main");
    const root = main || document.body;
    const text = normalizeText(root?.textContent || "");
    const words = text ? text.split(" ").filter(Boolean).length : 0;
    const headings = root ? root.querySelectorAll("h1, h2").length : 0;

    const controls = root ? Array.from(root.querySelectorAll("input, textarea, select, button")) : [];
    const visibleControls = controls.filter((el) => isVisiblyRendered(el));

    const loadingNodes = root
      ? root.querySelectorAll(
          "[aria-busy='true'], [data-loading-state='true'], [data-loading='true'], .animate-pulse, .spinner, .loading"
        ).length
      : 0;

    return {
      has_main: Boolean(main),
      main_visible: isVisiblyRendered(main || document.body),
      text_words: words,
      heading_count: headings,
      form_control_count: controls.length,
      visible_form_control_count: visibleControls.length,
      loading_indicator_count: loadingNodes,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = normalizeUrl(args["base-url"]);
  const apiBaseUrl = normalizeUrl(args["api-base-url"] || "");
  const routesJsonPath = String(args["routes-json"] || "").trim();
  const outputDir = String(args["output-dir"] || "").trim();
  const routeSamplesPath = String(args["route-samples"] || "").trim();
  const authMode = normalizeAuthMode(args["auth-mode"]);
  const ownerIdentifier = String(args["owner-identifier"] || "").trim();
  const ownerPassword = String(args["owner-password"] || "").trim();
  const maxRoutes = resolveMaxRoutes(args["max-routes"]);

  if (!baseUrl || !routesJsonPath || !outputDir) {
    throw new Error("Required args: --base-url --routes-json --output-dir");
  }

  const allowedRoots = [repoRoot];
  const cwdPath = path.resolve(process.cwd());
  if (isPathWithinRoot(repoRoot, cwdPath)) {
    allowedRoots.push(cwdPath);
  }
  const routesJsonAbsPath = resolvePathUnderAllowedBases(routesJsonPath, allowedRoots, "--routes-json");
  const outputDirAbsPath = resolvePathUnderAllowedBases(outputDir, allowedRoots, "--output-dir");

  const routesPayload = JSON.parse(await readUtf8FileUnderAllowedBases(routesJsonAbsPath, allowedRoots, "--routes-json"));
  const routes = Array.isArray(routesPayload?.routes) ? routesPayload.routes.slice(0, maxRoutes) : [];
  let routeSamples = await loadRouteSamples(routeSamplesPath, allowedRoots);

  await ensureDirectoryUnderBase(outputDirAbsPath);
  await ensureDirectoryUnderBase(outputDirAbsPath, "screenshots");

  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installApiRewrite(context, {
    baseUrl,
    apiBaseUrl: apiBaseUrl || baseUrl,
  });
  let ownerAuth = null;
  if (authMode === "owner") {
    ownerAuth = await primeOwnerSession(context, {
      apiBaseUrl: apiBaseUrl || baseUrl,
      ownerIdentifier,
      ownerPassword,
    });
  }
  routeSamples = await hydrateRouteSamplesFromApi(context, {
    apiBaseUrl: apiBaseUrl || baseUrl,
    routeSamples,
    accessToken: ownerAuth?.accessToken || "",
  });
  const page = await context.newPage();

  const seoSnapshot = [];
  const consoleErrors = [];
  const layoutSignals = [];
  const visibilitySignals = [];

  for (const route of routes) {
    const routeTemplate = String(route?.full_path || "/");
    const surface = String(route?.surface || "storefront");
    const materialized = materializeRoute(routeTemplate, routeSamples);
    const resolvedPath = materialized.resolvedRoute.startsWith("/") ? materialized.resolvedRoute : `/${materialized.resolvedRoute}`;
    const url = `${baseUrl}${resolvedPath}`;
    const slug = routeSlug(resolvedPath || routeTemplate);
    const screenshotPath = path.join("screenshots", `${slug}.png`);
    const screenshotAbsPath = resolvePathUnderBase(outputDirAbsPath, screenshotPath);
    const routeConsole = [];
    const routePageErrors = [];
    const routeResourceFailures = [];
    const routeResourceFailureKeys = new Set();

    if (materialized.unresolvedPlaceholder) {
      seoSnapshot.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        unresolved_placeholder: true,
        auth_mode: authMode,
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
        auth_mode: authMode,
        surface,
        sticky_count: 0,
        scrollable_count: 0,
        nested_scrollables_count: 0,
        skipped_reason: "unresolved_placeholder"
      });
      visibilitySignals.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        unresolved_placeholder: true,
        surface,
        auth_mode: authMode,
        skipped_reason: "unresolved_placeholder",
      });
      continue;
    }

    const onConsole = (msg) => {
      const location = typeof msg.location === "function" ? msg.location() : null;
      const line =
        location && Number.isFinite(Number(location.lineNumber)) ? Number(location.lineNumber) : null;
      const column =
        location && Number.isFinite(Number(location.columnNumber)) ? Number(location.columnNumber) : null;
      routeConsole.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        level: String(msg.type() || "info"),
        text: String(msg.text() || ""),
        source_url: location && location.url ? String(location.url) : null,
        line,
        column,
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
    const onResponse = (response) => {
      const statusCode = Number(response.status() || 0);
      if (!Number.isFinite(statusCode) || statusCode < 400) return;
      const request = response.request();
      const resourceType = String(request.resourceType() || "");
      const url = normalizeResourceFailureUrl(response.url());
      const method = String(request.method() || "");
      const item = {
        source: "response",
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        status_code: statusCode,
        request_url: url,
        resource_type: resourceType,
        method,
        failure_text: "",
      };
      const dedupeKey = buildResourceFailureKey(item);
      if (routeResourceFailureKeys.has(dedupeKey)) return;
      routeResourceFailureKeys.add(dedupeKey);
      routeResourceFailures.push(item);
    };
    const onRequestFailed = (request) => {
      const failure = request.failure();
      const item = {
        source: "requestfailed",
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        status_code: null,
        request_url: normalizeResourceFailureUrl(request.url()),
        resource_type: String(request.resourceType() || ""),
        method: String(request.method() || ""),
        failure_text: String(failure?.errorText || ""),
      };
      const dedupeKey = buildResourceFailureKey(item);
      if (routeResourceFailureKeys.has(dedupeKey)) return;
      routeResourceFailureKeys.add(dedupeKey);
      routeResourceFailures.push(item);
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("response", onResponse);
    page.on("requestfailed", onRequestFailed);

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      const visibilityInitial = await collectVisibilityProbe(page);
      await page.waitForTimeout(2000);
      const visibilitySettled = await collectVisibilityProbe(page);
      await page.evaluate(() => {
        globalThis.dispatchEvent(new Event("scroll"));
        globalThis.dispatchEvent(new Event("resize"));
      });
      await page.waitForTimeout(250);
      const visibilityAfterPassive = await collectVisibilityProbe(page);
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

        const bodyText = (document.body?.innerText || "").replaceAll(/\s+/g, " ").trim();
        const wordCount = bodyText ? bodyText.split(" ").filter(Boolean).length : 0;
        const candidateBlocks = Array.from(document.querySelectorAll("main p, article p, section p, li, h2, h3"))
          .map((node) => (node.textContent || "").replaceAll(/\s+/g, " ").trim())
          .filter((text) => text.length >= 40);
        const meaningfulTextBlocks = candidateBlocks.filter((text) => text.split(" ").filter(Boolean).length >= 8);

        const internalLinks = Array.from(document.querySelectorAll("a[href]")).filter((anchor) => {
          const href = String(anchor.getAttribute("href") || "").trim();
          if (!href) return false;
          if (href.startsWith("#")) return false;
          try {
            const url = new URL(href, globalThis.location.origin);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
              return false;
            }
            return url.origin === globalThis.location.origin;
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
        auth_mode: authMode,
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
        auth_mode: authMode,
        surface,
        ...layout,
      });

      const controlsUnlockedAfterPassive = visibilitySettled.visible_form_control_count === 0
        && visibilityAfterPassive.visible_form_control_count > 0;
      const textUnlockedAfterPassive = visibilitySettled.text_words < 20
        && visibilityAfterPassive.text_words >= 40;
      const controlsAppearedAfterSettleWithoutLoading = visibilityInitial.visible_form_control_count === 0
        && visibilitySettled.visible_form_control_count > 0
        && visibilitySettled.loading_indicator_count === 0;
      const textAppearedAfterSettleWithoutLoading = visibilityInitial.text_words < 20
        && visibilitySettled.text_words >= 40
        && visibilitySettled.loading_indicator_count === 0;

      visibilitySignals.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        unresolved_placeholder: false,
        surface,
        auth_mode: authMode,
        phases: {
          initial: visibilityInitial,
          settled: visibilitySettled,
          after_passive_events: visibilityAfterPassive,
        },
        // Only promote as actionable when passive interaction unlocks hidden content.
        // "After settle" deltas are tracked as telemetry, but are often benign async hydration.
        visibility_issue: controlsUnlockedAfterPassive || textUnlockedAfterPassive,
        issue_reasons: [
          controlsUnlockedAfterPassive ? "form_controls_appear_after_passive_events" : null,
          textUnlockedAfterPassive ? "text_appears_after_passive_events" : null,
        ].filter(Boolean),
        settle_only_reasons: [
          controlsAppearedAfterSettleWithoutLoading ? "form_controls_appear_after_settle" : null,
          textAppearedAfterSettleWithoutLoading ? "text_appears_after_settle_without_loading_state" : null,
        ].filter(Boolean),
      });
    } catch (err) {
      const message = String(err?.message || err || "unknown browser error");
      seoSnapshot.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        unresolved_placeholder: false,
        auth_mode: authMode,
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
        auth_mode: authMode,
        surface,
        sticky_count: 0,
        scrollable_count: 0,
        nested_scrollables_count: 0,
        error: message,
      });
      visibilitySignals.push({
        route: routeTemplate,
        route_template: routeTemplate,
        resolved_route: resolvedPath,
        unresolved_placeholder: false,
        surface,
        auth_mode: authMode,
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
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
    }

    for (const item of routeResourceFailures) {
      const statusLabel = item.status_code ? `status ${item.status_code}` : (item.failure_text || "requestfailed");
      const descriptor = [statusLabel, item.resource_type || "resource", item.method || "GET", item.request_url || "(unknown-url)"]
        .filter(Boolean)
        .join(" | ");
      consoleErrors.push({
        route: item.route,
        route_template: item.route_template,
        resolved_route: item.resolved_route,
        surface,
        level: "error",
        severity: "s4",
        text: `Failed resource request: ${descriptor}`,
        source: item.source,
        request_url: item.request_url || null,
        status_code: item.status_code,
        resource_type: item.resource_type || null,
        method: item.method || null,
        failure_text: item.failure_text || null,
        source_url: null,
        line: null,
        column: null,
      });
    }

    for (const item of routeConsole) {
      const lowerText = String(item.text || "").toLowerCase();
      if (lowerText.includes("failed to load resource")) {
        // Prefer structured resource-failure events above; generic console messages
        // are noisy and omit URL/status.
        continue;
      }
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
        source_url: item.source_url ?? null,
        line: item.line ?? null,
        column: item.column ?? null,
      });
    }
    for (const item of routePageErrors) {
      const lowerText = String(item.text || "").toLowerCase();
      if (lowerText.includes("failed to load resource")) {
        // Prefer structured resource-failure events above; generic page errors
        // are noisy and omit URL/status.
        continue;
      }
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
        source_url: item.source_url ?? null,
        line: item.line ?? null,
        column: item.column ?? null,
      });
    }
  }

  await browser.close();

  await writeUtf8FileUnderBase(outputDirAbsPath, "seo-snapshot.json", `${JSON.stringify(seoSnapshot, null, 2)}\n`);
  await writeUtf8FileUnderBase(outputDirAbsPath, "console-errors.json", `${JSON.stringify(consoleErrors, null, 2)}\n`);
  await writeUtf8FileUnderBase(outputDirAbsPath, "layout-signals.json", `${JSON.stringify(layoutSignals, null, 2)}\n`);
  await writeUtf8FileUnderBase(outputDirAbsPath, "visibility-signals.json", `${JSON.stringify(visibilitySignals, null, 2)}\n`);
  await writeUtf8FileUnderBase(
    outputDirAbsPath,
    "browser-evidence-meta.json",
    `${JSON.stringify(
      {
        auth_mode: authMode,
        base_url: baseUrl,
        api_base_url: apiBaseUrl || baseUrl,
      },
      null,
      2
    )}\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const message = String(err?.message || err || "unknown error");
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

export { parseArgs, resolveMaxRoutes };
