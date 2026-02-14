import { appConfig } from './app-config';

type FullStoryRuntime = {
  init: (config: { orgId: string }) => void;
  shutdown?: () => void;
  restart?: () => void;
  consent?: (value: boolean) => void;
};

let runtimePromise: Promise<FullStoryRuntime | null> | null = null;
let started = false;

function orgId(): string {
  return (appConfig.fullstoryOrgId || '').trim();
}

function loadRuntime(): Promise<FullStoryRuntime | null> {
  if (runtimePromise) return runtimePromise;
  if (typeof window === 'undefined' || !orgId()) {
    runtimePromise = Promise.resolve(null);
    return runtimePromise;
  }
  runtimePromise = import('@fullstory/browser')
    .then((mod) => mod as unknown as FullStoryRuntime)
    .catch(() => null);
  return runtimePromise;
}

export function enableFullStory(): void {
  const configuredOrg = orgId();
  if (!configuredOrg) return;

  void loadRuntime().then((runtime) => {
    if (!runtime) return;
    try {
      if (started) {
        runtime.restart?.();
        return;
      }
      runtime.consent?.(true);
      runtime.init({ orgId: configuredOrg });
      started = true;
    } catch {
      // no-op: telemetry must never block user flows
    }
  });
}

export function disableFullStory(): void {
  void loadRuntime().then((runtime) => {
    if (!runtime || !started) return;
    try {
      if (typeof runtime.shutdown === 'function') runtime.shutdown();
      else runtime.consent?.(false);
    } catch {
      // no-op: telemetry must never block user flows
    } finally {
      started = false;
    }
  });
}
