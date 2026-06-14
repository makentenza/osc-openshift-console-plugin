import { MemoryRouter } from 'react-router-dom-v5-compat';
import PeerPodsConfigWizard from '../../src/components/PeerPodsConfigWizard';
import type { WatchResult } from '../mocks/dynamic-plugin-sdk';

const PEER_PODS_CM = 'peer-pods-cm';

const mountWizard = (peerPodsCm: WatchResult) => {
  window.__watchResults = { [PEER_PODS_CM]: peerPodsCm };
  cy.mount(
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
    mountWizard([undefined, false, { code: 404, message: 'not found' }]);

    cy.contains('button', 'Create').should('be.visible').and('not.be.disabled');
    cy.contains('button', 'Save').should('not.exist');
  });

  it('keeps Create disabled while the watch is still loading (no result, no error yet)', () => {
    mountWizard([undefined, false, undefined]);

    cy.contains('button', 'Create').should('be.disabled');
  });

  it('shows an enabled Save (not Create) when peer-pods-cm already exists', () => {
    mountWizard([
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: PEER_PODS_CM, namespace: 'openshift-sandboxed-containers-operator' },
        data: { CLOUD_PROVIDER: 'gcp' },
      },
      true,
      undefined,
    ]);

    cy.contains('button', 'Save').should('not.be.disabled');
    cy.contains('button', 'Create').should('not.exist');
  });
});
