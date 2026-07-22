import {
  DocumentTitle,
  k8sCreate,
  k8sUpdate,
  ListPageHeader,
  type K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  ActionGroup,
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  CodeBlock,
  CodeBlockCode,
  ExpandableSection,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  PageSection,
  Switch,
  TextInput,
} from '@patternfly/react-core';
import type { FC } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import { ConfigMapModel, OSC_NAMESPACE, PEER_PODS_CM } from '../k8s/resources';
import type { ConfigMapKind } from '../k8s/types';
import {
  useAwsNetworking,
  useAzureNetworking,
  useClusterPlatform,
  useGcpNetworking,
  usePeerPodsCm,
} from '../k8s/setup';
import { toYaml } from '../utils/yaml';
import { normalizeCsvList } from '../utils/csv';
import { parsePeerPodsBool } from '../utils/peerPods';
import { AZURE_DEPLOY_DOCS } from '../utils/caaDiagnostics';
import FetchAwsNetworking from './FetchAwsNetworking';
import './sandbox.css';

interface Field {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  /** A comma-separated allow-list — normalized on save so spacing can't break a lookup (#68). */
  list?: boolean;
}

// Primary provider fields. GCP keys match the OpenShift sandboxed containers 1.12
// "Creating the peer pods config map" procedure exactly.
const FIELDS: Record<string, Field[]> = {
  gcp: [
    { key: 'GCP_PROJECT_ID', label: 'Project ID' },
    { key: 'GCP_ZONE', label: 'Zone', placeholder: 'europe-west4-a' },
    {
      key: 'GCP_MACHINE_TYPE',
      label: 'Machine type',
      placeholder: 'e2-medium',
      help: 'Default machine type used when a workload does not request one.',
    },
    {
      key: 'GCP_NETWORK',
      label: 'Network',
      help: 'The VPC network the pod VMs join, as a full resource path — projects/<project>/global/networks/<name>. The cloud-api-adaptor rejects a bare network name. Prefilled from your cluster.',
    },
  ],
  aws: [
    { key: 'AWS_REGION', label: 'Region' },
    {
      key: 'PODVM_INSTANCE_TYPE',
      label: 'Instance type',
      placeholder: 't3.medium',
      help: 'Default instance type used when a workload does not request one.',
    },
    {
      key: 'PODVM_INSTANCE_TYPES',
      label: 'Allowed instance types',
      placeholder: 't2.small,t2.medium,t3.large',
      list: true,
      help: 'Instance types a workload may request by annotation; leave empty to allow only the default above.',
    },
    { key: 'AWS_SUBNET_ID', label: 'Subnet ID' },
    { key: 'AWS_VPC_ID', label: 'VPC ID' },
    {
      key: 'AWS_SG_IDS',
      label: 'Security group IDs',
      list: true,
      help: 'Comma-separated security group IDs (sg-…).',
    },
  ],
  azure: [
    { key: 'AZURE_SUBSCRIPTION_ID', label: 'Subscription ID' },
    { key: 'AZURE_REGION', label: 'Region' },
    { key: 'AZURE_RESOURCE_GROUP', label: 'Resource group' },
    { key: 'AZURE_SUBNET_ID', label: 'Subnet ID' },
    { key: 'AZURE_NSG_ID', label: 'Network security group ID' },
    {
      key: 'AZURE_INSTANCE_SIZE',
      label: 'Instance size',
      placeholder: 'Standard_D2as_v5',
      help: 'The default size used when a workload does not request one. With confidential computing on, it must be a Confidential VM size — AMD SEV-SNP (e.g. Standard_DC2as_v5) or Intel TDX (e.g. Standard_EC2eds_v5).',
    },
    {
      key: 'AZURE_INSTANCE_SIZES',
      label: 'Allowed instance sizes',
      placeholder: 'Standard_D2as_v5,Standard_D4as_v5',
      list: true,
      help: 'Additional sizes a workload may request by annotation (io.katacontainers.config.hypervisor.machine_type); leave empty to allow only the default size above.',
    },
    {
      key: 'AZURE_IMAGE_ID',
      label: 'Pod VM image ID (optional)',
      help: 'Leave blank — the OpenShift sandboxed containers operator builds a pod VM image from your cluster credentials after KataConfig runs and fills this in for you. Set it only to pin a pre-built Azure Compute Gallery image id.',
    },
  ],
};

// Optional key=value tags applied to pod VM instances — supported on all three clouds.
const TAGS_FIELD: Field = {
  key: 'TAGS',
  label: 'Instance tags',
  placeholder: 'key1=value1,key2=value2',
  help: 'Optional key=value tags applied to pod VM instances, e.g. to track cost or identify peer pods across clusters.',
};

// Pod VM root disk size — same key/default (6 GB) on all providers; surfaced so a value smaller than
// the pod VM image OS disk (a common peer-pod start failure) can be fixed in the UI.
const ROOT_VOLUME_FIELD: Field = {
  key: 'ROOT_VOLUME_SIZE',
  label: 'Pod VM root volume size (GB)',
  placeholder: '6',
  help: 'Root disk size for each pod VM, in GB. Default and minimum 6; increase it for large container images. A value smaller than the pod VM image OS disk makes pods fail to start.',
};

// Optional provider-specific keys, surfaced under "Advanced options".
const ADVANCED_FIELDS: Record<string, Field[]> = {
  gcp: [
    {
      key: 'GCP_SUBNETWORK',
      label: 'Subnetwork (custom VPC only)',
      help: 'Prefilled from your cluster’s worker subnet on a custom VPC. Leave empty only on auto-mode (default) networks. On a custom VPC you must also open the peer-pods firewall ports on this subnet.',
    },
    TAGS_FIELD,
    ROOT_VOLUME_FIELD,
  ],
  // PODVM_AMI_ID is normally operator-managed (see below); expose it only here, for the rare case of
  // pinning a custom AMI (issue #28).
  aws: [
    {
      key: 'PODVM_AMI_ID',
      label: 'Custom pod VM AMI ID (optional)',
      help: 'Leave blank — the operator registers an AMI from your cluster credentials after KataConfig runs. Set this only to pin your own AMI.',
    },
    TAGS_FIELD,
    ROOT_VOLUME_FIELD,
  ],
  azure: [TAGS_FIELD, ROOT_VOLUME_FIELD],
};

const DEFAULTS: Record<string, string> = {
  VXLAN_PORT: '9000',
  PROXY_TIMEOUT: '5m',
  PEERPODS_LIMIT_PER_NODE: '10',
  ROOT_VOLUME_SIZE: '6',
  GCP_MACHINE_TYPE: 'e2-medium',
};

// The Red Hat "Creating the peer pods config map" procedure for reading AWS values off a worker
// instance — shown as a fallback for the IDs the cluster doesn't expose for prefill (issue #28).
const AWS_DESCRIBE_CLI = [
  `INSTANCE_ID=$(oc get nodes -l node-role.kubernetes.io/worker \\`,
  `  -o jsonpath='{.items[0].spec.providerID}' | sed 's#[^ ]*/##g')`,
  `AWS_REGION=$(oc get infrastructure/cluster -o jsonpath='{.status.platformStatus.aws.region}')`,
  `aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$AWS_REGION" \\`,
  `  --query 'Reservations[*].Instances[*].SubnetId' --output text   # AWS_SUBNET_ID`,
  `aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$AWS_REGION" \\`,
  `  --query 'Reservations[*].Instances[*].VpcId' --output text      # AWS_VPC_ID`,
  `aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$AWS_REGION" \\`,
  `  --query 'Reservations[*].Instances[*].SecurityGroups[*].GroupId' --output json \\`,
  `  | jq -r '.[][]' | paste -sd ","                                 # AWS_SG_IDS`,
].join('\n');

const PeerPodsConfigWizard: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const navigate = useNavigate();
  const [existing, loaded] = usePeerPodsCm();
  const gcp = useGcpNetworking();
  const aws = useAwsNetworking();
  const azure = useAzureNetworking();
  const platform = useClusterPlatform();

  const [values, setValues] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [cliOpen, setCliOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const defaultProvider = platform === 'AWS' ? 'aws' : platform === 'Azure' ? 'azure' : 'gcp';
  const provider = values.CLOUD_PROVIDER ?? existing?.data?.CLOUD_PROVIDER ?? defaultProvider;

  const gcpPrefill: Record<string, string | undefined> = {
    GCP_PROJECT_ID: gcp.project,
    GCP_ZONE: gcp.zone,
    GCP_MACHINE_TYPE: gcp.machineType ?? 'e2-medium',
    GCP_NETWORK: gcp.network,
    GCP_SUBNETWORK: gcp.subnetwork,
  };
  // Prefill AWS the way GCP already is, from Infrastructure + worker MachineSets (issue #28).
  const awsPrefill: Record<string, string | undefined> = {
    AWS_REGION: aws.region,
    PODVM_INSTANCE_TYPE: aws.instanceType,
    AWS_SUBNET_ID: aws.subnetId,
    AWS_SG_IDS: aws.securityGroupIds,
  };
  // Prefill Azure from the cluster's cloud-provider-config: subscription, region, resource group,
  // and the full ARM ids of the worker subnet + node NSG (peer-pods wants full resource ids).
  const azurePrefill: Record<string, string | undefined> = {
    AZURE_SUBSCRIPTION_ID: azure.subscriptionId,
    AZURE_REGION: azure.region,
    AZURE_RESOURCE_GROUP: azure.resourceGroup,
    AZURE_SUBNET_ID: azure.subnetId,
    AZURE_NSG_ID: azure.nsgId,
  };

  const fieldVal = (key: string): string => {
    if (values[key] !== undefined) return values[key];
    if (existing?.data?.[key] !== undefined) return existing.data[key];
    if (provider === 'gcp' && gcpPrefill[key]) return gcpPrefill[key] as string;
    if (provider === 'aws' && awsPrefill[key]) return awsPrefill[key] as string;
    if (provider === 'azure' && azurePrefill[key]) return azurePrefill[key] as string;
    return DEFAULTS[key] ?? '';
  };
  const set = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  const usePublicIp =
    parsePeerPodsBool(values.USE_PUBLIC_IP ?? existing?.data?.USE_PUBLIC_IP) === true;
  // Azure is the only provider where confidential VMs are a choice, and it was never surfaced: the
  // wizard wrote no DISABLECVM at all, leaving the cloud-api-adaptor's own default in charge with no
  // way to opt out from the UI (issue #68). Off unless the config map already asks for it —
  // DISABLECVM=false being the ask, in any spelling the adaptor would accept.
  const azureConfidential =
    parsePeerPodsBool(values.DISABLECVM ?? existing?.data?.DISABLECVM) === false;

  const data: Record<string, string> = { CLOUD_PROVIDER: provider };
  [...FIELDS[provider], ...ADVANCED_FIELDS[provider]].forEach((f) => {
    const raw = fieldVal(f.key).trim();
    const v = f.list ? normalizeCsvList(raw) : raw;
    if (v) data[f.key] = v;
  });
  data.VXLAN_PORT = fieldVal('VXLAN_PORT').trim() || DEFAULTS.VXLAN_PORT;
  data.PROXY_TIMEOUT = fieldVal('PROXY_TIMEOUT').trim() || DEFAULTS.PROXY_TIMEOUT;
  data.PEERPODS_LIMIT_PER_NODE =
    fieldVal('PEERPODS_LIMIT_PER_NODE').trim() || DEFAULTS.PEERPODS_LIMIT_PER_NODE;
  data.ROOT_VOLUME_SIZE = fieldVal('ROOT_VOLUME_SIZE').trim() || DEFAULTS.ROOT_VOLUME_SIZE;
  // AWS and GCP peer pods have no confidential-VM support in OSC 1.12, so they run without a TEE and
  // the cloud-api-adaptor requires DISABLECVM="true" (AWS docs §3.2 "Creating the peer pods config
  // map"). Azure supports Confidential VM sizes, so the user picks — but write the answer either
  // way, so the config map states it outright instead of inheriting a default nobody chose (#68).
  if (provider === 'aws' || provider === 'gcp') data.DISABLECVM = 'true';
  else if (provider === 'azure') data.DISABLECVM = azureConfidential ? 'false' : 'true';
  // Write both directions. Setting the key only when true meant switching it back off left the old
  // "true" in place through the merge below, so the wizard showed off while the cluster stayed on.
  data.USE_PUBLIC_IP = usePublicIp ? 'true' : 'false';
  // The operator fills PODVM_AMI_ID in after KataConfig runs, so the user doesn't (issue #28). Seed
  // an empty key on a brand-new AWS config map so the operator populates it; never overwrite a value
  // already present (operator-written, or a custom AMI pinned under Advanced options).
  if (
    provider === 'aws' &&
    data.PODVM_AMI_ID === undefined &&
    existing?.data?.PODVM_AMI_ID === undefined
  )
    data.PODVM_AMI_ID = '';
  // Same for Azure: the operator builds a pod VM image and fills AZURE_IMAGE_ID after KataConfig
  // runs, so seed an empty key on a brand-new config map and never overwrite an existing value.
  if (
    provider === 'azure' &&
    data.AZURE_IMAGE_ID === undefined &&
    existing?.data?.AZURE_IMAGE_ID === undefined
  )
    data.AZURE_IMAGE_ID = '';

  const cm: ConfigMapKind & K8sResourceCommon = existing
    ? { ...existing, data: { ...existing.data, ...data } }
    : {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: PEER_PODS_CM, namespace: OSC_NAMESPACE },
        data,
      };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (existing) {
        await k8sUpdate({ model: ConfigMapModel, data: cm });
      } else {
        await k8sCreate({ model: ConfigMapModel, data: cm });
      }
      navigate('/sandboxes/setup');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DocumentTitle>{t('Configure peer pods')}</DocumentTitle>
      <ListPageHeader title={t('Configure peer pods')} />
      <PageSection>
        <Grid hasGutter>
          <GridItem md={6}>
            <Card>
              <CardTitle>{existing ? t('Edit peer-pods-cm') : t('Create peer-pods-cm')}</CardTitle>
              <CardBody>
                <Form>
                  <FormGroup label={t('Cloud provider')} fieldId="pp-provider">
                    <FormSelect
                      id="pp-provider"
                      value={provider}
                      onChange={(_e, v) => {
                        set('CLOUD_PROVIDER', v);
                      }}
                    >
                      <FormSelectOption value="gcp" label="Google Cloud (gcp)" />
                      <FormSelectOption value="aws" label="AWS (aws)" />
                      <FormSelectOption value="azure" label="Azure (azure)" />
                    </FormSelect>
                  </FormGroup>

                  {provider === 'azure' && (
                    <Alert
                      isInline
                      variant="info"
                      title={t('Azure peer pods need outbound connectivity')}
                    >
                      {t(
                        'The peer-pod VM pulls the workload image itself, so the subnet in AZURE_SUBNET_ID must have outbound internet access — configure a NAT gateway on it. Without one, pods fail to start with an image-pull timeout. This is an Azure-infra prerequisite the plugin cannot configure.',
                      )}{' '}
                      <Button
                        variant="link"
                        isInline
                        component="a"
                        href={AZURE_DEPLOY_DOCS}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('Outbound connections (docs)')}
                      </Button>
                    </Alert>
                  )}

                  {FIELDS[provider].map((f) => (
                    <FormGroup key={f.key} label={t(f.label)} fieldId={`pp-${f.key}`}>
                      <TextInput
                        id={`pp-${f.key}`}
                        value={fieldVal(f.key)}
                        placeholder={f.placeholder}
                        onChange={(_e, v) => {
                          set(f.key, v);
                        }}
                      />
                      {f.help && (
                        <FormHelperText>
                          <HelperText>
                            <HelperTextItem>{t(f.help)}</HelperTextItem>
                          </HelperText>
                        </FormHelperText>
                      )}
                    </FormGroup>
                  ))}

                  {provider === 'azure' && (
                    <FormGroup label={t('Confidential computing')} fieldId="pp-cvm">
                      <Switch
                        id="pp-cvm"
                        isChecked={azureConfidential}
                        onChange={(_e, c) => {
                          set('DISABLECVM', c ? 'false' : 'true');
                        }}
                        label={t('Run pod VMs as Azure Confidential VMs (DISABLECVM=false)')}
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'Off by default: peer pods run on ordinary VM sizes, like AWS and Google Cloud. Turn it on to run each pod VM inside a hardware TEE — the instance sizes above must then be Confidential VM sizes, and the operator needs a confidential pod VM image. Either way the choice is written to the config map, so it is never left implicit.',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                  )}

                  {provider === 'aws' && (
                    <>
                      <p className="osc-openshift-console-plugin__muted osc-openshift-console-plugin__mb">
                        {t(
                          'Prefilled from your cluster where available. On IPI clusters the subnet, VPC, and security groups are referenced by tag, not by id, so they can’t be read from the cluster — fetch them from AWS, or fill them in with the CLI below. Pod VM AMI ID is added automatically by the operator after KataConfig runs (pin a custom AMI under Advanced options if needed).',
                        )}
                      </p>
                      <FetchAwsNetworking
                        region={fieldVal('AWS_REGION')}
                        onFetched={(r) => {
                          setValues((prev) => ({
                            ...prev,
                            ...(r.subnetId ? { AWS_SUBNET_ID: r.subnetId } : {}),
                            ...(r.vpcId ? { AWS_VPC_ID: r.vpcId } : {}),
                            ...(r.sgIds ? { AWS_SG_IDS: r.sgIds } : {}),
                          }));
                        }}
                      />
                      <ExpandableSection
                        className="osc-openshift-console-plugin__mt"
                        toggleText={t('Fetch subnet, VPC, and security group IDs with the AWS CLI')}
                        isExpanded={cliOpen}
                        onToggle={(_e, x) => {
                          setCliOpen(x);
                        }}
                      >
                        <CodeBlock>
                          <CodeBlockCode>{AWS_DESCRIBE_CLI}</CodeBlockCode>
                        </CodeBlock>
                      </ExpandableSection>
                    </>
                  )}

                  <ExpandableSection
                    toggleText={t('Advanced options')}
                    isExpanded={advancedOpen}
                    onToggle={(_e, x) => {
                      setAdvancedOpen(x);
                    }}
                  >
                    {ADVANCED_FIELDS[provider].map((f) => (
                      <FormGroup key={f.key} label={t(f.label)} fieldId={`pp-${f.key}`}>
                        <TextInput
                          id={`pp-${f.key}`}
                          value={fieldVal(f.key)}
                          placeholder={f.placeholder}
                          onChange={(_e, v) => {
                            set(f.key, v);
                          }}
                        />
                        {f.help && (
                          <FormHelperText>
                            <HelperText>
                              <HelperTextItem>{t(f.help)}</HelperTextItem>
                            </HelperText>
                          </FormHelperText>
                        )}
                      </FormGroup>
                    ))}

                    <FormGroup label={t('Peer pods per node')} fieldId="pp-limit">
                      <TextInput
                        id="pp-limit"
                        type="number"
                        value={fieldVal('PEERPODS_LIMIT_PER_NODE')}
                        onChange={(_e, v) => {
                          set('PEERPODS_LIMIT_PER_NODE', v);
                        }}
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'PEERPODS_LIMIT_PER_NODE — maximum pod VMs per worker (default 10).',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                    <FormGroup label={t('Root volume size (GB)')} fieldId="pp-rootvol">
                      <TextInput
                        id="pp-rootvol"
                        type="number"
                        value={fieldVal('ROOT_VOLUME_SIZE')}
                        onChange={(_e, v) => {
                          set('ROOT_VOLUME_SIZE', v);
                        }}
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'ROOT_VOLUME_SIZE — pod VM root disk in GB (default and minimum 6).',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                    <FormGroup label={t('VXLAN port')} fieldId="pp-vxlan">
                      <TextInput
                        id="pp-vxlan"
                        value={fieldVal('VXLAN_PORT')}
                        onChange={(_e, v) => {
                          set('VXLAN_PORT', v);
                        }}
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'Overlay (VXLAN) UDP port between worker and pod VM (default 9000).',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                    <FormGroup label={t('Proxy timeout')} fieldId="pp-proxy">
                      <TextInput
                        id="pp-proxy"
                        value={fieldVal('PROXY_TIMEOUT')}
                        onChange={(_e, v) => {
                          set('PROXY_TIMEOUT', v);
                        }}
                      />
                    </FormGroup>
                    <FormGroup label={t('Use public IP')} fieldId="pp-pubip">
                      <Switch
                        id="pp-pubip"
                        isChecked={usePublicIp}
                        onChange={(_e, c) => {
                          set('USE_PUBLIC_IP', c ? 'true' : 'false');
                        }}
                        label={t('Reach pod VMs over their public IP')}
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'Independent of the fields above. Turn on only when pod VMs run in a separate VPC or network with no private route from your workers — the cloud-api-adaptor then reaches them over their public IP. Leave off for same-VPC peer pods.',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                  </ExpandableSection>

                  {error && (
                    <Alert variant="danger" isInline title={t('Could not save peer-pods-cm')}>
                      {error}
                    </Alert>
                  )}

                  <ActionGroup>
                    <Button
                      variant="primary"
                      onClick={() => void save()}
                      isLoading={busy}
                      isDisabled={busy || !loaded}
                    >
                      {existing ? t('Save') : t('Create')}
                    </Button>
                    <Button
                      variant="link"
                      onClick={() => {
                        navigate('/sandboxes/setup');
                      }}
                    >
                      {t('Cancel')}
                    </Button>
                  </ActionGroup>
                </Form>
              </CardBody>
            </Card>
          </GridItem>
          <GridItem md={6}>
            <Card>
              <CardTitle>{t('Manifest preview')}</CardTitle>
              <CardBody>
                <p className="osc-openshift-console-plugin__muted osc-openshift-console-plugin__mb">
                  {t(
                    'The operator reconciles the cloud-api-adaptor DaemonSet from this ConfigMap. On Google Cloud, credentials are minted automatically by the Cloud Credential Operator — no peer-pods-secret is needed unless you removed the CCO. The operator builds and registers the pod VM image automatically when KataConfig installs — no separate image config needed.',
                  )}
                </p>
                <CodeBlock>
                  <CodeBlockCode>{toYaml(cm)}</CodeBlockCode>
                </CodeBlock>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default PeerPodsConfigWizard;
