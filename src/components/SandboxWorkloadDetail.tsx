import {
  DocumentTitle,
  k8sDelete,
  k8sPatch,
  ListPageHeader,
  ResourceEventStream,
  ResourceLink,
  ResourceYAMLEditor,
  Timestamp,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Breadcrumb,
  BreadcrumbItem,
  Button,
  Card,
  CardBody,
  CardTitle,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  NumberInput,
  PageSection,
  Tab,
  Tabs,
  TabTitleText,
} from '@patternfly/react-core';
import type { FC } from 'react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import { useRuntimeClasses, usePeerPodIndex } from '../k8s/hooks';
import { DeploymentGVK, DeploymentModel, PodGVK, PodModel } from '../k8s/resources';
import type { DeploymentKind, PodKind } from '../k8s/types';
import { buildIsolationMap, isolationDescription } from '../utils/runtime';
import { ContainerStatuses } from './ContainerStatuses';
import { IsolationLabel } from './IsolationLabel';
import { WorkloadMetrics } from './WorkloadMetrics';
import './sandbox.css';

const YAMLFallback: FC<{ obj: unknown }> = ({ obj }) => (
  <CodeBlock>
    <CodeBlockCode>{JSON.stringify(obj, null, 2)}</CodeBlockCode>
  </CodeBlock>
);

const SandboxWorkloadDetail: FC = () => {
  const { t } = useTranslation('plugin__osc-plugin');
  const navigate = useNavigate();
  const { kind, ns, name } = useParams();
  const isPod = kind === 'Pod';
  const [runtimeClasses] = useRuntimeClasses();
  const peerPods = usePeerPodIndex();

  const [obj] = useK8sWatchResource<PodKind | DeploymentKind>({
    groupVersionKind: isPod ? PodGVK : DeploymentGVK,
    name,
    namespace: ns,
  });

  const rc = isPod
    ? (obj as PodKind)?.spec?.runtimeClassName
    : (obj as DeploymentKind)?.spec?.template?.spec?.runtimeClassName;
  const isolation = buildIsolationMap(runtimeClasses)[rc ?? ''] ?? 'unknown';
  const isPeerPod = isolation === 'peerpod';
  const peerPod = isPod ? peerPods[`${ns}/${name}`] : undefined;
  const nodeName = isPod ? (obj as PodKind)?.spec?.nodeName : undefined;
  const image = isPod
    ? (obj as PodKind)?.spec?.containers?.[0]?.image
    : (obj as DeploymentKind)?.spec?.template?.spec?.containers?.[0]?.image;
  const currentReplicas = !isPod ? ((obj as DeploymentKind)?.spec?.replicas ?? 1) : 0;
  const status = isPod
    ? (obj as PodKind)?.status?.phase
    : `${(obj as DeploymentKind)?.status?.readyReplicas ?? 0}/${currentReplicas} ${t('ready')}`;

  const [activeTab, setActiveTab] = useState<string | number>('details');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [scaleValue, setScaleValue] = useState(currentReplicas);
  const [scaling, setScaling] = useState(false);

  const doDelete = async () => {
    if (!obj) return;
    setDeleting(true);
    try {
      await k8sDelete({ model: isPod ? PodModel : DeploymentModel, resource: obj });
      void navigate('/sandboxes/workloads');
    } finally {
      setDeleting(false);
    }
  };

  const doScale = async () => {
    if (!obj) return;
    setScaling(true);
    try {
      await k8sPatch({
        model: DeploymentModel,
        resource: obj as DeploymentKind,
        data: [{ op: 'replace', path: '/spec/replicas', value: scaleValue }],
      });
      setScaleOpen(false);
    } finally {
      setScaling(false);
    }
  };

  return (
    <>
      <DocumentTitle>{name ?? ''}</DocumentTitle>
      <PageSection className="osc-plugin__breadcrumb-section">
        <Breadcrumb>
          <BreadcrumbItem>
            <Link to="/sandboxes">{t('Sandboxes')}</Link>
          </BreadcrumbItem>
          <BreadcrumbItem>
            <Link to="/sandboxes/workloads">{t('Workloads')}</Link>
          </BreadcrumbItem>
          <BreadcrumbItem isActive>{name}</BreadcrumbItem>
        </Breadcrumb>
      </PageSection>
      <ListPageHeader title={name ?? ''}>
        <Flex gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <IsolationLabel isolation={isolation} />
          </FlexItem>
          {!isPod && (
            <FlexItem>
              <Button
                variant="secondary"
                onClick={() => {
                  setScaleValue(currentReplicas);
                  setScaleOpen(true);
                }}
              >
                {t('Scale')}
              </Button>
            </FlexItem>
          )}
          <FlexItem>
            <Button
              variant="danger"
              onClick={() => {
                setDeleteOpen(true);
              }}
            >
              {t('Delete')}
            </Button>
          </FlexItem>
        </Flex>
      </ListPageHeader>

      <PageSection>
        <Tabs
          activeKey={activeTab}
          onSelect={(_e, k) => {
            setActiveTab(k);
          }}
          mountOnEnter
          unmountOnExit
        >
          <Tab eventKey="details" title={<TabTitleText>{t('Details')}</TabTitleText>}>
            <div className="osc-plugin__detail-tabs">
              <Grid hasGutter>
                <GridItem span={6}>
                  <Card>
                    <CardTitle>{t('Sandbox')}</CardTitle>
                    <CardBody>
                      <DescriptionList isHorizontal>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Resource')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            <ResourceLink
                              groupVersionKind={isPod ? PodGVK : DeploymentGVK}
                              name={name}
                              namespace={ns}
                              linkTo
                            />
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Runtime class')}</DescriptionListTerm>
                          <DescriptionListDescription>{rc ?? '—'}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Isolation')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            <IsolationLabel isolation={isolation} />
                            <div className="osc-plugin__muted">
                              {isolationDescription(isolation)}
                            </div>
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Status')}</DescriptionListTerm>
                          <DescriptionListDescription>{status}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Image')}</DescriptionListTerm>
                          <DescriptionListDescription className="osc-plugin__mono">
                            {image ?? '—'}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Created')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            <Timestamp timestamp={obj?.metadata?.creationTimestamp} />
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </CardBody>
                  </Card>
                </GridItem>

                <GridItem span={6}>
                  <Card>
                    <CardTitle>{t('Backing infrastructure')}</CardTitle>
                    <CardBody>
                      {isPeerPod ? (
                        <DescriptionList isHorizontal>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Placement')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              <Label color="blue">{t('Peer pod (remote cloud VM)')}</Label>
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Cloud provider')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {peerPod?.spec?.cloudProvider ?? '—'}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Backing VM instance')}</DescriptionListTerm>
                            <DescriptionListDescription className="osc-plugin__mono">
                              {peerPod?.spec?.instanceID ?? t('(provisioning…)')}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                        </DescriptionList>
                      ) : (
                        <DescriptionList isHorizontal>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Placement')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              <Label color="green">{t('On-node microVM (QEMU/KVM)')}</Label>
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t('Node')}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {nodeName ? (
                                <ResourceLink
                                  groupVersionKind={{ version: 'v1', kind: 'Node' }}
                                  name={nodeName}
                                  linkTo
                                />
                              ) : isPod ? (
                                '—'
                              ) : (
                                t('Varies per replica')
                              )}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                        </DescriptionList>
                      )}
                    </CardBody>
                  </Card>
                </GridItem>

                {isPod && obj && (
                  <GridItem span={12}>
                    <Card>
                      <CardTitle>{t('Container statuses')}</CardTitle>
                      <CardBody>
                        <ContainerStatuses pod={obj as PodKind} />
                      </CardBody>
                    </Card>
                  </GridItem>
                )}
              </Grid>
            </div>
          </Tab>

          <Tab eventKey="metrics" title={<TabTitleText>{t('Metrics')}</TabTitleText>}>
            <div className="osc-plugin__detail-tabs">
              <WorkloadMetrics
                kind={isPod ? 'Pod' : 'Deployment'}
                name={name ?? ''}
                namespace={ns ?? ''}
                isPeerPod={isPeerPod}
              />
            </div>
          </Tab>

          <Tab eventKey="events" title={<TabTitleText>{t('Events')}</TabTitleText>}>
            <div className="osc-plugin__detail-tabs">
              {obj ? (
                <ResourceEventStream resource={obj} />
              ) : (
                <span className="osc-plugin__muted">{t('Loading…')}</span>
              )}
            </div>
          </Tab>

          <Tab eventKey="yaml" title={<TabTitleText>{t('YAML')}</TabTitleText>}>
            <div className="osc-plugin__detail-tabs">
              {obj ? (
                <ResourceYAMLEditor initialResource={obj} readOnly />
              ) : (
                <YAMLFallback obj={obj} />
              )}
            </div>
          </Tab>
        </Tabs>
      </PageSection>

      {deleteOpen && (
        <Modal
          isOpen
          variant="small"
          onClose={() => {
            setDeleteOpen(false);
          }}
        >
          <ModalHeader title={t('Delete sandboxed workload?')} />
          <ModalBody>
            {t('Delete {{kind}} {{name}} in {{namespace}}? Its sandbox VM will be torn down.', {
              kind,
              name,
              namespace: ns,
            })}
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" onClick={() => void doDelete()} isLoading={deleting}>
              {t('Delete')}
            </Button>
            <Button
              variant="link"
              onClick={() => {
                setDeleteOpen(false);
              }}
            >
              {t('Cancel')}
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {scaleOpen && (
        <Modal
          isOpen
          variant="small"
          onClose={() => {
            setScaleOpen(false);
          }}
        >
          <ModalHeader title={t('Scale {{name}}', { name })} />
          <ModalBody>
            <p className="osc-plugin__mb">{t('Set the number of replicas for this deployment.')}</p>
            <NumberInput
              value={scaleValue}
              min={0}
              onMinus={() => {
                setScaleValue(Math.max(0, scaleValue - 1));
              }}
              onPlus={() => {
                setScaleValue(scaleValue + 1);
              }}
              onChange={(e) => {
                setScaleValue(Number((e.target as HTMLInputElement).value) || 0);
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="primary" onClick={() => void doScale()} isLoading={scaling}>
              {t('Scale')}
            </Button>
            <Button
              variant="link"
              onClick={() => {
                setScaleOpen(false);
              }}
            >
              {t('Cancel')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
};

export default SandboxWorkloadDetail;
