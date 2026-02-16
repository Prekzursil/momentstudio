import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseDotEnv(contents) {
  const result = {
    API_BASE_URL: undefined,
    APP_ENV: undefined,
    APP_VERSION: undefined,
    STRIPE_ENABLED: undefined,
    PAYPAL_ENABLED: undefined,
    NETOPIA_ENABLED: undefined,
    ADDRESS_AUTOCOMPLETE_ENABLED: undefined,
    SENTRY_DSN: undefined,
    SENTRY_TRACES_SAMPLE_RATE: undefined,
    SENTRY_REPLAY_SESSION_SAMPLE_RATE: undefined,
    SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE: undefined,
    CAPTCHA_SITE_KEY: undefined
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
      case 'SENTRY_DSN':
        result.SENTRY_DSN = value;
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
      default:
        break;
    }
  }
  return result;
}

function firstExisting(paths) {
  for (const candidate of paths) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptsDir, '..');
let packageVersion = '';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8'));
  if (typeof pkg?.version === 'string') packageVersion = pkg.version;
} catch {
  packageVersion = '';
}
const envPath = firstExisting([
  path.join(frontendRoot, '.env'),
  path.join(frontendRoot, '.env.local'),
  path.join(frontendRoot, '.env.example')
]);

const parsed = envPath ? parseDotEnv(fs.readFileSync(envPath, 'utf8')) : {};

const apiBaseUrl = process.env.API_BASE_URL ?? parsed.API_BASE_URL ?? '/api/v1';
const appEnv = process.env.APP_ENV ?? parsed.APP_ENV ?? 'development';
const appVersion = process.env.APP_VERSION ?? parsed.APP_VERSION ?? packageVersion;
const stripeEnabledRaw = process.env.STRIPE_ENABLED ?? parsed.STRIPE_ENABLED;
const stripeEnabled = ['1', 'true', 'yes', 'on'].includes(String(stripeEnabledRaw ?? '').trim().toLowerCase());
const paypalEnabledRaw = process.env.PAYPAL_ENABLED ?? parsed.PAYPAL_ENABLED ?? '';
const netopiaEnabledRaw = process.env.NETOPIA_ENABLED ?? parsed.NETOPIA_ENABLED ?? '';
const addressAutocompleteEnabledRaw = process.env.ADDRESS_AUTOCOMPLETE_ENABLED ?? parsed.ADDRESS_AUTOCOMPLETE_ENABLED ?? '';
const sentryDsn = process.env.SENTRY_DSN ?? parsed.SENTRY_DSN ?? '';
const sentryTracesSampleRateRaw = process.env.SENTRY_TRACES_SAMPLE_RATE ?? parsed.SENTRY_TRACES_SAMPLE_RATE ?? '0';
const sentryReplaySessionSampleRateRaw =
  process.env.SENTRY_REPLAY_SESSION_SAMPLE_RATE ?? parsed.SENTRY_REPLAY_SESSION_SAMPLE_RATE ?? '0';
const sentryReplayOnErrorSampleRateRaw =
  process.env.SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE ?? parsed.SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE ?? '0';
const captchaSiteKey = process.env.CAPTCHA_SITE_KEY ?? parsed.CAPTCHA_SITE_KEY ?? '';
const paypalEnabled = ['1', 'true', 'yes', 'on'].includes(String(paypalEnabledRaw).trim().toLowerCase());
const netopiaEnabled = ['1', 'true', 'yes', 'on'].includes(String(netopiaEnabledRaw).trim().toLowerCase());
const addressAutocompleteEnabled = ['1', 'true', 'yes', 'on'].includes(String(addressAutocompleteEnabledRaw).trim().toLowerCase());
const sentryTracesSampleRate = Math.max(0, Math.min(1, Number.parseFloat(String(sentryTracesSampleRateRaw)) || 0));
const sentryReplaySessionSampleRate = Math.max(
  0,
  Math.min(1, Number.parseFloat(String(sentryReplaySessionSampleRateRaw)) || 0)
);
const sentryReplayOnErrorSampleRate = Math.max(
  0,
  Math.min(1, Number.parseFloat(String(sentryReplayOnErrorSampleRateRaw)) || 0)
);

const outPath = path.join(frontendRoot, 'src', 'assets', 'app-config.js');
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const config = {
  apiBaseUrl,
  appEnv,
  appVersion,
  stripeEnabled,
  paypalEnabled,
  netopiaEnabled,
  addressAutocompleteEnabled,
  sentryDsn,
  sentryTracesSampleRate,
  sentryReplaySessionSampleRate,
  sentryReplayOnErrorSampleRate,
  captchaSiteKey
};
const payload = `// Auto-generated by scripts/generate-config.mjs\nwindow.__APP_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`;

fs.writeFileSync(outPath, payload, 'utf8');
console.log(`Wrote ${path.relative(frontendRoot, outPath)} from ${envPath ? path.relative(frontendRoot, envPath) : 'defaults'}`);
