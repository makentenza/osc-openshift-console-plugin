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

/** A peer-pods-cm that does not exist yet: the named watch 404s and never flips `loaded`. */
const ABSENT: WatchResult = [undefined, false, { code: 404, message: 'not found' }];

/** Mount with the cluster reporting a platform, so the wizard preselects that provider. */
const mountOn = (platform: string, peerPodsCm: WatchResult = ABSENT) => {
  window.__watchResults = {
    [PEER_PODS_CM]: peerPodsCm,
    Infrastructure: [{ status: { platform } }, true, undefined],
  };
  cy.mount(
    <MemoryRouter initialEntries={['/sandboxes/setup/peer-pods']}>
      <PeerPodsConfigWizard />
    </MemoryRouter>,
  );
};

/** The ConfigMap data the wizard just wrote, whether it created or updated. */
const written = (): Record<string, string> => {
  const calls = [...(window.__k8sCreateCalls ?? []), ...(window.__k8sUpdateCalls ?? [])];
  const payload = calls[calls.length - 1] as { data?: { data?: Record<string, string> } };
  return payload?.data?.data ?? {};
};

const resetCalls = () => {
  window.__watchResults = {};
  window.__k8sCreateCalls = [];
  window.__k8sUpdateCalls = [];
};

/*
 * Azure is the only provider where confidential VMs are a choice, and the wizard never wrote
 * DISABLECVM for it — so peer pods inherited the cloud-api-adaptor's confidential default with no
 * way to opt out from the UI (issue #68).
 */
describe('PeerPodsConfigWizard — Azure confidential computing', () => {
  beforeEach(resetCalls);

  it('writes non-confidential by default on a new Azure config map', () => {
    mountOn('Azure');

    cy.contains('label', 'Run pod VMs as Azure Confidential VMs')
      .find('input')
      .should('not.be.checked');
    cy.contains('button', 'Create').click();
    cy.wrap(null).should(() => {
      expect(written().CLOUD_PROVIDER).to.equal('azure');
      expect(written().DISABLECVM).to.equal('true');
    });
  });

  it('writes DISABLECVM=false once confidential computing is switched on', () => {
    mountOn('Azure');

    cy.contains('label', 'Run pod VMs as Azure Confidential VMs').click();
    cy.contains('button', 'Create').click();
    cy.wrap(null).should(() => {
      expect(written().DISABLECVM).to.equal('false');
    });
  });

  // DISABLECVM is a Go boolean to the adaptor, so "False" already means confidential.
  it('treats DISABLECVM=False as confidential rather than overwriting it', () => {
    mountOn('Azure', [{ data: { CLOUD_PROVIDER: 'azure', DISABLECVM: 'False' } }, true, undefined]);

    cy.contains('label', 'Run pod VMs as Azure Confidential VMs')
      .find('input')
      .should('be.checked');
    cy.contains('button', 'Save').click();
    cy.wrap(null).should(() => {
      expect(written().DISABLECVM).to.equal('false');
    });
  });

  // AWS and GCP have no confidential support in OSC 1.12 — forced, and no toggle.
  it('leaves AWS forced to non-confidential and offers no toggle', () => {
    mountOn('AWS');

    cy.contains('Run pod VMs as Azure Confidential VMs').should('not.exist');
    cy.contains('button', 'Create').click();
    cy.wrap(null).should(() => {
      expect(written().CLOUD_PROVIDER).to.equal('aws');
      expect(written().DISABLECVM).to.equal('true');
    });
  });
});

/*
 * The cloud-api-adaptor reads these allow-lists verbatim, so " Standard_D4as_v5" never matches a
 * workload's request. The wizard used to push that on the user ("Comma-separated, no spaces").
 */
describe('PeerPodsConfigWizard — comma-separated allow-lists', () => {
  beforeEach(resetCalls);

  it('strips the spaces a user types around commas', () => {
    mountOn('Azure');

    cy.contains('label', 'Allowed instance sizes')
      .invoke('attr', 'for')
      .then((id) => cy.get(`#${id}`).type('Standard_D2as_v5, Standard_D4as_v5 ,Standard_D8as_v5'));
    cy.contains('button', 'Create').click();

    cy.wrap(null).should(() => {
      expect(written().AZURE_INSTANCE_SIZES).to.equal(
        'Standard_D2as_v5,Standard_D4as_v5,Standard_D8as_v5',
      );
    });
  });

  it('no longer tells the user to avoid spaces', () => {
    mountOn('Azure');

    cy.contains('Comma-separated, no spaces').should('not.exist');
  });
});
