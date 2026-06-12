import {
  DocumentTitle,
  ListPageHeader,
  ResourceLink,
  Timestamp,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Grid,
  GridItem,
  Label,
  PageSection,
} from '@patternfly/react-core';
import type { FC } from 'react';
import { useParams } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import { useRuntimeClasses, usePeerPodIndex } from '../k8s/hooks';
import { DeploymentGVK, PodGVK } from '../k8s/resources';
import type { DeploymentKind, PodKind } from '../k8s/types';
import { buildIsolationMap, isolationDescription } from '../utils/runtime';
import { IsolationLabel } from './IsolationLabel';
import { WorkloadMetrics } from './WorkloadMetrics';
import './sandbox.css';

const SandboxWorkloadDetail: FC = () => {
  const { t } = useTranslation('plugin__osc-plugin');
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
  const status = isPod
    ? (obj as PodKind)?.status?.phase
    : `${(obj as DeploymentKind)?.status?.readyReplicas ?? 0}/${
        (obj as DeploymentKind)?.spec?.replicas ?? 0
      } ${t('ready')}`;

  return (
    <>
      <DocumentTitle>{name ?? ''}</DocumentTitle>
      <ListPageHeader title={name ?? ''}>
        <IsolationLabel isolation={isolation} />
      </ListPageHeader>
      <PageSection>
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
                      <div className="osc-plugin__muted">{isolationDescription(isolation)}</div>
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

          <GridItem span={12}>
            <Card>
              <CardTitle>{t('Live metrics')}</CardTitle>
              <CardBody>
                <WorkloadMetrics
                  kind={isPod ? 'Pod' : 'Deployment'}
                  name={name ?? ''}
                  namespace={ns ?? ''}
                  isPeerPod={isPeerPod}
                />
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default SandboxWorkloadDetail;
