/**
 * Build the fully-qualified GCP network resource path the cloud-api-adaptor expects in
 * GCP_NETWORK. MachineSets (and a bare UI default) carry only the short network name, which the
 * adaptor rejects — it needs `projects/<project>/global/networks/<name>` (issue #11). An already
 * qualified value, or a missing project, is returned unchanged (best effort).
 */
export const toGcpNetworkPath = (network?: string, project?: string): string | undefined => {
  if (!network) return network;
  if (network.includes('/')) return network; // already a full or partial resource path
  if (!project) return network; // can't qualify without the project
  return `projects/${project}/global/networks/${network}`;
};
