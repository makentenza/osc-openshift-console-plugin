import { MemoryRouter } from 'react-router-dom-v5-compat';
import SandboxesOverview from '../../src/components/SandboxesOverview';
import type { WatchResult } from '../mocks/dynamic-plugin-sdk';

/*
 * Creating a KataConfig only starts a node-by-node rollout, and the object exists with an empty
 * status before the operator touches it. The overview must not call that "Installed" — the state it
 * certainly isn't — because the wizard drops the user here the moment they hit Create (issue #64).
 */

const kataConfig = (status?: Record<string, unknown>): WatchResult => [
  [
    {
      metadata: { name: 'example-kataconfig' },
      spec: { enablePeerPods: true },
      ...(status ? { status } : {}),
    },
  ],
  true,
  undefined,
];

const mountOverview = (kc: WatchResult) => {
  window.__watchResults = { KataConfig: kc };
  cy.mount(
    <MemoryRouter initialEntries={['/sandboxes']}>
      <SandboxesOverview />
    </MemoryRouter>,
  );
};

describe('SandboxesOverview — installation state', () => {
  beforeEach(() => {
    window.__watchResults = {};
  });

  // The exact state the wizard lands the user in: created, status not yet populated.
  it('does not claim Installed for a freshly-created KataConfig', () => {
    mountOverview(kataConfig());

    cy.contains('Installing').should('exist');
    cy.contains('The runtime is not usable until every node reports ready.').should('exist');
    cy.contains('.pf-v6-c-label__text', 'Installed').should('not.exist');
  });

  it('surfaces the operator’s reason alongside Installing', () => {
    mountOverview(
      kataConfig({
        conditions: [{ type: 'InProgress', status: 'True', reason: 'WaitingForNodes' }],
      }),
    );

    cy.contains('Installing (WaitingForNodes)').should('exist');
  });

  // A settled condition keeps its last reason; showing it next to "Installing" contradicts itself.
  it('never renders "Installing (Installed)"', () => {
    mountOverview(
      kataConfig({
        conditions: [{ type: 'InProgress', status: 'False', reason: 'Installed' }],
        kataNodes: { nodeCount: 3, readyNodeCount: 1 },
        runtimeClasses: [],
      }),
    );

    cy.contains('Installing (').should('not.exist');
  });

  // Only once the rollout settles AND the runtime classes register is it genuinely usable.
  it('reports Installed once the runtime is actually ready', () => {
    mountOverview(
      kataConfig({
        conditions: [{ type: 'InProgress', status: 'False' }],
        kataNodes: { nodeCount: 3, readyNodeCount: 3 },
        runtimeClasses: ['kata-remote'],
      }),
    );

    cy.contains('.pf-v6-c-label__text', 'Installed').should('exist');
    cy.contains('Installing').should('not.exist');
  });

  // A settled rollout with a failed node is not "Installed" either — it used to show green.
  it('reports a failed install rather than Installed', () => {
    mountOverview(
      kataConfig({
        conditions: [{ type: 'InProgress', status: 'False' }],
        kataNodes: { nodeCount: 3, readyNodeCount: 2, failedToInstall: ['worker-2'] },
      }),
    );

    cy.contains('Install failed').should('exist');
    cy.contains('worker-2').should('exist');
  });

  // A blocked uninstall settles InProgress to False, so the phase alone reads as an install.
  it('reports a blocked uninstall rather than an install in progress', () => {
    mountOverview(
      kataConfig({
        conditions: [{ type: 'InProgress', status: 'False', reason: 'BlockedByExistingKataPods' }],
        kataNodes: { nodeCount: 2, readyNodeCount: 0 },
      }),
    );

    cy.contains('Uninstall blocked').should('exist');
    cy.contains('Existing pods still use the kata-remote runtime class').should('exist');
  });
});
