import {
  k8sCreate,
  k8sDelete,
  k8sGet,
  ResourceLink,
  useK8sWatchResource,
  type K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Button,
  ClipboardCopy,
  Content,
  Flex,
  FlexItem,
  Label,
  Spinner,
} from '@patternfly/react-core';
import type { FC } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CLOUD_CREDENTIAL_NAMESPACE,
  CLOUD_SDK_IMAGE,
  CredentialsRequestModel,
  FIREWALL_CRED_REQUEST,
  FIREWALL_CRED_SECRET,
  FIREWALL_JOB,
  FIREWALL_RULE_NAME,
  JobGVK,
  JobModel,
  NodeGVK,
  OSC_NAMESPACE,
  SecretModel,
} from '../k8s/resources';
import type { JobKind, NodeKind } from '../k8s/types';
import {
  useClusterPlatform,
  useCloudNetworking,
  useGcpNetworking,
  usePeerPodsCm,
} from '../k8s/setup';
import { buildFirewallCommand, type FirewallProvider } from '../utils/firewall';
import './sandbox.css';

const WORKER_LABEL = 'node-role.kubernetes.io/worker';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Last path segment of a GCP resource URL (e.g. projects/p/global/networks/n -> n). */
const basename = (p?: string): string | undefined => (p ? p.split('/').filter(Boolean).pop() : p);

const errCode = (e: unknown): number | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: number }).code : undefined;
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const isAlreadyExists = (e: unknown): boolean =>
  errCode(e) === 409 || /already exists/i.test(errMsg(e));
const isNotFound = (e: unknown): boolean => errCode(e) === 404 || /not found/i.test(errMsg(e));

type ApplyPhase = 'idle' | 'minting' | 'applying' | 'running' | 'done' | 'failed';

// How the firewall source ranges were derived, so the UI can explain (or warn about) them.
type RangesKind = 'internal' | 'external' | 'nat' | 'none';

/**
 * The "Open the peer pods port" setup step. Replaces the old hard-coded gcloud command that
 * left `--project`, `--network`, and `--source-ranges` as <placeholders>: it now resolves all
 * three from the cluster (Infrastructure + worker Node IPs + peer-pods-cm) and opens BOTH the
 * agent port (TCP 15150) and the VXLAN tunnel (UDP 9000). On GCP it can also apply the rule in
 * the cluster — it asks the Cloud Credential Operator to mint a credential scoped to
 * compute.firewalls.* and runs gcloud in a Job, so no local CLI is needed. Addresses issue #5.
 */
const OpenPeerPodsFirewall: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const [peerPodsCm] = usePeerPodsCm();
  const platform = useClusterPlatform();
  const gcp = useGcpNetworking();
  const [nodes] = useK8sWatchResource<NodeKind[]>({ groupVersionKind: NodeGVK, isList: true });

  const cloud = useCloudNetworking();
  const pp = peerPodsCm?.data ?? {};
  // Normalize the provider from peer-pods-cm first (it's what the cloud-api-adaptor actually uses),
  // then the cluster platform (AWS/Azure/GCP/…), defaulting to GCP for the existing one-click flow.
  const provider = (pp.CLOUD_PROVIDER ?? (platform ? platform.toLowerCase() : 'gcp')).toLowerCase();
  const isGcp = provider === 'gcp';

  // The pod VMs live wherever peer-pods-cm points them (which can differ from the cluster's own
  // VPC); fall back to the cluster networking inferred from the worker MachineSets.
  const project = pp.GCP_PROJECT_ID || gcp.project;
  // gcloud --network wants the short name; both peer-pods-cm and gcp.network may be a full path.
  const network = basename(pp.GCP_NETWORK || gcp.network);
  const usePublicIp = (pp.USE_PUBLIC_IP ?? '').toLowerCase() === 'true';

  // The cloud-api-adaptor reaches each pod VM from the worker node it runs on (hostNetwork), so
  // the firewall source is the set of worker node IPs — external when the VMs are reached over a
  // public IP, internal otherwise. List them as /32s so the rule is exactly as wide as it needs.
  const { sourceRanges, rangesReady, rangesKind } = useMemo<{
    sourceRanges: string;
    rangesReady: boolean;
    rangesKind: RangesKind;
  }>(() => {
    const all = nodes ?? [];
    const workers = all.filter((n) => Object.keys(n.metadata?.labels ?? {}).includes(WORKER_LABEL));
    const pool = workers.length ? workers : all;
    const ipsOfType = (type: string): string[] =>
      Array.from(
        new Set(
          pool.flatMap((n) =>
            (n.status?.addresses ?? []).filter((a) => a.type === type).map((a) => a.address),
          ),
        ),
      );
    const cidrs = (ips: string[]): string => ips.map((ip) => `${ip}/32`).join(',');
    if (usePublicIp) {
      const external = ipsOfType('ExternalIP');
      if (external.length)
        return { sourceRanges: cidrs(external), rangesReady: true, rangesKind: 'external' };
      // Public-IP mode but the workers have no external IP of their own: traffic egresses via the
      // cluster's Cloud NAT address, which isn't visible from inside the cluster.
      return { sourceRanges: '<cluster_nat_egress_ip>/32', rangesReady: false, rangesKind: 'nat' };
    }
    const internal = ipsOfType('InternalIP');
    if (internal.length)
      return { sourceRanges: cidrs(internal), rangesReady: true, rangesKind: 'internal' };
    return { sourceRanges: '<worker_subnet_cidr>', rangesReady: false, rangesKind: 'none' };
  }, [nodes, usePublicIp]);

  const command = [
    `gcloud compute firewall-rules create ${FIREWALL_RULE_NAME} \\`,
    `  --project=${project ?? '<project_id>'} \\`,
    `  --network=${network ?? '<network>'} \\`,
    `  --direction=INGRESS \\`,
    `  --allow=tcp:15150,udp:9000 \\`,
    `  --source-ranges=${sourceRanges}`,
  ].join('\n');

  // ---- in-cluster apply (CCO-minted credential + gcloud Job) ----
  const [phase, setPhase] = useState<ApplyPhase>('idle');
  const [error, setError] = useState<string | undefined>();
  const [job] = useK8sWatchResource<JobKind>({
    groupVersionKind: JobGVK,
    namespace: OSC_NAMESPACE,
    name: FIREWALL_JOB,
  });

  const jobSucceeded =
    (job?.status?.succeeded ?? 0) > 0 ||
    Boolean(job?.status?.conditions?.some((c) => c.type === 'Complete' && c.status === 'True'));
  const jobFailed = Boolean(
    job?.status?.conditions?.some((c) => c.type === 'Failed' && c.status === 'True'),
  );

  // Derive the terminal outcome from the live Job rather than storing it in state (avoids
  // setState-in-effect): once the Job we started finishes, the displayed phase reflects its result.
  const displayPhase: ApplyPhase =
    phase === 'running' ? (jobSucceeded ? 'done' : jobFailed ? 'failed' : 'running') : phase;

  const credentialsRequest: K8sResourceCommon & { spec: Record<string, unknown> } = {
    apiVersion: 'cloudcredential.openshift.io/v1',
    kind: 'CredentialsRequest',
    metadata: { name: FIREWALL_CRED_REQUEST, namespace: CLOUD_CREDENTIAL_NAMESPACE },
    spec: {
      secretRef: { name: FIREWALL_CRED_SECRET, namespace: OSC_NAMESPACE },
      providerSpec: {
        apiVersion: 'cloudcredential.openshift.io/v1',
        kind: 'GCPProviderSpec',
        predefinedRoles: [],
        permissions: [
          'compute.firewalls.create',
          'compute.firewalls.get',
          'compute.firewalls.list',
          'compute.firewalls.update',
        ],
        skipServiceCheck: true,
      },
    },
  };

  // create-or-update so a second click reconciles the rule instead of erroring on "already exists".
  const script = [
    'set -euo pipefail',
    'export CLOUDSDK_CORE_DISABLE_PROMPTS=1',
    'gcloud auth activate-service-account --key-file=/creds/service_account.json',
    `echo ">>> Ensuring firewall rule ${FIREWALL_RULE_NAME} on ${network ?? ''}"`,
    `if gcloud compute firewall-rules describe ${FIREWALL_RULE_NAME} --project=${project ?? ''} >/dev/null 2>&1; then`,
    `  gcloud compute firewall-rules update ${FIREWALL_RULE_NAME} --project=${project ?? ''} --allow=tcp:15150,udp:9000 --source-ranges=${sourceRanges}`,
    'else',
    `  gcloud compute firewall-rules create ${FIREWALL_RULE_NAME} --project=${project ?? ''} --network=${network ?? ''} --direction=INGRESS --allow=tcp:15150,udp:9000 --source-ranges=${sourceRanges} --description="OSC peer pods: agent 15150 + VXLAN 9000 (osc-openshift-console-plugin)"`,
    'fi',
    `gcloud compute firewall-rules describe ${FIREWALL_RULE_NAME} --project=${project ?? ''} --format="yaml(name,network,direction,allowed,sourceRanges)"`,
  ].join('\n');

  const firewallJob: K8sResourceCommon & { spec: Record<string, unknown> } = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: FIREWALL_JOB, namespace: OSC_NAMESPACE },
    spec: {
      backoffLimit: 1,
      ttlSecondsAfterFinished: 1800,
      template: {
        metadata: { labels: { app: FIREWALL_JOB } },
        spec: {
          restartPolicy: 'Never',
          securityContext: { runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
          containers: [
            {
              name: 'gcloud',
              image: CLOUD_SDK_IMAGE,
              command: ['/bin/bash', '-c'],
              args: [script],
              env: [
                { name: 'HOME', value: '/tmp' },
                { name: 'CLOUDSDK_CONFIG', value: '/tmp/gcloud' },
              ],
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
              },
              volumeMounts: [{ name: 'creds', mountPath: '/creds', readOnly: true }],
              resources: { requests: { cpu: '50m', memory: '128Mi' }, limits: { memory: '256Mi' } },
            },
          ],
          volumes: [{ name: 'creds', secret: { secretName: FIREWALL_CRED_SECRET } }],
        },
      },
    },
  };

  // Re-running means a stale completed Job is in the way; delete it and wait for it to clear.
  const recreateJob = async (): Promise<void> => {
    try {
      await k8sCreate({ model: JobModel, data: firewallJob });
      return;
    } catch (e) {
      if (!isAlreadyExists(e)) throw e;
    }
    await k8sDelete({ model: JobModel, resource: firewallJob });
    for (let i = 0; i < 20; i++) {
      try {
        await k8sGet({ model: JobModel, name: FIREWALL_JOB, ns: OSC_NAMESPACE });
        await sleep(1000);
      } catch (e) {
        if (isNotFound(e)) break;
        throw e;
      }
    }
    await k8sCreate({ model: JobModel, data: firewallJob });
  };

  const apply = async (): Promise<void> => {
    setError(undefined);
    setPhase('minting');
    try {
      // 1. Ask the Cloud Credential Operator for a credential scoped to compute.firewalls.*
      try {
        await k8sCreate({ model: CredentialsRequestModel, data: credentialsRequest });
      } catch (e) {
        if (!isAlreadyExists(e)) throw e;
      }
      // 2. Wait (~2 min) for CCO to mint the secret into the OSC namespace.
      let minted = false;
      for (let i = 0; i < 40 && !minted; i++) {
        try {
          await k8sGet({ model: SecretModel, name: FIREWALL_CRED_SECRET, ns: OSC_NAMESPACE });
          minted = true;
        } catch (e) {
          if (!isNotFound(e)) throw e;
          await sleep(3000);
        }
      }
      if (!minted)
        throw new Error(
          t(
            'Timed out waiting for the Cloud Credential Operator to mint a credential. Your cluster may not be in mint mode — run the command above with your own credentials instead.',
          ),
        );
      // 3. Run gcloud in a Job using the minted credential.
      setPhase('applying');
      await recreateJob();
      setPhase('running');
    } catch (e) {
      setError(errMsg(e));
      setPhase('failed');
    }
  };

  // AWS/Azure: no in-cluster apply, but render a fully-resolved copy-paste CLI — every value we can
  // read from the cluster (peer-pods-cm + Infrastructure) is filled in; the rest are clear
  // <placeholders> the user edits before running.
  if (provider === 'aws' || provider === 'azure') {
    const fwProvider: FirewallProvider = provider;
    // AWS_SG_IDS may be a comma-separated list; the rule targets the pod VM SG, so use the first.
    const awsSg = pp.AWS_SG_IDS?.split(',')[0]?.trim() || undefined;
    const { command: cliCommand, placeholders } = buildFirewallCommand(fwProvider, {
      region: provider === 'aws' ? (pp.AWS_REGION ?? cloud.region) : pp.AZURE_REGION,
      awsSecurityGroupId: awsSg,
      awsVpcId: pp.AWS_VPC_ID,
      azureResourceGroup: pp.AZURE_RESOURCE_GROUP ?? cloud.azureResourceGroup,
      azureNsgName: pp.AZURE_NSG_ID,
    });
    return (
      <>
        <Content component="p" className="osc-openshift-console-plugin__muted">
          {t(
            'Open the peer pods communication ports — TCP 15150 (agent) and UDP 9000 (VXLAN tunnel) — so your worker nodes can reach the pod VMs. The command below is filled in from your cluster; run it in your cloud CLI.',
          )}
        </Content>
        <ClipboardCopy
          isReadOnly
          variant="expansion"
          isExpanded
          hoverTip={t('Copy')}
          clickTip={t('Copied')}
        >
          {cliCommand}
        </ClipboardCopy>
        {placeholders.length > 0 && (
          <Alert
            variant="warning"
            isInline
            isPlain
            className="osc-openshift-console-plugin__mt"
            title={t(
              'Replace the placeholder value(s) before running: {{placeholders}}. Find them in your peer-pods config map or cloud console.',
              { placeholders: placeholders.join(', ') },
            )}
          />
        )}
      </>
    );
  }

  if (!isGcp) {
    return (
      <Content component="p" className="osc-openshift-console-plugin__muted">
        {t(
          'Open the peer pods communication ports — TCP 15150 (agent) and UDP 9000 (VXLAN tunnel) — in your cloud firewall, allowing traffic from your worker nodes to the pod VMs. This is done in your cloud CLI, not from the cluster.',
        )}
      </Content>
    );
  }

  const busy = phase === 'minting' || phase === 'applying';
  const applyLabel = busy
    ? phase === 'minting'
      ? t('Requesting credential…')
      : t('Starting…')
    : displayPhase === 'running'
      ? t('Applying…')
      : t('Apply in cluster');

  return (
    <>
      <Content component="p" className="osc-openshift-console-plugin__muted">
        {t(
          'Allow the cluster to reach pod VMs on Compute Engine: open TCP 15150 (agent) and UDP 9000 (VXLAN tunnel) from your worker nodes. The command below is filled in from your cluster — no placeholders to edit.',
        )}
      </Content>
      <ClipboardCopy
        isReadOnly
        variant="expansion"
        isExpanded
        hoverTip={t('Copy')}
        clickTip={t('Copied')}
      >
        {command}
      </ClipboardCopy>

      {!rangesReady && (
        <Alert
          variant="warning"
          isInline
          isPlain
          className="osc-openshift-console-plugin__mt"
          title={
            rangesKind === 'nat'
              ? t(
                  'Your workers have no external IP, so traffic reaches the pod VMs via the cluster’s Cloud NAT address. Replace <cluster_nat_egress_ip> with that IP before running the command.',
                )
              : t(
                  'Could not read worker node IPs. Replace <worker_subnet_cidr> with your worker subnet (for example 10.0.128.0/24) before running the command.',
                )
          }
        />
      )}

      <div className="osc-openshift-console-plugin__mt">
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          gap={{ default: 'gapSm' }}
          flexWrap={{ default: 'wrap' }}
        >
          <FlexItem>
            <Button
              variant="secondary"
              onClick={() => void apply()}
              isLoading={busy}
              isDisabled={
                busy || displayPhase === 'running' || !rangesReady || !project || !network
              }
            >
              {applyLabel}
            </Button>
          </FlexItem>
          {displayPhase === 'running' && (
            <FlexItem>
              <Spinner size="md" aria-label={t('Applying firewall rule')} />
            </FlexItem>
          )}
          {job && (
            <FlexItem>
              <Label isCompact color={jobSucceeded ? 'green' : jobFailed ? 'red' : 'blue'}>
                {jobSucceeded ? t('applied') : jobFailed ? t('failed') : t('running')}
              </Label>
            </FlexItem>
          )}
          {job && (
            <FlexItem>
              <ResourceLink
                groupVersionKind={JobGVK}
                name={FIREWALL_JOB}
                namespace={OSC_NAMESPACE}
                inline
              />
            </FlexItem>
          )}
        </Flex>
        <Content
          component="small"
          className="osc-openshift-console-plugin__muted osc-openshift-console-plugin__mt"
        >
          {t(
            'Apply in cluster asks the Cloud Credential Operator to mint a credential scoped to compute.firewalls.*, then runs gcloud in a Job — no local CLI or cloud console needed.',
          )}
        </Content>

        {error && (
          <Alert
            variant="danger"
            isInline
            title={t('Could not apply the firewall rule')}
            className="osc-openshift-console-plugin__mt"
          >
            {error}
          </Alert>
        )}
        {displayPhase === 'done' && (
          <Alert
            variant="success"
            isInline
            isPlain
            title={t('Firewall rule applied — open the Job above to see the result.')}
            className="osc-openshift-console-plugin__mt"
          />
        )}
        {displayPhase === 'failed' && job && jobFailed && (
          <Alert
            variant="warning"
            isInline
            isPlain
            title={t(
              'The Job failed — open it above to read the logs. The minted credential may still be provisioning, or the rule may already exist with conflicting settings.',
            )}
            className="osc-openshift-console-plugin__mt"
          />
        )}
      </div>
    </>
  );
};

export default OpenPeerPodsFirewall;
