import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import type * as ReactRouter from 'react-router';

/** `[data, loaded, loadError]` — mirrors the SDK's WatchK8sResult tuple. */
type WatchResult = [unknown, boolean, unknown];

interface Watch {
  groupVersionKind?: { kind?: string };
  name?: string;
  isList?: boolean;
}

/** Just enough of a k8sCreate payload to tell the manifests apart. */
interface CreateArgs {
  data?: { kind?: string };
}

declare global {
  interface Window {
    __watchResults?: Record<string, WatchResult>;
  }
}

const navigate = jest.fn();
const k8sCreate = jest.fn<Promise<unknown>, [CreateArgs]>(() => Promise.resolve({}));

jest.mock('@openshift-console/dynamic-plugin-sdk', () => ({
  DocumentTitle: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ListPageHeader: ({ title }: { title?: ReactNode }) => <h1>{title}</h1>,
  // Named watches come from window.__watchResults; everything else falls back to empty.
  useK8sWatchResource: (o: Watch): WatchResult => {
    const named = o.name ? window.__watchResults?.[o.name] : undefined;
    return named ?? (o.isList ? [[], true, undefined] : [undefined, true, undefined]);
  },
  k8sCreate: (args: CreateArgs) => k8sCreate(args),
  // The feature-gate ConfigMap does not exist yet, so ensureFeatureGate() takes its create path.
  k8sGet: () => Promise.reject(Object.assign(new Error('not found'), { code: 404 })),
  k8sPatch: jest.fn(() => Promise.resolve({})),
}));

// Keep the router real — the wizard renders inside one — but watch where it sends the user.
jest.mock('react-router', () => ({
  ...jest.requireActual<typeof ReactRouter>('react-router'),
  useNavigate: () => navigate,
}));

import KataConfigWizard from './KataConfigWizard';

const PEER_PODS_CM = 'peer-pods-cm';
/** peer-pods-cm does not exist: a named watch for a missing object 404s, never loading. */
const ABSENT: WatchResult = [undefined, false, { code: 404, message: 'not found' }];
/** The watch has not settled yet — neither loaded nor errored. */
const LOADING: WatchResult = [undefined, false, undefined];
const CONFIGURED: WatchResult = [{ data: { CLOUD_PROVIDER: 'azure' } }, true, undefined];

const renderWizard = (peerPodsCm: WatchResult = ABSENT) => {
  window.__watchResults = { [PEER_PODS_CM]: peerPodsCm };
  return render(
    <MemoryRouter initialEntries={['/sandboxes/setup/kataconfig']}>
      <KataConfigWizard />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  window.__watchResults = {};
});

/**
 * Creating a KataConfig only starts a rollout. Landing the user on the overview read as "done" the
 * moment they hit Create, so the wizard hands off to the checklist — the screen that tracks it node
 * by node (issue #64).
 */
describe('KataConfigWizard — where Create leaves you', () => {
  it('hands off to the setup checklist, not the overview', async () => {
    renderWizard();

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/sandboxes/setup');
    });
    // The overview greeted a just-created KataConfig with a green "Installed" check.
    expect(navigate).not.toHaveBeenCalledWith('/sandboxes');
  });

  it('creates the KataConfig before navigating anywhere', async () => {
    renderWizard();

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });
    expect(k8sCreate.mock.calls.map(([args]) => args.data?.kind)).toContain('KataConfig');
  });

  it('stays put when the create fails', async () => {
    k8sCreate.mockImplementation((args) =>
      args.data?.kind === 'KataConfig'
        ? Promise.reject(new Error('admission webhook denied the request'))
        : Promise.resolve({}),
    );
    renderWizard();

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText(/admission webhook denied the request/)).toBeInTheDocument();
    });
    expect(navigate).not.toHaveBeenCalled();
  });
});

/**
 * peer-pods-cm has to exist before the KataConfig — but only if peer pods are actually wanted. That
 * constraint used to be enforced by hiding the Create KataConfig action on the checklist entirely,
 * which forced peer pods on everyone. It lives here now, next to the switch that decides it, and it
 * warns rather than blocks (issue #69).
 */
describe('KataConfigWizard — peer pods config map', () => {
  const warning = () => screen.queryByText(/The operator reads peer-pods-cm while installing this/);

  it('warns when peer pods are on and no config map exists', () => {
    renderWizard(ABSENT);

    expect(warning()).toBeInTheDocument();
  });

  // The whole point of #69: warning, never blocking.
  it('still lets the KataConfig be created', () => {
    renderWizard(ABSENT);

    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  // On-node sandboxed containers need no config map, so the warning is irrelevant there.
  it('drops the warning when peer pods are switched off', async () => {
    renderWizard(ABSENT);

    await userEvent.click(screen.getByLabelText(/Run pods as cloud VMs/));

    expect(warning()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('says nothing when the config map is already configured', () => {
    renderWizard(CONFIGURED);

    expect(warning()).not.toBeInTheDocument();
  });

  // Answering before the watch settles would flash the warning at someone who does have one.
  it('says nothing while the watch is still in flight', () => {
    renderWizard(LOADING);

    expect(warning()).not.toBeInTheDocument();
  });
});
