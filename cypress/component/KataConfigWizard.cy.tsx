import { MemoryRouter, Route, Routes } from 'react-router-dom-v5-compat';
import KataConfigWizard from '../../src/components/KataConfigWizard';
import type { WatchResult } from '../mocks/dynamic-plugin-sdk';

/*
 * peer-pods-cm has to exist before the KataConfig — but only if peer pods are actually wanted. That
 * constraint used to be enforced by hiding the Create KataConfig action on the checklist entirely,
 * which forced peer pods on everyone. It lives here now, next to the switch that decides it, and it
 * warns rather than blocks (issue #69).
 */

/** peer-pods-cm does not exist: a named watch for a missing object 404s, never loading. */
const ABSENT: WatchResult = [undefined, false, { code: 404, message: 'not found' }];
/** The watch has not settled yet — neither loaded nor errored. */
const LOADING: WatchResult = [undefined, false, undefined];
const CONFIGURED: WatchResult = [{ data: { CLOUD_PROVIDER: 'azure' } }, true, undefined];

const mountWizard = (peerPodsCm: WatchResult = ABSENT) => {
  window.__watchResults = { 'peer-pods-cm': peerPodsCm };
  cy.mount(
    <MemoryRouter initialEntries={['/sandboxes/setup/kataconfig']}>
      <KataConfigWizard />
    </MemoryRouter>,
  );
};

const WARNING = 'The operator reads peer-pods-cm while installing this';

describe('KataConfigWizard — peer pods config map', () => {
  beforeEach(() => {
    window.__watchResults = {};
    window.__k8sCreateCalls = [];
  });

  it('warns when peer pods are on and no config map exists', () => {
    mountWizard(ABSENT);

    cy.contains(WARNING).should('exist');
  });

  // The whole point of #69: warning, never blocking.
  it('still lets the KataConfig be created', () => {
    mountWizard(ABSENT);

    cy.contains('button', 'Create').should('not.be.disabled');
  });

  // On-node sandboxed containers need no config map, so the warning is irrelevant there.
  it('drops the warning when peer pods are switched off', () => {
    mountWizard(ABSENT);

    cy.contains('label', 'Run pods as cloud VMs').click();

    cy.contains(WARNING).should('not.exist');
    cy.contains('button', 'Create').should('not.be.disabled');
  });

  it('says nothing when the config map is already configured', () => {
    mountWizard(CONFIGURED);

    cy.contains(WARNING).should('not.exist');
  });

  // Answering before the watch settles would flash the warning at someone who does have one.
  it('says nothing while the watch is still in flight', () => {
    mountWizard(LOADING);

    cy.contains(WARNING).should('not.exist');
  });
});

/*
 * Creating a KataConfig only starts a rollout, so the wizard hands off to the checklist — the screen
 * that tracks it node by node — rather than the overview, which read as "done" (issue #64).
 */
describe('KataConfigWizard — where Create leaves you', () => {
  beforeEach(() => {
    window.__watchResults = {};
    window.__k8sCreateCalls = [];
  });

  it('creates the KataConfig, then hands off to the setup checklist', () => {
    window.__watchResults = { 'peer-pods-cm': CONFIGURED };
    // Real routes, so where navigate() lands is observable rather than asserted on a spy.
    cy.mount(
      <MemoryRouter initialEntries={['/sandboxes/setup/kataconfig']}>
        <Routes>
          <Route path="/sandboxes/setup/kataconfig" element={<KataConfigWizard />} />
          <Route path="/sandboxes/setup" element={<h1>SETUP CHECKLIST</h1>} />
          <Route path="/sandboxes" element={<h1>OVERVIEW</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    cy.contains('button', 'Create').click();

    cy.wrap(null).should(() => {
      const kinds = (window.__k8sCreateCalls ?? []).map(
        (c) => (c as { data?: { kind?: string } }).data?.kind,
      );
      expect(kinds).to.include('KataConfig');
    });
    // The overview greeted a just-created KataConfig with a green "Installed" check.
    cy.contains('SETUP CHECKLIST').should('exist');
    cy.contains('OVERVIEW').should('not.exist');
  });
});
