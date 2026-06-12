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
  Skeleton,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { EllipsisVIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { ISortBy, OnSort } from '@patternfly/react-table';
import type { FC } from 'react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom-v5-compat';
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

const statusCategory = (status: string): string => {
  if (['Running', 'Available', 'Succeeded'].includes(status)) return 'Healthy';
  if (['Pending', 'Progressing', 'ContainerCreating'].includes(status)) return 'Pending';
  if (['Failed', 'Error', 'CrashLoopBackOff'].includes(status)) return 'Error';
  return 'Other';
};

const SORTABLE_FIELDS: (keyof SandboxWorkload | null)[] = [
  'name',
  'namespace',
  'kind',
  null,
  null,
  'status',
  null,
  'creationTimestamp',
];

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

const SkeletonTable: FC = () => (
  <Table aria-label="Loading" variant="compact">
    <Thead>
      <Tr>
        {Array.from({ length: 9 }, (_, i) => (
          <Th key={i}>
            <Skeleton width="5rem" />
          </Th>
        ))}
      </Tr>
    </Thead>
    <Tbody>
      {Array.from({ length: 5 }, (_, i) => (
        <Tr key={i}>
          {Array.from({ length: 9 }, (_, j) => (
            <Td key={j}>
              <Skeleton width={j === 0 ? '10rem' : '6rem'} />
            </Td>
          ))}
        </Tr>
      ))}
    </Tbody>
  </Table>
);

const SandboxWorkloadsList: FC = () => {
  const { t } = useTranslation('plugin__osc-plugin');
  const { workloads, loaded } = useSandboxWorkloads();

  const [text, setText] = useState('');
  const [isolation, setIsolation] = useState<string>('All');
  const [isoOpen, setIsoOpen] = useState(false);
  const [nsFilter, setNsFilter] = useState<string>('All');
  const [nsOpen, setNsOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [statusOpen, setStatusOpen] = useState(false);
  const [sortBy, setSortBy] = useState<ISortBy>({});
  const [toDelete, setToDelete] = useState<SandboxWorkload | undefined>();
  const [deleting, setDeleting] = useState(false);

  const namespaces = useMemo(
    () => [...new Set(workloads.map((w) => w.namespace))].sort(),
    [workloads],
  );

  const onSort: OnSort = (_event, index, direction) => {
    setSortBy({ index, direction });
  };

  const rows = useMemo(() => {
    const filtered = workloads.filter((w) => {
      if (text && !w.name.toLowerCase().includes(text.toLowerCase())) return false;
      if (isolation === 'On-node' && w.isolation !== 'node') return false;
      if (isolation === 'Peer pod' && w.isolation !== 'peerpod') return false;
      if (nsFilter !== 'All' && w.namespace !== nsFilter) return false;
      if (statusFilter !== 'All' && statusCategory(w.status) !== statusFilter) return false;
      return true;
    });

    if (sortBy.index === undefined) return filtered;

    const field = SORTABLE_FIELDS[sortBy.index];
    if (!field) return filtered;

    const sorted = [...filtered].sort((a, b) => {
      const aVal = String(a[field] ?? '');
      const bVal = String(b[field] ?? '');
      return aVal.localeCompare(bVal);
    });
    return sortBy.direction === 'desc' ? sorted.reverse() : sorted;
  }, [workloads, text, isolation, nsFilter, statusFilter, sortBy]);

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

  const getSortParams = (columnIndex: number) => ({
    sortBy,
    onSort,
    columnIndex,
  });

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
                isOpen={nsOpen}
                selected={nsFilter}
                onSelect={(_e, v) => {
                  setNsFilter(v as string);
                  setNsOpen(false);
                }}
                onOpenChange={setNsOpen}
                toggle={(ref) => (
                  <MenuToggle
                    ref={ref}
                    onClick={() => {
                      setNsOpen(!nsOpen);
                    }}
                  >
                    {nsFilter === 'All' ? t('All namespaces') : nsFilter}
                  </MenuToggle>
                )}
              >
                <SelectList>
                  <SelectOption value="All">{t('All namespaces')}</SelectOption>
                  {namespaces.map((ns) => (
                    <SelectOption key={ns} value={ns}>
                      {ns}
                    </SelectOption>
                  ))}
                </SelectList>
              </Select>
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
            <ToolbarItem>
              <Select
                isOpen={statusOpen}
                selected={statusFilter}
                onSelect={(_e, v) => {
                  setStatusFilter(v as string);
                  setStatusOpen(false);
                }}
                onOpenChange={setStatusOpen}
                toggle={(ref) => (
                  <MenuToggle
                    ref={ref}
                    onClick={() => {
                      setStatusOpen(!statusOpen);
                    }}
                  >
                    {statusFilter === 'All' ? t('All statuses') : statusFilter}
                  </MenuToggle>
                )}
              >
                <SelectList>
                  <SelectOption value="All">{t('All statuses')}</SelectOption>
                  <SelectOption value="Healthy">{t('Healthy')}</SelectOption>
                  <SelectOption value="Pending">{t('Pending')}</SelectOption>
                  <SelectOption value="Error">{t('Error')}</SelectOption>
                </SelectList>
              </Select>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>

        {!loaded ? (
          <SkeletonTable />
        ) : rows.length === 0 ? (
          <EmptyState headingLevel="h4" titleText={t('No sandboxed workloads')}>
            <EmptyStateBody>
              {t('Create a workload with a kata runtime class to see it here.')}
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Table aria-label={t('Sandboxed workloads')} variant="compact">
            <Thead>
              <Tr>
                <Th sort={getSortParams(0)}>{t('Name')}</Th>
                <Th sort={getSortParams(1)}>{t('Namespace')}</Th>
                <Th sort={getSortParams(2)}>{t('Kind')}</Th>
                <Th>{t('Runtime class')}</Th>
                <Th>{t('Isolation')}</Th>
                <Th sort={getSortParams(5)}>{t('Status')}</Th>
                <Th>{t('Placement')}</Th>
                <Th sort={getSortParams(7)}>{t('Created')}</Th>
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
