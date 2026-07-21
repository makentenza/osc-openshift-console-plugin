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

const renderOn = (cloudProvider: string, data: Record<string, string> = {}) => {
  window.__watchResults = {
    'peer-pods-cm': [{ data: { CLOUD_PROVIDER: cloudProvider, ...data } }, true, undefined],
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

  // The ports carry different protocols — the deleted command opened both with --protocol '*', so
  // dropping it must not leave a user writing a TCP-only rule that silently kills the VXLAN tunnel.
  it('says no action is needed, and names both ports with their protocols', () => {
    renderOn('azure');

    expect(screen.getByText(/No action needed on Azure/)).toBeInTheDocument();
    expect(screen.getByText(/TCP 15150 \(kata agent\)/)).toBeInTheDocument();
    expect(screen.getByText(/UDP 9000 \(VXLAN tunnel\)/)).toBeInTheDocument();
  });
});

// Removing Azure must not disturb the AWS command, which is still needed and still resolved.
describe('OpenPeerPodsFirewall — AWS is untouched', () => {
  it('still resolves the region and security group into the command', () => {
    renderOn('aws', { AWS_REGION: 'eu-west-2', AWS_SG_IDS: 'sg-0abc123,sg-0def456' });

    expect(screen.getByText(/aws ec2 authorize-security-group-ingress/)).toBeInTheDocument();
    expect(screen.getByText(/--region eu-west-2/)).toBeInTheDocument();
    // The rule targets the pod VM security group, so the first id is the one used.
    expect(screen.getByText(/--group-id sg-0abc123/)).toBeInTheDocument();
    expect(screen.getByText(/FromPort=15150/)).toBeInTheDocument();
    expect(screen.getByText(/FromPort=9000/)).toBeInTheDocument();
    expect(screen.queryByText(/<region>/)).not.toBeInTheDocument();
    expect(screen.queryByText(/<sg-xxxxxxxx>/)).not.toBeInTheDocument();
  });

  it('still marks what the cluster cannot supply as placeholders', () => {
    renderOn('aws');

    expect(screen.getByText(/<sg-xxxxxxxx>/)).toBeInTheDocument();
    expect(screen.getByText(/Replace the placeholder value\(s\)/)).toBeInTheDocument();
  });
});
