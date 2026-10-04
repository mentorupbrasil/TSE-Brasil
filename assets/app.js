"use strict";

const municipalities = window.CIVICA_MUNICIPALITIES || [];
const cfg = window.CIVICA_CONFIG || {};
const offices = cfg.officeLabels || {};
const shortOffices = cfg.officeShortLabels || offices;
const fmt = new Intl.NumberFormat("pt-BR");

const state = {
  office: cfg.defaultOffice || "6",
  municipality: "Imperatriz",
  candidateData: new Map(),
  sectionData: new Map(),
  summary: null,
  health: null,
  candidateFilters: { party: "", status: "", search: "", sort: "name", page: 1, pageSize: 24 },
  sectionFilters: { zone: "", search: "", page: 1, pageSize: 50 },
  globalSearchTimer: null,
  people: [],
  peopleKey: null,
  peopleSalt: null,
  peopleEditingId: null,
  peopleSearch: ""
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function normalize(value = "") { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function slugify(value = "") { return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function toast(text) { const el = $("#toast"); el.textContent = text; el.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2800); }
function formatDate(value) {
  if (!value) return "não informado pela fonte";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function formatMaybe(value) { return value === null || value === undefined ? "—" : fmt.format(value); }
function officeLabel(id) { return offices[String(id)] || `Cargo ${id}`; }

async function api(path, { refresh = false } = {}) {
  const url = refresh ? `${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}` : path;
  const cacheKey = `civica-api:${path}`;
  try {
    const response = await fetch(url, { cache: refresh ? "no-store" : "default" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.detail || `Falha HTTP ${response.status}`);
    try {
      if (!path.startsWith("/api/status")) localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data }));
    } catch {}
    return data;
  } catch (error) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached?.data && Date.now() - cached.savedAt < 24 * 60 * 60 * 1000) {
        return { ...cached.data, stale: true, cache: "browser-stale", fallbackError: "Fonte oficial temporariamente indisponível; exibindo a última consulta salva neste navegador." };
      }
    } catch {}
    throw error;
  }
}

function setPage(page) {
  $$(".page").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  const navMap = { "candidate-detail": "candidates", "municipality-detail": "municipalities" };
  const activeNav = navMap[page] || page;
  $$(".nav-link").forEach(el => el.classList.toggle("active", el.dataset.nav === activeNav));
  $("#mainContent")?.focus({ preventScroll: true });
  closeSidebar();
}

function setBreadcrumbs(items = []) {
  const root = $("#breadcrumbs");
  if (!items.length) { root.innerHTML = ""; return; }
  root.innerHTML = items.map((item, index) => {
    if (index === items.length - 1 || !item.path) return `<span>${esc(item.label)}</span>`;
    return `<a href="${esc(item.path)}" data-route="${esc(item.path)}">${esc(item.label)}</a><span> / </span>`;
  }).join("");
}

function navigate(path, replace = false) {
  if (replace) history.replaceState({}, "", path); else history.pushState({}, "", path);
  route();
}

function parseRoute() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (path === "/") return { page: "overview" };
  if (parts[0] === "candidatos" && parts.length >= 3) return { page: "candidate-detail", office: parts[1], id: parts.slice(2).join("/") };
  if (parts[0] === "candidatos") return { page: "candidates" };
  if (parts[0] === "partidos" || parts[0] === "bairros" || parts[0] === "fontes" || parts[0] === "lancamentos" || parts[0] === "simulacao") return { page: "overview", legacy: true };
  if (parts[0] === "zonas") return { page: "sections" };
  if (parts[0] === "municipios" && parts[1]) return { page: "municipality-detail", slug: parts.slice(1).join("/") };
  if (parts[0] === "municipios") return { page: "municipalities" };
  if (parts[0] === "base") return { page: "people" };
  return { page: "overview", notFound: true };
}

async function route() {
  const routeInfo = parseRoute();
  if (routeInfo.legacy) history.replaceState({}, "", "/");
  setPage(routeInfo.page);
  window.scrollTo({ top: 0, behavior: "auto" });
  try {
    if (routeInfo.page === "overview") { setBreadcrumbs([]); await loadOverview(); }
    if (routeInfo.page === "candidates") { setBreadcrumbs([{ label: "Candidaturas" }]); await loadCandidatePage(); }
    if (routeInfo.page === "candidate-detail") await loadCandidateDetail(routeInfo.office, routeInfo.id);
    if (routeInfo.page === "sections") { setBreadcrumbs([{ label: "Zonas e seções" }]); await loadSectionsPage(); }
    if (routeInfo.page === "municipalities") { setBreadcrumbs([{ label: "Municípios" }]); renderMunicipalities(); }
    if (routeInfo.page === "municipality-detail") await loadMunicipalityDetail(routeInfo.slug);
    if (routeInfo.page === "people") { setBreadcrumbs([{ label: "Base de pessoas" }]); renderPeoplePage(); }
  } catch (error) {
    toast(error.message || "Não foi possível carregar esta área.");
  }
}

function fillOfficeSelects() {
  const el = $("#candidateOffice");
  if (!el) return;
  el.innerHTML = Object.entries(offices).map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join("");
  el.value = state.office;
}

function fillMunicipalitySelect() {
  const html = municipalities.map(([name, code]) => `<option value="${esc(name)}">${esc(name)} — IBGE ${esc(code)}</option>`).join("");
  ["sectionMunicipality"].forEach(id => {
    const el = $("#" + id); if (!el) return; el.innerHTML = html; el.value = state.municipality;
  });
  const list = $("#municipalityNames"); if (list) list.innerHTML = municipalities.map(([name]) => `<option value="${esc(name)}"></option>`).join("");
}

async function getCandidates(office = state.office, refresh = false) {
  office = String(office);
  if (!refresh && state.candidateData.has(office)) return state.candidateData.get(office);
  const data = await api(`/api/candidatos?cargo=${encodeURIComponent(office)}`, { refresh });
  state.candidateData.set(office, data);
  return data;
}

async function getSections(municipality = state.municipality, refresh = false) {
  if (!refresh && state.sectionData.has(municipality)) return state.sectionData.get(municipality);
  const data = await api(`/api/secoes?municipio=${encodeURIComponent(municipality)}`, { refresh });
  state.sectionData.set(municipality, data);
  return data;
}

function dataMeta(data) {
  if (!data) return "";
  const stale = data.stale ? `<span class="stale">⚠ exibindo último dado disponível</span>` : "";
  const updated = data.sourceUpdatedAt ? `<span>Fonte atualizada em: <b>${esc(formatDate(data.sourceUpdatedAt))}</b></span>` : "";
  return `${stale}<span>Consulta realizada em: <b>${esc(formatDate(data.queriedAt))}</b></span>${updated}<span>Cache: ${esc(data.cache || "—")}</span>`;
}

function photoMarkup(candidate, large = false) {
  const cls = large ? "detail-photo" : "candidate-photo";
  const fallbackCls = large ? "detail-photo-fallback" : "candidate-photo-fallback";
  const initials = (candidate.name || candidate.fullName || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();
  if (candidate.photo) return `<img class="${cls}" src="${esc(candidate.photo)}" alt="Foto de ${esc(candidate.name || candidate.fullName)}" data-image-fallback="${esc(initials)}" loading="lazy">`;
  return `<div class="${fallbackCls}" aria-hidden="true">${esc(initials)}</div>`;
}

function wireImageFallbacks(root = document) {
  $$('img[data-image-fallback]', root).forEach(img => {
    img.addEventListener("error", () => {
      const div = document.createElement("div");
      div.className = img.classList.contains("detail-photo") ? "detail-photo-fallback" : "candidate-photo-fallback";
      div.textContent = img.dataset.imageFallback || "?";
      div.setAttribute("aria-hidden", "true");
      img.replaceWith(div);
    }, { once: true });
  });
}

function statusClass(status = "") {
  const n = normalize(status);
  return /deferid|apto|habilitad|eleito/.test(n) ? "good" : "";
}

function candidateCard(candidate, office = state.office) {
  const path = `/candidatos/${encodeURIComponent(office)}/${encodeURIComponent(candidate.id || candidate.number)}`;
  return `<a class="candidate-card" href="${path}" data-route="${path}">
    ${photoMarkup(candidate)}
    <div class="cand-body">
      <div class="cand-topline"><span class="number">${esc(candidate.number || "—")}</span><span class="status ${statusClass(candidate.status)}">${esc(candidate.status || "Situação não informada")}</span></div>
      <h3>${esc(candidate.name || candidate.fullName)}</h3>
      <p><b>${esc(candidate.party || "Sem sigla")}</b>${candidate.partyName ? ` · ${esc(candidate.partyName)}` : ""}</p>
    </div>
  </a>`;
}

function renderBarChart(root, items, labelKey, valueKey, maxItems = 15) {
  const list = (items || []).filter(x => Number.isFinite(Number(x[valueKey]))).slice(0, maxItems);
  if (!list.length) { root.innerHTML = `<div class="empty">Nenhum dado disponível.</div>`; return; }
  const max = Math.max(...list.map(x => Number(x[valueKey])), 1);
  root.innerHTML = list.map(item => `<div class="bar-row"><div class="bar-label" title="${esc(item[labelKey])}">${esc(item[labelKey])}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (Number(item[valueKey]) / max) * 100)}%"></div></div><div class="bar-value">${fmt.format(Number(item[valueKey]))}</div></div>`).join("");
}

async function loadOverview(refresh = false) {
  if (!window.CivicaOverview) return;
  const grid = $("#overviewOfficeGrid");
  if (grid && (!state.summary || refresh)) grid.innerHTML = `<div class="loading">Montando painel…</div>`;
  try {
    if (!state.summary || refresh) {
      state.summary = await api("/api/resumo", { refresh });
      if (refresh) state.candidateData.clear();
    }
    if (!state.health || refresh) await checkSources(refresh);
    CivicaOverview.bind({
      state,
      offices,
      fmt,
      esc,
      formatDate,
      formatMaybe,
      officeLabel,
      getCandidates,
      candidateCard,
      wireImageFallbacks,
      renderBarChart
    });
    await CivicaOverview.render(state.summary, state.health, refresh);
  } catch (error) {
    if (grid) grid.innerHTML = `<div class="error">${esc(error.message)}</div>`;
    toast(error.message || "Não foi possível carregar o painel inicial.");
  }
}

function aggregateParties(candidates) {
  const map = new Map();
  for (const c of candidates || []) {
    const party = c.party || "SEM SIGLA";
    const item = map.get(party) || { party, partyName: c.partyName || "", count: 0, candidates: [] };
    item.count++; item.candidates.push(c); if (!item.partyName && c.partyName) item.partyName = c.partyName;
    map.set(party, item);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.party.localeCompare(b.party));
}

async function loadCandidatePage(refresh = false) {
  const root = $("#candidateCatalog"); root.innerHTML = `<div class="loading">Carregando candidaturas oficiais…</div>`;
  const office = $("#candidateOffice").value || state.office; state.office = office;
  try {
    const data = await getCandidates(office, refresh);
    populateCandidateFilters(data.candidates);
    $("#candidateMeta").innerHTML = dataMeta(data);
    renderCandidateCatalog();
  } catch (error) { root.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
}

function populateCandidateFilters(candidates) {
  const parties = [...new Set((candidates || []).map(c => c.party).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const statuses = [...new Set((candidates || []).map(c => c.status).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const party = $("#candidateParty"), status = $("#candidateStatus");
  const currentParty = state.candidateFilters.party, currentStatus = state.candidateFilters.status;
  party.innerHTML = `<option value="">Todos</option>` + parties.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
  status.innerHTML = `<option value="">Todas</option>` + statuses.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
  if (parties.includes(currentParty)) party.value = currentParty; else state.candidateFilters.party = "";
  if (statuses.includes(currentStatus)) status.value = currentStatus; else state.candidateFilters.status = "";
}

function filteredCandidates() {
  const data = state.candidateData.get(state.office); if (!data) return [];
  const f = state.candidateFilters, q = normalize(f.search);
  const list = data.candidates.filter(c => (!f.party || c.party === f.party) && (!f.status || c.status === f.status) && (!q || normalize(`${c.name} ${c.fullName} ${c.number} ${c.party} ${c.partyName}`).includes(q)));
  list.sort((a, b) => {
    if (f.sort === "number") return Number(a.number || 0) - Number(b.number || 0) || String(a.name).localeCompare(String(b.name), "pt-BR");
    if (f.sort === "party") return String(a.party).localeCompare(String(b.party), "pt-BR") || String(a.name).localeCompare(String(b.name), "pt-BR");
    return String(a.name).localeCompare(String(b.name), "pt-BR");
  });
  return list;
}

function renderCandidateCatalog() {
  const list = filteredCandidates(), f = state.candidateFilters, totalPages = Math.max(1, Math.ceil(list.length / f.pageSize));
  f.page = Math.min(f.page, totalPages);
  const pageItems = list.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
  $("#candidateSummary").textContent = `${fmt.format(list.length)} candidaturas exibidas · ${officeLabel(state.office)}`;
  const root = $("#candidateCatalog"); root.innerHTML = pageItems.length ? pageItems.map(c => candidateCard(c, state.office)).join("") : `<div class="empty">Nenhum resultado encontrado.</div>`;
  wireImageFallbacks(root); renderPagination($("#candidatePagination"), f.page, totalPages, page => { f.page = page; renderCandidateCatalog(); window.scrollTo({ top: 180, behavior: "smooth" }); });
}

function renderPagination(root, current, total, onChange) {
  root.innerHTML = ""; if (total <= 1) return;
  const create = (label, page, disabled = false, active = false) => {
    const btn = document.createElement("button"); btn.className = "page-btn" + (active ? " active" : ""); btn.textContent = label; btn.disabled = disabled; btn.onclick = () => onChange(page); root.appendChild(btn);
  };
  create("‹", current - 1, current === 1);
  const start = Math.max(1, current - 2), end = Math.min(total, current + 2);
  for (let p = start; p <= end; p++) create(String(p), p, false, p === current);
  create("›", current + 1, current === total);
}

async function loadCandidateDetail(office, id) {
  setBreadcrumbs([{ label: "Candidaturas", path: "/candidatos" }, { label: "Detalhes" }]);
  const root = $("#candidateDetail"); root.innerHTML = `<div class="loading">Carregando candidatura…</div>`;
  try {
    const data = await getCandidates(office);
    const candidate = data.candidates.find(c => String(c.id) === String(id)) || data.candidates.find(c => String(c.number) === String(id));
    if (!candidate) { root.innerHTML = `<div class="error">Candidatura não localizada no conjunto atual.</div>`; return; }
    document.title = `${candidate.name} — ${officeLabel(office)} | Cívica MA`;
    root.innerHTML = `<div class="detail-hero">
      ${photoMarkup(candidate, true)}
      <div class="detail-title"><span class="eyebrow">${esc(officeLabel(office).toUpperCase())}</span><h1>${esc(candidate.name || candidate.fullName)}</h1><p>${esc(candidate.fullName || "")}</p><span class="status ${statusClass(candidate.status)}">${esc(candidate.status || "Situação não informada")}</span></div>
      <div><div class="detail-number">${esc(candidate.number || "—")}</div><div class="detail-actions"><button class="btn ghost" id="printCandidate">Imprimir / PDF</button><a class="btn secondary" target="_blank" rel="noopener" href="${esc(cfg.sources.divulga)}">Abrir fonte ↗</a></div></div>
    </div>
    <div class="detail-grid">
      <div class="info-card"><span>Partido</span><strong>${esc(candidate.party || "Não informado")}${candidate.partyName ? ` — ${esc(candidate.partyName)}` : ""}</strong></div>
      <div class="info-card"><span>Número</span><strong>${esc(candidate.number || "Não informado")}</strong></div>
      <div class="info-card"><span>Situação</span><strong>${esc(candidate.status || "Não informada")}</strong></div>
      <div class="info-card"><span>Coligação</span><strong>${esc(candidate.coalition || "Não informada / não aplicável")}</strong></div>
      <div class="info-card"><span>Federação</span><strong>${esc(candidate.federation || "Não informada / não aplicável")}</strong></div>
      <div class="info-card"><span>Cargo</span><strong>${esc(officeLabel(office))}</strong></div>
    </div>
    <div class="notice">Dados exibidos conforme retorno da fonte consultada. A situação de registro pode mudar por decisões da Justiça Eleitoral.</div>
    <div class="data-meta">${dataMeta(data)}</div>`;
    wireImageFallbacks(root); $("#printCandidate").onclick = () => window.print();
  } catch (error) { root.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
}

async function loadSectionsPage(refresh = false) {
  state.municipality = $("#sectionMunicipality").value || state.municipality;
  $("#sectionsBody").innerHTML = `<tr><td colspan="7">Carregando zonas, seções e locais oficiais…</td></tr>`;
  try {
    const data = await getSections(state.municipality, refresh);
    populateZoneFilter(data.zones); renderSections(data);
  } catch (error) { $("#sectionsBody").innerHTML = `<tr><td colspan="7" class="error">${esc(error.message)}</td></tr>`; }
}

function populateZoneFilter(zones) {
  const el = $("#sectionZone"), current = state.sectionFilters.zone;
  el.innerHTML = `<option value="">Todas</option>` + (zones || []).map(z => `<option value="${z.zona}">Zona ${z.zona}</option>`).join("");
  if ((zones || []).some(z => String(z.zona) === String(current))) el.value = current; else state.sectionFilters.zone = "";
}

function filteredSections(data) {
  const f = state.sectionFilters, q = normalize(f.search);
  return (data.sections || []).filter(x => (!f.zone || String(x.zona) === String(f.zone)) && (!q || normalize(`${x.secao} ${x.bairro} ${x.localNome} ${x.endereco}`).includes(q)));
}

function renderSections(data) {
  $("#sectionsCount").textContent = fmt.format(data.count || 0);
  $("#zonesCount").textContent = fmt.format(data.zoneCount ?? data.zones?.length ?? 0);
  $("#neighborhoodsCount").textContent = fmt.format(data.neighborhoodCount || 0);
  $("#locationsCount").textContent = fmt.format(data.locationCount || 0);
  $("#electorsCount").textContent = fmt.format(data.eleitores || 0);
  $("#sectionsMeta").innerHTML = dataMeta(data);
  $("#zoneCards").innerHTML = (data.zones || []).map(z => `<button class="zone-card ${String(state.sectionFilters.zone) === String(z.zona) ? "active" : ""}" data-zone="${z.zona}"><strong>Zona ${z.zona}</strong><span>${fmt.format(z.secoes)} seções · ${fmt.format(z.bairros || 0)} bairros · ${fmt.format(z.locais || 0)} locais</span></button>`).join("");
  $$(".zone-card", $("#zoneCards")).forEach(btn => btn.onclick = () => { state.sectionFilters.zone = String(btn.dataset.zone); $("#sectionZone").value = state.sectionFilters.zone; state.sectionFilters.page = 1; renderSections(data); });
  const list = filteredSections(data), f = state.sectionFilters, totalPages = Math.max(1, Math.ceil(list.length / f.pageSize)); f.page = Math.min(f.page, totalPages);
  const pageItems = list.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
  $("#sectionsBody").innerHTML = pageItems.length ? pageItems.map(x => `<tr><td>${esc(x.municipio)}</td><td>${esc(x.bairro || "—")}</td><td><b>${esc(x.zona)}</b></td><td>${esc(x.secao)}</td><td>${esc(x.localNome || "—")}</td><td>${fmt.format(x.eleitores || 0)}</td><td>${esc(x.acessibilidade || "—")}</td></tr>`).join("") : `<tr><td colspan="7">Nenhuma seção encontrada com os filtros atuais.</td></tr>`;
  renderPagination($("#sectionPagination"), f.page, totalPages, page => { f.page = page; renderSections(data); });
}

function renderMunicipalities(term = $("#municipalitySearch")?.value || "") {
  const q = normalize(term);
  const list = municipalities.filter(([name, code]) => !q || normalize(`${name} ${code}`).includes(q));
  $("#municipalityGrid").innerHTML = list.map(([name, code]) => {
    const path = `/municipios/${slugify(name)}`;
    return `<a class="municipality-card" href="${path}" data-route="${path}"><b>${esc(name)}</b><span>IBGE ${esc(code)} · abrir ficha eleitoral →</span></a>`;
  }).join("");
}

function municipalityBySlug(slug) { return municipalities.find(([name]) => slugify(name) === slugify(slug)); }

async function loadMunicipalityDetail(slug) {
  const entry = municipalityBySlug(slug);
  if (!entry) { setBreadcrumbs([{ label: "Municípios", path: "/municipios" }, { label: "Não localizado" }]); $("#municipalityDetail").innerHTML = `<div class="error">Município não localizado.</div>`; return; }
  const [name, code] = entry; setBreadcrumbs([{ label: "Municípios", path: "/municipios" }, { label: name }]);
  const root = $("#municipalityDetail"); root.innerHTML = `<div class="loading">Carregando ficha de ${esc(name)}…</div>`;
  try {
    const data = await getSections(name);
    root.innerHTML = `<div class="page-head"><div><span class="eyebrow">MUNICÍPIO • IBGE ${esc(code)}</span><h1>${esc(name)}</h1><p>Ficha territorial baseada no arquivo oficial de locais de votação de 2026.</p></div><div class="toolbar"><button class="btn ghost" id="printMunicipality">Imprimir / PDF</button><button class="btn secondary" id="openMunicipalitySections">Ver zonas e seções</button></div></div>
      <div class="metrics five"><article><span>Seções</span><strong>${fmt.format(data.count || 0)}</strong></article><article><span>Zonas</span><strong>${fmt.format(data.zoneCount || 0)}</strong></article><article><span>Bairros</span><strong>${fmt.format(data.neighborhoodCount || 0)}</strong></article><article><span>Locais</span><strong>${fmt.format(data.locationCount || 0)}</strong></article><article><span>Eleitores agregados</span><strong>${fmt.format(data.eleitores || 0)}</strong></article></div>
      <div class="data-meta">${dataMeta(data)}</div>
      <div class="zone-cards">${(data.zones||[]).map(z => `<div class="zone-card"><strong>Zona ${z.zona}</strong><span>${fmt.format(z.secoes)} seções · ${fmt.format(z.bairros || 0)} bairros · ${fmt.format(z.locais || 0)} locais</span></div>`).join("")}</div>
      <div class="split-grid"><section class="panel"><div class="panel-head"><div><h2>Bairros</h2><p>Prévia por bairro do local de votação.</p></div></div><div class="table-wrap"><table><thead><tr><th>Bairro</th><th>Zonas</th><th>Locais</th><th>Seções</th></tr></thead><tbody>${(data.neighborhoods||[]).slice(0,30).map(x => `<tr><td>${esc(x.bairro)}</td><td>${esc((x.zonas||[]).join(", "))}</td><td>${fmt.format(x.locais||0)}</td><td>${fmt.format(x.secoes||0)}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><div><h2>Locais de votação</h2><p>Primeiros locais publicados para o município.</p></div></div><div class="table-wrap"><table><thead><tr><th>Bairro</th><th>Zona</th><th>Local</th><th>Endereço</th></tr></thead><tbody>${(data.locations||[]).slice(0,30).map(x => `<tr><td>${esc(x.bairro||"—")}</td><td>${esc(x.zona||"—")}</td><td>${esc(x.nome||"—")}</td><td>${esc(x.endereco||"—")}</td></tr>`).join("")}</tbody></table></div></section></div>`;
    $("#printMunicipality").onclick = () => window.print();
    $("#openMunicipalitySections").onclick = () => { state.municipality = name; $("#sectionMunicipality").value = name; state.sectionFilters = { zone: "", search: "", page: 1, pageSize: 50 }; navigate("/zonas"); };
  } catch (error) { root.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
}

async function checkSources(refresh = false) {
  const root = $("#sourceState");
  try {
    state.health = await api("/api/status", { refresh });
    const checks = [state.health.candidates, state.health.electorate].filter(Boolean);
    const okCount = checks.filter(x => x.ok).length;
    const dot = $(".status-dot", root); dot.className = `status-dot ${okCount === checks.length && checks.length ? "good" : okCount ? "warn" : "neutral"}`;
    $("span:last-child", root).textContent = okCount === checks.length && checks.length ? "Fontes acessíveis" : okCount ? "Verificação parcial" : "Verificação temporariamente indisponível";
  } catch {
    const dot = $(".status-dot", root); dot.className = "status-dot neutral"; $("span:last-child", root).textContent = "Verificação temporariamente indisponível";
  }
}

function newId(prefix = "id") { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }

// Base de pessoas: cofre local criptografado no navegador.
const PEOPLE_STORAGE_KEY="civica-ma-pessoas-cofre-v1";
function bytesToB64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
function b64ToBytes(s){const raw=atob(s);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function derivePeopleKey(password,salt){const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:180000,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);}
async function encryptPeople(people,key,salt){const iv=crypto.getRandomValues(new Uint8Array(12)),plain=new TextEncoder().encode(JSON.stringify(people));const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,plain);return {version:1,salt:bytesToB64(salt),iv:bytesToB64(iv),cipher:bytesToB64(new Uint8Array(cipher)),updatedAt:new Date().toISOString()};}
async function decryptPeople(vault,key){const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64ToBytes(vault.iv)},key,b64ToBytes(vault.cipher));const data=JSON.parse(new TextDecoder().decode(plain));return Array.isArray(data)?data:[];}
function getPeopleVault(){try{return JSON.parse(localStorage.getItem(PEOPLE_STORAGE_KEY)||"null");}catch{return null;}}
async function persistPeople(){if(!state.peopleKey)return;const existing=getPeopleVault(),salt=existing?.salt?b64ToBytes(existing.salt):(state.peopleSalt||crypto.getRandomValues(new Uint8Array(16)));state.peopleSalt=salt;const vault=await encryptPeople(state.people,state.peopleKey,salt);localStorage.setItem(PEOPLE_STORAGE_KEY,JSON.stringify(vault));}
function renderPeoplePage(){const vault=getPeopleVault();$("#vaultHint").textContent=vault?"Digite a senha usada para criptografar esta base.":"Defina uma senha com pelo menos 8 caracteres para criar a base privada.";if(state.peopleKey){$("#vaultLocked").hidden=true;$("#peopleWorkspace").hidden=false;renderPeople();}else{$("#vaultLocked").hidden=false;$("#peopleWorkspace").hidden=true;} }
async function unlockPeople(){const password=$("#vaultPassword").value;if(password.length<8)return toast("Use uma senha com pelo menos 8 caracteres.");const vault=getPeopleVault();try{const salt=vault?.salt?b64ToBytes(vault.salt):crypto.getRandomValues(new Uint8Array(16)),key=await derivePeopleKey(password,salt);let people=[];if(vault)people=await decryptPeople(vault,key);state.peopleKey=key;state.peopleSalt=salt;state.people=people;$("#vaultPassword").value="";if(!vault)await persistPeople();renderPeoplePage();toast(vault?"Base privada desbloqueada.":"Base privada criada.");}catch{toast("Senha incorreta ou base corrompida.");}}
function lockPeople(){state.peopleKey=null;state.peopleSalt=null;state.people=[];state.peopleEditingId=null;renderPeoplePage();toast("Base privada bloqueada.");}
function maskCpf(cpf=""){const d=String(cpf).replace(/\D/g,"");if(d.length!==11)return cpf?"•••.•••.•••-••":"—";return `***.${d.slice(3,6)}.${d.slice(6,9)}-**`;}
function cleanPerson(input){return {id:input.id||newId("pessoa"),name:String(input.name||"").trim().slice(0,120),cpf:String(input.cpf||"").replace(/\D/g,"").slice(0,11),birth:String(input.birth||"").trim().slice(0,10),neighborhood:String(input.neighborhood||"").trim().slice(0,100),municipality:String(input.municipality||"").trim().slice(0,100),zone:String(input.zone||"").replace(/\D/g,"").slice(0,8),section:String(input.section||"").replace(/\D/g,"").slice(0,8),leader:String(input.leader||"").trim().slice(0,120),phone:String(input.phone||"").trim().slice(0,24),whatsapp:String(input.whatsapp||"").trim().slice(0,24),email:String(input.email||"").trim().slice(0,160),note:String(input.note||"").trim().slice(0,240),updatedAt:new Date().toISOString()};}
function personFromForm(){return cleanPerson({id:state.peopleEditingId,name:$("#personName").value,cpf:$("#personCpf").value,birth:$("#personBirth").value,neighborhood:$("#personNeighborhood").value,municipality:$("#personMunicipality").value,zone:$("#personZone").value,section:$("#personSection").value,leader:$("#personLeader").value,phone:$("#personPhone").value,whatsapp:$("#personWhatsapp").value,email:$("#personEmail").value,note:$("#personNote").value});}
function clearPersonForm(){state.peopleEditingId=null;["personName","personCpf","personBirth","personNeighborhood","personMunicipality","personZone","personSection","personLeader","personPhone","personWhatsapp","personEmail","personNote"].forEach(id=>$("#"+id).value="");$("#personFormTitle").textContent="Nova pessoa";$("#personCancel").hidden=true;}
async function savePerson(){const person=personFromForm();if(!person.name)return toast("Informe o nome.");const duplicateCpf=person.cpf&&state.people.some(x=>x.cpf===person.cpf&&x.id!==person.id);if(duplicateCpf)return toast("Já existe uma pessoa com este CPF.");const idx=state.people.findIndex(x=>x.id===person.id);if(idx>=0)state.people[idx]=person;else state.people.push(person);await persistPeople();clearPersonForm();renderPeople();toast(idx>=0?"Cadastro atualizado.":"Pessoa cadastrada.");}
function editPerson(id){const x=state.people.find(p=>p.id===id);if(!x)return;state.peopleEditingId=x.id;$("#personFormTitle").textContent="Editar pessoa";$("#personName").value=x.name||"";$("#personCpf").value=x.cpf||"";$("#personBirth").value=x.birth||"";$("#personNeighborhood").value=x.neighborhood||"";$("#personMunicipality").value=x.municipality||"";$("#personZone").value=x.zone||"";$("#personSection").value=x.section||"";$("#personLeader").value=x.leader||"";$("#personPhone").value=x.phone||"";$("#personWhatsapp").value=x.whatsapp||"";$("#personEmail").value=x.email||"";$("#personNote").value=x.note||"";$("#personCancel").hidden=false;window.scrollTo({top:180,behavior:"smooth"});}
async function deletePerson(id){const x=state.people.find(p=>p.id===id);if(!x||!confirm(`Excluir “${x.name}” da base privada?`))return;state.people=state.people.filter(p=>p.id!==id);await persistPeople();renderPeople();}
function renderPeople(){if(!state.peopleKey)return;const q=normalize(state.peopleSearch),list=state.people.filter(x=>!q||normalize(`${x.name} ${x.neighborhood} ${x.municipality} ${x.zone} ${x.section} ${x.leader} ${x.cpf}`).includes(q)).sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));$("#peopleCount").textContent=fmt.format(state.people.length);$("#peopleCpfCount").textContent=fmt.format(state.people.filter(x=>x.cpf).length);$("#peopleZoneCount").textContent=fmt.format(state.people.filter(x=>x.zone&&x.section).length);$("#peopleNeighborhoodCount").textContent=fmt.format(state.people.filter(x=>x.neighborhood).length);$("#peopleExportCsv").disabled=false;$("#peopleBackup").disabled=false;$("#peopleBody").innerHTML=list.length?list.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(maskCpf(x.cpf))}</td><td>${esc(x.birth||"—")}</td><td>${esc(x.neighborhood||"—")}</td><td>${esc(x.municipality||"—")}</td><td>${esc(x.zone||"—")}</td><td>${esc(x.section||"—")}</td><td>${esc(x.leader||"—")}</td><td>${esc(x.whatsapp||x.phone||x.email||"—")}</td><td><div class="row-actions"><button class="mini-btn" data-person-edit="${esc(x.id)}">Editar</button><button class="mini-btn danger" data-person-delete="${esc(x.id)}">Excluir</button></div></td></tr>`).join(""):`<tr><td colspan="10">Nenhuma pessoa cadastrada.</td></tr>`;$$('[data-person-edit]').forEach(b=>b.onclick=()=>editPerson(b.dataset.personEdit));$$('[data-person-delete]').forEach(b=>b.onclick=()=>deletePerson(b.dataset.personDelete));}
function parseDelimited(text){const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim());if(!lines.length)return[];const delimiter=(lines[0].match(/;/g)||[]).length>=(lines[0].match(/,/g)||[]).length?";":",";const rows=lines.map(line=>{const out=[];let cur="",quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){cur+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){out.push(cur);cur="";}else cur+=c;}out.push(cur);return out;});const hdr=rows[0].map(x=>normalize(x).replace(/[^a-z0-9]+/g,""));const pick=(row,...keys)=>{for(const k of keys){const i=hdr.indexOf(k);if(i>=0)return row[i]||"";}return"";};return rows.slice(1).filter(r=>r.some(Boolean)).map(r=>cleanPerson({name:pick(r,"nome"),cpf:pick(r,"cpf"),birth:pick(r,"nascimento","datanascimento"),neighborhood:pick(r,"bairro"),municipality:pick(r,"municipio"),zone:pick(r,"zona"),section:pick(r,"secao"),leader:pick(r,"lideranca","lider"),phone:pick(r,"telefone"),whatsapp:pick(r,"whatsapp"),email:pick(r,"email"),note:pick(r,"observacao","obs")})).filter(x=>x.name);}
function importPeopleCsv(file){const reader=new FileReader();reader.onload=async()=>{try{const rows=parseDelimited(String(reader.result||""));if(!rows.length)return toast("Nenhuma pessoa encontrada no CSV.");const existing=new Set(state.people.map(x=>x.cpf?`cpf:${x.cpf}`:`nome:${normalize(x.name)}|${normalize(x.municipality)}`));let added=0;for(const x of rows){const key=x.cpf?`cpf:${x.cpf}`:`nome:${normalize(x.name)}|${normalize(x.municipality)}`;if(existing.has(key))continue;existing.add(key);state.people.push(x);added++;}await persistPeople();renderPeople();toast(`${added} cadastro(s) importado(s).`);}catch{toast("Não foi possível importar o CSV.");}};reader.readAsText(file,"utf-8");}
function exportPeopleCsv(){exportCsv("base-pessoas-privada.csv",["Nome","CPF","Nascimento","Bairro","Municipio","Zona","Secao","Lideranca","Telefone","WhatsApp","Email","Observacao"],state.people.map(x=>[x.name,x.cpf,x.birth,x.neighborhood,x.municipality,x.zone,x.section,x.leader,x.phone,x.whatsapp,x.email,x.note]));}
function backupPeople(){const raw=localStorage.getItem(PEOPLE_STORAGE_KEY);if(!raw)return toast("Nenhum cofre encontrado.");downloadFile(`base-pessoas-criptografada-${new Date().toISOString().slice(0,10)}.json`,raw,"application/json;charset=utf-8");}
function restorePeopleVault(file){const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(reader.result);if(!data?.salt||!data?.iv||!data?.cipher)throw new Error();if(getPeopleVault()&&!confirm("Substituir a base privada existente pelo backup?"))return;localStorage.setItem(PEOPLE_STORAGE_KEY,JSON.stringify(data));state.peopleKey=null;state.peopleSalt=null;state.people=[];renderPeoplePage();toast("Backup restaurado. Digite a senha para desbloquear.");}catch{toast("Backup inválido.");}};reader.readAsText(file);}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
function exportCsv(filename, headers, rows) { const csv = "\uFEFF" + [headers, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n"); downloadFile(filename, csv, "text/csv;charset=utf-8"); }
function exportXls(filename, headers, rows) {
  const table = `<table><thead><tr>${headers.map(x => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  downloadFile(filename, `\uFEFF<html><head><meta charset="utf-8"></head><body>${table}</body></html>`, "application/vnd.ms-excel;charset=utf-8");
}

async function globalSearch(term) {
  const root = $("#globalSearchResults");
  const q = normalize(term).trim();
  if (q.length < 2) { root.hidden = true; root.innerHTML = ""; return; }
  root.hidden = false; root.innerHTML = `<div class="search-result"><span>Pesquisando…</span></div>`;
  const localMunicipalities = municipalities.filter(([name, code]) => normalize(`${name} ${code}`).includes(q)).slice(0, 7);
  let candidates = [];
  try { candidates = (await api(`/api/busca?q=${encodeURIComponent(term)}`)).results || []; } catch { candidates = []; }
  let html = "";
  if (localMunicipalities.length) {
    html += `<div class="search-group-title">Municípios</div>` + localMunicipalities.map(([name, code]) => { const path = `/municipios/${slugify(name)}`; return `<a class="search-result" href="${path}" data-route="${path}"><b>${esc(name)}</b><span>IBGE ${esc(code)}</span></a>`; }).join("");
  }
  if (candidates.length) {
    html += `<div class="search-group-title">Candidaturas</div>` + candidates.slice(0, 12).map(c => { const path = `/candidatos/${encodeURIComponent(c.office)}/${encodeURIComponent(c.id || c.number)}`; return `<a class="search-result" href="${path}" data-route="${path}"><b>${esc(c.name)}</b><span>${esc(c.officeLabel)} · ${esc(c.party)} ${esc(c.number)}</span></a>`; }).join("");
  }
  root.innerHTML = html || `<div class="search-result"><span>Nenhum resultado encontrado.</span></div>`;
}

function openSidebar() { $("#sidebar").classList.add("open"); $("#sidebarBackdrop").classList.add("show"); $("#menuBtn").setAttribute("aria-expanded", "true"); }
function closeSidebar() { $("#sidebar").classList.remove("open"); $("#sidebarBackdrop").classList.remove("show"); $("#menuBtn").setAttribute("aria-expanded", "false"); }

function bindEvents() {
  document.addEventListener("click", event => {
    const link = event.target.closest("[data-route]");
    if (link && link.origin === location.origin) { event.preventDefault(); navigate(link.getAttribute("data-route") || link.pathname); $("#globalSearchResults").hidden = true; }
    if (!event.target.closest(".global-search-wrap")) $("#globalSearchResults").hidden = true;
  });
  window.addEventListener("popstate", route);
  $("#menuBtn").onclick = () => $("#sidebar").classList.contains("open") ? closeSidebar() : openSidebar();
  $("#sidebarBackdrop").onclick = closeSidebar;
  $("#candidateOffice").onchange = async e => {
    state.office = e.target.value;
    if ($("#overviewOffice")) $("#overviewOffice").value = state.office;
    state.candidateFilters = { party: "", status: "", search: "", sort: "name", page: 1, pageSize: 24 };
    $("#candidateSearch").value = "";
    await loadCandidatePage();
  };
  $("#candidateParty").onchange = e => { state.candidateFilters.party = e.target.value; state.candidateFilters.page = 1; renderCandidateCatalog(); };
  $("#candidateStatus").onchange = e => { state.candidateFilters.status = e.target.value; state.candidateFilters.page = 1; renderCandidateCatalog(); };
  $("#candidateSearch").oninput = e => { state.candidateFilters.search = e.target.value; state.candidateFilters.page = 1; renderCandidateCatalog(); };
  $("#candidateSort").onchange = e => { state.candidateFilters.sort = e.target.value; state.candidateFilters.page = 1; renderCandidateCatalog(); };
  $("#sectionMunicipality").onchange = e => { state.municipality = e.target.value; state.sectionFilters = { zone: "", search: "", page: 1, pageSize: 50 }; loadSectionsPage(); };
  $("#sectionZone").onchange = e => { state.sectionFilters.zone = e.target.value; state.sectionFilters.page = 1; const data = state.sectionData.get(state.municipality); if (data) renderSections(data); };
  $("#sectionSearch").oninput = e => { state.sectionFilters.search = e.target.value; state.sectionFilters.page = 1; const data = state.sectionData.get(state.municipality); if (data) renderSections(data); };
  $("#municipalitySearch").oninput = e => renderMunicipalities(e.target.value);
  $("#refreshAll").onclick = async () => { state.summary = null; state.candidateData.clear(); state.sectionData.clear(); await loadOverview(true); toast("Painel atualizado."); };
  $("#exportCandidatesCsv").onclick = () => { const list = filteredCandidates(); exportCsv(`candidaturas-${state.office}-ma-2026.csv`, ["Nome de urna","Nome completo","Número","Partido","Partido - nome","Situação","Coligação","Federação"], list.map(c => [c.name,c.fullName,c.number,c.party,c.partyName,c.status,c.coalition,c.federation])); };
  $("#exportCandidatesXls").onclick = () => { const list = filteredCandidates(); exportXls(`candidaturas-${state.office}-ma-2026.xls`, ["Nome de urna","Nome completo","Número","Partido","Situação"], list.map(c => [c.name,c.fullName,c.number,c.party,c.status])); };
  $("#exportSectionsCsv").onclick = () => { const data=state.sectionData.get(state.municipality);if(!data)return;const list=filteredSections(data);exportCsv(`secoes-${slugify(state.municipality)}-2026.csv`,["Município","Bairro do local","Zona","Seção","Local de votação","Endereço","CEP","Eleitores","Acessibilidade"],list.map(x=>[x.municipio,x.bairro,x.zona,x.secao,x.localNome,x.endereco,x.cep,x.eleitores,x.acessibilidade])); };
  $("#exportSectionsXls").onclick = () => { const data=state.sectionData.get(state.municipality);if(!data)return;const list=filteredSections(data);exportXls(`secoes-${slugify(state.municipality)}-2026.xls`,["Município","Bairro do local","Zona","Seção","Local de votação","Eleitores"],list.map(x=>[x.municipio,x.bairro,x.zona,x.secao,x.localNome,x.eleitores])); };

  $("#vaultUnlock").onclick=unlockPeople;$("#vaultPassword").onkeydown=e=>{if(e.key==="Enter")unlockPeople();};$("#vaultLock").onclick=lockPeople;$("#personSave").onclick=savePerson;$("#personCancel").onclick=clearPersonForm;$("#peopleSearch").oninput=e=>{state.peopleSearch=e.target.value;renderPeople();};$("#peopleImportCsv").onchange=e=>{const f=e.target.files?.[0];if(f)importPeopleCsv(f);e.target.value="";};$("#peopleExportCsv").onclick=exportPeopleCsv;$("#peopleBackup").onclick=backupPeople;$("#peopleRestoreFile").onchange=e=>{const f=e.target.files?.[0];if(f)restorePeopleVault(f);e.target.value="";};

  $("#globalSearch").oninput = e => { clearTimeout(state.globalSearchTimer);state.globalSearchTimer=setTimeout(()=>globalSearch(e.target.value),320); };
  $("#globalSearch").onfocus = e => { if(e.target.value.trim().length>=2)globalSearch(e.target.value); };
}

function startClock() {
  const update = () => { const el = $("#clock"); if (el) el.textContent = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" }); };
  update(); setInterval(update, 1000);
}

async function init() {
  fillOfficeSelects(); fillMunicipalitySelect(); bindEvents(); startClock();
  checkSources(); route();
}

init();
