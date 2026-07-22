import OpenPeerPodsFirewall from '../../src/components/OpenPeerPodsFirewall';
import type { WatchResult } from '../mocks/dynamic-plugin-sdk';

/*
 * Two fixes meet in this component:
 *  - Azure renders no command at all now; its default AllowVnetInBound rule already permits
 *    worker to pod-VM traffic inside the cluster VNet (issue #67).
 *  - AWS on a hosted (HCP) cluster has no in-cluster source for the security group — no
 *    peer-pods-cm yet and no MachineSets — so the step offers to read it off a worker
 *    instance instead of printing an unresolvable placeholder (issue #63).
 */

/** A worker Node carrying the AWS providerID the describe Job reads. */
const workerNode = {
  metadata: { name: 'worker-1', labels: { 'node-role.kubernetes.io/worker': '' } },
  spec: { providerID: 'aws:///eu-west-2a/i-0123456789abcdef0' },
  status: { addresses: [{ type: 'InternalIP', address: '10.0.1.5' }] },
};

/** peer-pods-cm is created in a LATER setup step, so this step routinely runs without one. */
const ABSENT: WatchResult = [undefined, false, { code: 404, message: 'not found' }];

const mountOn = (opts: {
  platform?: string;
  peerPodsCm?: Record<string, string>;
  ccoMode?: string;
  /** Override the Infrastructure watch outright — for the loading and errored cases. */
  infrastructure?: WatchResult;
  /** Worker MachineSets, which is where the GCP network name comes from. */
  machineSets?: unknown[];
}) => {
  window.__watchResults = {
    Infrastructure: opts.infrastructure ?? [
      {
        status: {
          platform: opts.platform ?? 'AWS',
          platformStatus: { aws: { region: 'eu-west-2' } },
        },
      },
      true,
      undefined,
    ],
    Node: [[workerNode], true, undefined],
    // An AWS HCP guest cluster has no MachineSets — machine-api lives on the management cluster.
    MachineSet: [opts.machineSets ?? [], true, undefined],
    'peer-pods-cm': opts.peerPodsCm ? [{ data: opts.peerPodsCm }, true, undefined] : ABSENT,
    ...(opts.ccoMode
      ? { CloudCredential: [{ spec: { credentialsMode: opts.ccoMode } }, true, undefined] }
      : {}),
  };
  cy.mount(<OpenPeerPodsFirewall />);
};

describe('OpenPeerPodsFirewall — Azure', () => {
  beforeEach(() => {
    window.__watchResults = {};
  });

  it('renders no NSG command and offers no AWS fetch', () => {
    mountOn({ platform: 'Azure', peerPodsCm: { CLOUD_PROVIDER: 'azure' } });

    cy.contains('az network nsg rule create').should('not.exist');
    cy.contains('button', 'Fetch from AWS').should('not.exist');
  });

  // The ports carry different protocols, so a TCP-only rule would silently kill the VXLAN tunnel.
  it('says no action is needed, and names both ports with their protocols', () => {
    mountOn({ platform: 'Azure', peerPodsCm: { CLOUD_PROVIDER: 'azure' } });

    cy.contains('No action needed on Azure').should('exist');
    cy.contains('TCP 15150 (kata agent)').should('exist');
    cy.contains('UDP 9000 (VXLAN tunnel)').should('exist');
  });
});

describe('OpenPeerPodsFirewall — AWS security group', () => {
  beforeEach(() => {
    window.__watchResults = {};
  });

  it('offers to fetch the security group when the cluster does not hold it', () => {
    mountOn({ platform: 'AWS' });

    cy.contains('<sg-xxxxxxxx>').should('exist');
    cy.contains('button', 'Fetch from AWS').should('exist');
    cy.contains('Find the security group ID with the AWS CLI').should('exist');
  });

  // The reporter had no peer-pods config map — it is created later — so this sent them nowhere.
  it('does not send the user to a peer pods config map for the security group', () => {
    mountOn({ platform: 'AWS' });

    cy.contains('Use Fetch from AWS above to read the security group off a worker instance').should(
      'exist',
    );
    cy.contains('Find them in your peer pods config map').should('not.exist');
  });

  it('uses the configured security group and offers no fetch when peer-pods-cm has one', () => {
    mountOn({ platform: 'AWS', peerPodsCm: { CLOUD_PROVIDER: 'aws', AWS_SG_IDS: 'sg-0abc123' } });

    cy.contains('--group-id sg-0abc123').should('exist');
    cy.contains('<sg-xxxxxxxx>').should('not.exist');
    cy.contains('button', 'Fetch from AWS').should('not.exist');
  });

  it('still resolves the region into the command', () => {
    mountOn({
      platform: 'AWS',
      peerPodsCm: { CLOUD_PROVIDER: 'aws', AWS_REGION: 'eu-west-2', AWS_SG_IDS: 'sg-0abc' },
    });

    cy.contains('aws ec2 authorize-security-group-ingress').should('exist');
    cy.contains('--region eu-west-2').should('exist');
    cy.contains('<region>').should('not.exist');
  });
});

/*
 * STS (CCO in Manual mode) is the normal configuration on AWS HCP and ROSA — the reporter's own
 * cluster class. FetchAwsNetworking disables its button there, so the copy must not say to press it.
 */
describe('OpenPeerPodsFirewall — AWS with manually-managed credentials (STS)', () => {
  beforeEach(() => {
    window.__watchResults = {};
  });

  it('points at the CLI rather than the button it has disabled', () => {
    mountOn({ platform: 'AWS', ccoMode: 'Manual' });

    cy.contains('button', 'Fetch from AWS').should('be.disabled');
    cy.contains('Use Fetch from AWS above').should('not.exist');
    cy.contains('use the AWS CLI above to find it').should('exist');
  });

  // The CLI its copy sends the user to has to actually be on the page.
  it('still offers the AWS CLI fallback', () => {
    mountOn({ platform: 'AWS', ccoMode: 'Manual' });

    cy.contains('Find the security group ID with the AWS CLI').should('exist');
  });
});

/*
 * The point of the fix: what "Fetch from AWS" resolves off the worker instance has to land in the
 * command. Nothing else pins the fetchedSgIds wiring (issue #63).
 */
describe('OpenPeerPodsFirewall — the fetched security group reaches the command', () => {
  beforeEach(() => {
    window.__watchResults = {};
    window.__k8sGetFound = undefined;
    window.__consoleFetchText = undefined;
  });

  it('fills the fetched security group into the command', () => {
    // The describe Job is already complete, so the fetch resolves as soon as it is started.
    window.__k8sGetFound = true; // CCO minted the credential
    window.__consoleFetchText = () =>
      ['AWS_SUBNET_ID=subnet-0abc', 'AWS_VPC_ID=vpc-0def', 'AWS_SG_IDS=sg-0fetched,sg-0other'].join(
        '\n',
      );
    window.__watchResults = {
      Infrastructure: [
        { status: { platform: 'AWS', platformStatus: { aws: { region: 'eu-west-2' } } } },
        true,
        undefined,
      ],
      Node: [[workerNode], true, undefined],
      MachineSet: [[], true, undefined],
      'peer-pods-cm': ABSENT,
      'osc-peerpods-aws-describe': [
        { status: { succeeded: 1, conditions: [{ type: 'Complete', status: 'True' }] } },
        true,
        undefined,
      ],
      Pod: [
        [
          {
            metadata: {
              name: 'osc-peerpods-aws-describe-xyz',
              labels: { 'job-name': 'osc-peerpods-aws-describe' },
            },
          },
        ],
        true,
        undefined,
      ],
    };
    cy.mount(<OpenPeerPodsFirewall />);

    cy.contains('<sg-xxxxxxxx>').should('exist');
    cy.contains('button', 'Fetch from AWS').click();

    // The rule targets the pod VM security group, so the first id is the one used.
    cy.contains('--group-id sg-0fetched').should('exist');
    cy.contains('<sg-xxxxxxxx>').should('not.exist');
    cy.contains('Filled in the security group from your worker instance.').should('exist');
  });
});

/*
 * The provider used to fall back to 'gcp' whenever neither peer-pods-cm nor Infrastructure had
 * answered — so a non-GCP cluster rendered the gcloud commands and an enabled "Apply in cluster"
 * while the watch was in flight, and forever if it errored. That button mints a GCP credential.
 */
describe('OpenPeerPodsFirewall — before the cloud is known', () => {
  beforeEach(() => {
    window.__watchResults = {};
  });

  const NEUTRAL = 'Open the peer pods communication ports — TCP 15150 (agent) and UDP 9000';

  it('claims no cloud while the Infrastructure watch is loading', () => {
    mountOn({ infrastructure: [undefined, false, undefined] });

    cy.contains('gcloud compute firewall-rules').should('not.exist');
    cy.contains('button', 'Apply in cluster').should('not.exist');
    cy.contains(NEUTRAL).should('exist');
  });

  it('claims no cloud when the Infrastructure watch errored', () => {
    mountOn({ infrastructure: [undefined, false, { code: 403 }] });

    cy.contains('gcloud compute firewall-rules').should('not.exist');
    cy.contains('button', 'Apply in cluster').should('not.exist');
    cy.contains(NEUTRAL).should('exist');
  });

  it('shows the GCP flow once the cluster really does report GCP', () => {
    mountOn({ platform: 'GCP' });

    cy.contains('gcloud compute firewall-rules').should('exist');
    cy.contains(NEUTRAL).should('not.exist');
  });
});

/*
 * The GCP branch promised "no placeholders to edit" unconditionally, but the project and network
 * come from Infrastructure and the worker MachineSets — neither guaranteed.
 */
describe('OpenPeerPodsFirewall — GCP with values the cluster cannot supply', () => {
  beforeEach(() => {
    window.__watchResults = {};
  });

  const gcpInfra: WatchResult = [
    { status: { platform: 'GCP', platformStatus: { gcp: { projectID: 'my-project' } } } },
    true,
    undefined,
  ];

  it('does not claim there is nothing to edit, and names what is missing', () => {
    mountOn({ infrastructure: gcpInfra });

    cy.contains('--network=<network>').should('exist');
    cy.contains('no placeholders to edit').should('not.exist');
    cy.contains('Replace the placeholder value(s) before running: <network>.').should('exist');
  });

  it('explains why Apply in cluster is disabled', () => {
    mountOn({ infrastructure: gcpInfra });

    cy.contains('button', 'Apply in cluster').should('be.disabled');
    cy.contains('Apply in cluster needs the project and network').should('exist');
  });

  it('keeps the original promise when the cluster does supply everything', () => {
    mountOn({
      infrastructure: gcpInfra,
      machineSets: [
        {
          spec: {
            template: {
              spec: { providerSpec: { value: { networkInterfaces: [{ network: 'my-vpc' }] } } },
            },
          },
        },
      ],
    });

    cy.contains('--network=my-vpc').should('exist');
    cy.contains('no placeholders to edit').should('exist');
    cy.contains('Replace the placeholder value(s)').should('not.exist');
  });
});
