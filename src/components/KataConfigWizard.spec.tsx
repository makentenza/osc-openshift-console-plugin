import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import KataConfigWizard from './KataConfigWizard';

/**
 * peer-pods-cm has to exist before the KataConfig — but only if peer pods are actually wanted. That
 * constraint used to be enforced by hiding the Create KataConfig action on the checklist entirely,
 * which forced peer pods on everyone. It lives here now, next to the switch that decides it, and it
 * warns rather than blocks (issue #69).
 */

/** `[data, loaded, loadError]` — mirrors the SDK's WatchK8sResult tuple. */
type WatchResult = [unknown, boolean, unknown];

declare global {
  interface Window {
    __watchResults?: Record<string, WatchResult>;
  }
}

const PEER_PODS_CM = 'peer-pods-cm';
const ABSENT: WatchResult = [undefined, false, { code: 404, message: 'not found' }];
/** The watch has not settled yet — neither loaded nor errored. */
const LOADING: WatchResult = [undefined, false, undefined];
const CONFIGURED: WatchResult = [{ data: { CLOUD_PROVIDER: 'azure' } }, true, undefined];

const renderWizard = (peerPodsCm: WatchResult) => {
  window.__watchResults = { [PEER_PODS_CM]: peerPodsCm };
  return render(
    <MemoryRouter initialEntries={['/sandboxes/setup/kataconfig']}>
      <KataConfigWizard />
    </MemoryRouter>,
  );
};

const warning = () => screen.queryByText(/The operator reads peer-pods-cm while installing this/);

beforeEach(() => {
  window.__watchResults = {};
});

describe('KataConfigWizard — peer pods config map', () => {
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
