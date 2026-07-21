import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import OscSetup from './OscSetup';

/**
 * The checklist used to hide the Create KataConfig action until peer-pods-cm existed, which forced
 * peer pods on everyone. On-node sandboxed containers are a valid cloud setup and need no config map
 * at all, so the ordering constraint is advice now, not a gate (issue #69).
 */

/** `[data, loaded, loadError]` — mirrors the SDK's WatchK8sResult tuple. */
type WatchResult = [unknown, boolean, unknown];

declare global {
  interface Window {
    __watchResults?: Record<string, WatchResult>;
  }
}

const PEER_PODS_CM = 'peer-pods-cm';
/** A peer-pods-cm that does not exist: a named watch for a missing object 404s, never loading. */
const ABSENT: WatchResult = [undefined, false, { code: 404, message: 'not found' }];

const renderSetup = (peerPodsCm: WatchResult) => {
  // No KataConfig either — the state a fresh cluster starts in, and the one that was blocked.
  window.__watchResults = { [PEER_PODS_CM]: peerPodsCm, __list: [[], true, undefined] };
  return render(
    <MemoryRouter initialEntries={['/sandboxes/setup']}>
      <OscSetup />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  window.__watchResults = {};
});

describe('OscSetup — creating a KataConfig without peer pods', () => {
  it('offers Create KataConfig even when no peer pods config map exists', () => {
    renderSetup(ABSENT);

    expect(screen.getByRole('button', { name: 'Create KataConfig' })).toBeInTheDocument();
  });

  // The ordering advice is still worth giving — it just must not be phrased as a prerequisite.
  it('advises on ordering without demanding it, and points at the on-node alternative', () => {
    renderSetup(ABSENT);

    expect(
      screen.getByText(/Going to use peer pods\? Configure the peer pods config map first/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/For on-node sandboxed containers you do not need one/),
    ).toBeInTheDocument();
    // The old copy read as a hard prerequisite.
    expect(
      screen.queryByText(/^Configure the peer pods config map first\./),
    ).not.toBeInTheDocument();
  });

  it('drops the advice once the config map is there', () => {
    renderSetup([{ data: { CLOUD_PROVIDER: 'azure' } }, true, undefined]);

    expect(screen.getByRole('button', { name: 'Create KataConfig' })).toBeInTheDocument();
    expect(screen.queryByText(/Going to use peer pods\?/)).not.toBeInTheDocument();
  });
});
