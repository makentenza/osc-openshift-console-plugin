import { useMemo, useRef, useState } from 'react';
import type { FC, Ref } from 'react';
import {
  Divider,
  MenuToggle,
  type MenuToggleElement,
  Select,
  SelectList,
  SelectOption,
  Switch,
  TextInputGroup,
  TextInputGroupMain,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';

// Vendored per plugin: keep in sync with the other plugins' copies. The only intended
// difference is the i18n namespace passed to useTranslation below — it must stay a string
// literal (not a const) so `yarn i18n` can statically route the keys to this plugin.
const CREATE_SENTINEL = '__namespace_select_create__';

/**
 * OpenShift's rule for a "default"/system project — mirrors the console's own Project
 * dropdown, which hides these behind its "Show default projects" toggle. The dynamic
 * plugin SDK exports no equivalent helper, so we replicate the name pattern.
 */
export const isDefaultProject = (name: string): boolean =>
  /^(openshift$|openshift-|kube-|kube-public$|kube-system$|kube-node-lease$|default$)/.test(name);

export interface NamespaceSelectProps {
  /** Selected namespace name ('' = none). Controlled by the parent. */
  value: string;
  /** Called with the chosen (or, when creatable, the typed) namespace name. */
  onChange: (namespace: string) => void;
  /** Namespace/Project names to choose from — the parent owns the watch. */
  namespaces: string[];
  /** Input id, wired to the parent FormGroup's fieldId. */
  id?: string;
  placeholder?: string;
  /** Offer a "Create new namespace: X" option and commit typed text live. Default false. */
  creatable?: boolean;
  /** Initial state of the "Show default projects" switch. Default false (system projects hidden). */
  showDefaultProjectsDefault?: boolean;
  isDisabled?: boolean;
  'data-test'?: string;
}

/**
 * A project/namespace picker that mirrors the OpenShift console's native Project dropdown:
 * type-to-search plus a "Show default projects" switch that hides system namespaces
 * (openshift-*, kube-*, default, ...). Presentational — the parent watches Projects and
 * passes the names in, so this composes with each form's own validation/create logic.
 */
export const NamespaceSelect: FC<NamespaceSelectProps> = ({
  value,
  onChange,
  namespaces,
  id,
  placeholder,
  creatable = false,
  showDefaultProjectsDefault = false,
  isDisabled,
  'data-test': dataTest,
}) => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const [open, setOpen] = useState(false);
  const [showDefault, setShowDefault] = useState(showDefaultProjectsDefault);
  // Text in the combobox input: drives filtering and (when creatable) the create option.
  const [filterText, setFilterText] = useState(value);
  // True once the user edits the input since the last commit/close. This — not
  // (filterText !== value) — is what marks an active search, because creatable mode mirrors
  // the typed text into `value` live, which would otherwise pin filterActive to false.
  const [dirty, setDirty] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = id ? `${id}-listbox` : 'namespace-select-listbox';

  const q = filterText.trim().toLowerCase();
  // Treat the input as a search only once the user has actually typed, so opening the menu
  // lists the full set rather than a single self-match.
  const filterActive = q !== '' && dirty;

  const visible = useMemo(
    () =>
      namespaces.filter((n) => {
        if (filterActive && !n.toLowerCase().includes(q)) return false;
        // Hide system projects unless the switch is on, the project is the current selection,
        // or the user is actively searching (so search is never dead-ended).
        if (isDefaultProject(n) && !showDefault) return n === value || filterActive;
        return true;
      }),
    [namespaces, filterActive, q, showDefault, value],
  );

  const typed = filterText.trim();
  const showCreate = creatable && typed !== '' && !namespaces.includes(typed);

  const commit = (v: string) => {
    onChange(v);
    setFilterText(v);
    setDirty(false);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <Select
      isOpen={open}
      selected={namespaces.includes(value) ? value : undefined}
      onSelect={(_e, sel) => {
        if (sel === CREATE_SENTINEL) commit(typed);
        else if (typeof sel === 'string') commit(sel);
      }}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        // On close, snap the input back to the committed selection so a half-typed filter
        // (especially in pick-only mode) never lingers as if it were the chosen namespace.
        if (!isOpen) {
          setFilterText(value);
          setDirty(false);
        }
      }}
      toggle={(toggleRef: Ref<MenuToggleElement>) => (
        <MenuToggle
          ref={toggleRef}
          variant="typeahead"
          aria-label={t('Namespace')}
          isExpanded={open}
          isFullWidth
          isDisabled={isDisabled}
          onClick={() => {
            setOpen(!open);
          }}
        >
          <TextInputGroup isPlain>
            <TextInputGroupMain
              id={id}
              value={filterText}
              innerRef={inputRef}
              placeholder={
                placeholder ??
                (creatable ? t('Select or enter a namespace') : t('Select a namespace'))
              }
              role="combobox"
              isExpanded={open}
              aria-controls={listId}
              data-test={dataTest}
              onClick={() => {
                setOpen(!open);
              }}
              onChange={(_e, v) => {
                setFilterText(v);
                setDirty(true);
                if (!open) setOpen(true);
                // Create-forms commit the typed text live so a brand-new name can be submitted;
                // pick-only forms keep the last selection until an option is chosen.
                if (creatable) onChange(v);
              }}
            />
          </TextInputGroup>
        </MenuToggle>
      )}
    >
      <div style={{ padding: '8px 12px' }}>
        <Switch
          id={id ? `${id}-show-default` : 'namespace-select-show-default'}
          label={t('Show default projects')}
          isChecked={showDefault}
          onChange={(_e, checked) => {
            setShowDefault(checked);
          }}
        />
      </div>
      <Divider />
      <SelectList id={listId}>
        {visible.map((n) => (
          <SelectOption key={n} value={n}>
            {n}
          </SelectOption>
        ))}
        {showCreate && (
          <SelectOption key="__create__" value={CREATE_SENTINEL}>
            {t('Create new namespace: {{name}}', { name: typed })}
          </SelectOption>
        )}
        {visible.length === 0 && !showCreate && (
          <SelectOption isDisabled value="__none__">
            {t('No namespaces found')}
          </SelectOption>
        )}
      </SelectList>
    </Select>
  );
};
