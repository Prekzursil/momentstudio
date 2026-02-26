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

function pushUniqueResourceFailure(routeResourceFailureKeys, routeResourceFailures, item) {
  const dedupeKey = buildResourceFailureKey(item);
  if (routeResourceFailureKeys.has(dedupeKey)) {
    return;
  }
  routeResourceFailureKeys.add(dedupeKey);
  routeResourceFailures.push(item);
}

function buildResponseResourceFailure(response, routeTemplate, resolvedPath, statusCode) {
  const request = response.request();
  return {
    source: "response",
    route: routeTemplate,
    route_template: routeTemplate,
    resolved_route: resolvedPath,
    status_code: statusCode,
    request_url: normalizeResourceFailureUrl(response.url()),
    resource_type: String(request.resourceType() || ""),
    method: String(request.method() || ""),
    failure_text: "",
  };
}

function buildRequestFailedResourceFailure(request, routeTemplate, resolvedPath) {
  const failure = request.failure();
  return {
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
}

function readSeoMetaSnapshotInPage() {
  const readAttribute = (selector, attribute) => {
    const node = document.querySelector(selector);
    if (!node) {
      return null;
    }
    return node.getAttribute(attribute) || null;
  };
  const title = document.title || null;
  const h1Nodes = Array.from(document.querySelectorAll("h1"));
  const h1Texts = h1Nodes.map((node) => (node.textContent || "").trim()).filter(Boolean);

  return {
    title,
    description: readAttribute("meta[name='description']", "content"),
    og_description: readAttribute("meta[property='og:description']", "content"),
    canonical: readAttribute("link[rel='canonical']", "href"),
    robots: readAttribute("meta[name='robots']", "content"),
    h1_count: h1Nodes.length,
    h1_texts: h1Texts.slice(0, 5),
    route_heading_count: document.querySelectorAll("[data-route-heading='true']").length,
  };
}

function readSeoTextSignalsInPage() {
  const normalizeText = (value) => String(value || "").replaceAll(/\s+/g, " ").trim();
  const countWords = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) {
      return 0;
    }
    return normalized.split(" ").filter(Boolean).length;
  };
  const wordCount = countWords(document.body?.innerText || "");
  const meaningfulTextBlockCount = Array.from(document.querySelectorAll("main p, article p, section p, li, h2, h3"))
    .map((node) => normalizeText(node.textContent || ""))
    .filter((text) => text.length >= 40)
    .filter((text) => countWords(text) >= 8)
    .length;

  return {
    word_count_initial_html: wordCount,
    meaningful_text_block_count: meaningfulTextBlockCount,
  };
}

function countInternalLinksInPage() {
  const isSkippableHref = (href) => !href || href.startsWith("#");
  const isInternalHttpUrl = (url, origin) => {
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    return isHttp && url.origin === origin;
  };

  let internalLinkCount = 0;
  const origin = globalThis.location.origin;
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = String(anchor.getAttribute("href") || "").trim();
    if (isSkippableHref(href)) {
      continue;
    }
    try {
      if (isInternalHttpUrl(new URL(href, origin), origin)) {
        internalLinkCount += 1;
      }
    } catch {
      // Ignore malformed href values.
    }
  }
  return internalLinkCount;
}

async function collectSeoMetaSnapshot(page) {
  return page.evaluate(readSeoMetaSnapshotInPage);
}

async function collectSeoTextSignals(page) {
  return page.evaluate(readSeoTextSignalsInPage);
}

async function collectInternalLinkCount(page) {
  return page.evaluate(countInternalLinksInPage);
}

async function collectSeoSnapshot(page) {
  const [meta, textSignals, internalLinkCount] = await Promise.all([
    collectSeoMetaSnapshot(page),
    collectSeoTextSignals(page),
    collectInternalLinkCount(page),
  ]);
  const noindex = String(meta.robots || "").toLowerCase().includes("noindex");
  return {
    ...meta,
    ...textSignals,
    internal_link_count: internalLinkCount,
    indexable: !noindex,
  };
}

function buildVisibilitySignalPayload({
  routeTemplate,
  resolvedPath,
  surface,
  authMode,
  visibilityInitial,
  visibilitySettled,
  visibilityAfterPassive,
}) {
  const controlsUnlockedAfterPassive = didControlsUnlockAfterPassive(visibilitySettled, visibilityAfterPassive);
  const textUnlockedAfterPassive = didTextUnlockAfterPassive(visibilitySettled, visibilityAfterPassive);
  const controlsAppearedAfterSettleWithoutLoading = didControlsAppearAfterSettleWithoutLoading(
    visibilityInitial,
    visibilitySettled
  );
  const textAppearedAfterSettleWithoutLoading = didTextAppearAfterSettleWithoutLoading(
    visibilityInitial,
    visibilitySettled
  );
  return {
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
  };
}

function didControlsUnlockAfterPassive(visibilitySettled, visibilityAfterPassive) {
  return visibilitySettled.visible_form_control_count === 0
    && visibilityAfterPassive.visible_form_control_count > 0;
}

function didTextUnlockAfterPassive(visibilitySettled, visibilityAfterPassive) {
  return visibilitySettled.text_words < 20 && visibilityAfterPassive.text_words >= 40;
}

function didControlsAppearAfterSettleWithoutLoading(visibilityInitial, visibilitySettled) {
  return visibilityInitial.visible_form_control_count === 0
    && visibilitySettled.visible_form_control_count > 0
    && visibilitySettled.loading_indicator_count === 0;
}

function didTextAppearAfterSettleWithoutLoading(visibilityInitial, visibilitySettled) {
  return visibilityInitial.text_words < 20
    && visibilitySettled.text_words >= 40
    && visibilitySettled.loading_indicator_count === 0;
}

function onConsoleEvent(routeConsole, routeTemplate, resolvedPath, msg) {
  const location = typeof msg.location === "function" ? msg.location() : null;
  const line = location && Number.isFinite(Number(location.lineNumber)) ? Number(location.lineNumber) : null;
  const column = location && Number.isFinite(Number(location.columnNumber)) ? Number(location.columnNumber) : null;
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
}

function onPageErrorEvent(routePageErrors, routeTemplate, resolvedPath, err) {
  routePageErrors.push({
    route: routeTemplate,
    route_template: routeTemplate,
    resolved_route: resolvedPath,
    level: "error",
    text: String(err?.message || err || ""),
  });
}

function onResponseEvent(routeResourceFailureKeys, routeResourceFailures, routeTemplate, resolvedPath, response) {
  const statusCode = Number(response.status() || 0);
  if (!Number.isFinite(statusCode) || statusCode < 400) {
    return;
  }
  const item = buildResponseResourceFailure(response, routeTemplate, resolvedPath, statusCode);
  pushUniqueResourceFailure(routeResourceFailureKeys, routeResourceFailures, item);
}

function onRequestFailedEvent(routeResourceFailureKeys, routeResourceFailures, routeTemplate, resolvedPath, request) {
  const item = buildRequestFailedResourceFailure(request, routeTemplate, resolvedPath);
  pushUniqueResourceFailure(routeResourceFailureKeys, routeResourceFailures, item);
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

function readFirstTrimmedValue(values) {
  for (const value of values) {
    const token = String(value || "").trim();
    if (token) {
      return token;
    }
  }
  return "";
}

function readSeriesSlug(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const seriesSlug = readFirstTrimmedValue([
      item.series_slug,
      item.series?.slug,
      item.series,
    ]);
    if (seriesSlug) {
      return seriesSlug;
    }
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

function readLayoutSignalsInPage() {
  const allElements = Array.from(document.querySelectorAll("*"));
  const stickyElements = allElements.filter((el) => getComputedStyle(el).position === "sticky");
  const scrollables = allElements.filter((el) => {
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 8;
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
}

async function collectLayoutSignals(page) {
  return page.evaluate(readLayoutSignalsInPage);
}

function buildBaseRouteRecord(routeState) {
  return {
    route: routeState.routeTemplate,
    route_template: routeState.routeTemplate,
    resolved_route: routeState.resolvedPath,
  };
}

function buildSeoRecord(routeState, overrides = {}) {
  return {
    ...buildBaseRouteRecord(routeState),
    unresolved_placeholder: false,
    auth_mode: routeState.authMode,
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
    ...overrides,
  };
}

function buildLayoutRecord(routeState, overrides = {}) {
  return {
    ...buildBaseRouteRecord(routeState),
    unresolved_placeholder: false,
    auth_mode: routeState.authMode,
    surface: routeState.surface,
    sticky_count: 0,
    scrollable_count: 0,
    nested_scrollables_count: 0,
    ...overrides,
  };
}

function buildVisibilityRecord(routeState, overrides = {}) {
  return {
    ...buildBaseRouteRecord(routeState),
    unresolved_placeholder: false,
    surface: routeState.surface,
    auth_mode: routeState.authMode,
    ...overrides,
  };
}

function createRouteState(route, routeSamples, outputDirAbsPath, baseUrl, authMode) {
  const routeTemplate = String(route?.full_path || "/");
  const surface = String(route?.surface || "storefront");
  const materialized = materializeRoute(routeTemplate, routeSamples);
  const rawResolvedPath = materialized.resolvedRoute;
  const resolvedPath = rawResolvedPath.startsWith("/") ? rawResolvedPath : `/${rawResolvedPath}`;
  const slug = routeSlug(resolvedPath || routeTemplate);
  const screenshotPath = path.join("screenshots", `${slug}.png`);
  return {
    routeTemplate,
    surface,
    materialized,
    resolvedPath,
    url: `${baseUrl}${resolvedPath}`,
    screenshotPath,
    screenshotAbsPath: resolvePathUnderBase(outputDirAbsPath, screenshotPath),
    authMode,
    routeConsole: [],
    routePageErrors: [],
    routeResourceFailures: [],
    routeResourceFailureKeys: new Set(),
  };
}

function appendUnresolvedPlaceholderArtifacts(artifacts, routeState) {
  const skipped = {
    unresolved_placeholder: true,
    skipped_reason: "unresolved_placeholder",
  };
  artifacts.seoSnapshot.push(
    buildSeoRecord(routeState, {
      ...skipped,
      unresolved_keys: routeState.materialized.unresolvedKeys,
    })
  );
  artifacts.layoutSignals.push(buildLayoutRecord(routeState, skipped));
  artifacts.visibilitySignals.push(buildVisibilityRecord(routeState, skipped));
}

function appendRouteSuccessArtifacts(artifacts, routeState, seo, layout, visibilitySignal) {
  artifacts.seoSnapshot.push(buildSeoRecord(routeState, {
    surface: routeState.surface,
    url: routeState.url,
    screenshot: routeState.screenshotPath,
    ...seo,
  }));
  artifacts.layoutSignals.push(buildLayoutRecord(routeState, layout));
  artifacts.visibilitySignals.push(visibilitySignal);
}

function appendRouteFailureArtifacts(artifacts, routeState, message) {
  artifacts.seoSnapshot.push(buildSeoRecord(routeState, {
    surface: routeState.surface,
    url: routeState.url,
    error: message,
  }));
  artifacts.layoutSignals.push(buildLayoutRecord(routeState, { error: message }));
  artifacts.visibilitySignals.push(buildVisibilityRecord(routeState, { error: message }));
}

function bindRouteEventHandlers(page, routeState) {
  const onConsole = onConsoleEvent.bind(null, routeState.routeConsole, routeState.routeTemplate, routeState.resolvedPath);
  const onPageError = onPageErrorEvent.bind(null, routeState.routePageErrors, routeState.routeTemplate, routeState.resolvedPath);
  const onResponse = onResponseEvent.bind(
    null,
    routeState.routeResourceFailureKeys,
    routeState.routeResourceFailures,
    routeState.routeTemplate,
    routeState.resolvedPath
  );
  const onRequestFailed = onRequestFailedEvent.bind(
    null,
    routeState.routeResourceFailureKeys,
    routeState.routeResourceFailures,
    routeState.routeTemplate,
    routeState.resolvedPath
  );
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  return () => {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  };
}

async function collectVisibilityPhases(page) {
  const visibilityInitial = await collectVisibilityProbe(page);
  await page.waitForTimeout(2000);
  const visibilitySettled = await collectVisibilityProbe(page);
  await page.evaluate(() => {
    globalThis.dispatchEvent(new Event("scroll"));
    globalThis.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(250);
  const visibilityAfterPassive = await collectVisibilityProbe(page);
  return {
    visibilityInitial,
    visibilitySettled,
    visibilityAfterPassive,
  };
}

async function collectRouteEvidence(page, routeState) {
  await page.goto(routeState.url, { waitUntil: "networkidle", timeout: 45000 });
  const visibility = await collectVisibilityPhases(page);
  await page.screenshot({ path: routeState.screenshotAbsPath, fullPage: true });
  const [seo, layout] = await Promise.all([
    collectSeoSnapshot(page),
    collectLayoutSignals(page),
  ]);
  const visibilitySignal = buildVisibilitySignalPayload({
    routeTemplate: routeState.routeTemplate,
    resolvedPath: routeState.resolvedPath,
    surface: routeState.surface,
    authMode: routeState.authMode,
    visibilityInitial: visibility.visibilityInitial,
    visibilitySettled: visibility.visibilitySettled,
    visibilityAfterPassive: visibility.visibilityAfterPassive,
  });
  return { seo, layout, visibilitySignal };
}

function fallbackString(value, fallback) {
  const token = String(value || "").trim();
  return token || fallback;
}

function nullableString(value) {
  const token = String(value || "").trim();
  return token || null;
}

function buildResourceFailureStatusLabel(item) {
  if (item.status_code) {
    return `status ${item.status_code}`;
  }
  return fallbackString(item.failure_text, "requestfailed");
}

function buildResourceFailureDescriptor(item) {
  return [
    buildResourceFailureStatusLabel(item),
    fallbackString(item.resource_type, "resource"),
    fallbackString(item.method, "GET"),
    fallbackString(item.request_url, "(unknown-url)"),
  ].join(" | ");
}

function buildResourceFailureConsoleError(item, surface) {
  return {
    route: item.route,
    route_template: item.route_template,
    resolved_route: item.resolved_route,
    surface,
    level: "error",
    severity: "s4",
    text: `Failed resource request: ${buildResourceFailureDescriptor(item)}`,
    source: item.source,
    request_url: nullableString(item.request_url),
    status_code: item.status_code,
    resource_type: nullableString(item.resource_type),
    method: nullableString(item.method),
    failure_text: nullableString(item.failure_text),
    source_url: null,
    line: null,
    column: null,
  };
}

function appendResourceFailureConsoleErrors(consoleErrors, routeResourceFailures, surface) {
  for (const item of routeResourceFailures) {
    consoleErrors.push(buildResourceFailureConsoleError(item, surface));
  }
}

function appendClassifiedConsoleErrors(consoleErrors, entries, surface, severitySelector = (classification) => classification.severity) {
  for (const item of entries) {
    const lowerText = String(item.text || "").toLowerCase();
    if (lowerText.includes("failed to load resource")) {
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
      severity: severitySelector(classification),
      text: item.text,
      source_url: item.source_url ?? null,
      line: item.line ?? null,
      column: item.column ?? null,
    });
  }
}

function flushRouteConsoleErrors(routeState, consoleErrors) {
  appendResourceFailureConsoleErrors(consoleErrors, routeState.routeResourceFailures, routeState.surface);
  appendClassifiedConsoleErrors(consoleErrors, routeState.routeConsole, routeState.surface);
  appendClassifiedConsoleErrors(
    consoleErrors,
    routeState.routePageErrors,
    routeState.surface,
    (classification) => (classification.severity === "s4" ? "s4" : "s2")
  );
}

async function processRoute(page, route, runtime) {
  const routeState = createRouteState(route, runtime.routeSamples, runtime.outputDirAbsPath, runtime.baseUrl, runtime.authMode);
  if (routeState.materialized.unresolvedPlaceholder) {
    appendUnresolvedPlaceholderArtifacts(runtime.artifacts, routeState);
    return;
  }
  const cleanup = bindRouteEventHandlers(page, routeState);
  try {
    const evidence = await collectRouteEvidence(page, routeState);
    appendRouteSuccessArtifacts(
      runtime.artifacts,
      routeState,
      evidence.seo,
      evidence.layout,
      evidence.visibilitySignal
    );
  } catch (err) {
    const message = String(err?.message || err || "unknown browser error");
    appendRouteFailureArtifacts(runtime.artifacts, routeState, message);
    routeState.routeConsole.push({
      ...buildBaseRouteRecord(routeState),
      level: "error",
      text: message,
    });
  } finally {
    cleanup();
  }
  flushRouteConsoleErrors(routeState, runtime.artifacts.consoleErrors);
}

function parseRunArgs(argv) {
  const args = parseArgs(argv);
  const baseUrl = normalizeUrl(args["base-url"]);
  const apiBaseUrl = normalizeUrl(args["api-base-url"] || "");
  const routesJsonPath = String(args["routes-json"] || "").trim();
  const outputDir = String(args["output-dir"] || "").trim();
  if (!baseUrl || !routesJsonPath || !outputDir) {
    throw new Error("Required args: --base-url --routes-json --output-dir");
  }
  return {
    baseUrl,
    apiBaseUrl,
    routesJsonPath,
    outputDir,
    routeSamplesPath: String(args["route-samples"] || "").trim(),
    authMode: normalizeAuthMode(args["auth-mode"]),
    ownerIdentifier: String(args["owner-identifier"] || "").trim(),
    ownerPassword: String(args["owner-password"] || "").trim(),
    maxRoutes: resolveMaxRoutes(args["max-routes"]),
  };
}

function resolveRunPaths(config, cwdPath = process.cwd()) {
  const allowedRoots = [repoRoot];
  const cwdAbsPath = path.resolve(cwdPath);
  if (isPathWithinRoot(repoRoot, cwdAbsPath)) {
    allowedRoots.push(cwdAbsPath);
  }
  return {
    allowedRoots,
    routesJsonAbsPath: resolvePathUnderAllowedBases(config.routesJsonPath, allowedRoots, "--routes-json"),
    outputDirAbsPath: resolvePathUnderAllowedBases(config.outputDir, allowedRoots, "--output-dir"),
  };
}

async function loadRoutes(routesJsonAbsPath, allowedRoots, maxRoutes) {
  const payload = JSON.parse(await readUtf8FileUnderAllowedBases(routesJsonAbsPath, allowedRoots, "--routes-json"));
  return Array.isArray(payload?.routes) ? payload.routes.slice(0, maxRoutes) : [];
}

async function prepareOutputDirectory(outputDirAbsPath) {
  await ensureDirectoryUnderBase(outputDirAbsPath);
  await ensureDirectoryUnderBase(outputDirAbsPath, "screenshots");
}

async function createBrowserRuntime(baseUrl, apiBaseUrl) {
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installApiRewrite(context, {
    baseUrl,
    apiBaseUrl: apiBaseUrl || baseUrl,
  });
  const page = await context.newPage();
  return { browser, context, page };
}

async function maybePrimeOwnerAuth(context, config) {
  if (config.authMode !== "owner") {
    return null;
  }
  return primeOwnerSession(context, {
    apiBaseUrl: config.apiBaseUrl || config.baseUrl,
    ownerIdentifier: config.ownerIdentifier,
    ownerPassword: config.ownerPassword,
  });
}

function createArtifacts() {
  return {
    seoSnapshot: [],
    consoleErrors: [],
    layoutSignals: [],
    visibilitySignals: [],
  };
}

function toPrettyJson(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

async function writeArtifacts(outputDirAbsPath, artifacts, metadata) {
  await writeUtf8FileUnderBase(outputDirAbsPath, "seo-snapshot.json", toPrettyJson(artifacts.seoSnapshot));
  await writeUtf8FileUnderBase(outputDirAbsPath, "console-errors.json", toPrettyJson(artifacts.consoleErrors));
  await writeUtf8FileUnderBase(outputDirAbsPath, "layout-signals.json", toPrettyJson(artifacts.layoutSignals));
  await writeUtf8FileUnderBase(outputDirAbsPath, "visibility-signals.json", toPrettyJson(artifacts.visibilitySignals));
  await writeUtf8FileUnderBase(outputDirAbsPath, "browser-evidence-meta.json", toPrettyJson(metadata));
}

async function main() {
  const config = parseRunArgs(process.argv);
  const paths = resolveRunPaths(config);
  const routes = await loadRoutes(paths.routesJsonAbsPath, paths.allowedRoots, config.maxRoutes);
  let routeSamples = await loadRouteSamples(config.routeSamplesPath, paths.allowedRoots);
  await prepareOutputDirectory(paths.outputDirAbsPath);

  const artifacts = createArtifacts();
  const runtime = await createBrowserRuntime(config.baseUrl, config.apiBaseUrl);
  try {
    const ownerAuth = await maybePrimeOwnerAuth(runtime.context, config);
    routeSamples = await hydrateRouteSamplesFromApi(runtime.context, {
      apiBaseUrl: config.apiBaseUrl || config.baseUrl,
      routeSamples,
      accessToken: ownerAuth?.accessToken || "",
    });
    for (const route of routes) {
      await processRoute(runtime.page, route, {
        baseUrl: config.baseUrl,
        authMode: config.authMode,
        routeSamples,
        outputDirAbsPath: paths.outputDirAbsPath,
        artifacts,
      });
    }
  } finally {
    await runtime.browser.close();
  }

  await writeArtifacts(paths.outputDirAbsPath, artifacts, {
    auth_mode: config.authMode,
    base_url: config.baseUrl,
    api_base_url: config.apiBaseUrl || config.baseUrl,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const message = String(err?.message || err || "unknown error");
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

export { parseArgs, resolveMaxRoutes };
