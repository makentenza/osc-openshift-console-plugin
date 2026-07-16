import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The AWS firewall command needs a security group id the cluster does not always hold: IPI
 * MachineSets name the group by tag rather than id, and a hosted (HCP) cluster has no MachineSets at
 * all. The step used to render an unresolvable <sg-xxxxxxxx> and point the user at a peer-pods
 * config map they had not created yet (issue #63).
 */

/** What useK8sWatchResource returns: [data, loaded, loadError]. */
type WatchResult = [unknown, boolean, unknown];

interface Watch {
  groupVersionKind?: { kind?: string };
  name?: string;
  isList?: boolean;
}

const watches = new Map<string, WatchResult>();

// `Kind/name` first: this page watches two different Jobs (the firewall apply and the AWS describe),
// so kind alone would collide.
const watchKeys = (o: Watch): string[] => {
  const kind = o.groupVersionKind?.kind;
  const keys: string[] = [];
  if (kind && o.name) keys.push(`${kind}/${o.name}`);
  if (kind) keys.push(kind);
  if (o.name) keys.push(o.name);
  return keys;
};

const consoleFetchText = jest.fn<Promise<string>, [string]>();
const k8sGet = jest.fn();

jest.mock('@openshift-console/dynamic-plugin-sdk', () => ({
  ResourceLink: ({ name }: { name?: string }) => <span>{name}</span>,
  useK8sWatchResource: (o: Watch): WatchResult => {
    for (const key of watchKeys(o)) {
      const result = watches.get(key);
      if (result) return result;
    }
    return [o.isList ? [] : undefined, true, null];
  },
  consoleFetchText: (url: string) => consoleFetchText(url),
  k8sCreate: jest.fn(() => Promise.resolve({})),
  k8sDelete: jest.fn(() => Promise.resolve({})),
  k8sGet: (args: unknown) => k8sGet(args),
}));

// Render the English source string, interpolating {{vars}} — so assertions read the real copy.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) =>
      key.replace(/{{\s*(\w+)\s*}}/g, (_m, k: string) => String(opts?.[k] ?? `{{${k}}}`)),
  }),
}));

import OpenPeerPodsFirewall from './OpenPeerPodsFirewall';

const infrastructure = (platform: string, region?: string): WatchResult => [
  {
    status: {
      platform,
      controlPlaneTopology: 'External',
      platformStatus: { aws: region ? { region } : undefined },
    },
  },
  true,
  null,
];

/** A worker Node carrying the AWS providerID the describe Job reads. */
const workerNode = {
  metadata: { name: 'worker-1', labels: { 'node-role.kubernetes.io/worker': '' } },
  spec: { providerID: 'aws:///eu-west-2a/i-0123456789abcdef0' },
  status: { addresses: [{ type: 'InternalIP', address: '10.0.1.5' }] },
};

const setup = (opts: { platform?: string; peerPodsCm?: Record<string, string> }): void => {
  watches.clear();
  watches.set('Infrastructure', infrastructure(opts.platform ?? 'AWS', 'eu-west-2'));
  watches.set('Node', [[workerNode], true, null]);
  // An AWS HCP guest cluster has no MachineSets at all — its machine-api lives on the management
  // cluster — so there is nothing in-cluster to read the security group from.
  watches.set('MachineSet', [[], true, null]);
  watches.set('peer-pods-cm', [
    opts.peerPodsCm ? { data: opts.peerPodsCm } : undefined,
    false,
    { code: 404, message: 'not found' },
  ]);
};

const copy = (pattern: RegExp): HTMLElement[] => screen.queryAllByText(pattern);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('OpenPeerPodsFirewall — AWS security group', () => {
  it('offers to fetch the security group when the cluster does not hold it', () => {
    setup({ platform: 'AWS' });
    render(<OpenPeerPodsFirewall />);

    // The command still renders, with the id clearly marked as missing.
    expect(copy(/<sg-xxxxxxxx>/)).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: /Fetch from AWS/ })).toBeInTheDocument();
    expect(copy(/Find the security group ID with the AWS CLI/)).not.toHaveLength(0);
  });

  // The reporter had no peer-pods config map — it is created in a later step — so this told them to
  // look somewhere that did not exist.
  it('does not send the user to a peer pods config map for the security group', () => {
    setup({ platform: 'AWS' });
    render(<OpenPeerPodsFirewall />);

    expect(copy(/peer pods config map/)).toHaveLength(0);
    expect(
      copy(/Use Fetch from AWS above to read the security group off a worker instance/),
    ).not.toHaveLength(0);
  });

  it('uses the configured security group and offers no fetch when peer-pods-cm has one', () => {
    setup({ platform: 'AWS', peerPodsCm: { CLOUD_PROVIDER: 'aws', AWS_SG_IDS: 'sg-0abc123' } });
    watches.set('peer-pods-cm', [
      { data: { CLOUD_PROVIDER: 'aws', AWS_SG_IDS: 'sg-0abc123' } },
      true,
      null,
    ]);
    render(<OpenPeerPodsFirewall />);

    expect(copy(/--group-id sg-0abc123/)).not.toHaveLength(0);
    expect(copy(/<sg-xxxxxxxx>/)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Fetch from AWS/ })).not.toBeInTheDocument();
  });

  // The whole point of the fix: what Fetch resolves has to land in the command.
  it('fills the fetched security group into the command', async () => {
    const user = userEvent.setup();
    setup({ platform: 'AWS' });
    // The describe Job is already complete, so the fetch resolves as soon as it is started.
    watches.set('Job/osc-peerpods-aws-describe', [
      { status: { succeeded: 1, conditions: [{ type: 'Complete', status: 'True' }] } },
      true,
      null,
    ]);
    watches.set('Pod', [
      [
        {
          metadata: {
            name: 'osc-peerpods-aws-describe-xyz',
            labels: { 'job-name': 'osc-peerpods-aws-describe' },
          },
        },
      ],
      true,
      null,
    ]);
    k8sGet.mockResolvedValue({}); // CCO minted the credential
    consoleFetchText.mockResolvedValue(
      ['AWS_SUBNET_ID=subnet-0abc', 'AWS_VPC_ID=vpc-0def', 'AWS_SG_IDS=sg-0fetched,sg-0other'].join(
        '\n',
      ),
    );

    render(<OpenPeerPodsFirewall />);
    expect(copy(/<sg-xxxxxxxx>/)).not.toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Fetch from AWS/ }));

    // The rule targets the pod VM security group, so the first id is the one used.
    await waitFor(() => {
      expect(copy(/--group-id sg-0fetched/)).not.toHaveLength(0);
    });
    expect(copy(/<sg-xxxxxxxx>/)).toHaveLength(0);
    // Resolved — the placeholder warning and the fetch affordance are both gone.
    expect(copy(/Replace the placeholder value\(s\)/)).toHaveLength(0);
  });
});

describe('OpenPeerPodsFirewall — Azure', () => {
  it('does not offer the AWS fetch on Azure', () => {
    setup({ platform: 'Azure' });
    watches.set('peer-pods-cm', [{ data: { CLOUD_PROVIDER: 'azure' } }, true, null]);
    render(<OpenPeerPodsFirewall />);

    expect(screen.queryByRole('button', { name: /Fetch from AWS/ })).not.toBeInTheDocument();
    expect(copy(/Find them in your peer pods config map or cloud console\./)).not.toHaveLength(0);
