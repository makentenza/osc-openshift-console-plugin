import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * Creating a KataConfig only starts a node-by-node rollout, and the object exists with an empty
 * status before the operator touches it. The overview must not call that "Installed" — the state it
 * certainly isn't — because the wizard drops the user here the moment they hit Create (issue #64).
 */

/** What useK8sWatchResource returns: [data, loaded, loadError]. */
type WatchResult = [unknown, boolean, unknown];

interface Watch {
  groupVersionKind?: { kind?: string };
  name?: string;
  isList?: boolean;
}

const watches = new Map<string, WatchResult>();

const watchKey = (o: Watch): string => o.groupVersionKind?.kind ?? '';

jest.mock('@openshift-console/dynamic-plugin-sdk', () => ({
  DocumentTitle: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ListPageHeader: ({ title, children }: { title?: ReactNode; children?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
  ResourceLink: ({ name }: { name?: string }) => <span>{name}</span>,
  Timestamp: ({ timestamp }: { timestamp?: string }) => <span>{timestamp}</span>,
  useK8sWatchResource: (o: Watch): WatchResult =>
    watches.get(watchKey(o)) ?? [o.isList ? [] : undefined, true, null],
}));

// Render the English source string, interpolating {{vars}} — so assertions read the real copy.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) =>
      key.replace(/{{\s*(\w+)\s*}}/g, (_m, k: string) => String(opts?.[k] ?? `{{${k}}}`)),
  }),
}));

jest.mock('react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

import SandboxesOverview from './SandboxesOverview';

const kataConfig = (status?: Record<string, unknown>): WatchResult => [
  [
    {
      metadata: { name: 'example-kataconfig' },
      spec: { enablePeerPods: true },
      ...(status ? { status } : {}),
    },
  ],
  true,
  null,
];

const mount = (kc: WatchResult): void => {
  watches.clear();
  watches.set('KataConfig', kc);
  render(<SandboxesOverview />);
};

/** Copy rendered anywhere on the overview. Text-node matching, so ancestors don't double-count. */
const copy = (pattern: RegExp): HTMLElement[] => screen.queryAllByText(pattern);

describe('SandboxesOverview — installation state', () => {
  // The exact state the wizard lands the user in: created, status not yet populated.
  it('does not claim Installed for a freshly-created KataConfig', () => {
    mount(kataConfig());

    expect(copy(/^Installing$/)).not.toHaveLength(0);
    expect(copy(/^Installed$/)).toHaveLength(0);
    expect(copy(/The runtime is not usable until every node reports ready\./)).not.toHaveLength(0);
  });

  it('reports Installing while the rollout is in progress', () => {
    mount(
      kataConfig({
        conditions: [{ type: 'InProgress', status: 'True' }],
        kataNodes: { nodeCount: 3, readyNodeCount: 1 },
      }),
    );

    expect(copy(/^Installing$/)).not.toHaveLength(0);
    expect(copy(/^Installed$/)).toHaveLength(0);
  });

  it('surfaces the operator’s reason alongside Installing', () => {
    mount(
      kataConfig({
        conditions: [{ type: 'InProgress', status: 'True', reason: 'WaitingForNodes' }],
      }),
    );

    expect(copy(/Installing \(WaitingForNodes\)/)).not.toHaveLength(0);
  });

  // Only once the rollout settles AND the runtime classes are registered is it genuinely usable.
  it('reports Installed once the runtime is actually ready', () => {
    mount(
      kataConfig({
        conditions: [{ type: 'InProgress', status: 'False' }],
        kataNodes: { nodeCount: 3, readyNodeCount: 3 },
        runtimeClasses: ['kata-remote'],
      }),
    );

    expect(copy(/^Installed$/)).not.toHaveLength(0);
    expect(copy(/^Installing$/)).toHaveLength(0);
  });

  // A settled rollout with a failed node is not "Installed" either — it previously showed green.
  it('reports a failed install rather than Installed', () => {
    mount(
      kataConfig({
        conditions: [{ type: 'InProgress', status: 'False' }],
        kataNodes: { nodeCount: 3, readyNodeCount: 2, failedToInstall: ['worker-2'] },
      }),
    );

    expect(copy(/^Install failed$/)).not.toHaveLength(0);
    expect(copy(/^Installed$/)).toHaveLength(0);
    expect(copy(/worker-2/)).not.toHaveLength(0);
  });

  it('still reports "Installed, but not configured" when no KataConfig exists', () => {
    mount([[], true, null]);

    expect(copy(/Installed, but not configured/)).not.toHaveLength(0);
  });
});
