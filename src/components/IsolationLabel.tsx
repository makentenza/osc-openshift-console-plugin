import { Label, Tooltip } from '@patternfly/react-core';
import { CloudIcon, ServerIcon, OutlinedQuestionCircleIcon } from '@patternfly/react-icons';
import type { FC } from 'react';
import type { Isolation } from '../k8s/types';
import { isolationDescription, isolationLabel } from '../utils/runtime';

/** Badge that visually distinguishes peer pods (cloud) from on-node microVMs. */
export const IsolationLabel: FC<{ isolation: Isolation }> = ({ isolation }) => {
  const color = isolation === 'peerpod' ? 'blue' : isolation === 'node' ? 'green' : 'grey';
  const icon =
    isolation === 'peerpod' ? (
      <CloudIcon />
    ) : isolation === 'node' ? (
      <ServerIcon />
    ) : (
      <OutlinedQuestionCircleIcon />
    );
  return (
    <Tooltip content={isolationDescription(isolation)}>
      <Label color={color} icon={icon} isCompact>
        {isolationLabel(isolation)}
      </Label>
    </Tooltip>
  );
};
