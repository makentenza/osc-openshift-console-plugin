import * as React from 'react';

/*
 * Lightweight stand-in for `@openshift-console/dynamic-plugin-sdk`, used only by
 * Cypress component tests (wired in via a webpack alias in `cypress/webpack-ct.cjs`).
 *
 * The real SDK is provided by the OpenShift Console host at runtime — it depends
 * on a redux store, loaded k8s models, and live websockets, none of which exist
 * when a component is mounted standalone. This mock exposes only the handful of
 * runtime exports the peer-pods / podvm-image wizards actually use, and lets each
 * test drive `useK8sWatchResource` deterministically via `window.__watchResults`.
 */

/** `[data, loaded, loadError]` — mirrors the SDK's `WatchK8sResult` tuple. */
export type WatchResult = [unknown, boolean, unknown];

interface WatchResource {
  name?: string;
  isList?: boolean;
  groupVersionKind?: { kind?: string };
}

declare global {
  interface Window {
    /**
     * Keyed by `Kind/name`, `Kind`, or `name` (most specific wins); `__list` / `__single` are
     * fallbacks. A name alone is enough for uniquely-named objects, but not always: Infrastructure
     * and CloudCredential are both named `cluster`, and unnamed list watches have no name at all —
     * so those need a Kind key to be told apart.
     */
    __watchResults?: Record<string, WatchResult>;
    __k8sCreateCalls?: unknown[];
    __k8sUpdateCalls?: unknown[];
    __consoleFetchText?: (url: string) => string;
    __k8sGetFound?: boolean;
    __k8sDeleteCalls?: unknown[];
    __k8sPatchCalls?: unknown[];
  }
}

/** Lookup keys for a watch, most specific first. */
const watchKeys = (resource: WatchResource): string[] => {
  const kind = resource.groupVersionKind?.kind;
  const keys: string[] = [];
  if (kind && resource.name) keys.push(`${kind}/${resource.name}`);
  if (kind) keys.push(kind);
  if (resource.name) keys.push(resource.name);
  return keys;
};

export const useK8sWatchResource = (resource: WatchResource | null): WatchResult => {
  const results = window.__watchResults ?? {};
  const hit = resource ? watchKeys(resource).find((k) => results[k]) : undefined;
  if (hit) return results[hit];
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

/** Renders the resource name; the real one links into the console's resource pages. */
export const ResourceLink: React.FC<{ name?: string }> = ({ name }) => <span>{name}</span>;

export const k8sCreate = (payload: unknown): Promise<unknown> => {
  (window.__k8sCreateCalls ??= []).push(payload);
  return Promise.resolve(payload);
};

export const k8sUpdate = (payload: unknown): Promise<unknown> => {
  (window.__k8sUpdateCalls ??= []).push(payload);
  return Promise.resolve(payload);
};

export const k8sDelete = (payload: unknown): Promise<unknown> => {
  (window.__k8sDeleteCalls ??= []).push(payload);
  return Promise.resolve(payload);
};

export const k8sPatch = (payload: unknown): Promise<unknown> => {
  (window.__k8sPatchCalls ??= []).push(payload);
  return Promise.resolve(payload);
};

/**
 * Components reach for k8sGet on user actions (the firewall apply flow, the KataConfig wizard's
 * feature-gate merge), never on mount. Reject as not-found so anything that does call it takes its
 * absent-resource path rather than hanging on a promise that never settles.
 */
/**
 * Rejects 404 by default, which is what most create-forms want (the resource is absent, so they
 * take their create path). Tests that need a resource to exist — e.g. the CCO-minted secret the
 * "Fetch from AWS" flow waits on — set `window.__k8sGetFound` to resolve instead.
 */
export const k8sGet = (): Promise<unknown> =>
  window.__k8sGetFound
    ? Promise.resolve({})
    : Promise.reject(Object.assign(new Error('not found'), { code: 404 }));

/**
 * The console's authenticated fetch, used by FetchAwsNetworking to read the describe Job's pod log.
 * Tests drive it through `window.__consoleFetchText`; unset means "no log yet".
 */
export const consoleFetchText = (url: string): Promise<string> =>
  window.__consoleFetchText
    ? Promise.resolve(window.__consoleFetchText(url))
    : Promise.reject(new Error('no log'));
