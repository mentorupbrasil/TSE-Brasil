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

window.CivicaVoteLaunch = (() => {
  let deps = {};
  let running = false;
  let abort = false;
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
    const soundOn = document.getElementById("vlSound")?.checked !== false;
    if (!soundOn || !urnaBuffers.confirma) return;
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
    branches.innerHTML = chain.map((item, idx) => {
      const c = selectedCandidate(item.office);
      const name = c?.name || c?.fullName || "— selecione —";
      const num = c?.number || "—";
      const initials = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();
      const photo = c?.photo
        ? `<img class="vl-cand-photo" src="${esc(c.photo)}" alt="" loading="lazy" data-image-fallback="${esc(initials)}">`
        : `<div class="vl-cand-photo-fallback">${esc(initials)}</div>`;
      const party = c?.party ? `<div class="vl-cand-party">${esc(c.party)}</div>` : "";
      return `<div class="vl-flow-step">
        ${idx > 0 ? '<div class="vl-flow-arrow" aria-hidden="true"></div>' : ""}
        <article class="vl-branch on" data-office="${esc(item.office)}" id="vlBranch${esc(item.office)}">
          <header class="vl-office-label">${esc(officeLabel(item.office))}</header>
          <div class="vl-cand-card">
            ${photo}
            <div class="vl-cand-num">${esc(num)}</div>
            ${party}
            <div class="vl-cand-name">${esc(name)}</div>
            <div class="vl-node-bar"><div class="vl-node-bar-fill" id="vlBar${esc(item.office)}"></div></div>
          </div>
        </article>
      </div>`;
    }).join("");
    deps.wireImageFallbacks?.(branches);
  }

  function populateSelect(office) {
    const sel = document.getElementById(`vlSelect${office}`);
    if (!sel) return;
    const q = normalize(document.getElementById(`vlSearch${office}`)?.value || "");
    const list = (catalog.get(office) || []).filter(c => {
      if (!q) return true;
      const hay = `${c.name} ${c.fullName} ${c.number} ${c.party}`.toLowerCase();
      return hay.includes(q);
    }).slice(0, 400);
    const cur = selection.get(office) || "";
    sel.innerHTML = `<option value="">— Candidato —</option>` + list.map(c =>
      `<option value="${esc(c.id)}">${esc(c.number)} · ${esc(c.name)} (${esc(c.party || "?")})</option>`
    ).join("");
    if (list.some(c => String(c.id) === String(cur))) sel.value = cur;
    else if (list.length === 1) {
      sel.value = list[0].id;
      selection.set(office, String(list[0].id));
    }
  }

  function normalize(s = "") {
    return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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

  async function animatePacket(fromEl, toEl) {
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
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      if (abort) break;
      const p = i / steps;
      const ease = p * p * (3 - 2 * p);
      packet.style.left = `${x0 + (x1 - x0) * ease}px`;
      packet.style.top = `${y0 + (y1 - y0) * ease}px`;
      await sleep(16);
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

  async function runTramitation() {
    if (running) return;
    const chain = validateBeforeRun();
    if (!chain) return;
    running = true;
    abort = false;
    const cycles = Number(document.getElementById("vlMass")?.value || 1);
    const btnStart = document.getElementById("vlStart");
    const btnStop = document.getElementById("vlStop");
    btnStart.disabled = true;
    btnStop.disabled = false;
    renderTree();
    resetNodeVisuals();
    log("Início da tramitação simulada (demonstração local).", "info");
    let totalSteps = chain.length * cycles;
    let doneSteps = 0;
    let registered = 0;
    const hub = document.getElementById("vlHub");
    for (let cycle = 1; cycle <= cycles; cycle++) {
      if (abort) break;
      log(`Ciclo ${cycle} de ${cycles} — processando chapa selecionada.`, "warn");
      for (const item of chain) {
        if (abort) break;
        const c = selectedCandidate(item.office);
        const branch = document.getElementById(`vlBranch${item.office}`);
        const bar = document.getElementById(`vlBar${item.office}`);
        if (bar) bar.style.width = "0%";
        branch?.classList.remove("done");
        branch?.classList.add("active");
        hub?.classList.add("active");
        await animatePacket(hub, branch?.querySelector(".vl-cand-card") || branch);
        hub?.classList.remove("active");
        const regMs = cycles > 20 ? 120 : cycles > 5 ? 220 : 420;
        await fillBar(item.office, regMs);
        playUrnaBeep();
        await sleep(urnaBuffers.confirma?.duration ? Math.min(urnaBuffers.confirma.duration * 1000, 800) : 320);
        registered++;
        doneSteps++;
        const pct = Math.round((doneSteps / totalSteps) * 100);
        document.getElementById("vlGlobalBar")?.style && (document.getElementById("vlGlobalBar").style.width = `${pct}%`);
        document.getElementById("vlGlobalPct") && (document.getElementById("vlGlobalPct").textContent = `${pct}%`);
        setStat("vlStatReg", String(registered));
        setStat("vlStatCycle", `${cycle}/${cycles}`);
        const hash = fakeHash(`${c.id}-${c.number}-${cycle}-${Date.now()}`);
        log(`Registrado: ${officeLabel(item.office)} · nº ${esc(c.number)} · ${esc(c.name)} · ref. ${hash}`, "ok");
        branch?.classList.remove("active");
        branch?.classList.add("done");
        await sleep(cycles > 10 ? 40 : 90);
      }
    }
    if (abort) log("Tramitação interrompida pelo usuário.", "warn");
    else log(`Concluído: ${registered} registro(s) simulado(s). Sem efeito em urna real.`, "info");
    hub?.classList.remove("active");
    running = false;
    btnStart.disabled = false;
    btnStop.disabled = true;
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
      });
      document.getElementById(`vlSelect${item.office}`)?.addEventListener("change", e => {
        selection.set(item.office, e.target.value);
        renderTree();
      });
      document.getElementById(`vlSearch${item.office}`)?.addEventListener("input", () => populateSelect(item.office));
    });
    document.getElementById("vlStart")?.addEventListener("click", async () => {
      ensureAudio();
      try {
        await loadUrnaSounds();
      } catch (e) {
        deps.toast?.("Não foi possível carregar o áudio da urna.");
        log(`ERR :: áudio — ${esc(e.message)}`, "warn");
        return;
      }
      runTramitation();
    });
    document.getElementById("vlTestSound")?.addEventListener("click", async () => {
      ensureAudio();
      try {
        await loadUrnaSounds();
        playUrnaBeep();
      } catch (e) {
        deps.toast?.("Áudio da urna indisponível.");
      }
    });
    document.getElementById("vlStop")?.addEventListener("click", stopTramitation);
    document.getElementById("vlMass")?.addEventListener("input", e => {
      const out = document.getElementById("vlMassOut");
      if (out) out.textContent = e.target.value;
    });
    document.getElementById("vlClearLog")?.addEventListener("click", () => {
      const out = document.getElementById("vlTerminalOut");
      if (out) out.innerHTML = "";
      log("Registro limpo.", "dim");
    });
    document.getElementById("vlToggleChapa")?.addEventListener("click", () => {
      const panel = document.getElementById("vlChapaPanel");
      const btn = document.getElementById("vlToggleChapa");
      if (!panel || !btn) return;
      panel.classList.toggle("is-collapsed");
      const hidden = panel.classList.contains("is-collapsed");
      btn.textContent = hidden ? "Mostrar chapa" : "Ocultar chapa";
      btn.setAttribute("aria-expanded", hidden ? "false" : "true");
    });
    document.getElementById("vlToggleLog")?.addEventListener("click", () => {
      const log = document.getElementById("vlLogPanel");
      const btn = document.getElementById("vlToggleLog");
      if (!log || !btn) return;
      log.classList.toggle("is-collapsed");
      const hidden = log.classList.contains("is-collapsed");
      btn.textContent = hidden ? "Mostrar registro" : "Ocultar registro";
      btn.setAttribute("aria-expanded", hidden ? "false" : "true");
    });
  }

  function renderShell() {
    const root = document.getElementById("voteLaunchRoot");
    if (!root) return;
    root.innerHTML = `<div class="vl-shell">
      <div class="vl-notice"><strong>Demonstração</strong> Fluxo visual do voto casado com candidatos reais (TSE). Não registra voto, não conecta à urna eletrônica.</div>
      <header class="tse-page-header">
        <div class="tse-page-header-row">
          <div>
            <p class="eyebrow">Simulador de tramitação · Maranhão 2026</p>
            <h1>Lançamento de voto</h1>
            <p>Monte a chapa, acompanhe a ordem oficial de registro entre os cargos e ouça a confirmação sonora da urna.</p>
          </div>
        </div>
      </header>
      <section class="vl-chapa-panel vl-panel-block" id="vlChapaPanel">
        <div class="tse-panel-head vl-chapa-head">
          <h2>Configuração da chapa</h2>
          <button type="button" class="btn btn-tse btn-tse-ghost" id="vlToggleChapa" aria-expanded="true">Ocultar chapa</button>
        </div>
        <div class="vl-chapa-body">
          <div class="vl-chapa-row">
            ${VOTE_CHAIN.map(item => `<div class="vl-chapa-cell ${DEFAULT_ON.has(item.office) ? "on" : ""}" id="vlCargoBox${esc(item.office)}">
              <label class="vl-chapa-check"><input type="checkbox" id="vlCargo${esc(item.office)}" ${DEFAULT_ON.has(item.office) ? "checked" : ""}><span>${esc(item.short)}</span><span class="vl-chapa-full">${esc(item.label)}</span></label>
              <input type="search" class="vl-chapa-search" id="vlSearch${esc(item.office)}" placeholder="Buscar" autocomplete="off" title="Filtrar ${esc(item.label)}">
              <select class="vl-chapa-select" id="vlSelect${esc(item.office)}" aria-label="Candidato ${esc(item.label)}"><option value="">Candidato…</option></select>
            </div>`).join("")}
          </div>
          <div class="vl-chapa-toolbar">
            <div class="vl-mass-inline">
              <label for="vlMass">Ciclos</label>
              <input type="range" id="vlMass" min="1" max="120" value="1">
              <output id="vlMassOut" for="vlMass">1</output>
            </div>
            <label class="vl-sound-row"><input type="checkbox" id="vlSound" checked> confirma-urna.mp3</label>
            <button type="button" class="btn btn-tse btn-tse-secondary" id="vlTestSound">Testar som</button>
            <button type="button" class="btn btn-tse btn-tse-primary" id="vlStart">Iniciar tramitação</button>
            <button type="button" class="btn btn-tse btn-tse-ghost" id="vlStop" disabled>Interromper</button>
          </div>
        </div>
      </section>
      <div class="vl-stage">
        <section class="vl-panel-block vl-tree-wrap vl-tree-wrap--hero" id="vlTreeWrap">
          <div class="tse-panel-head vl-tree-head">
            <div><h2>Tramitação do voto casado</h2><p>Fluxo horizontal na ordem oficial de registro</p></div>
            <div class="vl-tree-head-actions">
              <button type="button" class="btn btn-tse btn-tse-ghost" id="vlToggleLog" aria-expanded="true">Ocultar registro</button>
              <div class="vl-progress-inline">
                <span id="vlGlobalPct">0%</span>
                <div class="vl-bar"><div class="vl-bar-fill" id="vlGlobalBar"></div></div>
              </div>
            </div>
          </div>
          <div class="vl-tree-area vl-tree-area--flow">
            <div class="vl-flow">
              <div class="vl-flow-hub" id="vlHub"><span>Início</span><small>Central de registro</small></div>
              <div class="vl-flow-track" id="vlBranches"></div>
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
            <div class="vl-stats">
              <div>Registros<b id="vlStatReg">0</b></div>
              <div>Ciclo<b id="vlStatCycle">—</b></div>
            </div>
            <button type="button" class="btn btn-tse btn-tse-ghost vl-log-clear" id="vlClearLog">Limpar</button>
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
    log("Sistema pronto. Selecione os candidatos e inicie a tramitação.", "dim");
    setStat("vlStatReg", "0");
    setStat("vlStatCycle", "—");
    try {
      await loadAllCatalogs();
      renderTree();
      log("Dados oficiais de candidatura sincronizados.", "info");
      loadUrnaSounds().then(() => {
        log("Áudio confirma-urna.mp3 carregado.", "dim");
      }).catch(() => log("Arquivo confirma-urna.mp3 não encontrado.", "warn"));
    } catch (e) {
      log(`ERR :: ${esc(e.message)}`, "warn");
      deps.toast?.(e.message || "Falha ao carregar candidatos.");
    }
  }

  return { mount };
})();
