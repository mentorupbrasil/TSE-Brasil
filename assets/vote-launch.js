"use strict";

/** Ordem de tramitação do voto casado (majoritários → proporcionais). */
const VOTE_CHAIN = [
  { office: "1", label: "Presidente", short: "Pres." },
  { office: "3", label: "Governador", short: "Gov." },
  { office: "5", label: "Senador", short: "Sen." },
  { office: "6", label: "Deputado federal", short: "Fed." },
  { office: "7", label: "Deputado estadual", short: "Est." }
];

const DEFAULT_ON = new Set(["3", "5", "6", "7"]);

/** Lote padrão: 3.000 chapas completas (ritmo mínimo prioriza áudio da urna). */
const BATCH_VOTE_COUNT = 3000;
const BATCH_DURATION_MS = 3 * 60 * 60 * 1000;
const MS_PER_VOTE_TARGET = BATCH_DURATION_MS / BATCH_VOTE_COUNT;
/** Pausa entre um voto completo e o próximo. */
const MS_BETWEEN_VOTES = 2600;
/** Silêncio após o fim do áudio de confirmação, por cargo. */
const MS_AFTER_SOUND = 500;

window.CivicaVoteLaunch = (() => {
  let deps = {};
  let running = false;
  let abort = false;
  let activeVoteDurationMs = MS_PER_VOTE_TARGET;
  let audioCtx = null;
  const urnaBuffers = { confirma: null };
  let urnaLoadPromise = null;
  let activeAudioSource = null;
  const catalog = new Map();
  const selection = new Map();

  function esc(v) {
    return deps.esc ? deps.esc(v) : String(v ?? "");
  }

  function officeLabel(id) {
    return deps.officeLabel ? deps.officeLabel(id) : id;
  }

  function log(line, cls = "ok") {
    const out = document.getElementById("vlTerminalOut");
    if (!out) return;
    const ts = new Date().toLocaleTimeString("pt-BR", { hour12: false });
    out.insertAdjacentHTML("beforeend", `<div class="${cls}"><span class="dim">[${ts}]</span> ${line}</div>`);
    out.scrollTop = out.scrollHeight;
  }

  function setStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  async function decodeSound(ctx, url) {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw new Error(`Áudio indisponível: ${url}`);
    return await ctx.decodeAudioData(await res.arrayBuffer());
  }

  async function loadUrnaSounds() {
    if (urnaBuffers.confirma) return urnaBuffers;
    if (urnaLoadPromise) return urnaLoadPromise;
    urnaLoadPromise = (async () => {
      const ctx = ensureAudio();
      urnaBuffers.confirma = await decodeSound(ctx, "/assets/sounds/confirma-urna.mp3");
      return urnaBuffers;
    })();
    return urnaLoadPromise;
  }

  function playUrnaBeep() {
    if (!urnaBuffers.confirma) return;
    try {
      const ctx = ensureAudio();
      if (activeAudioSource) {
        try { activeAudioSource.stop(); } catch { /* já encerrado */ }
        activeAudioSource.disconnect();
        activeAudioSource = null;
      }
      const src = ctx.createBufferSource();
      src.buffer = urnaBuffers.confirma;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.onended = () => { if (activeAudioSource === src) activeAudioSource = null; };
      activeAudioSource = src;
      src.start(0);
    } catch {
      /* áudio indisponível */
    }
  }

  function fakeHash(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, "0");
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function formatEta(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    return new Date(ms).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function updateBatchProgress(completedVotes, totalSteps, doneSteps) {
    const pct = totalSteps ? Math.min(100, Math.round((doneSteps / totalSteps) * 100)) : 0;
    document.getElementById("vlGlobalBar")?.style && (document.getElementById("vlGlobalBar").style.width = `${pct}%`);
    const pctEl = document.getElementById("vlGlobalPct");
    if (pctEl) pctEl.textContent = `${pct}%`;
    setStat("vlStatVotes", String(completedVotes));
    const remaining = BATCH_VOTE_COUNT - completedVotes;
    const etaMs = Date.now() + remaining * activeVoteDurationMs;
    setStat("vlStatEta", formatEta(etaMs));
  }

  function urnaSoundWaitMs() {
    const dur = (urnaBuffers.confirma?.duration || 0.55) * 1000;
    return Math.ceil(dur + MS_AFTER_SOUND);
  }

  function msPerVote(chainLen) {
    const n = Math.max(1, chainLen);
    const soundBlock = urnaSoundWaitMs();
    const minOfficeMs = soundBlock + 320 + 300;
    const minVoteMs = n * minOfficeMs + MS_BETWEEN_VOTES;
    return Math.max(MS_PER_VOTE_TARGET, minVoteMs);
  }

  function officeTiming(chainLen) {
    const voteMs = msPerVote(chainLen);
    const n = Math.max(1, chainLen);
    const officeSlot = (voteMs - MS_BETWEEN_VOTES) / n;
    const soundMs = urnaSoundWaitMs();
    const packetMs = Math.min(360, Math.max(220, officeSlot * 0.16));
    const regMs = Math.min(720, Math.max(320, officeSlot * 0.2));
    const gapMs = Math.max(320, officeSlot - packetMs - regMs - soundMs);
    return {
      packetSteps: Math.max(8, Math.round(packetMs / 16)),
      packetStepMs: 16,
      regMs,
      soundMs,
      gapMs,
      betweenVotesMs: MS_BETWEEN_VOTES
    };
  }

  function formatDurationHours(ms) {
    const h = ms / (60 * 60 * 1000);
    if (h >= 10) return `${Math.round(h)} h`;
    return `${h.toFixed(1).replace(".", ",")} h`;
  }

  function updateBatchMetaLabel(chainLen) {
    const el = document.getElementById("vlCommandMeta");
    if (!el || !chainLen) return;
    const totalMs = msPerVote(chainLen) * BATCH_VOTE_COUNT;
    el.textContent = `Lote · 3.000 votos · duração prevista ${formatDurationHours(totalMs)}`;
  }

  function enabledChain() {
    return VOTE_CHAIN.filter(x => document.getElementById(`vlCargo${x.office}`)?.checked);
  }

  function selectedCandidate(office) {
    const id = selection.get(office);
    if (!id) return null;
    return (catalog.get(office) || []).find(c => String(c.id) === String(id)) || null;
  }

  function renderTree() {
    const branches = document.getElementById("vlBranches");
    if (!branches) return;
    const chain = enabledChain();
    branches.innerHTML = chain.map(item => {
      const c = selectedCandidate(item.office);
      const name = c?.name || c?.fullName || "— selecione —";
      const num = c?.number || "—";
      const initials = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();
      const photo = c?.photo
        ? `<img class="vl-cand-photo" src="${esc(c.photo)}" alt="" loading="lazy" data-image-fallback="${esc(initials)}">`
        : `<div class="vl-cand-photo-fallback">${esc(initials)}</div>`;
      const party = c?.party ? `<div class="vl-cand-party">${esc(c.party)}</div>` : "";
      return `<div class="vl-flow-step">
        <article class="vl-branch on" data-office="${esc(item.office)}" id="vlBranch${esc(item.office)}">
          <div class="vl-cand-card">
            <header class="vl-office-label">${esc(officeLabel(item.office))}</header>
            <div class="vl-cand-photo-wrap">${photo}</div>
            <div class="vl-cand-body">
              <div class="vl-cand-num">${esc(num)}</div>
              ${party}
              <div class="vl-cand-name">${esc(name)}</div>
              <div class="vl-node-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="vl-node-bar-fill" id="vlBar${esc(item.office)}"></div></div>
            </div>
          </div>
        </article>
      </div>`;
    }).join("");
    const flow = document.querySelector(".page-vote-launch .vl-flow");
    if (flow) flow.style.setProperty("--vl-steps", String(Math.max(1, chain.length)));
    deps.wireImageFallbacks?.(branches);
    refreshProcessState();
  }

  function populateSelect(office) {
    const sel = document.getElementById(`vlSelect${office}`);
    if (!sel) return;
    const list = (catalog.get(office) || []).slice(0, 400);
    const cur = selection.get(office) || "";
    sel.innerHTML = `<option value="">Selecione o candidato</option>` + list.map(c =>
      `<option value="${esc(c.id)}">${esc(c.number)} · ${esc(c.name)} (${esc(c.party || "?")})</option>`
    ).join("");
    if (list.some(c => String(c.id) === String(cur))) sel.value = cur;
    else if (list.length === 1) {
      sel.value = list[0].id;
      selection.set(office, String(list[0].id));
    }
  }

  async function loadCatalog(office) {
    if (catalog.has(office)) return;
    log(`Carregando candidatos: ${officeLabel(office)}…`, "info");
    const data = await deps.getCandidates(office);
    const list = (data.candidates || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
    catalog.set(office, list);
    populateSelect(office);
    log(`${list.length} candidaturas disponíveis (${officeLabel(office)}).`, "dim");
  }

  async function loadAllCatalogs() {
    const jobs = VOTE_CHAIN.map(x => loadCatalog(x.office));
    await Promise.all(jobs);
  }

  function resetNodeVisuals() {
    VOTE_CHAIN.forEach(x => {
      document.getElementById(`vlBar${x.office}`)?.style && (document.getElementById(`vlBar${x.office}`).style.width = "0%");
      document.getElementById(`vlBranch${x.office}`)?.classList.remove("active", "done");
    });
    document.getElementById("vlHub")?.classList.remove("active");
    document.getElementById("vlGlobalBar")?.style && (document.getElementById("vlGlobalBar").style.width = "0%");
  }

  async function animatePacket(fromEl, toEl, motion = {}) {
    const wrap = document.getElementById("vlTreeWrap");
    const packet = document.getElementById("vlPacket");
    if (!wrap || !packet || !fromEl || !toEl) return;
    const wr = wrap.getBoundingClientRect();
    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();
    const x0 = fr.left + fr.width / 2 - wr.left;
    const y0 = fr.top + fr.height / 2 - wr.top;
    const x1 = tr.left + tr.width / 2 - wr.left;
    const y1 = tr.top + tr.height / 2 - wr.top;
    packet.classList.add("run");
    const steps = motion.packetSteps ?? 28;
    const stepMs = motion.packetStepMs ?? 16;
    for (let i = 0; i <= steps; i++) {
      if (abort) break;
      const p = i / steps;
      const ease = p * p * (3 - 2 * p);
      packet.style.left = `${x0 + (x1 - x0) * ease}px`;
      packet.style.top = `${y0 + (y1 - y0) * ease}px`;
      await sleep(stepMs);
    }
    packet.classList.remove("run");
  }

  async function fillBar(office, ms) {
    const bar = document.getElementById(`vlBar${office}`);
    if (!bar) return;
    const steps = Math.max(12, Math.floor(ms / 40));
    for (let i = 1; i <= steps; i++) {
      if (abort) break;
      bar.style.width = `${(i / steps) * 100}%`;
      await sleep(ms / steps);
    }
  }

  function chapaReady() {
    const chain = enabledChain();
    if (!chain.length) return false;
    return chain.every(item => selectedCandidate(item.office));
  }

  function refreshProcessState() {
    const ready = chapaReady();
    document.querySelectorAll(".vl-btn-start").forEach(btn => {
      btn.disabled = running || !ready;
    });
    document.querySelectorAll(".vl-btn-stop").forEach(btn => {
      btn.disabled = !running;
    });
    const badge = document.getElementById("vlProcessStatus");
    if (badge) {
      let state = "idle";
      let label = "Aguardando chapa";
      if (running) {
        state = "run";
        label = "Em tramitação";
      } else if (ready) {
        state = "ready";
        label = "Pronto para iniciar";
      }
      badge.dataset.state = state;
      badge.textContent = label;
    }
    const cta = document.getElementById("vlFlowCta");
    const ctaTitle = document.getElementById("vlFlowCtaTitle");
    const ctaText = document.getElementById("vlFlowCtaText");
    if (cta) cta.hidden = running;
    if (ctaTitle) ctaTitle.textContent = ready ? "Iniciar tramitação" : "Composição incompleta";
    if (ctaText) {
      ctaText.textContent = ready
        ? "Confirme o início do lote de 3.000 registros na ordem legal do voto casado."
        : "Marque os cargos e selecione um candidato em cada coluna da chapa.";
    }
  }

  function validateBeforeRun() {
    const chain = enabledChain();
    if (!chain.length) {
      deps.toast?.("Marque ao menos um cargo.");
      return null;
    }
    for (const item of chain) {
      if (!selectedCandidate(item.office)) {
        deps.toast?.(`Selecione candidato para ${officeLabel(item.office)}.`);
        return null;
      }
    }
    return chain;
  }

  async function onStartTramitation() {
    ensureAudio();
    try {
      await loadUrnaSounds();
    } catch (e) {
      deps.toast?.("Não foi possível carregar o áudio da urna.");
      log(`ERR :: áudio — ${esc(e.message)}`, "warn");
      return;
    }
    runTramitation();
  }

  async function runTramitation() {
    if (running) return;
    const chain = validateBeforeRun();
    if (!chain) return;
    running = true;
    abort = false;
    const cycles = BATCH_VOTE_COUNT;
    activeVoteDurationMs = msPerVote(chain.length);
    const timing = officeTiming(chain.length);
    updateBatchMetaLabel(chain.length);
    refreshProcessState();
    renderTree();
    resetNodeVisuals();
    log(`Processamento iniciado · lote de ${cycles.toLocaleString("pt-BR")} votos.`, "info");
    setStat("vlStatEta", formatEta(Date.now() + activeVoteDurationMs * cycles));
    let totalSteps = chain.length * cycles;
    let doneSteps = 0;
    let registered = 0;
    let completedVotes = 0;
    const hub = document.getElementById("vlHub");
    for (let cycle = 1; cycle <= cycles; cycle++) {
      if (abort) break;
      const voteSeed = `${cycle}-${Date.now()}`;
      for (const item of chain) {
        if (abort) break;
        const c = selectedCandidate(item.office);
        const branch = document.getElementById(`vlBranch${item.office}`);
        const bar = document.getElementById(`vlBar${item.office}`);
        if (bar) bar.style.width = "0%";
        branch?.classList.remove("done");
        branch?.classList.add("active");
        hub?.classList.add("active");
        await animatePacket(hub, branch?.querySelector(".vl-cand-card") || branch, timing);
        hub?.classList.remove("active");
        await fillBar(item.office, timing.regMs);
        playUrnaBeep();
        await sleep(timing.soundMs);
        registered++;
        doneSteps++;
        updateBatchProgress(completedVotes, totalSteps, doneSteps);
        branch?.classList.remove("active");
        branch?.classList.add("done");
        await sleep(timing.gapMs);
      }
      if (abort) break;
      completedVotes = cycle;
      updateBatchProgress(completedVotes, totalSteps, doneSteps);
      const hash = fakeHash(voteSeed);
      if (cycle === 1 || cycle % 25 === 0 || cycle === cycles) {
        log(`Voto ${cycle.toLocaleString("pt-BR")} de ${cycles.toLocaleString("pt-BR")} · protocolo ${hash}`, "ok");
      }
      if (cycle < cycles && !abort) {
        VOTE_CHAIN.forEach(x => {
          document.getElementById(`vlBranch${x.office}`)?.classList.remove("done", "active");
        });
        await sleep(timing.betweenVotesMs);
      }
    }
    if (abort) log("Processamento suspenso.", "warn");
    else {
      setStat("vlStatEta", formatEta(Date.now()));
      log(`Processamento concluído · ${completedVotes.toLocaleString("pt-BR")} votos tramitados.`, "info");
    }
    hub?.classList.remove("active");
    running = false;
    refreshProcessState();
  }

  function stopTramitation() {
    abort = true;
  }

  function bindCargoEvents() {
    VOTE_CHAIN.forEach(item => {
      const chk = document.getElementById(`vlCargo${item.office}`);
      const box = document.getElementById(`vlCargoBox${item.office}`);
      chk?.addEventListener("change", () => {
        box?.classList.toggle("on", chk.checked);
        renderTree();
        refreshProcessState();
        updateBatchMetaLabel(enabledChain().length);
      });
      document.getElementById(`vlSelect${item.office}`)?.addEventListener("change", e => {
        selection.set(item.office, e.target.value);
        renderTree();
        refreshProcessState();
        updateBatchMetaLabel(enabledChain().length);
      });
    });
    document.querySelectorAll(".vl-btn-start").forEach(btn => {
      btn.addEventListener("click", () => onStartTramitation());
    });
    document.querySelectorAll(".vl-btn-stop").forEach(btn => {
      btn.addEventListener("click", stopTramitation);
    });
    document.getElementById("vlClearLog")?.addEventListener("click", () => {
      const out = document.getElementById("vlTerminalOut");
      if (out) out.innerHTML = "";
      log("Registro limpo.", "dim");
    });
    document.getElementById("vlToggleLog")?.addEventListener("click", () => {
      const log = document.getElementById("vlLogPanel");
      const btn = document.getElementById("vlToggleLog");
      if (!log || !btn) return;
      log.classList.toggle("is-collapsed");
      const hidden = log.classList.contains("is-collapsed");
      btn.textContent = hidden ? "Exibir histórico" : "Histórico";
      btn.setAttribute("aria-expanded", hidden ? "false" : "true");
    });
  }

  function renderShell() {
    const root = document.getElementById("voteLaunchRoot");
    if (!root) return;
    root.innerHTML = `<div class="vl-shell">
      <header class="tse-page-header vl-page-header">
        <div class="tse-page-header-row">
          <div>
            <p class="eyebrow">Justiça Eleitoral · Eleições 2026</p>
            <h1>Tramitação de votos</h1>
            <p>Registro sequencial do voto casado conforme a ordem legal de apuração entre os cargos.</p>
          </div>
        </div>
      </header>
      <section class="vl-chapa-panel vl-panel-block tse-panel" id="vlChapaPanel">
        <div class="tse-panel-head vl-chapa-head">
          <h2>Composição da chapa eleitoral</h2>
        </div>
        <div class="vl-chapa-body tse-form-grid vl-chapa-grid">
            ${VOTE_CHAIN.map(item => `<div class="vl-chapa-cell tse-field ${DEFAULT_ON.has(item.office) ? "on" : ""}" id="vlCargoBox${esc(item.office)}">
              <span class="tse-label">${esc(item.label)}</span>
              <label class="vl-chapa-check"><input type="checkbox" id="vlCargo${esc(item.office)}" ${DEFAULT_ON.has(item.office) ? "checked" : ""}><span>Incluir cargo</span></label>
              <select class="vl-chapa-select" id="vlSelect${esc(item.office)}" aria-label="Candidato ${esc(item.label)}"><option value="">Selecione o candidato</option></select>
            </div>`).join("")}
        </div>
      </section>
      <section class="vl-command-bar" aria-label="Controle de tramitação">
        <div class="vl-command-left">
          <span class="vl-status-badge" id="vlProcessStatus" data-state="idle">Aguardando chapa</span>
          <span class="vl-command-meta" id="vlCommandMeta">Lote · 3.000 votos · duração prevista conforme chapa</span>
        </div>
        <div class="vl-command-actions">
          <button type="button" class="btn btn-tse btn-tse-primary vl-btn-start" id="vlStart">Iniciar tramitação</button>
          <button type="button" class="btn btn-tse btn-tse-secondary vl-btn-stop" id="vlStop" disabled>Suspender</button>
        </div>
      </section>
      <div class="vl-stage">
        <section class="vl-panel-block vl-tree-wrap vl-tree-wrap--hero tse-panel" id="vlTreeWrap">
          <div class="tse-panel-head vl-tree-head">
            <div><h2>Fluxo de registro</h2></div>
            <div class="vl-tree-head-actions">
              <div class="vl-progress-inline">
                <span class="vl-progress-label">Andamento do lote</span>
                <span id="vlGlobalPct">0%</span>
                <div class="vl-bar"><div class="vl-bar-fill" id="vlGlobalBar"></div></div>
              </div>
              <button type="button" class="btn btn-tse btn-tse-ghost vl-btn-compact" id="vlToggleLog" aria-expanded="true">Histórico</button>
            </div>
          </div>
          <div class="vl-tree-area vl-tree-area--flow">
            <div class="vl-flow">
              <article class="vl-flow-hub" id="vlHub" aria-label="Central de registro">
                <header class="vl-office-label vl-hub-label">Central de registro</header>
                <div class="vl-hub-body">
                  <p class="vl-hub-lead">Ponto inicial do fluxo</p>
                  <p class="vl-hub-detail">Encaminhamento sequencial da chapa</p>
                </div>
              </article>
              <div class="vl-flow-connector" aria-hidden="true"></div>
              <div class="vl-flow-track" id="vlBranches"></div>
            </div>
            <div class="vl-flow-cta" id="vlFlowCta">
              <div class="vl-flow-cta-card">
                <h3 id="vlFlowCtaTitle">Composição incompleta</h3>
                <p id="vlFlowCtaText">Marque os cargos e selecione um candidato em cada coluna da chapa.</p>
                <button type="button" class="btn btn-tse btn-tse-primary vl-btn-start">Iniciar tramitação</button>
              </div>
            </div>
          </div>
          <div class="vl-packet" id="vlPacket" aria-hidden="true"></div>
        </section>
        <aside class="vl-panel-block vl-log-panel" id="vlLogPanel">
          <div class="tse-panel-head">
            <h2>Registro</h2>
          </div>
          <div class="vl-log-body">
            <div class="vl-terminal-out" id="vlTerminalOut" aria-live="polite"></div>
            <div class="vl-stats vl-stats--batch">
              <div>Votos tramitados<b><span id="vlStatVotes">0</span> / 3.000</b></div>
              <div>Previsão de término<b id="vlStatEta">—</b></div>
            </div>
            <button type="button" class="btn btn-tse btn-tse-ghost vl-log-clear" id="vlClearLog">Limpar registro</button>
          </div>
        </aside>
      </div>
    </div>`;
  }

  async function mount(options = {}) {
    deps = options;
    renderShell();
    bindCargoEvents();
    renderTree();
    refreshProcessState();
    log("Aguardando configuração da chapa.", "dim");
    setStat("vlStatVotes", "0");
    setStat("vlStatEta", "—");
    try {
      await loadAllCatalogs();
      renderTree();
      log("Candidaturas sincronizadas.", "info");
      loadUrnaSounds().then(() => {
        updateBatchMetaLabel(enabledChain().length || DEFAULT_ON.size);
      }).catch(() => log("Módulo de confirmação indisponível.", "warn"));
    } catch (e) {
      log(`ERR :: ${esc(e.message)}`, "warn");
      deps.toast?.(e.message || "Falha ao carregar candidatos.");
    }
  }

  return { mount };
})();
