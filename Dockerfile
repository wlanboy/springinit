# ============================
# 1. Build Stage (Java 25)
# ============================
FROM registry.access.redhat.com/ubi10/openjdk-25:latest AS build
# Red Hat UBI 10 Builder-Image mit OpenJDK 25 und Maven

WORKDIR /app

RUN mkdir -p /app/config /app/data && \
    touch /app/config/.keep /app/data/.keep && \
    chmod -R g+w /app/config /app/data

COPY pom.xml .
# → Nur die pom.xml wird kopiert, damit Maven bereits alle Dependencies auflösen kann,
#   ohne dass sich der Sourcecode ändert. Das verbessert das Layer-Caching.

RUN --mount=type=cache,target=/root/.m2 mvn -q -DskipTests dependency:go-offline
# → Lädt alle Maven-Dependencies vorab herunter.
# → --mount=type=cache sorgt dafür, dass das lokale Maven-Repository zwischen Builds gecached wird.

COPY src ./src
# → Jetzt erst der Sourcecode, damit Änderungen am Code nicht das Dependency-Layer invalidieren.

RUN --mount=type=cache,target=/root/.m2 mvn -q -DskipTests compile spring-boot:process-aot package
# → Baut das eigentliche JAR mit AOT (Ahead-of-Time) Processing.
# → compile: Kompiliert die Klassen (notwendig für process-aot).
# → spring-boot:process-aot: Generiert AOT-Metadaten basierend auf den kompilierten Klassen.
# → package: Baut das finale JAR inkl. AOT-Klassen.
# → Wieder mit Maven-Cache, um Build-Zeit zu sparen.

RUN cp target/*.jar app.jar && \
    java -Djarmode=tools -jar app.jar extract --layers --launcher --destination extracted
# → Spring Boot 4.x Layertools: --launcher ist erforderlich um den Loader zu extrahieren
# → Extrahierte Layer:
#     - dependencies (BOOT-INF/lib)
#     - spring-boot-loader (org/springframework/boot/loader/*)
#     - snapshot-dependencies
#     - application (BOOT-INF/classes)
# → Vorteil: Docker kann diese Layer getrennt cachen → schnellere Deployments.

# ============================
# 2. Runtime Stage (Java 25)
# ============================
FROM registry.access.redhat.com/ubi10/openjdk-25-runtime:latest

# OCI-konforme Labels
LABEL org.opencontainers.image.title="Spring Init" \
      org.opencontainers.image.description="Spring based service to test http routes in kubernetes." \
      org.opencontainers.image.version="0.0.1-SNAPSHOT" \
      org.opencontainers.image.vendor="wlanboy" \
      org.opencontainers.image.source="https://github.com/wlanboy/springinit" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.base.name="ubi10/openjdk-25-runtime"

WORKDIR /app

USER 185

COPY --from=build --chown=185:0 /app/config /app/config
# → /app/config: für externe Konfigurationen (aus Build-Stage übernommen)

COPY --from=build --chown=185:0 /app/data /app/data
# → /app/data: für persistente Daten (aus Build-Stage übernommen)

COPY --from=build --chown=185:185 /app/extracted/dependencies/ ./
# → Kopiert nur die Dependency-Layer. Ändern sich selten.

COPY --from=build --chown=185:185 /app/extracted/observability-dependencies/ ./
# → Micrometer, SpringDoc – eigener Release-Zyklus.

COPY --from=build --chown=185:185 /app/extracted/spring-boot-loader/ ./
# → Enthält den Spring Boot Launcher (Main-Class Loader). Ändern sich selten.

COPY --from=build --chown=185:185 /app/extracted/snapshot-dependencies/ ./
# → Snapshot-Dependencies (z. B. lokale libs), ändern sich häufiger.

COPY --from=build --chown=185:185 /app/extracted/application-resources/ ./
# → Konfigurationsdateien (yml, properties, xml). Invalidiert nicht den Class-Layer.

COPY --from=build --chown=185:185 /app/extracted/application/ ./
# → Der eigentliche Applikationscode (Kompilat). Ändert sich.

COPY --chown=185:185 containerconfig/application.properties /app/config/application.properties
# → Externe Konfiguration ins Config-Verzeichnis für die Referenz für ENV Vars

RUN java -XX:ArchiveClassesAtExit=/app/app.jsa \
         -Dspring.context.exit=onRefresh \
         -Dspring.aot.enabled=true \
         -Dspring.config.location=file:/app/config/application.properties \
         org.springframework.boot.loader.launch.JarLauncher
# → CDS-Trainingslauf: Startet die App bis zum Context-Refresh und schreibt die geladenen Klassen in app.jsa.
# → Läuft bewusst in der Runtime-Stage: CDS verlangt zur Laufzeit denselben Classpath
#   (hier /app als exploded JAR) und dieselbe JVM wie beim Erzeugen des Archivs.

EXPOSE 8080
# → Dokumentiert den Port, den die App verwendet (Spring Boot Default).

# Wir nutzen exec, damit Java die PID 1 übernimmt.
# Dies ist wichtig für das Signal-Handling (z.B. in Kubernetes).
# exec ersetzt den aktuellen Shell-Prozess durch den Java-Prozess.

# JVM-Optionen:
# -Djava.security.egd: Beschleunigt kryptografische Initialisierung
# -XX:MaxRAMPercentage=50: Java nutzt max 50% des Container-RAMs
# -XX:InitialRAMPercentage=30: Startet mit 30% RAM (schnellerer Startup)
# -XX:+UseG1GC: G1 Garbage Collector für niedrige Latenz
# -XX:MaxGCPauseMillis=200: Zielwert für GC-Pause
# -XX:+ExplicitGCInvokesConcurrent: System.gc() läuft parallel
# -XX:+ExitOnOutOfMemoryError: JVM beendet bei OOM (Kubernetes kann neustarten)
ENTRYPOINT ["java", \
  "-XX:SharedArchiveFile=/app/app.jsa", \
  "-Dspring.aot.enabled=true", \
  "-Djava.security.egd=file:/dev/./urandom", \
  "-XX:MaxRAMPercentage=50", \
  "-XX:InitialRAMPercentage=30", \
  "-XX:+UseG1GC", \
  "-XX:MaxGCPauseMillis=200", \
  "-XX:+ExplicitGCInvokesConcurrent", \
  "-XX:+ExitOnOutOfMemoryError", \
  "-Dspring.config.location=file:/app/config/application.properties", \
  "org.springframework.boot.loader.launch.JarLauncher"]