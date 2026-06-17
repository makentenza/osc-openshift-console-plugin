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
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ConfigMapModel, OSC_NAMESPACE, PEER_PODS_CM } from '../k8s/resources';
import type { ConfigMapKind } from '../k8s/types';
import { useClusterPlatform, useGcpNetworking, usePeerPodsCm } from '../k8s/setup';
import { toYaml } from '../utils/yaml';
import './sandbox.css';

interface Field {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
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
      help: 'Auto-mode VPC network the pod VMs join. The 1.12 docs support only auto-mode networks.',
    },
  ],
  aws: [
    { key: 'AWS_REGION', label: 'Region' },
    { key: 'PODVM_INSTANCE_TYPE', label: 'Instance type', placeholder: 't3.medium' },
    { key: 'AWS_SUBNET_ID', label: 'Subnet ID' },
    { key: 'AWS_VPC_ID', label: 'VPC ID' },
    { key: 'AWS_SG_IDS', label: 'Security group IDs' },
    { key: 'PODVM_AMI_ID', label: 'Pod VM AMI ID' },
  ],
  azure: [
    { key: 'AZURE_SUBSCRIPTION_ID', label: 'Subscription ID' },
    { key: 'AZURE_REGION', label: 'Region' },
    { key: 'AZURE_RESOURCE_GROUP', label: 'Resource group' },
    { key: 'AZURE_SUBNET_ID', label: 'Subnet ID' },
    { key: 'AZURE_NSG_ID', label: 'Network security group ID' },
    { key: 'AZURE_INSTANCE_SIZE', label: 'Instance size', placeholder: 'Standard_D2as_v5' },
    { key: 'AZURE_IMAGE_ID', label: 'Pod VM image ID' },
  ],
};

// Optional provider-specific keys, surfaced under "Advanced options".
const ADVANCED_FIELDS: Record<string, Field[]> = {
  gcp: [
    {
      key: 'GCP_SUBNETWORK',
      label: 'Subnetwork (custom VPC only)',
      help: 'Leave empty for auto-mode networks. Set this only for a custom VPC — you must also open the peer-pods firewall ports on its subnet.',
    },
    {
      key: 'TAGS',
      label: 'Instance tags',
      placeholder: 'key1=value1,key2=value2',
      help: 'Optional key=value tags applied to pod VM instances, e.g. to track cost or identify peer pods across clusters.',
    },
  ],
  aws: [],
  azure: [],
};

const DEFAULTS: Record<string, string> = {
  VXLAN_PORT: '9000',
  PROXY_TIMEOUT: '5m',
  PEERPODS_LIMIT_PER_NODE: '10',
  ROOT_VOLUME_SIZE: '6',
  GCP_MACHINE_TYPE: 'e2-medium',
};

const PeerPodsConfigWizard: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const navigate = useNavigate();
  const [existing, loaded] = usePeerPodsCm();
  const gcp = useGcpNetworking();
  const platform = useClusterPlatform();

  const [values, setValues] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  const fieldVal = (key: string): string => {
    if (values[key] !== undefined) return values[key];
    if (existing?.data?.[key] !== undefined) return existing.data[key];
    if (provider === 'gcp' && gcpPrefill[key]) return gcpPrefill[key];
    return DEFAULTS[key] ?? '';
  };
  const set = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  const disableCvm = (values.DISABLECVM ?? existing?.data?.DISABLECVM ?? 'true') === 'true';
  const usePublicIp = (values.USE_PUBLIC_IP ?? existing?.data?.USE_PUBLIC_IP) === 'true';

  const data: Record<string, string> = { CLOUD_PROVIDER: provider };
  [...FIELDS[provider], ...ADVANCED_FIELDS[provider]].forEach((f) => {
    const v = fieldVal(f.key).trim();
    if (v) data[f.key] = v;
  });
  data.VXLAN_PORT = fieldVal('VXLAN_PORT').trim() || DEFAULTS.VXLAN_PORT;
  data.PROXY_TIMEOUT = fieldVal('PROXY_TIMEOUT').trim() || DEFAULTS.PROXY_TIMEOUT;
  data.PEERPODS_LIMIT_PER_NODE =
    fieldVal('PEERPODS_LIMIT_PER_NODE').trim() || DEFAULTS.PEERPODS_LIMIT_PER_NODE;
  data.ROOT_VOLUME_SIZE = fieldVal('ROOT_VOLUME_SIZE').trim() || DEFAULTS.ROOT_VOLUME_SIZE;
  data.DISABLECVM = disableCvm ? 'true' : 'false';
  if (usePublicIp) data.USE_PUBLIC_IP = 'true';

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
      void navigate('/sandboxes/setup');
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

                  <FormGroup label={t('Disable confidential VM (CVM)')} fieldId="pp-disablecvm">
                    <Switch
                      id="pp-disablecvm"
                      isChecked={disableCvm}
                      onChange={(_e, c) => {
                        set('DISABLECVM', c ? 'true' : 'false');
                      }}
                      label={t('Run regular (non-confidential) pod VMs')}
                    />
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {t(
                            'Keep this on for sandboxed containers. Confidential Containers sets DISABLECVM to false to boot pod VMs inside a TEE.',
                          )}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>

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
                        label={t(
                          'Reach pod VMs over their public IP (only if they are on a different VPC)',
                        )}
                      />
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
                        void navigate('/sandboxes/setup');
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
