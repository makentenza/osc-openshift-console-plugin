import * as React from 'react';

/*
 * Test stand-in for `@openshift-console/dynamic-plugin-sdk`. The real SDK is
 * provided by the OpenShift Console host at runtime (redux store, loaded k8s
 * models, live websockets) — none of which exist under jest/jsdom.
 *
 * This mock exposes only the handful of runtime exports our components use, and
 * lets each test drive `useK8sWatchResource` deterministically via
 * `window.__watchResults`. Jest applies it automatically for any test importing
 * the SDK (manual mock adjacent to node_modules).
 */

/** `[data, loaded, loadError]` — mirrors the SDK's WatchK8sResult tuple. */
export type WatchResult = [unknown, boolean, unknown];

interface WatchResource {
  name?: string;
  isList?: boolean;
  groupVersionKind?: { kind?: string };
}

declare global {
  interface Window {
    /** Keyed by resource `name`; `__list` / `__single` are fallbacks for unnamed watches. */
    __watchResults?: Record<string, WatchResult>;
    __k8sCreateCalls?: unknown[];
    __k8sUpdateCalls?: unknown[];
  }
}

export const useK8sWatchResource = (resource: WatchResource | null): WatchResult => {
  const results = window.__watchResults ?? {};
  if (resource?.name && results[resource.name]) return results[resource.name];
  if (resource?.isList) return results.__list ?? [[], true, undefined];
  return results.__single ?? [undefined, true, undefined];
};

export const DocumentTitle: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <>{children}</>
);

export const ListPageHeader: React.FC<{ title?: string; children?: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div>
    <h1>{title}</h1>
    {children}
  </div>
);

export const k8sCreate = (payload: unknown): Promise<unknown> => {
  (window.__k8sCreateCalls ??= []).push(payload);
  return Promise.resolve(payload);
};

export const k8sUpdate = (payload: unknown): Promise<unknown> => {
  (window.__k8sUpdateCalls ??= []).push(payload);
  return Promise.resolve(payload);
};
