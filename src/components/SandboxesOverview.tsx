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
  Skeleton,
  Title,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
} from '@patternfly/react-icons';
import type { FC } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import { useKataConfig, useRuntimeClasses, useSandboxWorkloads } from '../k8s/hooks';
import { CAA_DAEMONSET, DaemonSetGVK, OSC_NAMESPACE } from '../k8s/resources';
import type { DaemonSetKind } from '../k8s/types';
import { isSandboxRuntimeClass, isolationForHandler } from '../utils/runtime';
import { IsolationLabel } from './IsolationLabel';
import RecentEventsCard from './RecentEventsCard';
import './sandbox.css';

const StatTile: FC<{
  value: number | string;
  label: string;
  loading?: boolean;
  href?: string;
}> = ({ value, label, loading, href }) => {
  const card = (
    <Card isCompact className={`osc-plugin__stat${href ? ' osc-plugin__stat--clickable' : ''}`}>
      <CardBody>
        <div className="osc-plugin__stat-value">
          {loading ? <Skeleton width="3rem" height="1.5rem" /> : value}
        </div>
        <div className="osc-plugin__stat-label">{label}</div>
      </CardBody>
    </Card>
  );
  return href ? <Link to={href}>{card}</Link> : card;
};

const HealthBar: FC<{ healthy: number; warning: number; error: number }> = ({
  healthy,
  warning,
  error,
}) => {
  const { t } = useTranslation('plugin__osc-plugin');
  const total = healthy + warning + error;
  if (total === 0) return null;

  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;

  return (
    <>
      <div className="osc-plugin__health-bar">
        {healthy > 0 && (
          <div className="osc-plugin__health-segment--healthy" style={{ width: pct(healthy) }} />
        )}
        {warning > 0 && (
          <div className="osc-plugin__health-segment--warning" style={{ width: pct(warning) }} />
        )}
        {error > 0 && (
          <div className="osc-plugin__health-segment--error" style={{ width: pct(error) }} />
        )}
      </div>
      <Flex gap={{ default: 'gapMd' }} className="osc-plugin__mt">
        <Label color="green" icon={<CheckCircleIcon />} isCompact>
          {t('Healthy')}: {healthy}
        </Label>
        <Label color="orange" icon={<ExclamationTriangleIcon />} isCompact>
          {t('Warning')}: {warning}
        </Label>
        <Label color="red" icon={<ExclamationCircleIcon />} isCompact>
          {t('Error')}: {error}
        </Label>
      </Flex>
    </>
  );
};

const SandboxesOverview: FC = () => {
  const { t } = useTranslation('plugin__osc-plugin');
  const [kataConfig, kcLoaded] = useKataConfig();
  const [runtimeClasses] = useRuntimeClasses();
  const { workloads, loaded } = useSandboxWorkloads();
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

  const healthCounts = useMemo(() => {
    let healthy = 0,
      warning = 0,
      error = 0;
    workloads.forEach((w) => {
      if (['Running', 'Available', 'Succeeded'].includes(w.status)) healthy++;
      else if (['Pending', 'Progressing', 'ContainerCreating'].includes(w.status)) warning++;
      else error++;
    });
    return { healthy, warning, error };
  }, [workloads]);

  const inProgress = kataConfig?.status?.conditions?.find((c) => c.type === 'InProgress');
  const installing = inProgress?.status === 'True';
  const nodes = kataConfig?.status?.kataNodes;
  const peerPodsEnabled = kataConfig?.spec?.enablePeerPods;
  const sandboxRCs = runtimeClasses.filter(isSandboxRuntimeClass);
  const caaReady = `${caa?.status?.numberReady ?? 0}/${caa?.status?.desiredNumberScheduled ?? 0}`;
  const wlLoading = !loaded;

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
          <GridItem span={2}>
            <StatTile
              value={counts.total}
              label={t('Sandboxed workloads')}
              loading={wlLoading}
              href="/sandboxes/workloads"
            />
          </GridItem>
          <GridItem span={3}>
            <StatTile
              value={counts.node}
              label={t('On-node microVMs')}
              loading={wlLoading}
              href="/sandboxes/workloads"
            />
          </GridItem>
          <GridItem span={2}>
            <StatTile
              value={counts.peerpod}
              label={t('Peer pods')}
              loading={wlLoading}
              href="/sandboxes/workloads"
            />
          </GridItem>
          <GridItem span={3}>
            <StatTile
              value={sandboxRCs.length}
              label={t('Runtime classes')}
              loading={wlLoading}
              href="/sandboxes/runtime-classes"
            />
          </GridItem>
          <GridItem span={2}>
            <StatTile
              value={`${nodes?.readyNodeCount ?? 0}/${nodes?.nodeCount ?? 0}`}
              label={t('Kata nodes')}
              loading={!kcLoaded}
            />
          </GridItem>

          <GridItem span={12}>
            <Card>
              <CardTitle>{t('Workload health')}</CardTitle>
              <CardBody>
                {wlLoading ? (
                  <Skeleton width="100%" height="0.5rem" />
                ) : counts.total === 0 ? (
                  <span className="osc-plugin__muted">{t('No sandboxed workloads running.')}</span>
                ) : (
                  <HealthBar {...healthCounts} />
                )}
              </CardBody>
            </Card>
          </GridItem>

          <GridItem span={6}>
            <Card>
              <CardTitle>{t('Installation status')}</CardTitle>
              <CardBody>
                {!kcLoaded ? (
                  <Flex direction={{ default: 'column' }} gap={{ default: 'gapSm' }}>
                    <Skeleton width="60%" />
                    <Skeleton width="80%" />
                    <Skeleton width="50%" />
                  </Flex>
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

          <GridItem span={12}>
            <RecentEventsCard />
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default SandboxesOverview;
