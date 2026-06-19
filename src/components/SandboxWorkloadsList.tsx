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
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
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
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useSandboxWorkloads } from '../k8s/hooks';
import { DeploymentModel, NamespaceGVK, PodModel } from '../k8s/resources';
import type { SandboxWorkload } from '../k8s/types';
import { statusCategory, statusColor } from '../utils/status';
import { IsolationLabel } from './IsolationLabel';
import './sandbox.css';

const SORTABLE_FIELDS: (keyof SandboxWorkload | null)[] = [
  'name',
  'namespace',
  'kind',
  null,
  null,
  'status',
  null,
  null,
  'creationTimestamp',
];

const detailPath = (w: SandboxWorkload) =>
  `/sandboxes/workloads/${w.kind}/${w.namespace}/${w.name}`;

const RowActions: FC<{ w: SandboxWorkload; onDelete: (w: SandboxWorkload) => void }> = ({
  w,
  onDelete,
}) => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
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

const SkeletonTable: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  return (
    <Table aria-label={t('Loading')} variant="compact">
      <Thead>
        <Tr>
          {Array.from({ length: 10 }, (_, i) => (
            <Th key={i}>
              <Skeleton width="5rem" />
            </Th>
          ))}
        </Tr>
      </Thead>
      <Tbody>
        {Array.from({ length: 5 }, (_, i) => (
          <Tr key={i}>
            {Array.from({ length: 10 }, (_, j) => (
              <Td key={j}>
                <Skeleton width={j === 0 ? '10rem' : '6rem'} />
              </Td>
            ))}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
};

const SandboxWorkloadsList: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const { workloads, loaded } = useSandboxWorkloads();

  // Filters live in the URL so the overview tiles, runtime-class links, and
  // browser bookmarks can all deep-link into a pre-filtered view.
  const [searchParams, setSearchParams] = useSearchParams();
  const text = searchParams.get('name') ?? '';
  const nsFilter = searchParams.get('ns') ?? 'All';
  const isolation = searchParams.get('isolation') ?? 'All'; // node | peerpod
  const statusFilter = searchParams.get('status') ?? 'All'; // healthy | pending | error
  const rcFilter = searchParams.get('rc') ?? '';

  const setParam = (key: string, value?: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value || value === 'All') next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };
  const hasFilters =
    text !== '' ||
    nsFilter !== 'All' ||
    isolation !== 'All' ||
    statusFilter !== 'All' ||
    rcFilter !== '';
  const clearFilters = () => {
    setSearchParams({}, { replace: true });
  };

  const [isoOpen, setIsoOpen] = useState(false);
  const [nsOpen, setNsOpen] = useState(false);
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
      if (isolation !== 'All' && w.isolation !== isolation) return false;
      if (nsFilter !== 'All' && w.namespace !== nsFilter) return false;
      if (statusFilter !== 'All' && statusCategory(w.status).toLowerCase() !== statusFilter)
        return false;
      if (rcFilter && w.runtimeClass !== rcFilter) return false;
      return true;
    });

    if (sortBy.index === undefined) return filtered;

    const field = SORTABLE_FIELDS[sortBy.index];
    if (!field) return filtered;

    const cell = (w: SandboxWorkload): string => {
      const v = w[field];
      return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
    };
    const sorted = [...filtered].sort((a, b) => cell(a).localeCompare(cell(b)));
    return sortBy.direction === 'desc' ? sorted.reverse() : sorted;
  }, [workloads, text, isolation, nsFilter, statusFilter, rcFilter, sortBy]);

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

  const statusLabel = (value: string) =>
    value === 'healthy'
      ? t('Healthy')
      : value === 'pending'
        ? t('Pending')
        : value === 'error'
          ? t('Error')
          : t('All statuses');

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
                  setParam('name', v);
                }}
                onClear={() => {
                  setParam('name');
                }}
              />
            </ToolbarItem>
            <ToolbarItem>
              <Select
                isOpen={nsOpen}
                selected={nsFilter}
                onSelect={(_e, v) => {
                  setParam('ns', v as string);
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
                  setParam('isolation', v as string);
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
                    {isolation === 'node'
                      ? t('On-node')
                      : isolation === 'peerpod'
                        ? t('Peer pod')
                        : t('All isolation types')}
                  </MenuToggle>
                )}
              >
                <SelectList>
                  <SelectOption value="All">{t('All isolation types')}</SelectOption>
                  <SelectOption value="node">{t('On-node')}</SelectOption>
                  <SelectOption value="peerpod">{t('Peer pod')}</SelectOption>
                </SelectList>
              </Select>
            </ToolbarItem>
            <ToolbarItem>
              <Select
                isOpen={statusOpen}
                selected={statusFilter}
                onSelect={(_e, v) => {
                  setParam('status', v as string);
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
                    {statusLabel(statusFilter)}
                  </MenuToggle>
                )}
              >
                <SelectList>
                  <SelectOption value="All">{t('All statuses')}</SelectOption>
                  <SelectOption value="healthy">{t('Healthy')}</SelectOption>
                  <SelectOption value="pending">{t('Pending')}</SelectOption>
                  <SelectOption value="error">{t('Error')}</SelectOption>
                </SelectList>
              </Select>
            </ToolbarItem>
            {rcFilter && (
              <ToolbarItem>
                <Label
                  onClose={() => {
                    setParam('rc');
                  }}
                  closeBtnAriaLabel={t('Clear runtime class filter')}
                >
                  {t('Runtime class')}: {rcFilter}
                </Label>
              </ToolbarItem>
            )}
            {hasFilters && (
              <ToolbarItem>
                <Button variant="link" isInline onClick={clearFilters}>
                  {t('Clear all filters')}
                </Button>
              </ToolbarItem>
            )}
          </ToolbarContent>
        </Toolbar>

        {!loaded ? (
          <SkeletonTable />
        ) : rows.length === 0 ? (
          workloads.length === 0 ? (
            <EmptyState headingLevel="h4" titleText={t('No sandboxed workloads')}>
              <EmptyStateBody>
                {t(
                  'Sandboxed workloads run inside a dedicated VM for kernel-level isolation. Create one with a kata runtime class to see it here.',
                )}
              </EmptyStateBody>
              <EmptyStateFooter>
                <EmptyStateActions>
                  <Link to="/sandboxes/workloads/~new">
                    <Button variant="primary">{t('Create sandboxed workload')}</Button>
                  </Link>
                </EmptyStateActions>
              </EmptyStateFooter>
            </EmptyState>
          ) : (
            <EmptyState headingLevel="h4" titleText={t('No results match the current filters')}>
              <EmptyStateBody>
                {t('{{count}} sandboxed workloads are hidden by the active filters.', {
                  count: workloads.length,
                })}
              </EmptyStateBody>
              <EmptyStateFooter>
                <EmptyStateActions>
                  <Button variant="link" onClick={clearFilters}>
                    {t('Clear all filters')}
                  </Button>
                </EmptyStateActions>
              </EmptyStateFooter>
            </EmptyState>
          )
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
                <Th>{t('Restarts')}</Th>
                <Th>{t('Placement')}</Th>
                <Th sort={getSortParams(8)}>{t('Created')}</Th>
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
                  <Td dataLabel={t('Restarts')}>
                    {w.kind === 'Pod' ? (
                      (w.restarts ?? 0)
                    ) : (
                      <span className="osc-openshift-console-plugin__muted">—</span>
                    )}
                  </Td>
                  <Td dataLabel={t('Placement')}>
                    {w.placement ? (
                      <span className="osc-openshift-console-plugin__mono">{w.placement}</span>
                    ) : (
                      <span className="osc-openshift-console-plugin__muted">—</span>
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
