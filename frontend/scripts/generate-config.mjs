import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function isPathWithinRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolvePathUnderBase(rootPath, candidatePath, label) {
  const base = path.resolve(rootPath);
  const candidate = path.resolve(base, candidatePath);
  if (!isPathWithinRoot(base, candidate)) {
    throw new Error(`[config] Refusing ${label} outside allowed root: ${candidate}`);
  }
  return candidate;
}

function readUtf8UnderBase(rootPath, candidatePath, label) {
  const safePath = resolvePathUnderBase(rootPath, candidatePath, label);
  return fs.readFileSync(safePath, 'utf8');
}

function mkdirUnderBase(rootPath, candidatePath, label) {
  const safePath = resolvePathUnderBase(rootPath, candidatePath, label);
  fs.mkdirSync(safePath, { recursive: true });
  return safePath;
}

function writeUtf8UnderBase(rootPath, candidatePath, payload, label) {
  const safePath = resolvePathUnderBase(rootPath, candidatePath, label);
  fs.writeFileSync(safePath, payload, 'utf8');
}

function parseDotEnv(contents) {
  const result = {
    API_BASE_URL: undefined,
    APP_ENV: undefined,
    APP_VERSION: undefined,
    STRIPE_ENABLED: undefined,
    PAYPAL_ENABLED: undefined,
    NETOPIA_ENABLED: undefined,
    ADDRESS_AUTOCOMPLETE_ENABLED: undefined,
    FRONTEND_CLARITY_PROJECT_ID: undefined,
    CLARITY_ENABLED: undefined,
    SENTRY_ENABLED: undefined,
    SENTRY_DSN: undefined,
    SENTRY_SEND_DEFAULT_PII: undefined,
    SENTRY_TRACES_SAMPLE_RATE: undefined,
    SENTRY_REPLAY_SESSION_SAMPLE_RATE: undefined,
    SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE: undefined,
    CAPTCHA_SITE_KEY: undefined,
    SITE_NAME: undefined,
    PUBLIC_BASE_URL: undefined,
    SUPPORT_EMAIL: undefined,
    DEFAULT_LOCALE: undefined,
    SUPPORTED_LOCALES: undefined
  };
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    switch (key) {
      case 'API_BASE_URL':
        result.API_BASE_URL = value;
        break;
      case 'APP_ENV':
        result.APP_ENV = value;
        break;
      case 'APP_VERSION':
        result.APP_VERSION = value;
        break;
      case 'STRIPE_ENABLED':
        result.STRIPE_ENABLED = value;
        break;
      case 'PAYPAL_ENABLED':
        result.PAYPAL_ENABLED = value;
        break;
      case 'NETOPIA_ENABLED':
        result.NETOPIA_ENABLED = value;
        break;
      case 'ADDRESS_AUTOCOMPLETE_ENABLED':
        result.ADDRESS_AUTOCOMPLETE_ENABLED = value;
        break;
      case 'FRONTEND_CLARITY_PROJECT_ID':
        result.FRONTEND_CLARITY_PROJECT_ID = value;
        break;
      case 'CLARITY_ENABLED':
        result.CLARITY_ENABLED = value;
        break;
      case 'SENTRY_DSN':
        result.SENTRY_DSN = value;
        break;
      case 'SENTRY_ENABLED':
        result.SENTRY_ENABLED = value;
        break;
      case 'SENTRY_SEND_DEFAULT_PII':
        result.SENTRY_SEND_DEFAULT_PII = value;
        break;
      case 'SENTRY_TRACES_SAMPLE_RATE':
        result.SENTRY_TRACES_SAMPLE_RATE = value;
        break;
      case 'SENTRY_REPLAY_SESSION_SAMPLE_RATE':
        result.SENTRY_REPLAY_SESSION_SAMPLE_RATE = value;
        break;
      case 'SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE':
        result.SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE = value;
        break;
      case 'CAPTCHA_SITE_KEY':
        result.CAPTCHA_SITE_KEY = value;
        break;
      case 'SITE_NAME':
        result.SITE_NAME = value;
        break;
      case 'PUBLIC_BASE_URL':
        result.PUBLIC_BASE_URL = value;
        break;
      case 'SUPPORT_EMAIL':
        result.SUPPORT_EMAIL = value;
        break;
      case 'DEFAULT_LOCALE':
        result.DEFAULT_LOCALE = value;
        break;
      case 'SUPPORTED_LOCALES':
        result.SUPPORTED_LOCALES = value;
        break;
      default:
        break;
    }
  }
  return result;
}

function firstExisting(rootPath, paths) {
  for (const candidate of paths) {
    const safeCandidate = resolvePathUnderBase(rootPath, candidate, 'candidate path');
    if (fs.existsSync(safeCandidate)) return safeCandidate;
  }
  return null;
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptsDir, '..');
let packageVersion = '';
try {
  const packageJsonPath = resolvePathUnderBase(frontendRoot, path.join(frontendRoot, 'package.json'), 'package.json');
  const pkg = JSON.parse(readUtf8UnderBase(frontendRoot, packageJsonPath, 'package.json'));
  if (typeof pkg?.version === 'string') packageVersion = pkg.version;
} catch {
  packageVersion = '';
}
const envPath = firstExisting(frontendRoot, [
  path.join(frontendRoot, '.env'),
  path.join(frontendRoot, '.env.local'),
  path.join(frontendRoot, '.env.example')
]);

const parsed = envPath ? parseDotEnv(readUtf8UnderBase(frontendRoot, envPath, 'env file')) : {};

const apiBaseUrl = process.env.API_BASE_URL ?? parsed.API_BASE_URL ?? '/api/v1';
const appEnv = process.env.APP_ENV ?? parsed.APP_ENV ?? 'development';
const appVersion = process.env.APP_VERSION ?? parsed.APP_VERSION ?? packageVersion;
const stripeEnabledRaw = process.env.STRIPE_ENABLED ?? parsed.STRIPE_ENABLED;
const stripeEnabled = ['1', 'true', 'yes', 'on'].includes(String(stripeEnabledRaw ?? '').trim().toLowerCase());
const paypalEnabledRaw = process.env.PAYPAL_ENABLED ?? parsed.PAYPAL_ENABLED ?? '';
const netopiaEnabledRaw = process.env.NETOPIA_ENABLED ?? parsed.NETOPIA_ENABLED ?? '';
const addressAutocompleteEnabledRaw = process.env.ADDRESS_AUTOCOMPLETE_ENABLED ?? parsed.ADDRESS_AUTOCOMPLETE_ENABLED ?? '';
const clarityProjectId = process.env.FRONTEND_CLARITY_PROJECT_ID ?? parsed.FRONTEND_CLARITY_PROJECT_ID ?? '';
const clarityEnabledRaw = process.env.CLARITY_ENABLED ?? parsed.CLARITY_ENABLED ?? '';
const sentryEnabledRaw = process.env.SENTRY_ENABLED ?? parsed.SENTRY_ENABLED ?? '1';
const sentryDsn = process.env.SENTRY_DSN ?? parsed.SENTRY_DSN ?? '';
const sentrySendDefaultPiiRaw = process.env.SENTRY_SEND_DEFAULT_PII ?? parsed.SENTRY_SEND_DEFAULT_PII ?? '1';
const sentryTracesSampleRateRaw = process.env.SENTRY_TRACES_SAMPLE_RATE ?? parsed.SENTRY_TRACES_SAMPLE_RATE ?? '1.0';
const sentryReplaySessionSampleRateRaw =
  process.env.SENTRY_REPLAY_SESSION_SAMPLE_RATE ?? parsed.SENTRY_REPLAY_SESSION_SAMPLE_RATE ?? '0.25';
const sentryReplayOnErrorSampleRateRaw =
  process.env.SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE ?? parsed.SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE ?? '1.0';
const captchaSiteKey = process.env.CAPTCHA_SITE_KEY ?? parsed.CAPTCHA_SITE_KEY ?? '';
const siteName = process.env.SITE_NAME ?? parsed.SITE_NAME ?? 'momentstudio';
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? parsed.PUBLIC_BASE_URL ?? 'https://momentstudio.ro';
const supportEmail = process.env.SUPPORT_EMAIL ?? parsed.SUPPORT_EMAIL ?? 'momentstudio.ro@gmail.com';
const defaultLocale = process.env.DEFAULT_LOCALE ?? parsed.DEFAULT_LOCALE ?? 'en';
const supportedLocalesRaw = process.env.SUPPORTED_LOCALES ?? parsed.SUPPORTED_LOCALES ?? 'en,ro';
const paypalEnabled = ['1', 'true', 'yes', 'on'].includes(String(paypalEnabledRaw).trim().toLowerCase());
const netopiaEnabled = ['1', 'true', 'yes', 'on'].includes(String(netopiaEnabledRaw).trim().toLowerCase());
const addressAutocompleteEnabled = ['1', 'true', 'yes', 'on'].includes(String(addressAutocompleteEnabledRaw).trim().toLowerCase());
const clarityEnabled =
  String(clarityEnabledRaw ?? '').trim()
    ? ['1', 'true', 'yes', 'on'].includes(String(clarityEnabledRaw).trim().toLowerCase())
    : Boolean(String(clarityProjectId).trim());
const sentrySendDefaultPii = ['1', 'true', 'yes', 'on'].includes(String(sentrySendDefaultPiiRaw).trim().toLowerCase());
const sentryEnabled = ['1', 'true', 'yes', 'on'].includes(String(sentryEnabledRaw).trim().toLowerCase());
const sentryTracesSampleRate = Math.max(0, Math.min(1, Number.parseFloat(String(sentryTracesSampleRateRaw)) || 0));
const sentryReplaySessionSampleRate = Math.max(
  0,
  Math.min(1, Number.parseFloat(String(sentryReplaySessionSampleRateRaw)) || 0)
);
const sentryReplayOnErrorSampleRate = Math.max(
  0,
  Math.min(1, Number.parseFloat(String(sentryReplayOnErrorSampleRateRaw)) || 0)
);

const outPath = resolvePathUnderBase(frontendRoot, path.join(frontendRoot, 'src', 'assets', 'app-config.js'), 'output file');
const outDir = resolvePathUnderBase(frontendRoot, path.dirname(outPath), 'output directory');
mkdirUnderBase(frontendRoot, outDir, 'output directory');

const config = {
  apiBaseUrl,
  appEnv,
  appVersion,
  stripeEnabled,
  paypalEnabled,
  netopiaEnabled,
  addressAutocompleteEnabled,
  clarityProjectId: String(clarityProjectId).trim(),
  clarityEnabled,
  sentryEnabled,
  sentryDsn,
  sentrySendDefaultPii,
  sentryTracesSampleRate,
  sentryReplaySessionSampleRate,
  sentryReplayOnErrorSampleRate,
  captchaSiteKey,
  siteName: String(siteName).trim() || 'momentstudio',
  publicBaseUrl: String(publicBaseUrl).trim() || 'https://momentstudio.ro',
  supportEmail: String(supportEmail).trim() || 'momentstudio.ro@gmail.com',
  defaultLocale: String(defaultLocale).trim() || 'en',
  supportedLocales: (() => {
    const locales = String(supportedLocalesRaw)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return locales.length ? locales : ['en', 'ro'];
  })()
};
const payload = `// Auto-generated by scripts/generate-config.mjs\nwindow.__APP_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`;

writeUtf8UnderBase(frontendRoot, outPath, payload, 'output file');
console.log(`Wrote ${path.relative(frontendRoot, outPath)} from ${envPath ? path.relative(frontendRoot, envPath) : 'defaults'}`);
