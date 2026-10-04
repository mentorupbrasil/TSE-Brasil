"use strict";

/** Simulador de urna e apuração — módulo educativo (dados públicos TSE). */
window.CivicaSimulator = (() => {
  const CASADO_OFFICES = ["1", "3", "5", "6", "7"];
  let deps = null;
  let urnaDigits = "";
  let urnaOffice = "6";
  let runController = null;

  const urnaAudio = {
    ctx: null,
    enabled: true,
    ensure() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
      }
      return this.ctx;
    },
    tone(freq, duration, type = "sine", gain = 0.08) {
      if (!this.enabled) return;
      const ctx = this.ensure();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime;
      osc.start(t);
      g.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.stop(t + duration + 0.02);
    },
    key() { this.tone(880, 0.06, "square", 0.04); },
    confirm() {
      this.tone(523, 0.12, "sine", 0.09);
      setTimeout(() => this.tone(784, 0.18, "sine", 0.1), 90);
    },
    error() { this.tone(220, 0.25, "sawtooth", 0.07); },
    end() { this.tone(440, 0.15, "triangle", 0.06); setTimeout(() => this.tone(660, 0.2, "triangle", 0.05), 120); }
  };

  function $(id) { return document.getElementById(id); }

  function pickWeightedSection(sections) {
    const list = sections.filter(s => Number(s.eleitores) > 0);
    if (!list.length) return sections[Math.floor(Math.random() * sections.length)] || null;
    const total = list.reduce((a, s) => a + Number(s.eleitores || 1), 0);
    let r = Math.random() * total;
    for (const s of list) {
      r -= Number(s.eleitores || 1);
      if (r <= 0) return s;
    }
    return list[list.length - 1];
  }

  function sectionFromFormOrRandom(municipality, zone, section) {
    const data = deps.state.sectionData.get(municipality);
    if (!data?.sections?.length) {
      return { municipio: municipality, zona: zone || "—", secao: section || "—", bairro: "", localNome: "—", eleitores: 0 };
    }
    let pool = data.sections;
    if (zone) pool = pool.filter(x => String(x.zona) === String(zone));
    if (section) pool = pool.filter(x => String(x.secao) === String(section));
    if (!pool.length) pool = data.sections;
    return pickWeightedSection(pool);
  }

  function pushFlow(entry) {
    const feed = $("simFlowFeed");
    if (!feed) return;
    const li = document.createElement("li");
    li.className = "sim-flow-item";
    li.innerHTML = `<span class="sim-flow-from">${deps.esc(entry.municipality)} · Zona <b>${deps.esc(entry.zone)}</b> · Seção <b>${deps.esc(entry.section)}</b>${entry.local ? ` · ${deps.esc(entry.local)}` : ""}</span><span class="sim-flow-arrow">→</span><span class="sim-flow-to">${deps.esc(entry.officeLabel)}: <b>${deps.esc(entry.candidateName || entry.party || entry.type)}</b></span>`;
    feed.prepend(li);
    while (feed.children.length > 80) feed.lastElementChild?.remove();
  }

  function appendEntries(entries) {
    const scenario = deps.activeScenario();
    if (!scenario) return;
    scenario.entries.push(...entries);
    scenario.updatedAt = new Date().toISOString();
    deps.saveSimulationStore();
    entries.forEach(pushFlow);
    deps.renderSimulation();
    deps.renderLiveTotals();
  }

  function buildEntry({ office, municipality, sec, candidate, type = "candidate", note = "" }) {
    return {
      id: deps.newId("lanc"),
      at: new Date().toISOString(),
      office: String(office),
      officeLabel: deps.officeLabel(office),
      municipality,
      neighborhood: sec.bairro || "",
      zone: String(sec.zona || ""),
      section: String(sec.secao || ""),
      local: sec.localNome || "",
      type,
      candidateId: candidate ? String(candidate.id || candidate.number) : "",
      candidateName: candidate ? (candidate.name || candidate.fullName || "") : "",
      candidateNumber: candidate ? (candidate.number || "") : "",
      party: candidate?.party || "",
      partyName: candidate?.partyName || "",
      quantity: 1,
      note
    };
  }

  async function resolveCandidate(office, idOrNumber) {
    const data = await deps.getCandidates(office);
    return data.candidates.find(c => String(c.id) === String(idOrNumber) || String(c.number) === String(idOrNumber)) || null;
  }

  async function confirmUrnaVote() {
    const municipality = $("simMunicipality")?.value;
    if (!municipality) { deps.toast("Selecione o município."); urnaAudio.error(); return; }
    const zone = $("simZone")?.value || "";
    const section = $("simSection")?.value || "";
    const casado = $("simVotoCasadoUrna")?.checked;
    const offices = casado ? CASADO_OFFICES : [($("simOffice")?.value || urnaOffice)];

    const batch = [];
    if (casado) {
      for (const office of offices) {
        const sel = $(`urnaCasado-${office}`);
        const cid = sel?.value;
        if (!cid) { deps.toast(`Selecione candidatura para ${deps.officeLabel(office)}.`); urnaAudio.error(); return; }
        const cand = await resolveCandidate(office, cid);
        if (!cand) { deps.toast("Candidatura não encontrada."); urnaAudio.error(); return; }
        const sec = sectionFromFormOrRandom(municipality, zone, section);
        batch.push(buildEntry({ office, municipality, sec, candidate: cand, note: "urna-voto-casado" }));
      }
    } else {
      const office = $("simOffice")?.value || urnaOffice;
      let cand = null;
      const typed = urnaDigits.replace(/\D/g, "");
      if (typed) {
        cand = (await deps.getCandidates(office)).candidates.find(c => String(c.number) === typed);
        if (!cand) { deps.toast("Número não encontrado neste cargo."); urnaAudio.error(); showUrnaPreview(null); return; }
      } else {
        const cid = $("simCandidate")?.value;
        if (!cid) { deps.toast("Digite o número ou selecione a candidatura."); urnaAudio.error(); return; }
        cand = await resolveCandidate(office, cid);
      }
      if (!cand) { deps.toast("Candidatura inválida."); urnaAudio.error(); return; }
      const sec = sectionFromFormOrRandom(municipality, zone, section);
      batch.push(buildEntry({ office, municipality, sec, candidate: cand, note: "urna-manual" }));
    }

    appendEntries(batch);
    urnaAudio.confirm();
    flashUrnaConfirmed(batch[batch.length - 1]);
    urnaDigits = "";
    updateUrnaDisplay();
  }

  function flashUrnaConfirmed(entry) {
    const preview = $("urnaPreview");
    if (!preview) return;
    preview.hidden = false;
    $("urnaIdle")?.classList.add("confirmed");
    const cand = { name: entry.candidateName, number: entry.candidateNumber, party: entry.party, photo: null };
    deps.getCandidates(entry.office).then(data => {
      const full = data.candidates.find(c => String(c.id) === String(entry.candidateId) || String(c.number) === String(entry.candidateNumber));
      preview.innerHTML = `<div class="urna-confirmed-card">${deps.photoMarkup(full || cand, true)}<div><p class="urna-ok">Voto registrado na simulação</p><h3>${deps.esc(entry.candidateName)}</h3><p>${deps.esc(entry.party)} · ${deps.esc(entry.candidateNumber)}</p><small>${deps.esc(entry.municipality)} — Zona ${deps.esc(entry.zone)} · Seção ${deps.esc(entry.section)}</small></div></div>`;
      deps.wireImageFallbacks(preview);
      setTimeout(() => { preview.hidden = true; $("urnaIdle")?.classList.remove("confirmed"); }, 2400);
    });
  }

  function updateUrnaDisplay() {
    const el = $("urnaDisplay");
    if (el) el.textContent = urnaDigits || "—";
    const office = $("simOffice")?.value || urnaOffice;
    const typed = urnaDigits.replace(/\D/g, "");
    if (typed.length >= 2) {
      deps.getCandidates(office).then(data => {
        const c = data.candidates.find(x => String(x.number).startsWith(typed));
        showUrnaPreview(c || null);
      });
    } else showUrnaPreview(null);
  }

  function showUrnaPreview(candidate) {
    const preview = $("urnaPreview");
    if (!preview) return;
    if (!candidate) { preview.hidden = true; preview.innerHTML = ""; return; }
    preview.hidden = false;
    preview.innerHTML = `<div class="urna-preview-card">${deps.photoMarkup(candidate)}<div><strong>${deps.esc(candidate.name)}</strong><span>${deps.esc(candidate.party)} · ${deps.esc(candidate.number)}</span></div></div>`;
    deps.wireImageFallbacks(preview);
  }

  function buildKeypad() {
    const root = $("urnaKeypad");
    if (!root || root.dataset.wired) return;
    root.dataset.wired = "1";
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
    keys.forEach(k => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "urna-key";
      btn.textContent = k;
      btn.onclick = () => {
        if (urnaDigits.length >= 5) return;
        urnaDigits += k;
        urnaAudio.key();
        updateUrnaDisplay();
      };
      root.appendChild(btn);
    });
  }

  async function renderCasadoPicks() {
    const wrap = $("urnaCasadoPicks");
    const on = $("simVotoCasadoUrna")?.checked;
    if (!wrap) return;
    wrap.hidden = !on;
    if (!on) return;
    wrap.innerHTML = CASADO_OFFICES.map(o => `<label>${deps.esc(deps.officeLabel(o))}<select id="urnaCasado-${o}"><option value="">Carregando…</option></select></label>`).join("");
    await Promise.all(CASADO_OFFICES.map(async office => {
      const el = $(`urnaCasado-${office}`);
      try {
        const data = await deps.getCandidates(office);
        const list = [...(data.candidates || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
        el.innerHTML = `<option value="">Selecione</option>` + list.map(c => `<option value="${deps.esc(c.id || c.number)}">${deps.esc(c.name)} — ${deps.esc(c.party)} ${deps.esc(c.number)}</option>`).join("");
      } catch {
        el.innerHTML = `<option value="">Indisponível</option>`;
      }
    }));
  }

  async function renderProgCargoGrid() {
    const grid = $("progCargoGrid");
    if (!grid) return;
    grid.innerHTML = CASADO_OFFICES.map(o => `<label class="prog-cargo-item"><span>${deps.esc(deps.officeLabel(o))}</span><select id="progCand-${o}" data-office="${o}"><option value="">Carregando…</option></select></label>`).join("");
    await Promise.all(CASADO_OFFICES.map(async office => {
      const el = $(`progCand-${office}`);
      try {
        const data = await deps.getCandidates(office);
        const list = [...(data.candidates || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
        el.innerHTML = `<option value="">—</option>` + list.map(c => `<option value="${deps.esc(c.id || c.number)}">${deps.esc(c.name)} (${deps.esc(c.number)})</option>`).join("");
      } catch {
        el.innerHTML = `<option value="">Indisponível</option>`;
      }
    }));
  }

  async function populateProgGeography() {
    const municipality = $("progMunicipality")?.value;
    const zoneEl = $("progZone");
    const secEl = $("progSection");
    if (!zoneEl || !secEl || !municipality) return;
    zoneEl.innerHTML = `<option value="">Todas as zonas</option>`;
    secEl.innerHTML = `<option value="">Todas as seções</option>`;
    try {
      const data = await deps.getSections(municipality);
      zoneEl.innerHTML += (data.zones || []).map(z => `<option value="${deps.esc(z.zona)}">Zona ${deps.esc(z.zona)}</option>`).join("");
      secEl.innerHTML += (data.sections || []).slice(0, 2000).map(s => `<option value="${deps.esc(s.secao)}" data-zone="${deps.esc(s.zona)}">Zona ${deps.esc(s.zona)} · Seção ${deps.esc(s.secao)}</option>`).join("");
    } catch { /* noop */ }
  }

  function filterSectionsForProgram(data, zone, section) {
    let pool = data?.sections || [];
    if (zone) pool = pool.filter(x => String(x.zona) === String(zone));
    if (section) pool = pool.filter(x => String(x.secao) === String(section));
    return pool.length ? pool : (data?.sections || []);
  }

  function peopleAsSections(people, municipality) {
    return people
      .filter(p => !municipality || normalizeMuni(p.municipality) === normalizeMuni(municipality))
      .filter(p => p.zone && p.section)
      .map(p => ({ municipio: p.municipality || municipality, zona: p.zone, secao: p.section, bairro: p.neighborhood || "", localNome: "Base privada", eleitores: 1 }));
  }

  function normalizeMuni(v) {
    return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function speedMs(speed) {
    if (speed === "slow") return 120;
    if (speed === "fast") return 8;
    return 35;
  }

  async function startProgrammedRun() {
    if (runController?.running) return;
    const municipality = $("progMunicipality")?.value;
    const quantity = Math.min(500000, Math.max(1, Number($("progQuantity")?.value) || 0));
    const zone = $("progZone")?.value || "";
    const section = $("progSection")?.value || "";
    const speed = $("progSpeed")?.value || "medium";
    const casado = $("progVotoCasado")?.checked;
    const source = $("progElectorSource")?.value || "sections";

    if (!municipality) { deps.toast("Selecione o município."); return; }

    const targets = [];
    for (const office of CASADO_OFFICES) {
      const el = $(`progCand-${office}`);
      const val = el?.value;
      if (!val) continue;
      const cand = await resolveCandidate(office, val);
      if (cand) targets.push({ office, candidate: cand });
    }
    if (!targets.length) { deps.toast("Selecione ao menos uma candidatura."); return; }

    let sectionPool = [];
    if (source === "people" && deps.getPeople?.()?.length) {
      sectionPool = peopleAsSections(deps.getPeople(), municipality);
    }
    if (!sectionPool.length) {
      const data = await deps.getSections(municipality);
      sectionPool = filterSectionsForProgram(data, zone, section);
    }
    if (!sectionPool.length) { deps.toast("Nenhuma seção disponível para simulação."); return; }

    const officesToApply = casado ? targets : targets.slice(0, 1);
    const panel = $("progProgressPanel");
    panel.hidden = false;
    $("progTotal").textContent = deps.fmt.format(quantity);
    $("progDone").textContent = "0";
    $("progPercent").textContent = "0%";
    $("progFill").style.width = "0%";
    $("progStart").disabled = true;
    $("progPause").disabled = false;
    $("progStop").disabled = false;
    switchTab("apuracao");

    runController = { running: true, paused: false, stop: false, done: 0, total: quantity };

    const tick = async () => {
      if (!runController?.running || runController.stop) {
        finishRun();
        return;
      }
      while (runController.paused && runController.running && !runController.stop) {
        await sleep(80);
      }
      if (runController.stop) { finishRun(); return; }

      const sec = pickWeightedSection(sectionPool);
      const batch = [];
      for (const t of officesToApply) {
        batch.push(buildEntry({
          office: t.office,
          municipality,
          sec,
          candidate: t.candidate,
          note: casado ? "programado-voto-casado" : "programado-lote"
        }));
      }
      appendEntries(batch);
      if (runController.done % 3 === 0) urnaAudio.key();

      runController.done += 1;
      const pct = Math.min(100, (runController.done / runController.total) * 100);
      $("progDone").textContent = deps.fmt.format(runController.done);
      $("progPercent").textContent = `${pct.toFixed(1)}%`;
      $("progFill").style.width = `${pct}%`;
      $("progCurrentZone").textContent = sec.zona || "—";
      $("progCurrentSection").textContent = sec.secao || "—";
      $("progStatusText").textContent = `${deps.esc(municipality)} · Zona ${deps.esc(sec.zona)} · Seção ${deps.esc(sec.secao)}${sec.localNome ? ` · ${deps.esc(sec.localNome)}` : ""}`;

      if (runController.done >= runController.total) {
        urnaAudio.end();
        finishRun();
        deps.toast("Computação simulada concluída.");
        return;
      }
      setTimeout(tick, speedMs(speed));
    };
    tick();
  }

  function finishRun() {
    if (runController) runController.running = false;
    $("progStart").disabled = false;
    $("progPause").disabled = true;
    $("progStop").disabled = true;
    $("progPause").textContent = "Pausar";
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function switchTab(name) {
    document.querySelectorAll(".sim-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.simTab === name));
    document.querySelectorAll(".sim-pane").forEach(pane => {
      const on = pane.dataset.simPane === name;
      pane.classList.toggle("active", on);
      pane.hidden = !on;
    });
  }

  function bindTabs() {
    document.querySelectorAll(".sim-tab").forEach(btn => {
      btn.onclick = () => switchTab(btn.dataset.simTab);
    });
  }

  function bindUrna() {
    buildKeypad();
    $("urnaCorrige")?.addEventListener("click", () => { urnaDigits = ""; urnaAudio.key(); updateUrnaDisplay(); showUrnaPreview(null); });
    $("urnaBranco")?.addEventListener("click", () => { deps.toast("Branco registrado apenas na apuração programada."); urnaAudio.key(); });
    $("urnaConfirma")?.addEventListener("click", () => confirmUrnaVote());
    $("simVotoCasadoUrna")?.addEventListener("change", () => renderCasadoPicks());
    $("simSoundEnabled")?.addEventListener("change", e => { urnaAudio.enabled = e.target.checked; });
  }

  function bindProgram() {
    $("progMunicipality")?.addEventListener("change", populateProgGeography);
    $("progStart")?.addEventListener("click", startProgrammedRun);
    $("progPause")?.addEventListener("click", () => {
      if (!runController) return;
      runController.paused = !runController.paused;
      $("progPause").textContent = runController.paused ? "Retomar" : "Pausar";
    });
    $("progStop")?.addEventListener("click", () => {
      if (runController) runController.stop = true;
    });
  }

  async function load(depsIn) {
    deps = depsIn;
    bindTabs();
    bindUrna();
    bindProgram();
    urnaAudio.enabled = $("simSoundEnabled")?.checked !== false;

    const muniHtml = deps.municipalities.map(([name, code]) => `<option value="${deps.esc(name)}">${deps.esc(name)} — IBGE ${deps.esc(code)}</option>`).join("");
    $("progMunicipality").innerHTML = muniHtml;
    $("progMunicipality").value = deps.state.municipality;

    const officeIds = Object.keys(deps.offices);
    $("simTotalsOffice").innerHTML = officeIds.map(k => `<option value="${deps.esc(k)}">${deps.esc(deps.offices[k])}</option>`).join("");
    $("simHistoryOffice").innerHTML = $("simTotalsOffice").innerHTML;
    $("simTotalsOffice").onchange = () => deps.renderLiveTotals();
    $("simHistoryOffice").onchange = () => { deps.state.office = $("simHistoryOffice").value; deps.renderSimulation(); };

    await Promise.all([renderCasadoPicks(), renderProgCargoGrid(), populateProgGeography()]);
    deps.renderLiveTotals();
  }

  return { load, switchTab, urnaAudio };
})();
