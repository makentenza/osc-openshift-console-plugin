import { render, screen } from '@testing-library/react';
import OpenPeerPodsFirewall from './OpenPeerPodsFirewall';

/**
 * Azure's default AllowVnetInBound security rule already permits worker→pod-VM traffic inside the
 * cluster VNet, so the `az network nsg rule create` the step used to render was a no-op on every
 * cluster we have seen. It is gone; only the ports remain documented, for the one case that needs
 * them — a user who has restricted intra-VNet traffic with their own NSG rules (issue #67).
 */

/** `[data, loaded, loadError]` — mirrors the SDK's WatchK8sResult tuple. */
type WatchResult = [unknown, boolean, unknown];

declare global {
  interface Window {
    __watchResults?: Record<string, WatchResult>;
  }
}

const renderOn = (cloudProvider: string) => {
  window.__watchResults = {
    'peer-pods-cm': [{ data: { CLOUD_PROVIDER: cloudProvider } }, true, undefined],
  };
  return render(<OpenPeerPodsFirewall />);
};

beforeEach(() => {
  window.__watchResults = {};
});

describe('OpenPeerPodsFirewall — Azure', () => {
  it('renders no NSG command', () => {
    renderOn('azure');

    expect(screen.queryByText(/az network nsg rule create/)).not.toBeInTheDocument();
    expect(screen.queryByText(/--nsg-name/)).not.toBeInTheDocument();
  });

  it('says no action is needed, and names the ports for a locked-down VNet', () => {
    renderOn('azure');

    expect(screen.getByText(/No action needed on Azure/)).toBeInTheDocument();
    expect(screen.getByText(/allow ports 15150 and 9000/)).toBeInTheDocument();
  });

  // Removing Azure must not disturb the AWS command, which is still needed and still resolved.
  it('leaves the AWS command in place', () => {
    renderOn('aws');

    expect(screen.getByText(/aws ec2 authorize-security-group-ingress/)).toBeInTheDocument();
  });
});
