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
  peerPodsCm?: WatchResult;
  cloudProvider?: string;
}) => {
  window.__watchResults = {
    // peer-pods-cm configured unless a test says otherwise, so the install-copy cases are never
    // entangled with the ordering advice.
    'peer-pods-cm': opts.peerPodsCm ?? [
      { data: { CLOUD_PROVIDER: opts.cloudProvider ?? 'azure' } },
      true,
      undefined,
    ],
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

/** No peer-pods-cm: a named watch for a missing object 404s rather than loading. */
const PEER_PODS_CM_ABSENT: WatchResult = [undefined, false, { code: 404, message: 'not found' }];

/*
 * The checklist used to hide the Create KataConfig action until peer-pods-cm existed, forcing peer
 * pods on everyone. On-node sandboxed containers are a valid cloud setup and need no config map, so
 * the ordering constraint is advice now, not a gate (issue #69).
 */
describe('OscSetup — creating a KataConfig without peer pods', () => {
  beforeEach(() => {
    window.__watchResults = {};
  });

  it('offers Create KataConfig even when no peer pods config map exists', () => {
    mountSetup({ topology: 'External', peerPodsCm: PEER_PODS_CM_ABSENT });

    cy.contains('button', 'Create KataConfig').should('be.visible');
  });

  it('advises on ordering without demanding it, and points at the on-node alternative', () => {
    mountSetup({ topology: 'External', peerPodsCm: PEER_PODS_CM_ABSENT });

    cy.contains('Going to use peer pods? Configure the peer pods config map first').should('exist');
    cy.contains('For on-node sandboxed containers you do not need one').should('exist');
    // The step used to promise peer pods outright, contradicting the advice below it.
    cy.contains('with peer pods enabled').should('not.exist');
  });

  it('drops the advice once the config map is there', () => {
    mountSetup({ topology: 'External' });

    cy.contains('button', 'Create KataConfig').should('be.visible');
    cy.contains('Going to use peer pods?').should('not.exist');
  });
});

/*
 * A KataConfig with peer pods off registers only the on-node kata runtime and never gets a pod VM
 * image, so the steps built around peer pods have to say so (issue #69).
 */
describe('OscSetup — an on-node-only KataConfig', () => {
  const onNodeReady: WatchResult = [
    [
      {
        metadata: { name: 'example-kataconfig' },
        spec: { enablePeerPods: false },
        status: {
          conditions: [{ type: 'InProgress', status: 'False' }],
          kataNodes: { nodeCount: 2, readyNodeCount: 2 },
          runtimeClasses: ['kata'],
        },
      },
    ],
    true,
    undefined,
  ];

  beforeEach(() => {
    window.__watchResults = {};
  });

  it('names the runtime class the cluster actually registers', () => {
    mountSetup({ topology: 'External', kataConfig: onNodeReady });

    cy.contains('runtimeClassName: kata to run it in a microVM on the node').should('exist');
    cy.contains('kata-remote').should('not.exist');
  });

  it('does not promise a pod VM image that will never arrive', () => {
    mountSetup({ topology: 'External', kataConfig: onNodeReady });

    cy.contains('there is no pod VM image to build').should('exist');
  });
});

/* Only GCP has the in-cluster Apply flow, so only GCP should hear about it (issue #63). */
describe('OscSetup — "mark firewall as done" hint', () => {
  beforeEach(() => {
    window.__watchResults = {};
  });

  it('does not mention GCP on an AWS cluster', () => {
    mountSetup({ topology: 'External', cloudProvider: 'aws' });

    cy.contains('Tick this once you have opened the firewall ports').should('exist');
    cy.contains('GCP').should('not.exist');
  });

  it('still points GCP users at the in-cluster apply action', () => {
    mountSetup({ topology: 'HighlyAvailable', cloudProvider: 'gcp' });

    cy.contains('The "Apply in cluster" action above ticks it for you.').should('exist');
  });
});
