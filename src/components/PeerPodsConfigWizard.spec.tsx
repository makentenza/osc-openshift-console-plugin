import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import PeerPodsConfigWizard from './PeerPodsConfigWizard';

/** `[data, loaded, loadError]` — mirrors the SDK's WatchK8sResult tuple. */
type WatchResult = [unknown, boolean, unknown];

declare global {
  interface Window {
    __watchResults?: Record<string, WatchResult>;
    __k8sCreateCalls?: unknown[];
  }
}

const PEER_PODS_CM = 'peer-pods-cm';

const renderWizard = (peerPodsCm: WatchResult) => {
  window.__watchResults = { [PEER_PODS_CM]: peerPodsCm };
  return render(
    <MemoryRouter initialEntries={['/sandboxes/setup/peer-pods']}>
      <PeerPodsConfigWizard />
    </MemoryRouter>,
  );
};

describe('PeerPodsConfigWizard — Create button gating', () => {
  beforeEach(() => {
    window.__watchResults = {};
    window.__k8sCreateCalls = [];
  });

  // Regression: a named-resource watch for a CM that does not exist returns a 404
  // that sets loadError but never flips `loaded` to true. The Create button must
  // still enable — gating it on `loaded` left it permanently greyed out.
  it('enables Create when peer-pods-cm does not exist (watch 404s, loaded stays false)', () => {
    renderWizard([undefined, false, { code: 404, message: 'not found' }]);

    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('keeps Create disabled while the watch is still loading (no result, no error yet)', () => {
    renderWizard([undefined, false, undefined]);

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('shows an enabled Save (not Create) when peer-pods-cm already exists', () => {
    renderWizard([
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: PEER_PODS_CM, namespace: 'openshift-sandboxed-containers-operator' },
        data: { CLOUD_PROVIDER: 'gcp' },
      },
      true,
      undefined,
    ]);

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  });
});
