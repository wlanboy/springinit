#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

IMAGE="registry.gmk.lan/springinit:latest"
NAMESPACE="springinit"

echo "==> Baue Image (Dockerfile) ..."
docker build -f Dockerfile -t springinit .

echo "==> Tagge Image als $IMAGE ..."
docker tag springinit "$IMAGE"

echo "==> Push Image nach $IMAGE ..."
docker push "$IMAGE"

echo "==> Helm-Upgrade springinit ..."
helm upgrade springinit ./springinit-chart -n "$NAMESPACE"

echo "==> Rollout-Restart springinit ..."
kubectl rollout restart deployment/springinit -n "$NAMESPACE"

echo
echo "Fertig."
