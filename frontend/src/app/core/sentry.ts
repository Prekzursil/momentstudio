import * as Sentry from '@sentry/browser';
import { appConfig } from './app-config';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!appConfig.sentryDsn) return;

  Sentry.init({
    dsn: appConfig.sentryDsn,
    environment: appConfig.appEnv,
    release: appConfig.appEnv
  });

  initialized = true;
}

export function captureException(error: unknown): void {
  if (!appConfig.sentryDsn) return;
  initSentry();
  Sentry.captureException(error);
}
