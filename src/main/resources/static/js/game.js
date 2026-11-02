/* Bean Runner – kleines Jump & Run für Spring-Boot-Entwickler, ohne Abhängigkeiten. */
(() => {
    'use strict';

    const canvas = document.getElementById('game');
    const dialog = document.getElementById('game-dialog');
    if (!canvas || !canvas.getContext || !dialog || !dialog.showModal) return;
    const ctx = canvas.getContext('2d');
    const frame = canvas.parentElement;
    const modeBtn = document.getElementById('game-mode');

    // ---------- Konstanten (logische Pixel, Höhe ist fix) ----------
    const H = 270;
    const GROUND = 222;
    const P = 26;                 // Spielergröße (Hitbox)
    const GRAVITY = 2600;
    const JUMP_V = 820;
    const DJUMP_V = 700;
    const JUMP_CUT = 340;         // Sprung abbrechen beim Loslassen
    const MAX_FALL = 1400;
    const START_SPEED = 300;
    const MAX_SPEED = 580;
    const STEP = 1 / 60;
    const STORE = 'springinit.runner.';

    const ANNOTATIONS = ['@Bean', '@Service', '@Autowired', '@Component', '@RestController',
        '@Transactional', '@Configuration', '@Value', '@Repository', '@GetMapping'];
    const EXCEPTIONS = [
        {label: 'NPE', cause: 'NullPointerException'},
        {label: 'OOM', cause: 'OutOfMemoryError: Java heap space'},
        {label: 'NoSuchBean', cause: 'NoSuchBeanDefinitionException'},
        {label: 'Circular', cause: 'BeanCurrentlyInCreationException'},
        {label: 'SOE', cause: 'StackOverflowError'},
        {label: 'CME', cause: 'ConcurrentModificationException'},
        {label: ':8080', cause: 'Port 8080 was already in use'},
        {label: 'CNFE', cause: 'ClassNotFoundException'},
    ];
    const LOG_LINES = [
        'INFO  o.s.b.w.e.jetty.JettyWebServer   : Jetty started on port 8080 (http)',
        'INFO  c.e.spring.Application           : Started Application in 0.412 seconds',
        'INFO  o.s.b.a.e.web.EndpointLinksResolver : Exposing 2 endpoints beneath base path \'/actuator\'',
        'DEBUG o.s.b.a.ApplicationAvailabilityBean : Application availability state LivenessState changed to CORRECT',
        'INFO  o.s.c.s.DefaultLifecycleProcessor  : Starting beans in phase 2147483647',
        'WARN  o.s.b.a.o.j.JpaBaseConfiguration   : spring.jpa.open-in-view is enabled by default',
        'INFO  c.e.spring.Application           : Running with Spring Boot v4, Java 25',
        'INFO  o.s.b.w.s.c.ServletWebServerApplicationContext : Root WebApplicationContext: initialization completed',
    ];

    const css = getComputedStyle(document.documentElement);
    const color = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
    const C = {
        bg: color('--bg', '#0a0a12'),
        text: color('--text', '#f2f1f7'),
        muted: color('--muted', '#8c8aa3'),
        pink: color('--pink', '#ff3d81'),
        cyan: color('--cyan', '#22e3ff'),
        lime: color('--lime', '#c4ff3d'),
        violet: color('--violet', '#8b5cff'),
        red: color('--red', '#ff5a5a'),
        coffee: '#ffb35c',
    };
    const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

    // ---------- Zustand ----------
    let W = 960;
    let state = 'ready';          // ready | running | paused | dying | over
    let player, cam, speed, distance, coffee, starters, stomps, cause;
    let ground, platforms, bugs, pickups, particles, genX, segSeed;
    let held = false;
    let time = 0;
    let stateT = 0;
    let shake = 0;
    let bugsOn = load('bugs', '1') !== '0';
    let best = loadBest();
    let newBest = false;

    const rand = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const hash = (i) => {
        const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
        return s - Math.floor(s);
    };
    const playerX = () => Math.min(150, W * 0.22);

    function load(key, fallback) {
        try {
            return localStorage.getItem(STORE + key) ?? fallback;
        } catch {
            return fallback;
        }
    }

    function save(key, value) {
        try {
            localStorage.setItem(STORE + key, String(value));
        } catch {
            /* Storage nicht verfügbar – gilt nur für diese Sitzung */
        }
    }

    // getrennter Rekord pro Modus
    function bestKey() {
        return bugsOn ? 'best' : 'best.nobugs';
    }

    function loadBest() {
        return parseInt(load(bestKey(), '0'), 10) || 0;
    }

    function saveBest(v) {
        save(bestKey(), v);
    }

    function score() {
        return Math.floor(distance / 10) + coffee * 25 + starters * 100 + stomps * 50;
    }

    // ---------- Welt ----------
    function reset() {
        player = {x: 0, y: GROUND - P, vy: 0, onGround: true, jumps: 0, coyote: 0, buffer: 0, squash: 0};
        speed = START_SPEED;
        distance = 0;
        coffee = 0;
        starters = 0;
        stomps = 0;
        cause = '';
        ground = [];
        platforms = [];
        bugs = [];
        pickups = [];
        particles = [];
        newBest = false;
        segSeed = 0;
        cam = player.x - playerX();

        // sicherer Start ohne Gegner
        ground.push({x: -600, w: 1500, seed: segSeed++});
        genX = 900;
        for (let i = 0; i < 4; i++) pickups.push({x: 420 + i * 40, y: GROUND - 34, type: 'coffee', taken: false});
        ensureWorld();
    }

    function addPickup(x, y) {
        // selten ein Spring-Blatt (Starter) statt Kaffee
        pickups.push({x, y, type: Math.random() < 0.08 ? 'leaf' : 'coffee', taken: false});
    }

    function ensureWorld() {
        while (genX < cam + W + 600) generate();
    }

    function generate() {
        const difficulty = (speed - START_SPEED) / (MAX_SPEED - START_SPEED);
        const gap = rand(70, 70 + Math.min(110, 40 + (speed - START_SPEED) * 0.4));
        const gapStart = genX;
        genX += gap;
        const x = genX;
        const w = rand(260, 640);
        ground.push({x, w, seed: segSeed++});
        genX += w;

        // Kaffee im Bogen über der Lücke
        if (Math.random() < 0.45) {
            const mid = gapStart + gap / 2;
            for (let i = -1; i <= 1; i++) addPickup(mid + i * 28, GROUND - 80 + Math.abs(i) * 14);
        }

        if (Math.random() < 0.55) {
            // schwebende Annotation-Plattform mit Kaffee darüber
            const label = pick(ANNOTATIONS);
            const pw = Math.max(rand(90, 160), label.length * 6.2 + 20);
            const px = x + rand(60, w - 200);
            const py = GROUND - rand(80, 115);
            platforms.push({x: px, y: py, w: pw, label});
            const n = Math.floor(pw / 34);
            for (let i = 0; i < n; i++) addPickup(px + 17 + i * 34, py - 26);
        } else if (Math.random() < 0.6) {
            const sx = x + rand(40, w - 160);
            for (let i = 0; i < 4; i++) addPickup(sx + i * 34, GROUND - 34);
        }

        if (bugsOn && w > 320 && Math.random() < 0.45 + difficulty * 0.4) {
            spawnBug(x, w);
            if (w > 520 && difficulty > 0.5 && Math.random() < 0.5) spawnBug(x, w);
        }
    }

    function spawnBug(segX, segW) {
        const bw = 26;
        const bh = 18;
        const ex = pick(EXCEPTIONS);
        bugs.push({
            x: segX + rand(120, segW - 80),
            y: GROUND - bh,
            w: bw,
            h: bh,
            vx: (Math.random() < 0.5 ? -1 : 1) * rand(30, 70),
            min: segX + 16,
            max: segX + segW - 16,
            label: ex.label,
            cause: ex.cause,
            dead: false,
            deadT: 0,
        });
    }

    function cleanup() {
        const left = cam - 120;
        ground = ground.filter((s) => s.x + s.w > left);
        platforms = platforms.filter((p) => p.x + p.w > left);
        bugs = bugs.filter((b) => b.x + b.w > left && !(b.dead && b.deadT > 0.6));
        pickups = pickups.filter((p) => p.x > left && !p.taken);
        particles = particles.filter((p) => p.life > 0);
    }

    // ---------- Partikel ----------
    function burst(x, y, n, col, power = 220, up = 0) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = rand(0.3, 1) * power;
            const life = rand(0.3, 0.7);
            particles.push({x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, life, max: life, col, size: rand(2, 4)});
        }
    }

    function popText(x, y, text, col) {
        particles.push({x, y, vx: 0, vy: -60, life: 0.8, max: 0.8, col, text, noGravity: true});
    }

    // ---------- Spiellogik ----------
    function start() {
        reset();
        state = 'running';
        stateT = 0;
    }

    function jump(v) {
        player.vy = -v;
        player.onGround = false;
        player.coyote = 0;
        player.buffer = 0;
        player.squash = -0.25;
        burst(player.x + P / 2, player.y + P, 6, 'rgba(255,255,255,0.5)', 120);
    }

    function die(reason) {
        cause = reason;
        state = 'dying';
        stateT = 0;
        player.vy = -520;
        shake = 0.35;
        burst(player.x + P / 2, player.y + P / 2, 24, C.red, 320);
    }

    function finish() {
        state = 'over';
        stateT = 0;
        const s = score();
        if (s > best) {
            best = s;
            newBest = true;
            saveBest(best);
        }
    }

    function update(dt) {
        time += dt;
        stateT += dt;
        shake = Math.max(0, shake - dt);

        for (const p of particles) {
            p.life -= dt;
            if (!p.noGravity) p.vy += 900 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }

        if (state === 'dying') {
            player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);
            player.y += player.vy * dt;
            if (stateT > 1) finish();
            return;
        }
        if (state !== 'running') return;

        speed = Math.min(MAX_SPEED, speed + 7 * dt);

        // horizontale Bewegung; in einer Grube stoppt die Wand
        let nx = player.x + speed * dt;
        if (player.y + P > GROUND + 1) {
            for (const s of ground) {
                if (s.x > player.x && nx + P > s.x) nx = s.x - P;
            }
        }
        distance += Math.max(0, nx - player.x);
        player.x = nx;

        // Sprung (mit Puffer und Coyote-Time)
        player.buffer -= dt;
        player.coyote -= dt;
        if (player.buffer > 0) {
            if (player.onGround || player.coyote > 0) {
                jump(JUMP_V);
                player.jumps = 1;
            } else if (player.jumps < 2) {
                jump(DJUMP_V);
                player.jumps = 2;
                burst(player.x + P / 2, player.y + P, 10, C.cyan, 160);
            }
        }

        // Schwerkraft und Landung
        const wasOnGround = player.onGround;
        const landSpeed = player.vy;
        player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);
        const prevBottom = player.y + P;
        player.y += player.vy * dt;
        player.onGround = false;

        if (player.vy >= 0) {
            const surfaces = ground.map((s) => ({x: s.x, w: s.w, y: GROUND})).concat(platforms);
            for (const s of surfaces) {
                const overlaps = player.x + 4 < s.x + s.w && player.x + P - 4 > s.x;
                if (overlaps && prevBottom <= s.y + 0.5 && player.y + P >= s.y) {
                    player.y = s.y - P;
                    player.vy = 0;
                    player.onGround = true;
                    player.jumps = 0;
                    if (!wasOnGround && landSpeed > 400) {
                        player.squash = 0.22;
                        burst(player.x + P / 2, s.y, 5, 'rgba(255,255,255,0.4)', 90, 60);
                    }
                    break;
                }
            }
        }
        if (player.onGround) player.coyote = 0.09;
        player.squash += (0 - player.squash) * Math.min(1, dt * 12);

        // Exceptions
        for (const b of bugs) {
            if (b.dead) {
                b.deadT += dt;
                continue;
            }
            b.x += b.vx * dt;
            if (b.x < b.min || b.x + b.w > b.max) {
                b.vx = -b.vx;
                b.x = Math.max(b.min, Math.min(b.max - b.w, b.x));
            }
            const hit = player.x + 3 < b.x + b.w && player.x + P - 3 > b.x &&
                player.y + 3 < b.y + b.h && player.y + P > b.y + 2;
            if (!hit) continue;
            if (player.vy > 0 && prevBottom <= b.y + 10) {
                b.dead = true;
                stomps++;
                player.vy = -580;
                player.jumps = 1;
                burst(b.x + b.w / 2, b.y + b.h / 2, 14, C.red, 240);
                popText(b.x + b.w / 2, b.y - 14, 'fixed!', C.lime);
            } else {
                die(b.cause);
                return;
            }
        }

        // Kaffee und Starter einsammeln
        const cx = player.x + P / 2;
        const cy = player.y + P / 2;
        for (const l of pickups) {
            if (!l.taken && Math.hypot(l.x - cx, l.y - cy) < 22) {
                l.taken = true;
                if (l.type === 'leaf') {
                    starters++;
                    burst(l.x, l.y, 14, C.lime, 200);
                    popText(l.x, l.y - 16, '+starter', C.lime);
                } else {
                    coffee++;
                    burst(l.x, l.y, 8, C.coffee, 150);
                }
            }
        }

        if (player.y > H + 30) {
            cause = 'Absturz in die Dependency Hell';
            finish();
        }

        cam = player.x - playerX();
        ensureWorld();
        cleanup();
    }

    // ---------- Eingabe ----------
    function press() {
        if (state === 'ready' || (state === 'over' && stateT > 0.4)) {
            start();
            return;
        }
        if (state === 'paused') {
            state = 'running';
            return;
        }
        if (state === 'running') {
            held = true;
            player.buffer = 0.12;
        }
    }

    function release() {
        if (!held) return;
        held = false;
        if (state === 'running' && player.vy < -JUMP_CUT) player.vy = -JUMP_CUT;
    }

    function pause() {
        if (state === 'running') {
            state = 'paused';
            held = false;
        }
    }

    const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW', 'Enter']);

    // Esc schließt den Dialog nativ (cancel-Event), deshalb hier nicht abfangen
    window.addEventListener('keydown', (e) => {
        if (!dialog.open) return;
        if (JUMP_KEYS.has(e.code)) {
            e.preventDefault();
            if (!e.repeat) press();
        } else if (e.code === 'KeyB' && !e.repeat) {
            toggleMode();
        } else if (e.code === 'KeyP' || e.code === 'F8') {
            e.preventDefault();
            if (state === 'running') pause();
            else if (state === 'paused') state = 'running';
        }
    });
    window.addEventListener('keyup', (e) => {
        if (JUMP_KEYS.has(e.code)) release();
    });

    canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        canvas.focus({preventScroll: true});
        press();
    });
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', release);

    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) pause();
    });

    // ---------- Overlay öffnen / schließen ----------
    function openGame() {
        if (dialog.open) return;
        dialog.showModal();
        resize();
        canvas.focus({preventScroll: true});
        // laufende Runde bleibt im Breakpoint, sonst neue Runde starten
        if (state !== 'paused') start();
        last = performance.now();
        acc = 0;
    }

    const playBtn = document.getElementById('play-btn');
    if (playBtn) playBtn.addEventListener('click', openGame);

    const closeBtn = document.getElementById('game-close');
    if (closeBtn) closeBtn.addEventListener('click', () => dialog.close());

    // Klick auf den abgedunkelten Hintergrund schließt ebenfalls
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
        if (state === 'dying' || state === 'over') state = 'ready';
        pause();
        if (playBtn) playBtn.focus({preventScroll: true});
    });

    // ---------- Modus: mit / ohne Bugs ----------
    function renderMode() {
        if (!modeBtn) return;
        modeBtn.setAttribute('aria-pressed', String(bugsOn));
        modeBtn.textContent = bugsOn ? '🐞 Bugs: an' : '✨ Bugs: aus';
    }

    function toggleMode() {
        bugsOn = !bugsOn;
        save('bugs', bugsOn ? '1' : '0');
        best = loadBest();
        renderMode();
        // Moduswechsel startet eine frische Runde
        reset();
        state = 'ready';
        canvas.focus({preventScroll: true});
    }

    if (modeBtn) {
        modeBtn.addEventListener('click', toggleMode);
        renderMode();
    }

    // ---------- Größe ----------
    let scale = 1;
    let dpr = 1;

    function resize() {
        const cssW = frame.clientWidth || 960;
        const cssH = Math.max(220, Math.min(300, cssW * 0.34));
        dpr = Math.min(2, window.devicePixelRatio || 1);
        scale = cssH / H;
        W = cssW / scale;
        canvas.style.height = cssH + 'px';
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        if (state === 'ready' || state === 'over') cam = player.x - playerX();
        ensureWorld();
    }

    // ---------- Zeichnen ----------
    function rr(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    // Text auf maximale Breite einpassen
    function fitFont(text, weight, size, family, maxW) {
        let s = size;
        ctx.font = `${weight} ${s}px ${family}`;
        while (s > 9 && ctx.measureText(text).width > maxW) {
            s -= 1;
            ctx.font = `${weight} ${s}px ${family}`;
        }
    }

    function drawBackground() {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#0e0d1c');
        g.addColorStop(1, '#151027');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // Sterne
        const sx = cam * 0.08;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        for (let i = Math.floor(sx / 60) - 1; i < (sx + W) / 60 + 1; i++) {
            const x = i * 60 + hash(i) * 60 - sx;
            const y = hash(i + 99) * 150;
            const s = hash(i + 7) < 0.2 ? 2 : 1;
            ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(time * 2 + i));
            ctx.fillRect(x, y, s, s);
        }
        ctx.globalAlpha = 1;

        // Rechenzentrum: Server-Racks in zwei Ebenen
        drawRacks(0.18, 70, 'rgba(139,92,255,0.10)', 60, 120, 3);
        drawRacks(0.4, 90, 'rgba(255,61,129,0.08)', 30, 80, 11);
    }

    function drawRacks(f, step, fill, minH, maxH, seed) {
        const off = cam * f;
        for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
            const h = minH + hash(i * 3 + seed) * (maxH - minH);
            const w = step * (0.55 + hash(i + seed) * 0.35);
            const x = i * step - off;
            ctx.fillStyle = fill;
            ctx.fillRect(x, GROUND - h, w, h);
            // Einschübe mit blinkenden Status-LEDs
            for (let u = GROUND - h + 8; u < GROUND - 6; u += 12) {
                const k = hash(i * 13 + u + seed);
                if (k < 0.45) continue;
                const on = Math.sin(time * (2 + k * 4) + k * 10) > -0.3;
                ctx.fillStyle = k > 0.92 ? 'rgba(255,90,90,0.45)' : (on ? 'rgba(196,255,61,0.35)' : 'rgba(196,255,61,0.08)');
                ctx.fillRect(x + 5, u, 3, 2);
            }
        }
    }

    function drawGround() {
        for (const s of ground) {
            const x = s.x - cam;
            if (x > W || x + s.w < 0) continue;
            ctx.fillStyle = '#16121f';
            ctx.fillRect(x, GROUND, s.w, H - GROUND);

            // Log-Ausgabe als Bodentextur
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, GROUND + 4, s.w, H - GROUND - 4);
            ctx.clip();
            ctx.font = `9px ${MONO}`;
            ctx.textBaseline = 'top';
            ctx.textAlign = 'left';
            for (let row = 0; row < 3; row++) {
                const line = LOG_LINES[(s.seed * 3 + row) % LOG_LINES.length];
                const level = line.slice(0, 5).trim();
                ctx.fillStyle = level === 'WARN' ? 'rgba(255,179,92,0.35)' : 'rgba(140,138,163,0.32)';
                ctx.fillText(line, x + 8, GROUND + 10 + row * 13);
            }
            ctx.restore();

            ctx.save();
            ctx.shadowColor = C.lime;
            ctx.shadowBlur = 10;
            ctx.fillStyle = C.lime;
            ctx.fillRect(x, GROUND, s.w, 2);
            ctx.restore();
        }
    }

    function drawPlatforms() {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const p of platforms) {
            const x = p.x - cam;
            if (x > W || x + p.w < 0) continue;
            ctx.fillStyle = 'rgba(34,227,255,0.12)';
            rr(x, p.y, p.w, 16, 4);
            ctx.fill();
            ctx.font = `600 10px ${MONO}`;
            ctx.fillStyle = 'rgba(34,227,255,0.85)';
            ctx.fillText(p.label, x + p.w / 2, p.y + 9);
            ctx.save();
            ctx.shadowColor = C.cyan;
            ctx.shadowBlur = 8;
            ctx.fillStyle = C.cyan;
            ctx.fillRect(x + 2, p.y, p.w - 4, 2);
            ctx.restore();
        }
    }

    function drawLeaf(x, y, r, rot) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.fillStyle = C.lime;
        ctx.shadowColor = C.lime;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.quadraticCurveTo(r, -r * 0.2, 0, r);
        ctx.quadraticCurveTo(-r, -r * 0.2, 0, -r);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(10,10,18,0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.55);
        ctx.lineTo(0, r * 0.8);
        ctx.stroke();
        ctx.restore();
    }

    function drawCup(x, y, steam) {
        ctx.save();
        ctx.translate(x, y);
        // Dampf
        if (steam) {
            ctx.strokeStyle = 'rgba(242,241,247,0.35)';
            ctx.lineWidth = 1.2;
            for (const sx of [-2.5, 2.5]) {
                ctx.beginPath();
                for (let k = 0; k <= 6; k++) {
                    const yy = -7 - k * 1.3;
                    const xx = sx + Math.sin(time * 6 + k + sx) * 1.2;
                    if (k === 0) ctx.moveTo(xx, yy);
                    else ctx.lineTo(xx, yy);
                }
                ctx.stroke();
            }
        }
        // Henkel
        ctx.strokeStyle = C.coffee;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(6, 0, 3, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
        // Becher
        ctx.shadowColor = C.coffee;
        ctx.shadowBlur = 8;
        ctx.fillStyle = C.coffee;
        rr(-6, -5, 12, 11, 2.5);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(10,10,18,0.55)';
        ctx.fillRect(-4, -3, 8, 2);
        ctx.restore();
    }

    function drawPickups() {
        for (const l of pickups) {
            const x = l.x - cam;
            if (x < -20 || x > W + 20) continue;
            const bob = Math.sin(time * 4 + l.x * 0.05) * 3;
            if (l.type === 'leaf') drawLeaf(x, l.y + bob, 10, 0.5 + Math.sin(time * 3 + l.x) * 0.3);
            else drawCup(x, l.y + bob, true);
        }
    }

    function drawBugs() {
        for (const b of bugs) {
            const x = b.x - cam;
            if (x < -60 || x > W + 60) continue;
            ctx.save();
            ctx.translate(x + b.w / 2, b.y + b.h);
            if (b.dead) {
                ctx.globalAlpha = Math.max(0, 1 - b.deadT * 2);
                ctx.scale(1.2, 0.35);
            }
            const dir = b.vx < 0 ? -1 : 1;
            ctx.scale(dir, 1);

            // Beine
            ctx.strokeStyle = C.red;
            ctx.lineWidth = 2;
            for (let i = -1; i <= 1; i++) {
                const k = Math.sin(time * 18 + i * 2) * 3;
                ctx.beginPath();
                ctx.moveTo(i * 7, -6);
                ctx.lineTo(i * 7 + k, 0);
                ctx.stroke();
            }
            // Körper
            ctx.fillStyle = C.red;
            ctx.shadowColor = C.red;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.ellipse(0, -10, b.w / 2, b.h / 2 - 1, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(10,10,18,0.45)';
            ctx.beginPath();
            ctx.moveTo(-2, -18);
            ctx.lineTo(-2, -2);
            ctx.stroke();
            // Augen
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(8, -12, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = C.bg;
            ctx.beginPath();
            ctx.arc(9, -12, 1.5, 0, Math.PI * 2);
            ctx.fill();
            // Fühler
            ctx.strokeStyle = C.red;
            ctx.beginPath();
            ctx.moveTo(10, -17);
            ctx.lineTo(15, -23);
            ctx.stroke();
            ctx.restore();

            // Name der Exception
            if (!b.dead) {
                ctx.font = `600 9px ${MONO}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillStyle = 'rgba(255,90,90,0.9)';
                ctx.fillText(b.label, x + b.w / 2, b.y - 6);
            }
        }
    }

    // Entwickler im Hoodie mit Brille und Spring-Blatt am Kopfhörer
    function drawPlayer() {
        const x = player.x - cam;
        let y = player.y;
        if (state === 'ready') y += Math.sin(time * 3) * 2;
        const s = player.squash;
        const dead = state === 'dying' || (state === 'over' && cause !== '' && player.y > GROUND - P);
        const running = state === 'running' && player.onGround;

        ctx.save();
        ctx.translate(x + P / 2, y + P);
        if (dead) ctx.rotate(Math.min(1, stateT * 2) * 0.6);
        ctx.scale(1 + s, 1 - s);

        // Beine
        ctx.strokeStyle = '#2a2440';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        const swing = running ? Math.sin(time * 22) * 4 : (player.onGround ? 0 : 2);
        ctx.beginPath();
        ctx.moveTo(-5, -7);
        ctx.lineTo(-5 + swing, -1);
        ctx.moveTo(5, -7);
        ctx.lineTo(5 - swing, -1);
        ctx.stroke();

        // Hoodie
        const g = ctx.createLinearGradient(-P / 2, -P, P / 2, 0);
        g.addColorStop(0, C.pink);
        g.addColorStop(1, C.violet);
        ctx.shadowColor = C.pink;
        ctx.shadowBlur = 14;
        ctx.fillStyle = g;
        rr(-P / 2, -P, P, P - 5, 8);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Gesicht (Kapuzenöffnung)
        ctx.fillStyle = 'rgba(10,10,18,0.55)';
        rr(-8, -P + 5, 18, 11, 5);
        ctx.fill();

        // Kordeln
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-2, -P + 16);
        ctx.lineTo(-2, -P + 20);
        ctx.moveTo(5, -P + 16);
        ctx.lineTo(5, -P + 20);
        ctx.stroke();

        if (dead) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.6;
            for (const ex of [-2, 6]) {
                ctx.beginPath();
                ctx.moveTo(ex - 2, -P + 8.5);
                ctx.lineTo(ex + 2, -P + 12.5);
                ctx.moveTo(ex + 2, -P + 8.5);
                ctx.lineTo(ex - 2, -P + 12.5);
                ctx.stroke();
            }
        } else {
            // Brille mit Code-Reflex
            ctx.strokeStyle = C.cyan;
            ctx.lineWidth = 1.4;
            ctx.fillStyle = 'rgba(34,227,255,0.18)';
            for (const ex of [-2, 6]) {
                rr(ex - 3.5, -P + 8, 7, 5, 1.5);
                ctx.fill();
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.moveTo(1.5, -P + 10);
            ctx.lineTo(2.5, -P + 10);
            ctx.stroke();
            const look = Math.max(-1, Math.min(1, player.vy / 500));
            ctx.fillStyle = '#fff';
            ctx.fillRect(-1, -P + 10 + look, 1.6, 1.6);
            ctx.fillRect(7, -P + 10 + look, 1.6, 1.6);
        }

        // Kopfhörer-Bügel mit Spring-Blatt
        ctx.strokeStyle = '#2a2440';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(1, -P + 8, 12, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.translate(x + P / 2, y + P);
        ctx.scale(1 + s, 1 - s);
        drawLeaf(9, -P - 5, 5, 0.7 + Math.sin(time * 5) * 0.15);
        ctx.restore();
    }

    function drawParticles() {
        for (const p of particles) {
            ctx.globalAlpha = Math.max(0, p.life / p.max);
            ctx.fillStyle = p.col;
            if (p.text) {
                ctx.font = `700 10px ${MONO}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(p.text, p.x - cam, p.y);
            } else {
                ctx.fillRect(p.x - cam - p.size / 2, p.y - p.size / 2, p.size, p.size);
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawHud() {
        ctx.font = `600 13px ${MONO}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = C.text;
        const sc = String(score()).padStart(5, '0');
        ctx.fillText(sc, 16, 14);
        ctx.fillStyle = C.muted;
        const hi = `HI ${String(best).padStart(5, '0')}`;
        const hiX = 16 + ctx.measureText(sc).width + 14;
        ctx.fillText(hi, hiX, 14);
        if (!bugsOn) {
            const tagX = hiX + ctx.measureText(hi).width + 14;
            ctx.font = `600 10px ${MONO}`;
            ctx.fillStyle = C.cyan;
            ctx.fillText('NO-BUGS', tagX, 16);
            ctx.font = `600 13px ${MONO}`;
        }

        ctx.textAlign = 'right';
        let rx = W - 16;
        if (starters > 0) {
            const t = String(starters);
            ctx.fillStyle = C.lime;
            ctx.fillText(t, rx, 14);
            rx -= ctx.measureText(t).width + 10;
            drawLeaf(rx, 21, 6, 0.5);
            rx -= 16;
        }
        const t = String(coffee);
        ctx.font = `600 13px ${MONO}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillStyle = C.coffee;
        ctx.fillText(t, rx, 14);
        rx -= ctx.measureText(t).width + 12;
        drawCup(rx, 21, false);
    }

    function overlay(title, lines, opts = {}) {
        ctx.fillStyle = 'rgba(10,10,18,0.68)';
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const top = H / 2 - 14 - lines.length * 11;
        fitFont(title, 800, opts.titleSize || 30, opts.titleMono ? MONO : FONT, W - 32);
        ctx.fillStyle = opts.titleColor || C.text;
        ctx.fillText(title, W / 2, top);
        lines.forEach((line, i) => {
            const text = typeof line === 'string' ? line : line.text;
            fitFont(text, 500, 13, MONO, W - 32);
            ctx.fillStyle = (typeof line === 'object' && line.color) || (i === 0 ? C.text : C.muted);
            ctx.fillText(text, W / 2, top + 38 + i * 22);
        });
    }

    function draw() {
        ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
        if (shake > 0) {
            const m = shake * 14;
            ctx.translate(rand(-m, m), rand(-m, m));
        }
        drawBackground();
        drawPlatforms();
        drawGround();
        drawPickups();
        drawBugs();
        drawPlayer();
        drawParticles();
        drawHud();

        if (state === 'ready') {
            overlay('Bean Runner', [
                {text: '$ mvn spring-boot:run', color: C.lime},
                'Klicken, Tippen oder Leertaste zum Starten',
                bugsOn ? 'Kaffee sammeln · Exceptions ausweichen oder fixen' : 'Bug-freier Modus · nur Kaffee und Lücken',
            ]);
        } else if (state === 'paused') {
            overlay('Breakpoint', ['Leertaste, Tippen oder F8: Resume'], {titleColor: C.cyan});
        } else if (state === 'over') {
            overlay('APPLICATION FAILED TO START', [
                {text: `Caused by: ${cause}`, color: C.red},
                bugsOn ? `${score()} Punkte · ${coffee} Kaffee · ${stomps} Bugs gefixt` : `${score()} Punkte · ${coffee} Kaffee · ohne Bugs`,
                newBest ? {text: 'Neuer Rekord!', color: C.lime} : 'Neustart: Leertaste oder Tippen',
            ], {titleColor: C.red, titleMono: true, titleSize: 22});
        }
    }

    // ---------- Loop ----------
    let last = performance.now();
    let acc = 0;

    function loop(now) {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (dialog.open) {
            acc += dt;
            while (acc >= STEP) {
                update(STEP);
                acc -= STEP;
            }
            draw();
        }
        requestAnimationFrame(loop);
    }

    reset();
    resize();
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(frame);
    else window.addEventListener('resize', resize);
    requestAnimationFrame(loop);
})();
