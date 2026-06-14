import { Label } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContainerStatusKind, PodKind } from '../k8s/types';

const stateOf = (
  cs: ContainerStatusKind,
): { label: string; color: 'green' | 'orange' | 'red' | 'grey'; reason?: string } => {
  if (cs.state?.running) return { label: 'Running', color: 'green' };
  if (cs.state?.waiting)
    return {
      label: 'Waiting',
      color: 'orange',
      reason: cs.state.waiting.reason,
    };
  if (cs.state?.terminated)
    return {
      label: 'Terminated',
      color: 'red',
      reason: cs.state.terminated.reason,
    };
  return { label: 'Unknown', color: 'grey' };
};

export const ContainerStatuses: FC<{ pod: PodKind }> = ({ pod }) => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const statuses = pod.status?.containerStatuses;

  if (!statuses?.length) return null;

  return (
    <Table aria-label={t('Container statuses')} variant="compact">
      <Thead>
        <Tr>
          <Th>{t('Container')}</Th>
          <Th>{t('State')}</Th>
          <Th>{t('Restarts')}</Th>
          <Th>{t('Reason')}</Th>
        </Tr>
      </Thead>
      <Tbody>
        {statuses.map((cs) => {
          const s = stateOf(cs);
          return (
            <Tr key={cs.name}>
              <Td dataLabel={t('Container')}>{cs.name}</Td>
              <Td dataLabel={t('State')}>
                <Label color={s.color} isCompact>
                  {s.label}
                </Label>
              </Td>
              <Td dataLabel={t('Restarts')}>{cs.restartCount}</Td>
              <Td dataLabel={t('Reason')}>
                {s.reason ?? <span className="osc-openshift-console-plugin__muted">—</span>}
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
};
