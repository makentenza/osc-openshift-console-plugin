import {
  DocumentTitle,
  k8sDelete,
  ListPageHeader,
  ResourceLink,
  Timestamp,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Button,
  Dropdown,
  DropdownItem,
  DropdownList,
  EmptyState,
  EmptyStateBody,
  Label,
  MenuToggle,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  SearchInput,
  Select,
  SelectList,
  SelectOption,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { EllipsisVIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { FC } from 'react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useSandboxWorkloads } from '../k8s/hooks';
import { DeploymentModel, NamespaceGVK, PodModel } from '../k8s/resources';
import type { SandboxWorkload } from '../k8s/types';
import { IsolationLabel } from './IsolationLabel';
import './sandbox.css';

const statusColor = (status: string): 'green' | 'orange' | 'red' | 'grey' => {
  if (['Running', 'Available', 'Succeeded'].includes(status)) return 'green';
  if (['Pending', 'Progressing', 'ContainerCreating'].includes(status)) return 'orange';
  if (['Failed', 'Error', 'CrashLoopBackOff'].includes(status)) return 'red';
  return 'grey';
};

const detailPath = (w: SandboxWorkload) =>
  `/sandboxes/workloads/${w.kind}/${w.namespace}/${w.name}`;

const RowActions: FC<{ w: SandboxWorkload; onDelete: (w: SandboxWorkload) => void }> = ({
  w,
  onDelete,
}) => {
  const { t } = useTranslation('plugin__osc-plugin');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <Dropdown
      isOpen={open}
      onOpenChange={setOpen}
      popperProps={{ position: 'right' }}
      toggle={(ref) => (
        <MenuToggle
          ref={ref}
          variant="plain"
          onClick={() => {
            setOpen(!open);
          }}
          aria-label={t('Actions')}
        >
          <EllipsisVIcon />
        </MenuToggle>
      )}
    >
      <DropdownList>
        <DropdownItem onClick={() => void navigate(detailPath(w))}>
          {t('View details')}
        </DropdownItem>
        <DropdownItem
          onClick={() => {
            onDelete(w);
          }}
        >
          {t('Delete')}
        </DropdownItem>
      </DropdownList>
    </Dropdown>
  );
};

const SandboxWorkloadsList: FC = () => {
  const { t } = useTranslation('plugin__osc-plugin');
  const { workloads, loaded } = useSandboxWorkloads();

  const [text, setText] = useState('');
  const [isolation, setIsolation] = useState<string>('All');
  const [isoOpen, setIsoOpen] = useState(false);
  const [toDelete, setToDelete] = useState<SandboxWorkload | undefined>();
  const [deleting, setDeleting] = useState(false);

  const rows = useMemo(
    () =>
      workloads.filter((w) => {
        if (text && !w.name.toLowerCase().includes(text.toLowerCase())) return false;
        if (isolation === 'On-node' && w.isolation !== 'node') return false;
        if (isolation === 'Peer pod' && w.isolation !== 'peerpod') return false;
        return true;
      }),
    [workloads, text, isolation],
  );

  const doDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await k8sDelete({
        model: toDelete.kind === 'Pod' ? PodModel : DeploymentModel,
        resource: toDelete.obj,
      });
      setToDelete(undefined);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <DocumentTitle>{t('Sandboxed workloads')}</DocumentTitle>
      <ListPageHeader title={t('Sandboxed workloads')}>
        <Link to="/sandboxes/workloads/~new">
          <Button variant="primary">{t('Create sandboxed workload')}</Button>
        </Link>
      </ListPageHeader>
      <PageSection>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <SearchInput
                placeholder={t('Filter by name')}
                value={text}
                onChange={(_e, v) => {
                  setText(v);
                }}
                onClear={() => {
                  setText('');
                }}
              />
            </ToolbarItem>
            <ToolbarItem>
              <Select
                isOpen={isoOpen}
                selected={isolation}
                onSelect={(_e, v) => {
                  setIsolation(v as string);
                  setIsoOpen(false);
                }}
                onOpenChange={setIsoOpen}
                toggle={(ref) => (
                  <MenuToggle
                    ref={ref}
                    onClick={() => {
                      setIsoOpen(!isoOpen);
                    }}
                  >
                    {isolation === 'All' ? t('All isolation types') : isolation}
                  </MenuToggle>
                )}
              >
                <SelectList>
                  <SelectOption value="All">{t('All isolation types')}</SelectOption>
                  <SelectOption value="On-node">{t('On-node')}</SelectOption>
                  <SelectOption value="Peer pod">{t('Peer pod')}</SelectOption>
                </SelectList>
              </Select>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>

        {loaded && rows.length === 0 ? (
          <EmptyState headingLevel="h4" titleText={t('No sandboxed workloads')}>
            <EmptyStateBody>
              {t('Create a workload with a kata runtime class to see it here.')}
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Table aria-label={t('Sandboxed workloads')} variant="compact">
            <Thead>
              <Tr>
                <Th>{t('Name')}</Th>
                <Th>{t('Namespace')}</Th>
                <Th>{t('Kind')}</Th>
                <Th>{t('Runtime class')}</Th>
                <Th>{t('Isolation')}</Th>
                <Th>{t('Status')}</Th>
                <Th>{t('Placement')}</Th>
                <Th>{t('Created')}</Th>
                <Th screenReaderText={t('Actions')} />
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((w) => (
                <Tr key={w.uid}>
                  <Td dataLabel={t('Name')}>
                    <Link to={detailPath(w)}>{w.name}</Link>
                  </Td>
                  <Td dataLabel={t('Namespace')}>
                    <ResourceLink groupVersionKind={NamespaceGVK} name={w.namespace} linkTo />
                  </Td>
                  <Td dataLabel={t('Kind')}>{w.kind}</Td>
                  <Td dataLabel={t('Runtime class')}>{w.runtimeClass}</Td>
                  <Td dataLabel={t('Isolation')}>
                    <IsolationLabel isolation={w.isolation} />
                  </Td>
                  <Td dataLabel={t('Status')}>
                    <Label color={statusColor(w.status)} isCompact>
                      {w.ready ? `${w.status} (${w.ready})` : w.status}
                    </Label>
                  </Td>
                  <Td dataLabel={t('Placement')}>
                    {w.placement ? (
                      <span className="osc-plugin__mono">{w.placement}</span>
                    ) : (
                      <span className="osc-plugin__muted">—</span>
                    )}
                  </Td>
                  <Td dataLabel={t('Created')}>
                    <Timestamp timestamp={w.creationTimestamp} />
                  </Td>
                  <Td isActionCell>
                    <RowActions w={w} onDelete={setToDelete} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>

      {toDelete && (
        <Modal
          isOpen
          variant="small"
          onClose={() => {
            setToDelete(undefined);
          }}
        >
          <ModalHeader title={t('Delete sandboxed workload?')} />
          <ModalBody>
            {t('Delete {{kind}} {{name}} in {{namespace}}? Its sandbox VM will be torn down.', {
              kind: toDelete.kind,
              name: toDelete.name,
              namespace: toDelete.namespace,
            })}
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" onClick={() => void doDelete()} isLoading={deleting}>
              {t('Delete')}
            </Button>
            <Button
              variant="link"
              onClick={() => {
                setToDelete(undefined);
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

export default SandboxWorkloadsList;
