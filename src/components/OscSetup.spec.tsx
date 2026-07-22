import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * The setup checklist must describe the install the way the operator will actually perform it: a
 * DaemonSet install (hosted/HCP clusters) drains and reboots nothing, so the reboot copy is simply
 * false there and contradicts the KataConfig wizard (issue #58).
 */

/** What useK8sWatchResource returns: [data, loaded, loadError]. */
type WatchResult = [unknown, boolean, unknown];

interface Watch {
  groupVersionKind?: { kind?: string };
  name?: string;
  isList?: boolean;
}

const watches = new Map<string, WatchResult>();

// ConfigMaps are told apart by name; every other resource this page watches is unique by kind.
const watchKey = (o: Watch): string => {
  const kind = o.groupVersionKind?.kind ?? '';
  return kind === 'ConfigMap' ? `ConfigMap/${o.name ?? ''}` : kind;
};

jest.mock('@openshift-console/dynamic-plugin-sdk', () => ({
  DocumentTitle: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ListPageHeader: ({ title }: { title?: ReactNode }) => <h1>{title}</h1>,
  ResourceLink: ({ name }: { name?: string }) => <span>{name}</span>,
  useK8sWatchResource: (o: Watch): WatchResult =>
    watches.get(watchKey(o)) ?? [o.isList ? [] : undefined, true, null],
  k8sCreate: jest.fn(),
  k8sDelete: jest.fn(),
  k8sGet: jest.fn(),
  k8sPatch: jest.fn(),
  k8sUpdate: jest.fn(),
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

import OscSetup from './OscSetup';

const infrastructure = (controlPlaneTopology?: string): WatchResult => [
  { status: { platform: 'Azure', controlPlaneTopology } },
  true,
  null,
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
  null,
];

// No osc-feature-gates ConfigMap — the state of any cluster that never set a deployment mode, and
// so the default this page must get right. A named watch for a missing object never flips `loaded`;
// it 404s, and settledCm() reads that as "settled, absent". Modelling it as a clean load would
// exercise a state the SDK never produces.
const FEATURE_GATES_ABSENT: WatchResult = [undefined, false, { code: 404, message: 'not found' }];
/** Still in flight: neither loaded nor errored. */
const FEATURE_GATES_LOADING: WatchResult = [undefined, false, null];

/** No peer-pods-cm: a named watch for a missing object 404s rather than loading. */
const PEER_PODS_CM_ABSENT: WatchResult = [undefined, false, { code: 404, message: 'not found' }];

const setup = (opts: {
  topology?: string;
  infraLoaded?: boolean;
  featureGates?: Record<string, string>;
  featureGatesLoading?: boolean;
  kataConfig?: WatchResult;
  peerPodsCm?: WatchResult;
}): void => {
  watches.clear();
  // peer-pods-cm configured unless a test says otherwise, so the install-copy cases below are never
  // entangled with the ordering advice.
  watches.set(
    'ConfigMap/peer-pods-cm',
    opts.peerPodsCm ?? [{ data: { CLOUD_PROVIDER: 'azure' } }, true, null],
  );
  watches.set(
    'Infrastructure',
    opts.infraLoaded === false ? [undefined, false, null] : infrastructure(opts.topology),
  );
  watches.set(
    'ConfigMap/osc-feature-gates',
    opts.featureGates
      ? [{ data: opts.featureGates }, true, null]
      : opts.featureGatesLoading
        ? FEATURE_GATES_LOADING
        : FEATURE_GATES_ABSENT,
  );
  watches.set('KataConfig', opts.kataConfig ?? [[], true, null]);
  render(<OscSetup />);
};

/** Copy rendered anywhere on the checklist. Text-node matching, so ancestors don't double-count. */
const copy = (pattern: RegExp): HTMLElement[] => screen.queryAllByText(pattern);

describe('OscSetup — KataConfig step install copy', () => {
  describe('on a hosted (HCP) cluster, where the install uses a DaemonSet', () => {
    it('does not claim nodes reboot before the KataConfig exists', () => {
      setup({ topology: 'External' });
      expect(copy(/reboots to install/)).toHaveLength(0);
      expect(
        copy(/A DaemonSet installs it live, without draining or rebooting nodes/),
      ).not.toHaveLength(0);
    });

    it('does not claim nodes drain and reboot while installing', () => {
      setup({ topology: 'External', kataConfig: installingKataConfig(3) });
      expect(copy(/drains and reboots/)).toHaveLength(0);
      expect(
        copy(
          /Each worker installs the runtime live via a DaemonSet — no drain or reboot\. Usually a few minutes for 3 worker\(s\)\./,
        ),
      ).not.toHaveLength(0);
      expect(copy(/The step turns green once the runtime is ready\./)).not.toHaveLength(0);
    });

    it('falls back to a countless estimate when the node count is unknown', () => {
      setup({ topology: 'External', kataConfig: [[{ metadata: {}, spec: {} }], true, null] });
      expect(copy(/drains and reboots/)).toHaveLength(0);
      expect(
        copy(
          /Each worker installs the runtime live via a DaemonSet — no drain or reboot\. Usually a few minutes\./,
        ),
      ).not.toHaveLength(0);
    });
  });

  describe('on a standalone cluster, where the install uses MachineConfig', () => {
    it('keeps the reboot warning before the KataConfig exists', () => {
      setup({ topology: 'HighlyAvailable' });
      expect(copy(/Each node reboots to install it/)).not.toHaveLength(0);
    });

    it('keeps the drain-and-reboot estimate while installing', () => {
      setup({ topology: 'HighlyAvailable', kataConfig: installingKataConfig(3) });
      expect(
        copy(
          /Each node drains and reboots to install the runtime — expect roughly 5–20 min for 3 worker\(s\)\./,
        ),
      ).not.toHaveLength(0);
    });

    it('falls back to a per-worker estimate when the node count is unknown', () => {
      setup({
        topology: 'HighlyAvailable',
        kataConfig: [[{ metadata: {}, spec: {} }], true, null],
      });
      expect(copy(/expect roughly 5–20 min per worker\./)).not.toHaveLength(0);
    });
  });

  // The feature gate is what the operator actually reads; topology only breaks the tie.
  it('honours an explicit MachineConfig gate over the topology', () => {
    setup({
      topology: 'External',
      featureGates: { deploymentMode: 'MachineConfig' },
      kataConfig: installingKataConfig(2),
    });
    expect(copy(/drains and reboots/)).not.toHaveLength(0);
  });

  it('honours an explicit DaemonSet gate on a standalone cluster', () => {
    setup({
      topology: 'HighlyAvailable',
      featureGates: { deploymentMode: 'DaemonSet' },
      kataConfig: installingKataConfig(2),
    });
    expect(copy(/drains and reboots/)).toHaveLength(0);
  });

  describe('before the mode is known', () => {
    it('makes no reboot claim either way while the topology is loading', () => {
      setup({ infraLoaded: false, kataConfig: installingKataConfig(2) });
      expect(copy(/reboot/)).toHaveLength(0);
      expect(copy(/The runtime is installing on each worker\./)).not.toHaveLength(0);
    });

    // Answering from topology alone would flash reboot copy at a user who chose DaemonSet.
    it('makes no reboot claim while the feature gates are still loading', () => {
      setup({
        topology: 'HighlyAvailable',
        featureGatesLoading: true,
        kataConfig: installingKataConfig(2),
      });
      expect(copy(/reboot/)).toHaveLength(0);
    });
  });
});

/**
 * The checklist used to hide the Create KataConfig action until peer-pods-cm existed, which forced
 * peer pods on everyone. On-node sandboxed containers are a valid cloud setup and need no config map
 * at all, so the ordering constraint is advice now, not a gate (issue #69).
 */
describe('OscSetup — creating a KataConfig without peer pods', () => {
  it('offers Create KataConfig even when no peer pods config map exists', () => {
    setup({ topology: 'External', peerPodsCm: PEER_PODS_CM_ABSENT });

    expect(screen.getByRole('button', { name: 'Create KataConfig' })).toBeInTheDocument();
  });

  // The ordering advice is still worth giving — it just must not read as a prerequisite.
  it('advises on ordering without demanding it, and points at the on-node alternative', () => {
    setup({ topology: 'External', peerPodsCm: PEER_PODS_CM_ABSENT });

    expect(
      copy(/Going to use peer pods\? Configure the peer pods config map first/),
    ).not.toHaveLength(0);
    expect(copy(/For on-node sandboxed containers you do not need one/)).not.toHaveLength(0);
  });

  // The step used to promise peer pods outright, contradicting the advice directly below it. All
  // three install-mode branches word this sentence separately, so all three have to be checked.
  it.each([
    ['a rebooting install', { topology: 'HighlyAvailable' }],
    ['a DaemonSet install', { topology: 'External' }],
    ['an install whose mode is not known yet', { featureGatesLoading: true }],
  ])('does not assert peer pods will be enabled — %s', (_case, modeOpts) => {
    setup({ ...modeOpts, peerPodsCm: PEER_PODS_CM_ABSENT });

    expect(copy(/Install the kata runtime on your workers/)).not.toHaveLength(0);
    expect(copy(/with peer pods enabled/)).toHaveLength(0);
  });

  it('drops the advice once the config map is there', () => {
    setup({ topology: 'External' });

    expect(screen.getByRole('button', { name: 'Create KataConfig' })).toBeInTheDocument();
    expect(copy(/Going to use peer pods\?/)).toHaveLength(0);
  });

  // Answering before the watch settles flashed the advice at someone who does have a config map.
  it('says nothing while the peer-pods-cm watch is still in flight', () => {
    setup({ topology: 'External', peerPodsCm: [undefined, false, null] });

    expect(copy(/Going to use peer pods\?/)).toHaveLength(0);
  });
});

/**
 * A KataConfig with peer pods off registers only the on-node kata runtime and never gets a pod VM
 * image. The steps built around peer pods have to say so, or the path #69 opened up leads straight
 * into instructions that cannot work.
 */
describe('OscSetup — an on-node-only KataConfig', () => {
  /** Installed and ready, with peer pods explicitly off. */
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
    null,
  ];

  it('names the runtime class the cluster actually registers', () => {
    setup({ topology: 'External', kataConfig: onNodeReady });

    expect(copy(/runtimeClassName: kata to run it in a microVM on the node/)).not.toHaveLength(0);
    expect(copy(/kata-remote/)).toHaveLength(0);
  });

  it('does not promise a pod VM image that will never arrive', () => {
    setup({ topology: 'External', kataConfig: onNodeReady });

    expect(copy(/there is no pod VM image to build/)).not.toHaveLength(0);
    expect(copy(/the operator is registering the pod VM image/)).toHaveLength(0);
  });

  // With peer pods on, the peer-pods wording is right and must stay.
  it('still speaks of pod VMs when peer pods are on', () => {
    setup({
      topology: 'External',
      kataConfig: [
        [
          {
            metadata: { name: 'example-kataconfig' },
            spec: { enablePeerPods: true },
            status: {
              conditions: [{ type: 'InProgress', status: 'False' }],
              kataNodes: { nodeCount: 2, readyNodeCount: 2 },
              runtimeClasses: ['kata-remote'],
            },
          },
        ],
        true,
        null,
      ],
    });

    expect(copy(/runtimeClassName: kata-remote to run it in a pod VM/)).not.toHaveLength(0);
  });
});
