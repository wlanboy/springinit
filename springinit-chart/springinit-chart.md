# Helm Chart: springinit

Helm Chart für das Deployment des `springinit`-Services (Spring-Boot-Service zum Testen von
HTTP-Routen in Kubernetes) in Kubernetes, mit Istio als Ingress-Weg und cert-manager für TLS.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Chart-Name | `springinit` |
| Chart-Version | 0.1.0 |
| App-Version | `latest` |
| Typ | `application` |

## Komponenten

- **Deployment** (`templates/deployment.yaml`) – 1 Replica des Containers
  `registry.gmk.lan/springinit`, mit Liveness-Probe (`GET /actuator/health/liveness`) und
  Readiness-Probe (`GET /actuator/health/readiness`). Keine Persistenz nötig.
- **Service** (`templates/service.yaml`) – ClusterIP-Service, leitet Traffic an die Pods weiter.
- **Gateway** (`templates/gateway.yaml`) – Istio `Gateway` auf Port 80/HTTP und, sofern
  `certmanager.enabled: true`, zusätzlich 443/HTTPS für die konfigurierten Hosts.
- **VirtualService** (`templates/virtualservice.yaml`) – Istio `VirtualService`, routet Traffic
  vom Gateway (und dem internen `mesh`-Gateway) zum Service.
- **Certificate** (`templates/certificate.yaml`, nur bei `certmanager.enabled: true`) –
  cert-manager `Certificate`, stellt das TLS-Secret für das Istio-Gateway bereit.

## Konfiguration (`values.yaml`)

| Key | Beschreibung | Default |
|---|---|---|
| `replicaCount` | Anzahl Replicas | `1` |
| `deploymentName` | Name für Deployment, Service, VirtualService | `springinit` |
| `namespace` | Ziel-Namespace (informativ – wird beim `helm install/upgrade -n` gesetzt, nicht aus diesem Wert gerendert) | `springinit` |
| `image.repository` / `image.tag` / `image.pullPolicy` | Container-Image | `registry.gmk.lan/springinit`, `latest`, `Always` |
| `hosts` | Liste externer Hostnamen für Gateway, VirtualService und Certificate | `hello.gmk.lan`, `hello.localhost` |
| `service.port` / `service.targetPort` | Service- und Container-Port | `8080` |
| `istio.gateway` | Name des Istio-Gateway-Objekts | `springinit-gateway` |
| `istio.gatewayNamespace` | Namespace, in dem das TLS-Secret für das Gateway liegt | `istio-ingress` |
| `certmanager.enabled` | cert-manager `Certificate` für das Istio-TLS-Secret erzeugen | `true` |
| `certmanager.issuer` / `certmanager.kind` | cert-manager Issuer-Referenz | `local-ca-issuer`, `ClusterIssuer` |
| `certmanager.secretName` | Name des TLS-Secrets (Certificate + Gateway) | `springinit-tls` |
| `resources` | Requests/Limits des Containers | `128Mi` Memory, `50m` CPU-Request |

## Installation

```bash
kubectl create namespace springinit
kubectl label namespace springinit istio-injection=enabled --overwrite
helm install springinit ./springinit-chart -n springinit --create-namespace
```

Das `istio-injection`-Label wird benötigt, damit die Pods einen Istio-Sidecar erhalten.

```bash
kubectl get gateway,virtualservice,certificate -n springinit
helm status springinit -n springinit
```

Erreichbar danach unter `https://hello.gmk.lan` bzw. `https://hello.localhost`.

## Upgrade

```bash
helm upgrade springinit ./springinit-chart -n springinit --set image.tag=1.2.3
kubectl rollout restart deployment/springinit -n springinit
```

## Deinstallation

```bash
helm uninstall springinit -n springinit
```

## Hinweise

- Die JVM-Optionen sind im `ENTRYPOINT` des Dockerfiles fest hinterlegt und auf ein
  Container-Limit von 128 MB ausgelegt (`MaxRAMPercentage=50`, SerialGC, C1-only). Wer
  `resources.limits.memory` ändert, ändert damit implizit auch die Heap-Größe.
- Der Gateway-Selector ist im Template fest auf `istio: ingressgateway` gesetzt.
- Der VirtualService exportiert die Route auf `.` (eigener Namespace), `istio-ingress` und
  `istio-system` und bindet sowohl das eigene Gateway als auch `mesh` ein.
- Der `hello.gmk.lan`-CNAME muss auf die Istio-Ingress-Gateway-VIP zeigen.
  `hello.localhost` löst lokal auf `127.0.0.1` auf und funktioniert z. B. mit einem lokalen
  Cluster (kind/k3d) mit Port-Mapping auf das Ingress-Gateway.

## Testen

```bash
helm lint ./springinit-chart
helm template springinit ./springinit-chart

# sicherstellen, dass bei deaktiviertem cert-manager kein Certificate und kein HTTPS-Server entstehen
helm template springinit ./springinit-chart --set certmanager.enabled=false | grep -E "Certificate|HTTPS"
```
