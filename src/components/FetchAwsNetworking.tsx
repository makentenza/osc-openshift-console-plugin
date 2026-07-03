import {
  consoleFetchText,
  k8sCreate,
  k8sDelete,
  k8sGet,
  ResourceLink,
  useK8sWatchResource,
  type K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import { Alert, Button, Content, Flex, FlexItem, Label, Spinner } from '@patternfly/react-core';
import type { FC } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AWS_CLI_IMAGE,
  AWS_FETCH_CRED_REQUEST,
  AWS_FETCH_CRED_SECRET,
  AWS_FETCH_JOB,
  CLOUD_CREDENTIAL_NAMESPACE,
  CredentialsRequestModel,
  JobGVK,
  JobModel,
  NodeGVK,
  OSC_NAMESPACE,
  PodGVK,
  SecretModel,
} from '../k8s/resources';
import type { JobKind, NodeKind, PodKind } from '../k8s/types';
import { useAwsNetworking, useCcoMode, useCloudNetworking } from '../k8s/setup';
import './sandbox.css';

const WORKER_LABEL = 'node-role.kubernetes.io/worker';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const errCode = (e: unknown): number | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: number }).code : undefined;
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const isAlreadyExists = (e: unknown): boolean =>
  errCode(e) === 409 || /already exists/i.test(errMsg(e));
const isNotFound = (e: unknown): boolean => errCode(e) === 404 || /not found/i.test(errMsg(e));

/** aws:///<az>/<instance-id> -> <instance-id> (the EC2 instance the Job describes). */
export const instanceIdFromProviderId = (providerId?: string): string | undefined => {
  if (!providerId?.startsWith('aws://')) return undefined;
  const id = providerId.split('/').filter(Boolean).pop();
  return id?.startsWith('i-') ? id : undefined;
};

export interface AwsNetworkingResult {
  subnetId?: string;
  vpcId?: string;
  sgIds?: string;
}

const clean = (v?: string): string | undefined => {
  const s = v?.trim();
  return s && s !== 'None' && s !== 'null' ? s : undefined;
};
export const parseLog = (log: string): AwsNetworkingResult => {
  const get = (key: string): string | undefined =>
    clean(
      log
        .split('\n')
        .find((l) => l.startsWith(`${key}=`))
        ?.slice(key.length + 1),
    );
  return { subnetId: get('AWS_SUBNET_ID'), vpcId: get('AWS_VPC_ID'), sgIds: get('AWS_SG_IDS') };
};

// Read-only EC2 describe against the worker instance; prints the three ids we hand back to the form.
const jobScript = [
  'set -e',
  'Q() { aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$AWS_REGION" --query "$1" --output text; }',
  'echo "AWS_SUBNET_ID=$(Q "Reservations[0].Instances[0].SubnetId")"',
  'echo "AWS_VPC_ID=$(Q "Reservations[0].Instances[0].VpcId")"',
  'echo "AWS_SG_IDS=$(Q "Reservations[0].Instances[0].SecurityGroups[*].GroupId" | tr -s "[:space:]" "," | sed "s/^,//;s/,$//")"',
].join('\n');

type Phase = 'idle' | 'minting' | 'running';

/**
 * "Fetch from AWS": resolve AWS_SUBNET_ID / AWS_VPC_ID / AWS_SG_IDS for the peer pods config map. On
 * IPI clusters the MachineSet references the subnet + security groups by tag filter, not literal id,
 * so they aren't in cluster state — this asks the Cloud Credential Operator to mint a read-only
 * ec2:DescribeInstances credential, runs `aws ec2 describe-instances` against a worker instance in a
 * short Job, and reads the three ids back from the Job pod's log. Mirrors the firewall Apply flow;
 * disabled when CCO is in Manual mode (STS), where the manual CLI below is the fallback.
 */
const FetchAwsNetworking: FC<{ region?: string; onFetched: (r: AwsNetworkingResult) => void }> = ({
  region,
  onFetched,
}) => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const [nodes] = useK8sWatchResource<NodeKind[]>({ groupVersionKind: NodeGVK, isList: true });
  const cloud = useCloudNetworking();
  const awsNet = useAwsNetworking();
  const ccoManual = useCcoMode() === 'Manual';

  const instanceId = useMemo(() => {
    const all = nodes ?? [];
    const workers = all.filter((n) => Object.keys(n.metadata?.labels ?? {}).includes(WORKER_LABEL));
    for (const n of workers.length ? workers : all) {
      const id = instanceIdFromProviderId(n.spec?.providerID);
      if (id) return id;
    }
    return undefined;
  }, [nodes]);
  const awsRegion = region?.trim() || cloud.region || awsNet.region;

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<AwsNetworkingResult | undefined>();
  const readStarted = useRef(false);
  const cleanedUp = useRef(false);

  const [job] = useK8sWatchResource<JobKind>({
    groupVersionKind: JobGVK,
    namespace: OSC_NAMESPACE,
    name: AWS_FETCH_JOB,
  });
  const [pods] = useK8sWatchResource<PodKind[]>({
    groupVersionKind: PodGVK,
    namespace: OSC_NAMESPACE,
    isList: true,
  });
  const jobPodName = useMemo(
    () =>
      (pods ?? []).find(
        (p) =>
          p.metadata?.labels?.['job-name'] === AWS_FETCH_JOB ||
          p.metadata?.labels?.['batch.kubernetes.io/job-name'] === AWS_FETCH_JOB,
      )?.metadata?.name,
    [pods],
  );

  const jobSucceeded =
    (job?.status?.succeeded ?? 0) > 0 ||
    Boolean(job?.status?.conditions?.some((c) => c.type === 'Complete' && c.status === 'True'));
  const jobFailed = Boolean(
    job?.status?.conditions?.some((c) => c.type === 'Failed' && c.status === 'True'),
  );

  const cleanup = async (): Promise<void> => {
    const dels = [
      {
        model: JobModel,
        resource: {
          apiVersion: 'batch/v1',
          kind: 'Job',
          metadata: { name: AWS_FETCH_JOB, namespace: OSC_NAMESPACE },
        },
      },
      {
        model: CredentialsRequestModel,
        resource: {
          apiVersion: 'cloudcredential.openshift.io/v1',
          kind: 'CredentialsRequest',
          metadata: { name: AWS_FETCH_CRED_REQUEST, namespace: CLOUD_CREDENTIAL_NAMESPACE },
        },
      },
    ];
    for (const d of dels) {
      try {
        await k8sDelete(d);
      } catch {
        /* best-effort — deleting the CredentialsRequest also removes the minted secret */
      }
    }
  };

  // Once the Job succeeds, read its pod log, parse the three ids, hand them up, and clean up. All
  // state writes are inside the promise callbacks (never synchronous in the effect body).
  useEffect(() => {
    if (!(phase === 'running' && jobSucceeded && jobPodName) || readStarted.current) return;
    readStarted.current = true;
    consoleFetchText(`/api/kubernetes/api/v1/namespaces/${OSC_NAMESPACE}/pods/${jobPodName}/log`)
      .then((log) => {
        const parsed = parseLog(log);
        setResult(parsed);
        onFetched(parsed);
        setPhase('idle');
        void cleanup();
      })
      .catch((e: unknown) => {
        setError(errMsg(e));
        setPhase('idle');
      });
  }, [phase, jobSucceeded, jobPodName, onFetched]);

  // On failure, tear the Job/credential down (best-effort). Async delete only — no setState here; the
  // failure is shown from the derived `jobFailed` below.
  useEffect(() => {
    if (phase === 'running' && jobFailed && !cleanedUp.current) {
      cleanedUp.current = true;
      void cleanup();
    }
  }, [phase, jobFailed]);

  const credentialsRequest: K8sResourceCommon & { spec: Record<string, unknown> } = {
    apiVersion: 'cloudcredential.openshift.io/v1',
    kind: 'CredentialsRequest',
    metadata: { name: AWS_FETCH_CRED_REQUEST, namespace: CLOUD_CREDENTIAL_NAMESPACE },
    spec: {
      secretRef: { name: AWS_FETCH_CRED_SECRET, namespace: OSC_NAMESPACE },
      providerSpec: {
        apiVersion: 'cloudcredential.openshift.io/v1',
        kind: 'AWSProviderSpec',
        statementEntries: [{ effect: 'Allow', action: ['ec2:DescribeInstances'], resource: '*' }],
      },
    },
  };

  const describeJob: K8sResourceCommon & { spec: Record<string, unknown> } = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: AWS_FETCH_JOB, namespace: OSC_NAMESPACE },
    spec: {
      backoffLimit: 1,
      ttlSecondsAfterFinished: 600,
      template: {
        metadata: { labels: { app: AWS_FETCH_JOB } },
        spec: {
          restartPolicy: 'Never',
          securityContext: { runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
          containers: [
            {
              name: 'aws',
              image: AWS_CLI_IMAGE,
              command: ['/bin/bash', '-c'],
              args: [jobScript],
              env: [
                { name: 'HOME', value: '/tmp' },
                { name: 'INSTANCE_ID', value: instanceId },
                { name: 'AWS_REGION', value: awsRegion },
                {
                  name: 'AWS_ACCESS_KEY_ID',
                  valueFrom: {
                    secretKeyRef: { name: AWS_FETCH_CRED_SECRET, key: 'aws_access_key_id' },
                  },
                },
                {
                  name: 'AWS_SECRET_ACCESS_KEY',
                  valueFrom: {
                    secretKeyRef: { name: AWS_FETCH_CRED_SECRET, key: 'aws_secret_access_key' },
                  },
                },
              ],
              securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
              resources: { requests: { cpu: '50m', memory: '128Mi' }, limits: { memory: '256Mi' } },
            },
          ],
        },
      },
    },
  };

  const recreateJob = async (): Promise<void> => {
    try {
      await k8sCreate({ model: JobModel, data: describeJob });
      return;
    } catch (e) {
      if (!isAlreadyExists(e)) throw e;
    }
    await k8sDelete({ model: JobModel, resource: describeJob });
    for (let i = 0; i < 20; i++) {
      try {
        await k8sGet({ model: JobModel, name: AWS_FETCH_JOB, ns: OSC_NAMESPACE });
        await sleep(1000);
      } catch (e) {
        if (isNotFound(e)) break;
        throw e;
      }
    }
    await k8sCreate({ model: JobModel, data: describeJob });
  };

  const fetch = async (): Promise<void> => {
    setError(undefined);
    setResult(undefined);
    readStarted.current = false;
    cleanedUp.current = false;
    setPhase('minting');
    try {
      try {
        await k8sCreate({ model: CredentialsRequestModel, data: credentialsRequest });
      } catch (e) {
        if (!isAlreadyExists(e)) throw e;
      }
      let minted = false;
      for (let i = 0; i < 40 && !minted; i++) {
        try {
          await k8sGet({ model: SecretModel, name: AWS_FETCH_CRED_SECRET, ns: OSC_NAMESPACE });
          minted = true;
          break;
        } catch (e) {
          if (!isNotFound(e)) throw e;
        }
        await sleep(3000);
      }
      if (!minted)
        throw new Error(
          t(
            'Timed out waiting for the Cloud Credential Operator to mint a credential. Fetch the IDs with the AWS CLI below instead.',
          ),
        );
      await recreateJob();
      setPhase('running');
    } catch (e) {
      setError(errMsg(e));
      setPhase('idle');
    }
  };

  const busy = phase === 'minting' || (phase === 'running' && !result && !jobFailed);
  const disabled = busy || ccoManual || !instanceId || !awsRegion;
  const label =
    phase === 'minting'
      ? t('Requesting credential…')
      : busy
        ? t('Describing instance…')
        : t('Fetch from AWS');

  return (
    <div className="osc-openshift-console-plugin__mt">
      <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
        <FlexItem>
          <Button
            variant="secondary"
            onClick={() => void fetch()}
            isLoading={busy}
            isDisabled={disabled}
          >
            {label}
          </Button>
        </FlexItem>
        {busy && (
          <FlexItem>
            <Spinner size="md" aria-label={t('Fetching from AWS')} />
          </FlexItem>
        )}
        {job && (
          <FlexItem>
            <Label isCompact color={jobSucceeded ? 'green' : jobFailed ? 'red' : 'blue'}>
              {jobSucceeded ? t('done') : jobFailed ? t('failed') : t('running')}
            </Label>
          </FlexItem>
        )}
        {job && (
          <FlexItem>
            <ResourceLink
              groupVersionKind={JobGVK}
              name={AWS_FETCH_JOB}
              namespace={OSC_NAMESPACE}
              inline
            />
          </FlexItem>
        )}
      </Flex>

      {ccoManual ? (
        <Alert
          variant="info"
          isInline
          isPlain
          className="osc-openshift-console-plugin__mt"
          title={t(
            'This cluster uses manually-managed credentials (the Cloud Credential Operator is in Manual mode), so it can’t mint a credential. Use the AWS CLI below instead.',
          )}
        />
      ) : (
        <Content
          component="small"
          className="osc-openshift-console-plugin__muted osc-openshift-console-plugin__mt"
        >
          {t(
            'Fetch from AWS asks the Cloud Credential Operator to mint a read-only ec2:DescribeInstances credential, then runs the AWS CLI in a short Job to resolve the subnet, VPC, and security group IDs — no local CLI needed.',
          )}
        </Content>
      )}

      {result && (
        <Alert
          variant="success"
          isInline
          isPlain
          className="osc-openshift-console-plugin__mt"
          title={t('Filled in Subnet, VPC, and security group IDs from your worker instance.')}
        />
      )}
      {phase === 'running' && jobFailed && (
        <Alert
          variant="warning"
          isInline
          isPlain
          className="osc-openshift-console-plugin__mt"
          title={t(
            'The describe Job failed — open it above to read the logs, or use the AWS CLI below.',
          )}
        />
      )}
      {error && (
        <Alert
          variant="danger"
          isInline
          title={t('Could not fetch AWS networking')}
          className="osc-openshift-console-plugin__mt"
        >
          {error}
        </Alert>
      )}
    </div>
  );
};

export default FetchAwsNetworking;
