import { MemoryRouter } from 'react-router-dom-v5-compat';
import OscSetup from '../../src/components/OscSetup';
import type { WatchResult } from '../mocks/dynamic-plugin-sdk';

/*
 * The setup checklist must describe the install the way the operator will actually perform it: a
 * DaemonSet install (hosted/HCP clusters) drains and reboots nothing, so the reboot copy is simply
 * false there and contradicts the KataConfig wizard (issue #58).
 */

const infrastructure = (controlPlaneTopology?: string): WatchResult => [
  { status: { platform: 'Azure', controlPlaneTopology } },
  true,
  undefined,
];

/** A KataConfig mid-rollout across `nodeCount` workers. */
const installingKataConfig = (nodeCount: number): WatchResult => [
  [
    {
      metadata: { name: 'example-kataconfig' },
      spec: { enablePeerPods: true },
      status: {
        conditions: [{ type: 'InProgress', status: 'True' }],
        kataNodes: { nodeCount, readyNodeCount: 0 },
      },
    },
  ],
  true,
  undefined,
];

/** A KataConfig that exists but whose status has not populated — installing, node count unknown. */
const nascentKataConfig: WatchResult = [[{ metadata: {}, spec: {} }], true, undefined];

// No osc-feature-gates ConfigMap — the state of any cluster that never set a deployment mode, and
// so the default this page must get right. A named watch for a missing object never flips `loaded`;
// it 404s, and settledCm() reads that as "settled, absent".
const FEATURE_GATES_ABSENT: WatchResult = [undefined, false, { code: 404, message: 'not found' }];
/** Still in flight: neither loaded nor errored. */
const FEATURE_GATES_LOADING: WatchResult = [undefined, false, undefined];

const mountSetup = (opts: {
  topology?: string;
  infraLoaded?: boolean;
  featureGates?: Record<string, string>;
  featureGatesLoading?: boolean;
  kataConfig?: WatchResult;
}) => {
  window.__watchResults = {
    // peer-pods-cm configured throughout, so the checklist is never blocked on ordering.
    'peer-pods-cm': [{ data: { CLOUD_PROVIDER: 'azure' } }, true, undefined],
    // Keyed by Kind: CloudCredential is also named `cluster`.
    Infrastructure:
      opts.infraLoaded === false ? [undefined, false, undefined] : infrastructure(opts.topology),
    'osc-feature-gates': opts.featureGates
      ? [{ data: opts.featureGates }, true, undefined]
      : opts.featureGatesLoading
        ? FEATURE_GATES_LOADING
        : FEATURE_GATES_ABSENT,
    KataConfig: opts.kataConfig ?? [[], true, undefined],
  };
  cy.mount(
    <MemoryRouter initialEntries={['/sandboxes/setup']}>
      <OscSetup />
    </MemoryRouter>,
  );
};

describe('OscSetup — KataConfig step install copy', () => {
  beforeEach(() => {
    window.__watchResults = {};
  });

  describe('on a hosted (HCP) cluster, where the install uses a DaemonSet', () => {
    it('does not claim nodes reboot before the KataConfig exists', () => {
      mountSetup({ topology: 'External' });

      cy.contains('A DaemonSet installs it live, without draining or rebooting nodes').should(
        'be.visible',
      );
      cy.contains('reboots to install').should('not.exist');
    });

    it('does not claim nodes drain and reboot while installing', () => {
      mountSetup({ topology: 'External', kataConfig: installingKataConfig(3) });

      cy.contains(
        'Each worker installs the runtime live via a DaemonSet — no drain or reboot. Usually a few minutes for 3 worker(s).',
      ).should('be.visible');
      cy.contains('The step turns green once the runtime is ready.').should('be.visible');
      cy.contains('drains and reboots').should('not.exist');
    });

    it('falls back to a countless estimate when the node count is unknown', () => {
      mountSetup({ topology: 'External', kataConfig: nascentKataConfig });

      cy.contains(
        'Each worker installs the runtime live via a DaemonSet — no drain or reboot. Usually a few minutes.',
      ).should('be.visible');
      cy.contains('drains and reboots').should('not.exist');
    });
  });

  describe('on a standalone cluster, where the install uses MachineConfig', () => {
    it('keeps the reboot warning before the KataConfig exists', () => {
      mountSetup({ topology: 'HighlyAvailable' });

      cy.contains('Each node reboots to install it').should('be.visible');
    });

    it('keeps the drain-and-reboot estimate while installing', () => {
      mountSetup({ topology: 'HighlyAvailable', kataConfig: installingKataConfig(3) });

      cy.contains(
        'Each node drains and reboots to install the runtime — expect roughly 5–20 min for 3 worker(s).',
      ).should('be.visible');
    });

    it('falls back to a per-worker estimate when the node count is unknown', () => {
      mountSetup({ topology: 'HighlyAvailable', kataConfig: nascentKataConfig });

      cy.contains('expect roughly 5–20 min per worker.').should('be.visible');
    });
  });

  // The feature gate is what the operator actually reads; topology only breaks the tie.
  it('honours an explicit MachineConfig gate over the topology', () => {
    mountSetup({
      topology: 'External',
      featureGates: { deploymentMode: 'MachineConfig' },
      kataConfig: installingKataConfig(2),
    });

    cy.contains('drains and reboots').should('be.visible');
  });

  it('honours an explicit DaemonSet gate on a standalone cluster', () => {
    mountSetup({
      topology: 'HighlyAvailable',
      featureGates: { deploymentMode: 'DaemonSet' },
      kataConfig: installingKataConfig(2),
    });

    cy.contains('no drain or reboot').should('be.visible');
    cy.contains('drains and reboots').should('not.exist');
  });

  describe('before the mode is known', () => {
    it('makes no reboot claim either way while the topology is loading', () => {
      mountSetup({ infraLoaded: false, kataConfig: installingKataConfig(2) });

      cy.contains('The runtime is installing on each worker.').should('be.visible');
      cy.contains('reboot').should('not.exist');
    });

    // Answering from topology alone would flash reboot copy at a user who chose DaemonSet.
    it('makes no reboot claim while the feature gates are still loading', () => {
      mountSetup({
        topology: 'HighlyAvailable',
        featureGatesLoading: true,
        kataConfig: installingKataConfig(2),
      });

      cy.contains('reboot').should('not.exist');
    });
  });
});
