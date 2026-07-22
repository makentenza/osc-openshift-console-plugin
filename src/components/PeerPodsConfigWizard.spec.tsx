import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import PeerPodsConfigWizard from './PeerPodsConfigWizard';

/** `[data, loaded, loadError]` — mirrors the SDK's WatchK8sResult tuple. */
type WatchResult = [unknown, boolean, unknown];

declare global {
  interface Window {
    __watchResults?: Record<string, WatchResult>;
    __k8sCreateCalls?: unknown[];
    __k8sUpdateCalls?: unknown[];
  }
}

const PEER_PODS_CM = 'peer-pods-cm';
/** A peer-pods-cm that does not exist yet: the named watch 404s and never flips `loaded`. */
const ABSENT: WatchResult = [undefined, false, { code: 404, message: 'not found' }];

const renderWizard = (peerPodsCm: WatchResult) => {
  window.__watchResults = { [PEER_PODS_CM]: peerPodsCm };
  return render(
    <MemoryRouter initialEntries={['/sandboxes/setup/peer-pods']}>
      <PeerPodsConfigWizard />
    </MemoryRouter>,
  );
};

/** Render with the cluster reporting a platform, so the wizard preselects that provider. */
const renderOn = (platform: string, peerPodsCm: WatchResult = ABSENT) => {
  window.__watchResults = {
    [PEER_PODS_CM]: peerPodsCm,
    cluster: [{ status: { platform } }, true, undefined],
  };
  return render(
    <MemoryRouter initialEntries={['/sandboxes/setup/peer-pods']}>
      <PeerPodsConfigWizard />
    </MemoryRouter>,
  );
};

/** The ConfigMap `data` the wizard just wrote, whether it created or updated. */
const written = (): Record<string, string> => {
  const calls = [...(window.__k8sCreateCalls ?? []), ...(window.__k8sUpdateCalls ?? [])];
  const payload = calls[calls.length - 1] as { data?: { data?: Record<string, string> } };
  return payload?.data?.data ?? {};
};

const submit = async (name: 'Create' | 'Save') => {
  await userEvent.click(screen.getByRole('button', { name }));
  await waitFor(() => {
    expect(Object.keys(written())).not.toHaveLength(0);
  });
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

/**
 * Azure is the only provider where confidential VMs are a choice, and the wizard never wrote
 * DISABLECVM for it — so peer pods inherited the cloud-api-adaptor's confidential default with no
 * way to opt out from the UI (issue #68).
 */
describe('PeerPodsConfigWizard — Azure confidential computing', () => {
  beforeEach(() => {
    window.__watchResults = {};
    window.__k8sCreateCalls = [];
    window.__k8sUpdateCalls = [];
  });

  it('writes non-confidential by default on a new Azure config map', async () => {
    renderOn('Azure');

    expect(screen.getByLabelText(/Run pod VMs as Azure Confidential VMs/)).not.toBeChecked();
    await submit('Create');

    expect(written().CLOUD_PROVIDER).toBe('azure');
    expect(written().DISABLECVM).toBe('true');
  });

  it('writes DISABLECVM=false once confidential computing is switched on', async () => {
    renderOn('Azure');

    await userEvent.click(screen.getByLabelText(/Run pod VMs as Azure Confidential VMs/));
    await submit('Create');

    expect(written().DISABLECVM).toBe('false');
  });

  // Someone already running confidential peer pods must not be flipped by opening the wizard.
  it('keeps confidential on for a config map that already asks for it', async () => {
    renderWizard([
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: PEER_PODS_CM, namespace: 'openshift-sandboxed-containers-operator' },
        data: { CLOUD_PROVIDER: 'azure', DISABLECVM: 'false' },
      },
      true,
      undefined,
    ]);

    expect(screen.getByLabelText(/Run pod VMs as Azure Confidential VMs/)).toBeChecked();
    await submit('Save');

    expect(written().DISABLECVM).toBe('false');
    // The merge would preserve an untouched key on its own, so prove the wizard wrote this one:
    // toggling off must reach the config map, which only happens if Azure is written every time.
    await userEvent.click(screen.getByLabelText(/Run pod VMs as Azure Confidential VMs/));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(written().DISABLECVM).toBe('true');
    });
  });

  /**
   * DISABLECVM is a Go boolean to the cloud-api-adaptor, so "False" already means confidential.
   * Recognising only the exact string 'false' read such a config map as saying the opposite of what
   * it says — and, because Azure is now written on every save, silently rewrote it.
   */
  it.each(['False', 'FALSE', '0', 'f'])(
    'treats DISABLECVM=%s as confidential rather than overwriting it',
    async (spelling) => {
      renderWizard([
        {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: PEER_PODS_CM, namespace: 'openshift-sandboxed-containers-operator' },
          data: { CLOUD_PROVIDER: 'azure', DISABLECVM: spelling },
        },
        true,
        undefined,
      ]);

      expect(screen.getByLabelText(/Run pod VMs as Azure Confidential VMs/)).toBeChecked();
      await submit('Save');

      expect(written().DISABLECVM).toBe('false');
    },
  );

  /**
   * The deliberate behaviour change, pinned so it cannot be "fixed" by accident: a config map
   * written before this existed has no DISABLECVM key at all and is implicitly confidential. Saving
   * it through the wizard now pins it non-confidential, matching AWS and GCP. Flipping this back
   * means changing the default, not patching around it.
   */
  it('pins an existing config map that never stated a choice to non-confidential', async () => {
    renderWizard([
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: PEER_PODS_CM, namespace: 'openshift-sandboxed-containers-operator' },
        data: { CLOUD_PROVIDER: 'azure', AZURE_REGION: 'westeurope' },
      },
      true,
      undefined,
    ]);

    expect(screen.getByLabelText(/Run pod VMs as Azure Confidential VMs/)).not.toBeChecked();
    await submit('Save');

    expect(written().DISABLECVM).toBe('true');
    // Everything else it already had survives the save.
    expect(written().AZURE_REGION).toBe('westeurope');
  });

  // AWS and GCP have no confidential support in OSC 1.12 — they stay forced, and get no toggle.
  it('leaves AWS forced to non-confidential and offers no toggle', async () => {
    renderOn('AWS');

    expect(
      screen.queryByLabelText(/Run pod VMs as Azure Confidential VMs/),
    ).not.toBeInTheDocument();
    await submit('Create');

    expect(written().CLOUD_PROVIDER).toBe('aws');
    expect(written().DISABLECVM).toBe('true');
  });
});

/**
 * The cloud-api-adaptor reads these allow-lists verbatim, so " Standard_D4as_v5" never matches a
 * workload's request. The wizard used to push that on the user ("Comma-separated, no spaces").
 */
describe('PeerPodsConfigWizard — comma-separated allow-lists', () => {
  beforeEach(() => {
    window.__watchResults = {};
    window.__k8sCreateCalls = [];
    window.__k8sUpdateCalls = [];
  });

  it('strips the spaces a user types around commas in the Azure sizes', async () => {
    renderOn('Azure');

    await userEvent.type(
      screen.getByLabelText('Allowed instance sizes'),
      'Standard_D2as_v5, Standard_D4as_v5 ,Standard_D8as_v5',
    );
    await submit('Create');

    expect(written().AZURE_INSTANCE_SIZES).toBe(
      'Standard_D2as_v5,Standard_D4as_v5,Standard_D8as_v5',
    );
  });

  it('strips them from the AWS instance types too', async () => {
    renderOn('AWS');

    await userEvent.type(screen.getByLabelText('Allowed instance types'), 't2.small, t3.large');
    await submit('Create');

    expect(written().PODVM_INSTANCE_TYPES).toBe('t2.small,t3.large');
  });

  it('strips them from the AWS security group IDs', async () => {
    renderOn('AWS');

    await userEvent.type(screen.getByLabelText('Security group IDs'), 'sg-0abc, sg-0def');
    await submit('Create');

    expect(written().AWS_SG_IDS).toBe('sg-0abc,sg-0def');
  });

  it.each(['Azure', 'AWS'])('no longer tells the user to avoid spaces on %s', (platform) => {
    renderOn(platform);

    expect(screen.queryByText(/Comma-separated, no spaces/)).not.toBeInTheDocument();
  });
});

/**
 * Writing a key only when it is true left the old value in place through the save merge, so
 * switching "Use public IP" back off on an existing config map did nothing — the wizard showed off
 * while the cluster went on routing pod VM traffic over public IPs.
 */
describe('PeerPodsConfigWizard — turning a switch back off', () => {
  beforeEach(() => {
    window.__watchResults = {};
    window.__k8sCreateCalls = [];
    window.__k8sUpdateCalls = [];
  });

  it('clears USE_PUBLIC_IP on an existing config map', async () => {
    renderWizard([
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: PEER_PODS_CM, namespace: 'openshift-sandboxed-containers-operator' },
        data: { CLOUD_PROVIDER: 'azure', USE_PUBLIC_IP: 'true' },
      },
      true,
      undefined,
    ]);

    await userEvent.click(screen.getByText('Advanced options'));
    const publicIp = screen.getByLabelText(/Reach pod VMs over their public IP/);
    expect(publicIp).toBeChecked();

    await userEvent.click(publicIp);
    await submit('Save');

    expect(written().USE_PUBLIC_IP).toBe('false');
  });
});
