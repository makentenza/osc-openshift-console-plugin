import {
  DocumentTitle,
  ListPageHeader,
  ResourceLink,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  Label,
  PageSection,
  Title,
} from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@patternfly/react-icons';
import type { FC } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useKataConfig, useRuntimeClasses, useSandboxWorkloads } from '../k8s/hooks';
import { CAA_DAEMONSET, DaemonSetGVK, OSC_NAMESPACE } from '../k8s/resources';
import type { DaemonSetKind } from '../k8s/types';
import { isSandboxRuntimeClass, isolationForHandler } from '../utils/runtime';
import { IsolationLabel } from './IsolationLabel';
import './sandbox.css';

const StatTile: FC<{ value: number | string; label: string }> = ({ value, label }) => (
  <Card isCompact className="osc-plugin__stat">
    <CardBody>
      <div className="osc-plugin__stat-value">{value}</div>
      <div className="osc-plugin__stat-label">{label}</div>
    </CardBody>
  </Card>
);

const SandboxesOverview: FC = () => {
  const { t } = useTranslation('plugin__osc-plugin');
  const [kataConfig, kcLoaded] = useKataConfig();
  const [runtimeClasses] = useRuntimeClasses();
  const { workloads } = useSandboxWorkloads();
  const [caa] = useK8sWatchResource<DaemonSetKind>({
    groupVersionKind: DaemonSetGVK,
    namespace: OSC_NAMESPACE,
    name: CAA_DAEMONSET,
  });

  const counts = useMemo(() => {
    const peerpod = workloads.filter((w) => w.isolation === 'peerpod').length;
    const node = workloads.filter((w) => w.isolation === 'node').length;
    return { total: workloads.length, peerpod, node };
  }, [workloads]);

  const inProgress = kataConfig?.status?.conditions?.find((c) => c.type === 'InProgress');
  const installing = inProgress?.status === 'True';
  const nodes = kataConfig?.status?.kataNodes;
  const peerPodsEnabled = kataConfig?.spec?.enablePeerPods;
  const sandboxRCs = runtimeClasses.filter(isSandboxRuntimeClass);
  const caaReady = `${caa?.status?.numberReady ?? 0}/${caa?.status?.desiredNumberScheduled ?? 0}`;

  return (
    <>
      <DocumentTitle>{t('Sandboxes')}</DocumentTitle>
      <ListPageHeader title={t('Sandboxes overview')}>
        <Link to="/sandboxes/workloads/~new">
          <Button variant="primary">{t('Create sandboxed workload')}</Button>
        </Link>
      </ListPageHeader>

      <PageSection>
        <Grid hasGutter>
          <GridItem span={3}>
            <StatTile value={counts.total} label={t('Sandboxed workloads')} />
          </GridItem>
          <GridItem span={3}>
            <StatTile value={counts.node} label={t('On-node microVMs')} />
          </GridItem>
          <GridItem span={3}>
            <StatTile value={counts.peerpod} label={t('Peer pods')} />
          </GridItem>
          <GridItem span={3}>
            <StatTile value={sandboxRCs.length} label={t('Runtime classes')} />
          </GridItem>

          <GridItem span={6}>
            <Card>
              <CardTitle>{t('Installation status')}</CardTitle>
              <CardBody>
                {!kcLoaded ? (
                  t('Loading…')
                ) : !kataConfig ? (
                  <Label color="red" icon={<ExclamationTriangleIcon />}>
                    {t('KataConfig not found — OSC is not installed')}
                  </Label>
                ) : (
                  <DescriptionList isHorizontal>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('State')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {installing ? (
                          <Label color="orange">
                            {t('Installing')}
                            {inProgress?.reason ? ` (${inProgress.reason})` : ''}
                          </Label>
                        ) : (
                          <Label color="green" icon={<CheckCircleIcon />}>
                            {t('Installed')}
                          </Label>
                        )}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Kata nodes ready')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {`${nodes?.readyNodeCount ?? 0} / ${nodes?.nodeCount ?? 0}`}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Peer pods')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {peerPodsEnabled ? t('Enabled') : t('Disabled')}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('cloud-api-adaptor')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        <ResourceLink
                          groupVersionKind={DaemonSetGVK}
                          name={CAA_DAEMONSET}
                          namespace={OSC_NAMESPACE}
                        />
                        {` ${caaReady} ${t('ready')}`}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  </DescriptionList>
                )}
              </CardBody>
            </Card>
          </GridItem>

          <GridItem span={6}>
            <Card>
              <CardTitle>{t('Available runtime classes')}</CardTitle>
              <CardBody>
                {sandboxRCs.length === 0 ? (
                  t('No sandbox runtime classes found.')
                ) : (
                  <Flex direction={{ default: 'column' }}>
                    {sandboxRCs.map((rc) => (
                      <FlexItem key={rc.metadata?.name}>
                        <Flex
                          justifyContent={{ default: 'justifyContentSpaceBetween' }}
                          alignItems={{ default: 'alignItemsCenter' }}
                        >
                          <FlexItem>
                            <ResourceLink
                              groupVersionKind={{
                                group: 'node.k8s.io',
                                version: 'v1',
                                kind: 'RuntimeClass',
                              }}
                              name={rc.metadata?.name}
                            />
                          </FlexItem>
                          <FlexItem>
                            <IsolationLabel isolation={isolationForHandler(rc.handler)} />
                          </FlexItem>
                        </Flex>
                      </FlexItem>
                    ))}
                  </Flex>
                )}
                <Title headingLevel="h4" size="md" className="osc-plugin__mt">
                  <Link to="/sandboxes/runtime-classes">{t('View runtime class details')}</Link>
                </Title>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default SandboxesOverview;
