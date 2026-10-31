const $ = (id) => document.getElementById(id);

async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    // Health liefert bei DOWN 503, der Body ist trotzdem gültig
    return { ok: res.ok, data: await res.json() };
}

async function loadHealth() {
    const pill = $("health-pill");
    const card = document.querySelector(".card--status");
    try {
        const { data } = await fetchJson("/actuator/health");
        const status = data.status ?? "UNKNOWN";
        const state = status === "UP" ? "up" : "down";
        pill.dataset.state = state;
        card.dataset.state = state;
        $("health-text").textContent = status.toLowerCase();
        $("status-value").textContent = status;
        $("status-meta").textContent = "zuletzt " + new Date().toLocaleTimeString("de-DE");
    } catch {
        pill.dataset.state = "down";
        card.dataset.state = "down";
        $("health-text").textContent = "offline";
        $("status-value").textContent = "OFFLINE";
    }
}

function timeAgo(date) {
    const minutes = Math.round((Date.now() - date) / 60000);
    const rtf = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
    if (Math.abs(minutes) < 60) return rtf.format(-minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
    return rtf.format(-Math.round(hours / 24), "day");
}

async function loadInfo() {
    try {
        const { data } = await fetchJson("/actuator/info");
        const build = data.build;
        if (!build) return;
        $("version-value").textContent = build.version ?? "—";
        $("artifact-meta").textContent = [build.group, build.artifact].filter(Boolean).join(":");
        if (build.name) $("app-name").textContent = build.name;
        if (build.time) {
            const time = new Date(build.time);
            // Reproduzierbare Builds setzen einen festen Zeitstempel (1980), der keine echte Buildzeit ist
            if (time.getFullYear() <= 1980) {
                $("build-time").textContent = "reproducible";
                $("build-ago").textContent = "fester Zeitstempel";
                return;
            }
            $("build-time").textContent = time.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
            $("build-ago").textContent = timeAgo(time);
        }
    } catch {
        // Ohne build-info bleiben die Platzhalter stehen
    }
}

function tickClock() {
    $("clock").textContent = new Date().toLocaleTimeString("de-DE");
}

loadHealth();
loadInfo();
tickClock();
setInterval(loadHealth, 10000);
setInterval(tickClock, 1000);
