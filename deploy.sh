#!/usr/bin/env bash
#
# Build, push, and roll out the osc-openshift-console-plugin image to the cluster's internal
# image registry, then point the running Deployment at the freshly pushed digest.
#
# Usage:
#   ./deploy.sh              # build + push + roll out
#   ./deploy.sh --no-build   # push the already-built local image + roll out
#
# Requires: oc (logged in), podman, helm (only for the first-time install).
# Override defaults with env vars, e.g. NAMESPACE=foo ./deploy.sh
set -euo pipefail

NAMESPACE="${NAMESPACE:-osc-openshift-console-plugin}"
PLUGIN="${PLUGIN:-osc-openshift-console-plugin}"
TAG="${TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"

command -v oc >/dev/null     || { echo "✗ oc not found";     exit 1; }
command -v podman >/dev/null || { echo "✗ podman not found"; exit 1; }
oc whoami >/dev/null 2>&1     || { echo "✗ not logged in — run 'oc login' first"; exit 1; }

# Discover (and if needed, expose) the internal image-registry route.
REGISTRY="$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}' 2>/dev/null || true)"
if [ -z "${REGISTRY}" ]; then
  echo "==> Exposing the internal image-registry route"
  oc patch configs.imageregistry.operator.openshift.io cluster --type merge \
    -p '{"spec":{"defaultRoute":true}}'
  until REGISTRY="$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}' 2>/dev/null)" && [ -n "${REGISTRY}" ]; do
    sleep 2
  done
fi
EXTERNAL_IMG="${REGISTRY}/${NAMESPACE}/${PLUGIN}:${TAG}"
echo "Registry : ${REGISTRY}"
echo "Image    : ${EXTERNAL_IMG}"

if [ "${1:-}" != "--no-build" ]; then
  echo "==> Building image (${PLATFORM})"
  podman build --platform="${PLATFORM}" -t "${EXTERNAL_IMG}" .
fi

echo "==> Logging in to the registry"
# 'kubeadmin' is a safe username; oc whoami can be 'kube:admin' (the colon breaks login).
podman login -u kubeadmin -p "$(oc whoami -t)" --tls-verify=false "${REGISTRY}" >/dev/null 2>&1 \
  || echo "   (login failed — relying on cached credentials)"

echo "==> Pushing"
podman push --tls-verify=false "${EXTERNAL_IMG}"

echo "==> Resolving the pushed digest"
DIGEST="$(oc get istag "${PLUGIN}:${TAG}" -n "${NAMESPACE}" -o jsonpath='{.image.metadata.name}')"
INTERNAL_REF="image-registry.openshift-image-registry.svc:5000/${NAMESPACE}/${PLUGIN}@${DIGEST}"
echo "   ${INTERNAL_REF}"

if oc get deploy "${PLUGIN}" -n "${NAMESPACE}" >/dev/null 2>&1; then
  CONTAINER="$(oc get deploy "${PLUGIN}" -n "${NAMESPACE}" -o jsonpath='{.spec.template.spec.containers[0].name}')"
  echo "==> Rolling out new image"
  oc set image "deploy/${PLUGIN}" "${CONTAINER}=${INTERNAL_REF}" -n "${NAMESPACE}"
else
  echo "==> First install — deploying via Helm"
  helm upgrade -i "${PLUGIN}" charts/openshift-console-plugin -n "${NAMESPACE}" --create-namespace \
    --set plugin.image="${INTERNAL_REF}"
fi
oc rollout status "deploy/${PLUGIN}" -n "${NAMESPACE}" --timeout=180s

CONSOLE="$(oc get route console -n openshift-console -o jsonpath='{.spec.host}' 2>/dev/null || true)"
echo ""
echo "✓ Deployed. Hard-refresh the console (new build = new entry hash) to load it:"
[ -n "${CONSOLE}" ] && echo "   https://${CONSOLE}/sandboxes"
