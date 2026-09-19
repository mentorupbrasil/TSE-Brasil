"use strict";
const municipalities = window.CIVICA_MUNICIPALITIES;
const officeLabels = window.CIVICA_OFFICE_LABELS;
const partyColors = window.CIVICA_PARTY_COLORS;
const candidates = window.CIVICA_CANDIDATES;
const boxRows = window.CIVICA_BOX_ROWS;

const app = {
      running: false,
      section: 482,
      totalSections: 547,
      selectedOffice: "governador",
      selectedMunicipality: "Imperatriz",
      selectedAmount: 1000,
      events: [],
      audit: []
    };

    const $ = (sel, root=document) => root.querySelector(sel);
    const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
    const fmt = new Intl.NumberFormat("pt-BR");
    const pct = new Intl.NumberFormat("pt-BR", {minimumFractionDigits:1, maximumFractionDigits:1});
    const nowTime = () => new Date().toLocaleTimeString("pt-BR", {hour12:false});
    const initials = name => name.split(" ").slice(0,2).map(x => x[0]).join("").toUpperCase();
    const hash = () => "DEMO-" + crypto.getRandomValues(new Uint32Array(2)).join("-").slice(0,18);

    function toast(message) {
      $("#toastText").textContent = message;
      $("#toast").classList.add("show");
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 2800);
    }

    function addEvent(text, type="Atualização") {
      const item = {time: nowTime(), text, type};
      app.events.unshift(item);
      app.events = app.events.slice(0, 18);
      app.audit.unshift({...item, hash: hash()});
      renderActivity();
      renderAudit();
    }

    function seedEvents() {
      [
        ["Cenário demonstrativo carregado","Sistema local"],
        ["Base territorial com 217 municípios validada","Base geográfica"],
        ["Catálogo de candidaturas fictícias carregado","Candidaturas"],
        ["482 lotes sintéticos preparados","Processamento"],
        ["Ambiente confirmado sem conexões externas","Integridade"]
      ].reverse().forEach(([text,type], idx) => {
        const item = {time:new Date(Date.now()-idx*23000).toLocaleTimeString("pt-BR",{hour12:false}), text, type};
        app.events.unshift(item);
        app.audit.unshift({...item, hash:hash()});
      });
    }

    function renderMunicipalitySelect() {
      $("#municipalitySelect").innerHTML = municipalities.map(([name,code]) =>
        `<option value="${name}" ${name === "Imperatriz" ? "selected" : ""}>${name} — ${code}</option>`
      ).join("");
    }

    function renderResults(target="#resultsList", office=app.selectedOffice) {
      const list = candidates[office];
      const total = list.reduce((sum,c) => sum + c.votes, 0);
      const max = Math.max(...list.map(c => c.votes));
      $(target).innerHTML = [...list].sort((a,b)=>b.votes-a.votes).map(c => {
        const percent = c.votes / total * 100;
        const width = c.votes / max * 100;
        return `
          <div class="candidate-row" style="--party:${partyColors[c.party]}">
            <div class="candidate-id">
              <div class="candidate-avatar">${initials(c.name)}</div>
              <div style="min-width:0">
                <div class="candidate-name">${c.name}</div>
                <div class="candidate-party">${c.party} · nº ${c.number}</div>
              </div>
            </div>
            <div class="bar-track" aria-label="${pct.format(percent)} por cento"><div class="bar-fill" style="width:${width}%"></div></div>
            <div class="vote-data"><div class="vote-number">${fmt.format(c.votes)}</div><div class="vote-percent">${pct.format(percent)}%</div></div>
          </div>`;
      }).join("");
    }

    function renderMetrics() {
      const total = candidates[app.selectedOffice].reduce((sum,c)=>sum+c.votes,0);
      $("#votesMetric").textContent = fmt.format(total);
      $("#sectionsMetric").textContent = `${app.section} / ${app.totalSections}`;
      $("#sectionsMeta").textContent = `${pct.format(app.section/app.totalSections*100)}% do cenário`;
      $("#turnoutMetric").textContent = pct.format(72.8 + (app.section/app.totalSections)*2.1) + "%";
      $("#batchCount").textContent = app.section;
      $("#pendingCount").textContent = app.totalSections - app.section;
    }

    function renderActivity() {
      $("#activityList").innerHTML = app.events.map(e => `
        <div class="activity-item"><div class="activity-time">${e.time}</div><div class="activity-text"><strong>${e.type}</strong><br>${e.text}</div></div>
      `).join("");
    }

    function renderAudit() {
      $("#auditMetric").textContent = app.audit.length;
      $("#auditList").innerHTML = app.audit.map(e => `
        <div class="audit-row"><div class="activity-time">${e.time}</div><div><div class="audit-type">${e.type}</div><div class="audit-hash" title="${e.text}">${e.hash}</div></div><span class="status">registro demo</span></div>
      `).join("");
    }

    function renderMunicipalities(term="") {
      const normalized = term.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase();
      const filtered = municipalities.filter(([name,code]) =>
        (name+" "+code).normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().includes(normalized)
      );
      $("#municipalityCount").textContent = `${filtered.length} de 217 municípios exibidos`;
      $("#municipalityGrid").innerHTML = filtered.length ? filtered.map(([name,code]) => `
        <button class="municipality-card ${name==="Imperatriz"?"featured":""}" type="button" data-municipality="${name}">
          <span class="municipality-name">${name}</span><span class="municipality-code">IBGE ${code}</span>
        </button>
      `).join("") : '<div class="empty">Nenhum município encontrado.</div>';
      $$(".municipality-card").forEach(btn => btn.addEventListener("click", () => {
        app.selectedMunicipality = btn.dataset.municipality;
        $("#municipalitySelect").value = app.selectedMunicipality;
        showPage("overview");
        updateContext();
        toast(`Município alterado para ${app.selectedMunicipality}.`);
      }));
    }

    function renderBoxes() {
      $("#boxesBody").innerHTML = boxRows.map(row => {
        const cls = row[5] === "Consolidada" ? "" : row[5] === "Em processamento" ? "warn" : "neutral";
        return `<tr><td class="code">${row[0]}</td><td>${row[1]}</td><td class="code">${row[2]}</td><td>${row[3]}</td><td class="code">${row[4]}</td><td><span class="status ${cls}">${row[5]}</span></td></tr>`;
      }).join("");
    }

    function renderOfficeTabs() {
      $("#officeTabs").innerHTML = Object.entries(officeLabels).map(([key,label]) =>
        `<button class="office-tab ${key==="governador"?"active":""}" type="button" data-office-tab="${key}">${label}</button>`
      ).join("");
      $$(".office-tab").forEach(btn => btn.addEventListener("click", () => {
        $$(".office-tab").forEach(x=>x.classList.remove("active"));
        btn.classList.add("active");
        renderCandidateCatalog(btn.dataset.officeTab);
      }));
    }

    function renderCandidateCatalog(office) {
      $("#candidateCatalog").innerHTML = candidates[office].map(c => `
        <article class="candidate-card" style="--party:${partyColors[c.party]}">
          <div class="candidate-avatar">${initials(c.name)}</div>
          <div><div class="candidate-name">${c.name}</div><div class="candidate-party">${c.party} · ${c.partyName}</div><div class="candidate-office">${officeLabels[office]} • candidatura fictícia</div></div>
          <div class="candidate-number">${c.number}</div>
        </article>
      `).join("");
    }

    function renderScenarioOptions() {
      $("#scenarioOffice").innerHTML = Object.entries(officeLabels).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
      updateScenarioCandidates();
    }

    function updateScenarioCandidates() {
      const office = $("#scenarioOffice").value || "governador";
      $("#scenarioCandidate").innerHTML = candidates[office].map((c,i)=>`<option value="${i}">${c.name} — ${c.party}</option>`).join("");
      $("#scenarioPreviewTitle").textContent = officeLabels[office] + " • cenário atual";
      renderResults("#scenarioPreview", office);
    }

    function updateContext() {
      $("#resultsSubtitle").textContent = `${officeLabels[app.selectedOffice]} • ${app.selectedMunicipality}`;
      renderResults();
      renderMetrics();
    }

    function showPage(page) {
      $$(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.page===page));
      $$(".page").forEach(p=>p.classList.toggle("active", p.id===`page-${page}`));
      window.scrollTo({top:0,behavior:"smooth"});
    }

    function toggleSimulation() {
      app.running = !app.running;
      const btn = $("#toggleRunBtn");
      btn.innerHTML = app.running
        ? '<svg viewBox="0 0 24 24" fill="none"><path d="M8 5h3v14H8V5Zm5 0h3v14h-3V5Z" stroke="currentColor" stroke-width="1.8"/></svg>Pausar simulação'
        : '<svg viewBox="0 0 24 24" fill="none"><path d="m8 5 11 7-11 7V5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>Continuar simulação';
      $("#livePill").textContent = app.running ? "processando" : "em pausa";
      addEvent(app.running ? "Fluxo automático iniciado" : "Fluxo automático pausado", "Execução");
      toast(app.running ? "Simulação iniciada." : "Simulação pausada.");
    }

    function simulationTick() {
      if (!app.running) return;
      const list = candidates[app.selectedOffice];
      list.forEach(c => c.votes += Math.floor(Math.random()*180+25));
      if (app.section < app.totalSections && Math.random() > .35) app.section += 1;
      $("#updateMetric").textContent = "agora";
      updateContext();
      if (Math.random() > .68) addEvent(`Lote sintético ${app.section} consolidado em ${app.selectedMunicipality}`, "Processamento");
      if (app.section >= app.totalSections) {
        app.running = false;
        $("#livePill").textContent = "concluído";
        $("#toggleRunBtn").textContent = "Cenário concluído";
        $("#toggleRunBtn").disabled = true;
        addEvent("Todos os lotes deste cenário foram consolidados", "Conclusão");
      }
    }

    function resetScenario() {
      const initial = {
        "governador":[48220,41740,30110,18356],
        "senador":[44950,39470,32580,21426],
        "deputado-federal":[35870,33460,28960,22620],
        "deputado-estadual":[31930,29740,26640,24116],
        "presidente":[46780,42160,29120,20366]
      };
      Object.entries(candidates).forEach(([office,list])=>list.forEach((c,i)=>c.votes=initial[office][i]));
      app.section = 482;
      app.running = false;
      $("#livePill").textContent = "em espera";
      $("#toggleRunBtn").disabled = false;
      $("#toggleRunBtn").innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="m8 5 11 7-11 7V5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>Iniciar simulação';
      updateContext();
      updateScenarioCandidates();
      addEvent("Projeções restauradas ao estado inicial", "Reinicialização");
      toast("Cenário reiniciado.");
    }

    function applySyntheticBatch() {
      const office = $("#scenarioOffice").value;
      const candidate = candidates[office][Number($("#scenarioCandidate").value)];
      candidate.votes += app.selectedAmount;
      if (office === app.selectedOffice) updateContext();
      renderResults("#scenarioPreview", office);
      addEvent(`Lote sintético de ${fmt.format(app.selectedAmount)} unidades aplicado a ${candidate.name}`, "Cenário manual");
      toast("Lote sintético aplicado apenas nesta demonstração.");
    }

    function exportAudit() {
      const lines = [
        "RELATÓRIO DEMONSTRATIVO — SEM VALIDADE OFICIAL",
        "CÍVICA — SIMULADOR ELEITORAL FICTÍCIO",
        "Gerado em: " + new Date().toLocaleString("pt-BR"),
        "",
        ...app.audit.map(e=>`[${e.time}] ${e.type} | ${e.hash} | ${e.text}`),
        "",
        "AVISO: todos os eventos, identificadores e dados eleitorais deste relatório são fictícios."
      ];
      const blob = new Blob([lines.join("\\n")], {type:"text/plain;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "relatorio-simulacao-ficticia.txt";
      a.click();
      URL.revokeObjectURL(url);
      toast("Relatório demonstrativo gerado.");
    }

    function bindEvents() {
      $$(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>showPage(btn.dataset.page)));
      $("#municipalitySelect").addEventListener("change", e => { app.selectedMunicipality=e.target.value; updateContext(); addEvent(`Município de referência alterado para ${app.selectedMunicipality}`,"Filtro"); });
      $("#officeSelect").addEventListener("change", e => { app.selectedOffice=e.target.value; updateContext(); addEvent(`Cargo alterado para ${officeLabels[app.selectedOffice]}`,"Filtro"); });
      $("#municipalitySearch").addEventListener("input",e=>renderMunicipalities(e.target.value));
      $("#toggleRunBtn").addEventListener("click",toggleSimulation);
      $("#resetBtn").addEventListener("click",resetScenario);
      $("#refreshBoxesBtn").addEventListener("click",()=>{ boxRows.forEach((r,i)=>{ if(r[5]!=="Consolidada" && Math.random()>.5) r[5]="Consolidada"; r[4]=nowTime(); }); renderBoxes(); addEvent("Estados das urnas simuladas atualizados","Inventário"); toast("Inventário simulado atualizado."); });
      $("#scenarioOffice").addEventListener("change",updateScenarioCandidates);
      $$(".amount-btn").forEach(btn=>btn.addEventListener("click",()=>{ $$(".amount-btn").forEach(x=>x.classList.remove("active")); btn.classList.add("active"); app.selectedAmount=Number(btn.dataset.amount); }));
      $("#applyScenarioBtn").addEventListener("click",applySyntheticBatch);
      $("#exportAuditBtn").addEventListener("click",exportAudit);
      $("#printBtn").addEventListener("click",()=>window.print());
      $("#fullBtn").addEventListener("click",()=>{ if(!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); });
    }

    function init() {
      renderMunicipalitySelect();
      seedEvents();
      renderMunicipalities();
      renderBoxes();
      renderOfficeTabs();
      renderCandidateCatalog("governador");
      renderScenarioOptions();
      updateContext();
      renderActivity();
      renderAudit();
      bindEvents();
      setInterval(()=>{ $("#clock").textContent = new Date().toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"medium"}); },1000);
      setInterval(simulationTick,1800);
      $("#clock").textContent = new Date().toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"medium"});
    }
    init();
