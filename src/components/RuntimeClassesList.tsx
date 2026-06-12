import {
  DocumentTitle,
  ListPageHeader,
  ResourceLink,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import { Card, CardBody, CardTitle, PageSection } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useRuntimeClasses } from '../k8s/hooks';
import { ConfigMapGVK, OSC_NAMESPACE, PEER_PODS_CM, RuntimeClassGVK } from '../k8s/resources';
import type { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';
import { isSandboxRuntimeClass, isolationDescription, isolationForHandler } from '../utils/runtime';
import { IsolationLabel } from './IsolationLabel';

type ConfigMapKind = K8sResourceCommon & { data?: Record<string, string> };

const RuntimeClassesList: FC = () => {
  const { t } = useTranslation('plugin__osc-plugin');
  const [runtimeClasses] = useRuntimeClasses();
  const [cm] = useK8sWatchResource<ConfigMapKind>({
    groupVersionKind: ConfigMapGVK,
    namespace: OSC_NAMESPACE,
    name: PEER_PODS_CM,
  });
  const sandboxRCs = runtimeClasses.filter(isSandboxRuntimeClass);
  const machineType = cm?.data?.GCP_MACHINE_TYPE ?? cm?.data?.PODVM_INSTANCE_TYPE;
  const podvmImage = cm?.data?.PODVM_IMAGE_NAME;

  return (
    <>
      <DocumentTitle>{t('Runtime classes')}</DocumentTitle>
      <ListPageHeader title={t('Sandbox runtime classes')} />
      <PageSection>
        <Table aria-label={t('Runtime classes')} variant="compact">
          <Thead>
            <Tr>
              <Th>{t('Name')}</Th>
              <Th>{t('Handler')}</Th>
              <Th>{t('Isolation')}</Th>
              <Th>{t('Description')}</Th>
            </Tr>
          </Thead>
          <Tbody>
            {sandboxRCs.map((rc) => {
              const iso = isolationForHandler(rc.handler);
              return (
                <Tr key={rc.metadata?.name}>
                  <Td dataLabel={t('Name')}>
                    <ResourceLink groupVersionKind={RuntimeClassGVK} name={rc.metadata?.name} />
                  </Td>
                  <Td dataLabel={t('Handler')} className="osc-plugin__mono">
                    {rc.handler}
                  </Td>
                  <Td dataLabel={t('Isolation')}>
                    <IsolationLabel isolation={iso} />
                  </Td>
                  <Td dataLabel={t('Description')}>{isolationDescription(iso)}</Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>

        <Card className="osc-plugin__mt">
          <CardTitle>{t('Peer pod defaults')}</CardTitle>
          <CardBody>
            {cm ? (
              <>
                {t('Default machine type')}: <strong>{machineType ?? '—'}</strong>
                <br />
                {t('Pod VM image')}: <span className="osc-plugin__mono">{podvmImage ?? '—'}</span>
                <br />
                {t('Cloud provider')}: <strong>{cm?.data?.CLOUD_PROVIDER ?? '—'}</strong>
              </>
            ) : (
              t('peer-pods-cm not found.')
            )}
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
};

export default RuntimeClassesList;
