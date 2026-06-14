import {
  DocumentTitle,
  k8sCreate,
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
import { KataConfigModel } from '../k8s/resources';
import { toYaml } from '../utils/yaml';
import './sandbox.css';

const KataConfigWizard: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const navigate = useNavigate();

  const [name, setName] = useState('example-kataconfig');
  const [enablePeerPods, setEnablePeerPods] = useState(true);
  const [checkNodeEligibility, setCheckNodeEligibility] = useState(false);
  const [logLevel, setLogLevel] = useState('info');
  const [poolLabelKey, setPoolLabelKey] = useState('');
  const [poolLabelValue, setPoolLabelValue] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const spec: Record<string, unknown> = { enablePeerPods, checkNodeEligibility, logLevel };
  if (poolLabelKey.trim()) {
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
                            'Required on clouds without nested virtualization (e.g. most GCP/AWS/Azure). Create the peer-pods-cm and podvm-image-cm before this KataConfig so the operator can launch pod VMs.',
                          )}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>
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
                              'Optional kataConfigPoolSelector. Leave empty to install kata-remote on all worker nodes.',
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
                      isDisabled={busy || name.trim() === ''}
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
