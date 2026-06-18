import {
  DocumentTitle,
  k8sCreate,
  k8sPatch,
  ListPageHeader,
  useK8sWatchResource,
  type K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  ActionGroup,
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
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
  Radio,
  Switch,
  TextInput,
} from '@patternfly/react-core';
import type { FC } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import { KATA_NODE_LABEL, KataConfigModel, NodeGVK, NodeModel } from '../k8s/resources';
import type { NodeKind } from '../k8s/types';
import { toYaml } from '../utils/yaml';
import './sandbox.css';

const WORKER_LABEL = 'node-role.kubernetes.io/worker';

const KataConfigWizard: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const navigate = useNavigate();

  const [name, setName] = useState('example-kataconfig');
  const [enablePeerPods, setEnablePeerPods] = useState(true);
  const [checkNodeEligibility, setCheckNodeEligibility] = useState(false);
  const [logLevel, setLogLevel] = useState('info');
  const [nodeMode, setNodeMode] = useState<'all' | 'specific'>('all');
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [poolLabelKey, setPoolLabelKey] = useState('');
  const [poolLabelValue, setPoolLabelValue] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const [nodes] = useK8sWatchResource<NodeKind[]>({ groupVersionKind: NodeGVK, isList: true });
  const workerNodes = (nodes ?? []).filter((n) =>
    Object.keys(n.metadata?.labels ?? {}).includes(WORKER_LABEL),
  );
  // A hand-picked node set is targeted by labeling those nodes and selecting on that label.
  const useSpecificNodes = nodeMode === 'specific' && selectedNodes.length > 0;

  const toggleNode = (node: string, checked: boolean) => {
    setSelectedNodes((prev) =>
      checked ? Array.from(new Set([...prev, node])) : prev.filter((n) => n !== node),
    );
  };

  const spec: Record<string, unknown> = { enablePeerPods, checkNodeEligibility, logLevel };
  if (useSpecificNodes) {
    spec.kataConfigPoolSelector = { matchLabels: { [KATA_NODE_LABEL]: 'true' } };
  } else if (poolLabelKey.trim()) {
    spec.kataConfigPoolSelector = {
      matchLabels: { [poolLabelKey.trim()]: poolLabelValue.trim() },
    };
  }

  const manifest: K8sResourceCommon & Record<string, unknown> = {
    apiVersion: 'kataconfiguration.openshift.io/v1',
    kind: 'KataConfig',
    metadata: { name: name.trim() },
    spec,
  };

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // Label the hand-picked nodes so KataConfig's pool selector matches exactly them.
      if (useSpecificNodes) {
        await Promise.all(
          selectedNodes.map((node) =>
            k8sPatch({
              model: NodeModel,
              resource: { apiVersion: 'v1', kind: 'Node', metadata: { name: node } },
              data: [{ op: 'add', path: `/metadata/labels/${KATA_NODE_LABEL}`, value: 'true' }],
            }),
          ),
        );
      }
      await k8sCreate({ model: KataConfigModel, data: manifest });
      navigate('/sandboxes');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DocumentTitle>{t('Create KataConfig')}</DocumentTitle>
      <ListPageHeader title={t('Create KataConfig')} />
      <PageSection>
        <Alert
          variant="warning"
          isInline
          title={t('Creating a KataConfig reboots your worker nodes')}
          className="osc-openshift-console-plugin__mb"
        >
          {t(
            'Installing the Kata runtime drains and reboots each eligible node — this can take from 10 to 60+ minutes. Track progress on the Sandboxes overview.',
          )}
        </Alert>
        <Grid hasGutter>
          <GridItem md={6}>
            <Card>
              <CardTitle>{t('KataConfig')}</CardTitle>
              <CardBody>
                <Form>
                  <FormGroup label={t('Name')} isRequired fieldId="kc-name">
                    <TextInput
                      id="kc-name"
                      value={name}
                      onChange={(_e, v) => {
                        setName(v);
                      }}
                    />
                  </FormGroup>
                  <FormGroup label={t('Enable peer pods')} fieldId="kc-peerpods">
                    <Switch
                      id="kc-peerpods"
                      isChecked={enablePeerPods}
                      onChange={(_e, c) => {
                        setEnablePeerPods(c);
                      }}
                      label={t('Run pods as cloud VMs (kata-remote) via the cloud-api-adaptor')}
                    />
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {t(
                            'Required on clouds without nested virtualization (e.g. most GCP/AWS/Azure). Create the peer-pods-cm before this KataConfig. It installs both runtime classes — kata-remote (peer pods) and kata (on-node) — so one cluster can run either, chosen per workload by its runtimeClassName.',
                          )}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>

                  <FormGroup label={t('Install on')} isInline fieldId="kc-node-mode">
                    <Radio
                      id="kc-nodes-all"
                      name="kc-node-mode"
                      label={t('All worker nodes')}
                      isChecked={nodeMode === 'all'}
                      onChange={() => {
                        setNodeMode('all');
                      }}
                    />
                    <Radio
                      id="kc-nodes-specific"
                      name="kc-node-mode"
                      label={t('Specific nodes')}
                      isChecked={nodeMode === 'specific'}
                      onChange={() => {
                        setNodeMode('specific');
                      }}
                    />
                  </FormGroup>
                  {nodeMode === 'specific' && (
                    <FormGroup fieldId="kc-node-list">
                      {workerNodes.length === 0 ? (
                        <HelperText>
                          <HelperTextItem>{t('No worker nodes found.')}</HelperTextItem>
                        </HelperText>
                      ) : (
                        <div className="osc-openshift-console-plugin__node-list">
                          {workerNodes.map((n) => {
                            const nodeName = n.metadata?.name ?? '';
                            return (
                              <Checkbox
                                key={nodeName}
                                id={`kc-node-${nodeName}`}
                                label={nodeName}
                                isChecked={selectedNodes.includes(nodeName)}
                                onChange={(_e, c) => {
                                  toggleNode(nodeName, c);
                                }}
                              />
                            );
                          })}
                        </div>
                      )}
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'The runtime installs only on the nodes you pick — each is labeled {{label}}=true and reboots once. Other workers are untouched.',
                              { label: KATA_NODE_LABEL },
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                  )}

                  <FormGroup label={t('Check node eligibility')} fieldId="kc-eligibility">
                    <Switch
                      id="kc-eligibility"
                      isChecked={checkNodeEligibility}
                      onChange={(_e, c) => {
                        setCheckNodeEligibility(c);
                      }}
                      label={t(
                        'Only install on nodes labeled feature.node.kubernetes.io/runtime.kata=true',
                      )}
                    />
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {t(
                            'Requires Node Feature Discovery (NFD): it labels virt-capable nodes with that label, and the runtime installs only there. Leave this off if NFD is not installed — or pick Specific nodes above instead.',
                          )}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>
                  <FormGroup label={t('Log level')} fieldId="kc-loglevel">
                    <FormSelect
                      id="kc-loglevel"
                      value={logLevel}
                      onChange={(_e, v) => {
                        setLogLevel(v);
                      }}
                    >
                      <FormSelectOption value="info" label="info" />
                      <FormSelectOption value="debug" label="debug" />
                    </FormSelect>
                  </FormGroup>

                  <ExpandableSection
                    toggleText={t('Advanced options')}
                    isExpanded={advancedOpen}
                    onToggle={(_e, x) => {
                      setAdvancedOpen(x);
                    }}
                  >
                    <FormGroup label={t('Node selector label')} fieldId="kc-pool-key">
                      <TextInput
                        id="kc-pool-key"
                        value={poolLabelKey}
                        placeholder="node-role.kubernetes.io/worker"
                        onChange={(_e, v) => {
                          setPoolLabelKey(v);
                        }}
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'Optional kataConfigPoolSelector. Leave empty to install on all worker nodes. Ignored when you pick Specific nodes above.',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                    <FormGroup label={t('Node selector value')} fieldId="kc-pool-value">
                      <TextInput
                        id="kc-pool-value"
                        value={poolLabelValue}
                        onChange={(_e, v) => {
                          setPoolLabelValue(v);
                        }}
                      />
                    </FormGroup>
                  </ExpandableSection>

                  {error && (
                    <Alert variant="danger" isInline title={t('Could not create KataConfig')}>
                      {error}
                    </Alert>
                  )}

                  <ActionGroup>
                    <Button
                      variant="primary"
                      onClick={() => void create()}
                      isLoading={busy}
                      isDisabled={
                        busy ||
                        name.trim() === '' ||
                        (nodeMode === 'specific' && selectedNodes.length === 0)
                      }
                    >
                      {t('Create')}
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
                <CodeBlock>
                  <CodeBlockCode>{toYaml(manifest)}</CodeBlockCode>
                </CodeBlock>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default KataConfigWizard;
