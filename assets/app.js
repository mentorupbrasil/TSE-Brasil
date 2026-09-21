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
  partyOffice: cfg.defaultOffice || "6",
  partySearch: "",
  globalSearchTimer: null,
  simulation: null,
  simulationRecordSearch: "",
  neighborhoodSearch: "",
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
  const navMap = { "candidate-detail": "candidates", "party-detail": "parties", "municipality-detail": "municipalities" };
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
  if (parts[0] === "partidos" && parts.length >= 3) return { page: "party-detail", office: parts[1], party: parts.slice(2).join("/") };
  if (parts[0] === "partidos") return { page: "parties" };
  if (parts[0] === "zonas") return { page: "sections" };
  if (parts[0] === "bairros") return { page: "neighborhoods" };
  if (parts[0] === "municipios" && parts[1]) return { page: "municipality-detail", slug: parts.slice(1).join("/") };
  if (parts[0] === "municipios") return { page: "municipalities" };
  if (parts[0] === "base") return { page: "people" };
  if (parts[0] === "lancamentos" || parts[0] === "simulacao") return { page: "launches", legacy: parts[0] === "simulacao" };
  if (parts[0] === "fontes") return { page: "sources" };
  return { page: "overview", notFound: true };
}

async function route() {
  const routeInfo = parseRoute();
  if (routeInfo.legacy) history.replaceState({}, "", "/lancamentos");
  setPage(routeInfo.page);
  window.scrollTo({ top: 0, behavior: "auto" });
  try {
    if (routeInfo.page === "overview") { setBreadcrumbs([]); await loadOverview(); }
    if (routeInfo.page === "candidates") { setBreadcrumbs([{ label: "Candidaturas" }]); await loadCandidatePage(); }
    if (routeInfo.page === "candidate-detail") await loadCandidateDetail(routeInfo.office, routeInfo.id);
    if (routeInfo.page === "parties") { setBreadcrumbs([{ label: "Partidos" }]); await loadPartiesPage(); }
    if (routeInfo.page === "party-detail") await loadPartyDetail(routeInfo.office, routeInfo.party);
    if (routeInfo.page === "sections") { setBreadcrumbs([{ label: "Zonas e seções" }]); await loadSectionsPage(); }
    if (routeInfo.page === "neighborhoods") { setBreadcrumbs([{ label: "Bairros e locais" }]); await loadNeighborhoodsPage(); }
    if (routeInfo.page === "municipalities") { setBreadcrumbs([{ label: "Municípios" }]); renderMunicipalities(); }
    if (routeInfo.page === "municipality-detail") await loadMunicipalityDetail(routeInfo.slug);
    if (routeInfo.page === "people") { setBreadcrumbs([{ label: "Base de pessoas" }]); renderPeoplePage(); }
    if (routeInfo.page === "launches") { setBreadcrumbs([{ label: "Lançamentos" }]); await loadLaunchesPage(); }
    if (routeInfo.page === "sources") { setBreadcrumbs([{ label: "Fontes e metodologia" }]); await loadSourceHealthCards(); }
  } catch (error) {
    toast(error.message || "Não foi possível carregar esta área.");
  }
}

function fillOfficeSelects() {
  ["overviewOffice", "overviewPartyOffice", "candidateOffice", "partyOffice", "simOffice"].forEach(id => {
    const el = $("#" + id); if (!el) return;
    el.innerHTML = Object.entries(offices).map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join("");
  });
  if ($("#overviewOffice")) $("#overviewOffice").value = state.office;
  if ($("#overviewPartyOffice")) $("#overviewPartyOffice").value = state.office;
  if ($("#candidateOffice")) $("#candidateOffice").value = state.office;
  if ($("#partyOffice")) $("#partyOffice").value = state.partyOffice;
  if ($("#simOffice")) $("#simOffice").value = state.office;
}

function fillMunicipalitySelect() {
  const html = municipalities.map(([name, code]) => `<option value="${esc(name)}">${esc(name)} — IBGE ${esc(code)}</option>`).join("");
  ["sectionMunicipality", "neighborhoodMunicipality", "simMunicipality"].forEach(id => {
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
  const officeChart = $("#officeChart"), partyChart = $("#partyChart");
  if (!state.summary || refresh) {
    officeChart.innerHTML = ""; partyChart.innerHTML = "";
    try { state.summary = await api("/api/resumo", { refresh }); }
    catch (error) { officeChart.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
  }
  if (state.summary) {
    $("#metricCandidates").textContent = formatMaybe(state.summary.totalCandidates);
    const sections = state.summary.sections || {};
    $("#metricSections").textContent = sections.deferred ? "sob demanda" : formatMaybe(sections.count);
    $("#metricZones").textContent = sections.deferred ? "sob demanda" : formatMaybe(sections.zones);
    $("#metricElectors").textContent = sections.deferred ? "sob demanda" : formatMaybe(sections.electors);
    $("#metricSourceNote").textContent = sections.deferred ? "território consultado por município" : sections.stale ? "último dado em cache" : "consulta às fontes públicas";
    renderBarChart(officeChart, state.summary.offices.map(x => ({ label: shortOffices[x.office] || x.label, count: x.count })), "label", "count", 10);
  }
  await Promise.all([loadOverviewCandidates(state.office, refresh), loadOverviewPartyChart($("#overviewPartyOffice").value || state.office, refresh)]);
}

async function loadOverviewCandidates(office = state.office, refresh = false) {
  const root = $("#overviewCandidates"); root.innerHTML = `<div class="loading">Carregando candidaturas…</div>`;
  try {
    const data = await getCandidates(office, refresh);
    root.innerHTML = data.candidates.length ? data.candidates.slice(0, 8).map(c => candidateCard(c, office)).join("") : `<div class="empty">Nenhuma candidatura retornada.</div>`;
    wireImageFallbacks(root);
  } catch (error) { root.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
}

async function loadOverviewPartyChart(office = state.office, refresh = false) {
  const root = $("#partyChart"); root.innerHTML = "";
  try {
    const data = await getCandidates(office, refresh);
    const counts = aggregateParties(data.candidates);
    $("#partyChartLabel").textContent = officeLabel(office);
    renderBarChart(root, counts.map(x => ({ label: x.party, count: x.count })), "label", "count", 12);
  } catch (error) { root.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
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

async function loadPartiesPage(refresh = false) {
  state.partyOffice = $("#partyOffice").value || state.partyOffice;
  const root = $("#partyGrid"); root.innerHTML = `<div class="loading">Carregando partidos…</div>`;
  try {
    const data = await getCandidates(state.partyOffice, refresh);
    renderPartyGrid(aggregateParties(data.candidates));
  } catch (error) { root.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
}

function renderPartyGrid(parties) {
  const q = normalize(state.partySearch);
  const list = parties.filter(p => !q || normalize(`${p.party} ${p.partyName}`).includes(q));
  $("#partyGrid").innerHTML = list.length ? list.map(p => {
    const path = `/partidos/${encodeURIComponent(state.partyOffice)}/${encodeURIComponent(p.party)}`;
    return `<a class="party-card" href="${path}" data-route="${path}"><div class="sigla">${esc(p.party)}</div><p>${esc(p.partyName || "Nome não informado")}</p><div class="party-count">${fmt.format(p.count)} candidatura${p.count === 1 ? "" : "s"}</div></a>`;
  }).join("") : `<div class="empty">Nenhum partido encontrado.</div>`;
}

async function loadPartyDetail(office, party) {
  setBreadcrumbs([{ label: "Partidos", path: "/partidos" }, { label: party }]);
  const root = $("#partyDetail"); root.innerHTML = `<div class="loading">Carregando partido…</div>`;
  try {
    const data = await getCandidates(office); const list = data.candidates.filter(c => normalize(c.party) === normalize(party));
    if (!list.length) { root.innerHTML = `<div class="error">Nenhuma candidatura encontrada para esta sigla e cargo.</div>`; return; }
    const partyName = list.find(c => c.partyName)?.partyName || "";
    root.innerHTML = `<div class="page-head"><div><span class="eyebrow">${esc(officeLabel(office).toUpperCase())}</span><h1>${esc(party)}</h1><p>${esc(partyName)} · ${fmt.format(list.length)} candidatura${list.length === 1 ? "" : "s"}</p></div></div><div class="data-meta">${dataMeta(data)}</div><div class="candidate-grid party-candidates">${list.map(c => candidateCard(c, office)).join("")}</div>`;
    wireImageFallbacks(root);
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

async function loadNeighborhoodsPage(refresh = false) {
  const select = $("#neighborhoodMunicipality"); state.municipality = select?.value || state.municipality;
  $("#neighborhoodBody").innerHTML = `<tr><td colspan="5">Carregando bairros…</td></tr>`;
  $("#locationsBody").innerHTML = `<tr><td colspan="7">Carregando locais…</td></tr>`;
  try { const data = await getSections(state.municipality, refresh); renderNeighborhoods(data); }
  catch (error) { const row = `<tr><td colspan="7" class="error">${esc(error.message)}</td></tr>`; $("#locationsBody").innerHTML=row; $("#neighborhoodBody").innerHTML=`<tr><td colspan="5" class="error">${esc(error.message)}</td></tr>`; }
}

function renderNeighborhoods(data) {
  const q = normalize(state.neighborhoodSearch);
  const neighborhoods = (data.neighborhoods || []).filter(x => !q || normalize(`${x.bairro} ${(x.zonas||[]).join(" ")}`).includes(q));
  const locations = (data.locations || []).filter(x => !q || normalize(`${x.bairro} ${x.nome} ${x.endereco} ${x.cep} ${x.zona}`).includes(q));
  $("#bairroMetric").textContent = fmt.format(data.neighborhoodCount || 0);
  $("#localMetric").textContent = fmt.format(data.locationCount || 0);
  $("#bairroSectionMetric").textContent = fmt.format(data.count || 0);
  $("#bairroElectorMetric").textContent = fmt.format(data.eleitores || 0);
  $("#neighborhoodMeta").innerHTML = dataMeta(data);
  $("#neighborhoodBody").innerHTML = neighborhoods.length ? neighborhoods.map(x => `<tr><td><b>${esc(x.bairro)}</b></td><td>${esc((x.zonas||[]).join(", ") || "—")}</td><td>${fmt.format(x.locais || 0)}</td><td>${fmt.format(x.secoes || 0)}</td><td>${fmt.format(x.eleitores || 0)}</td></tr>`).join("") : `<tr><td colspan="5">Nenhum bairro encontrado.</td></tr>`;
  $("#locationsBody").innerHTML = locations.length ? locations.map(x => `<tr><td>${esc(x.bairro || "—")}</td><td>${esc(x.zona || "—")}</td><td><b>${esc(x.nome || "—")}</b></td><td>${esc(x.endereco || "—")}</td><td>${esc(x.cep || "—")}</td><td>${esc((x.secoes||[]).join(", ") || "—")}</td><td>${fmt.format(x.eleitores || 0)}</td></tr>`).join("") : `<tr><td colspan="7">Nenhum local encontrado.</td></tr>`;
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
    root.innerHTML = `<div class="page-head"><div><span class="eyebrow">MUNICÍPIO • IBGE ${esc(code)}</span><h1>${esc(name)}</h1><p>Ficha territorial baseada no arquivo oficial de locais de votação de 2026.</p></div><div class="toolbar"><button class="btn ghost" id="printMunicipality">Imprimir / PDF</button><button class="btn secondary" id="openMunicipalitySections">Ver zonas e seções</button><button class="btn secondary" id="openMunicipalityNeighborhoods">Ver bairros e locais</button></div></div>
      <div class="metrics five"><article><span>Seções</span><strong>${fmt.format(data.count || 0)}</strong></article><article><span>Zonas</span><strong>${fmt.format(data.zoneCount || 0)}</strong></article><article><span>Bairros</span><strong>${fmt.format(data.neighborhoodCount || 0)}</strong></article><article><span>Locais</span><strong>${fmt.format(data.locationCount || 0)}</strong></article><article><span>Eleitores agregados</span><strong>${fmt.format(data.eleitores || 0)}</strong></article></div>
      <div class="data-meta">${dataMeta(data)}</div>
      <div class="zone-cards">${(data.zones||[]).map(z => `<div class="zone-card"><strong>Zona ${z.zona}</strong><span>${fmt.format(z.secoes)} seções · ${fmt.format(z.bairros || 0)} bairros · ${fmt.format(z.locais || 0)} locais</span></div>`).join("")}</div>
      <div class="split-grid"><section class="panel"><div class="panel-head"><div><h2>Bairros</h2><p>Prévia por bairro do local de votação.</p></div></div><div class="table-wrap"><table><thead><tr><th>Bairro</th><th>Zonas</th><th>Locais</th><th>Seções</th></tr></thead><tbody>${(data.neighborhoods||[]).slice(0,30).map(x => `<tr><td>${esc(x.bairro)}</td><td>${esc((x.zonas||[]).join(", "))}</td><td>${fmt.format(x.locais||0)}</td><td>${fmt.format(x.secoes||0)}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><div><h2>Locais de votação</h2><p>Primeiros locais publicados para o município.</p></div></div><div class="table-wrap"><table><thead><tr><th>Bairro</th><th>Zona</th><th>Local</th><th>Endereço</th></tr></thead><tbody>${(data.locations||[]).slice(0,30).map(x => `<tr><td>${esc(x.bairro||"—")}</td><td>${esc(x.zona||"—")}</td><td>${esc(x.nome||"—")}</td><td>${esc(x.endereco||"—")}</td></tr>`).join("")}</tbody></table></div></section></div>`;
    $("#printMunicipality").onclick = () => window.print();
    $("#openMunicipalitySections").onclick = () => { state.municipality = name; $("#sectionMunicipality").value = name; state.sectionFilters = { zone: "", search: "", page: 1, pageSize: 50 }; navigate("/zonas"); };
    $("#openMunicipalityNeighborhoods").onclick = () => { state.municipality = name; $("#neighborhoodMunicipality").value = name; navigate("/bairros"); };
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

async function loadSourceHealthCards() {
  if (!state.health) await checkSources();
  const h = state.health || {};
  const card = (title, data) => `<div class="health-card"><div><b>${esc(title)}</b><span>Verificado em ${esc(formatDate(h.checkedAt))}</span>${data?.transport ? `<span>${esc(data.transport)}</span>` : ""}${data?.error ? `<span>${esc(data.error)}</span>` : ""}</div><span class="health-state ${data?.ok ? "good" : "neutral"}">${data?.ok ? "ACESSÍVEL" : "VERIFICAÇÃO INDISPONÍVEL"}</span></div>`;
  $("#sourceHealthCards").innerHTML = card("Candidaturas — TSE", h.candidates) + card("Locais de votação — TSE", h.electorate);
}

const LAUNCH_STORAGE_KEY = "civica-ma-lancamentos-v1";
const LEGACY_LAUNCH_STORAGE_KEY = "civica-ma-simulacao-v1";

function newId(prefix = "id") { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
function emptyLaunchStore() {
  const id = newId("controle");
  return { version: 2, activeId: id, scenarios: [{ id, name: "Controle 1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), entries: [] }] };
}
function loadSimulationStore() {
  if (state.simulation) return state.simulation;
  try {
    const current = localStorage.getItem(LAUNCH_STORAGE_KEY);
    const legacy = localStorage.getItem(LEGACY_LAUNCH_STORAGE_KEY);
    const parsed = JSON.parse(current || legacy || "null");
    if (parsed && Array.isArray(parsed.scenarios) && parsed.scenarios.length) state.simulation = parsed;
  } catch {}
  if (!state.simulation) state.simulation = emptyLaunchStore();
  if (!state.simulation.scenarios.some(x => x.id === state.simulation.activeId)) state.simulation.activeId = state.simulation.scenarios[0].id;
  saveSimulationStore();
  return state.simulation;
}
function saveSimulationStore() { try { localStorage.setItem(LAUNCH_STORAGE_KEY, JSON.stringify(state.simulation || emptyLaunchStore())); } catch {} }
function activeScenario() { const store = loadSimulationStore(); return store.scenarios.find(x => x.id === store.activeId) || store.scenarios[0]; }
function renderScenarioSelect() { const store=loadSimulationStore(),el=$("#simScenario"); if(!el)return; el.innerHTML=store.scenarios.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join(""); el.value=store.activeId; }
function createScenario(name) { const store=loadSimulationStore(),clean=String(name||"").trim();if(!clean)return; const x={id:newId("controle"),name:clean.slice(0,60),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),entries:[]};store.scenarios.push(x);store.activeId=x.id;saveSimulationStore();renderScenarioSelect();renderSimulation(); }
function simulationEntriesForOffice() { const office=$("#simOffice")?.value||state.office; return (activeScenario()?.entries||[]).filter(x=>String(x.office)===String(office)); }
function simulationVoteTypes(office) { const proportional=["6","7"].includes(String(office)); return [{value:"candidate",label:"Lançamento nominal em candidatura"},...(proportional?[{value:"legend",label:"Lançamento de legenda"}]:[]),{value:"blank",label:"Branco"},{value:"null",label:"Nulo"}]; }

async function populateSimulationCandidates() {
  const office=$("#simOffice").value||state.office,candidateEl=$("#simCandidate"),partyEl=$("#simParty");
  candidateEl.innerHTML=`<option value="">Carregando…</option>`;partyEl.innerHTML=`<option value="">Carregando…</option>`;
  try { const data=await getCandidates(office); const candidates=[...(data.candidates||[])].sort((a,b)=>String(a.name).localeCompare(String(b.name),"pt-BR")); candidateEl.innerHTML=`<option value="">Selecione</option>`+candidates.map(c=>`<option value="${esc(c.id||c.number)}">${esc(c.name)} — ${esc(c.party)} ${esc(c.number)}</option>`).join(""); const parties=new Map();for(const c of candidates)if(c.party)parties.set(c.party,c.partyName||"");partyEl.innerHTML=`<option value="">Selecione</option>`+[...parties.entries()].sort((a,b)=>a[0].localeCompare(b[0],"pt-BR")).map(([sigla,name])=>`<option value="${esc(sigla)}" data-name="${esc(name)}">${esc(sigla)}${name?` — ${esc(name)}`:""}</option>`).join(""); }
  catch { candidateEl.innerHTML=`<option value="">Candidaturas indisponíveis</option>`;partyEl.innerHTML=`<option value="">Partidos indisponíveis</option>`; }
  updateSimulationVoteMode();
}

async function populateLaunchGeography() {
  const municipality=$("#simMunicipality").value||state.municipality, neighborhoodEl=$("#simNeighborhood"), zoneEl=$("#simZone"), sectionEl=$("#simSection");
  neighborhoodEl.innerHTML=`<option value="">Não especificado</option>`;zoneEl.innerHTML=`<option value="">Não especificada</option>`;sectionEl.innerHTML=`<option value="">Não especificada</option>`;
  try { const data=await getSections(municipality); neighborhoodEl.innerHTML += (data.neighborhoods||[]).map(x=>`<option value="${esc(x.bairro)}">${esc(x.bairro)}</option>`).join(""); zoneEl.innerHTML += (data.zones||[]).map(x=>`<option value="${esc(x.zona)}">Zona ${esc(x.zona)}</option>`).join(""); }
  catch {}
}
function populateLaunchSections() {
  const municipality=$("#simMunicipality").value||state.municipality, zone=$("#simZone").value, neighborhood=$("#simNeighborhood").value, el=$("#simSection"); el.innerHTML=`<option value="">Não especificada</option>`;
  const data=state.sectionData.get(municipality); if(!data)return;
  const sections=(data.sections||[]).filter(x=>(!zone||String(x.zona)===String(zone))&&(!neighborhood||String(x.bairro)===String(neighborhood))).sort((a,b)=>Number(a.zona)-Number(b.zona)||Number(a.secao)-Number(b.secao));
  el.innerHTML += sections.map(x=>`<option value="${esc(x.secao)}" data-zone="${esc(x.zona)}">Zona ${esc(x.zona)} · Seção ${esc(x.secao)}${x.localNome?` · ${esc(x.localNome)}`:""}</option>`).join("");
}
function updateSimulationVoteMode() {
  const office=$("#simOffice").value||state.office,typeEl=$("#simVoteType"),current=typeEl.value; typeEl.innerHTML=simulationVoteTypes(office).map(x=>`<option value="${x.value}">${x.label}</option>`).join("");if([...typeEl.options].some(o=>o.value===current))typeEl.value=current;
  const type=typeEl.value;$("#simCandidateWrap").hidden=type!=="candidate";$("#simPartyWrap").hidden=type!=="legend";const help=$("#simVoteHelp");
  if(type==="legend")help.textContent="Lançamento de legenda disponível apenas para cargos proporcionais."; else if(type==="candidate")help.textContent="Selecione uma candidatura. Cada registro acrescenta uma unidade ao controle."; else help.textContent="Brancos e nulos ficam registrados separadamente.";
}
async function loadLaunchesPage() { loadSimulationStore();renderScenarioSelect();if($("#simOffice"))$("#simOffice").value=state.office;if($("#simMunicipality"))$("#simMunicipality").value=state.municipality;await Promise.all([populateSimulationCandidates(),populateLaunchGeography()]);populateLaunchSections();updateSimulationVoteMode();renderSimulation(); }

function addSimulationEntry() {
  const scenario=activeScenario();if(!scenario)return;const office=$("#simOffice").value,municipality=$("#simMunicipality").value,neighborhood=$("#simNeighborhood").value,zone=$("#simZone").value,section=$("#simSection").value,type=$("#simVoteType").value;if(!municipality)return toast("Selecione o município.");
  let candidateId="",candidateName="",candidateNumber="",party="",partyName="";const data=state.candidateData.get(String(office));
  if(type==="candidate"){const id=$("#simCandidate").value,c=data?.candidates?.find(x=>String(x.id||x.number)===String(id));if(!c)return toast("Selecione uma candidatura.");candidateId=String(c.id||c.number);candidateName=c.name||c.fullName||"";candidateNumber=c.number||"";party=c.party||"";partyName=c.partyName||"";}
  if(type==="legend"){party=$("#simParty").value;if(!party)return toast("Selecione o partido.");partyName=$("#simParty").selectedOptions[0]?.dataset?.name||"";}
  const entry={id:newId("lanc"),at:new Date().toISOString(),office,officeLabel:officeLabel(office),municipality,neighborhood:neighborhood||"",zone:zone||"",section:section||"",type,candidateId,candidateName,candidateNumber,party,partyName,quantity:1,note:$("#simNote").value.trim().slice(0,120)};scenario.entries.push(entry);scenario.updatedAt=new Date().toISOString();saveSimulationStore();$("#simNote").value="";renderSimulation();toast("1 lançamento registrado.");
}
function entryWeight(e){const n=Number(e?.quantity);return Number.isFinite(n)&&n>0?Math.floor(n):1;}
function aggregateSimulation(entries) {
  const municipalitiesMap=new Map(),neighborhoodsMap=new Map(),candidatesMap=new Map(),partiesMap=new Map(),zonesMap=new Map();
  for(const e of entries){const w=entryWeight(e),m=municipalitiesMap.get(e.municipality)||{municipality:e.municipality,total:0,candidates:new Set(),parties:new Set()};m.total+=w;if(e.candidateId)m.candidates.add(e.candidateId);if(e.party)m.parties.add(e.party);municipalitiesMap.set(e.municipality,m);
    if(e.neighborhood){const key=`${e.municipality}|${e.neighborhood}`,b=neighborhoodsMap.get(key)||{municipality:e.municipality,neighborhood:e.neighborhood,total:0,zones:new Set()};b.total+=w;if(e.zone)b.zones.add(e.zone);neighborhoodsMap.set(key,b);}
    if(e.type==="candidate"){const key=e.candidateId||`${e.candidateName}|${e.candidateNumber}`,c=candidatesMap.get(key)||{name:e.candidateName,number:e.candidateNumber,party:e.party,total:0,municipalities:new Set()};c.total+=w;c.municipalities.add(e.municipality);candidatesMap.set(key,c);}
    if(e.party){const p=partiesMap.get(e.party)||{party:e.party,name:e.partyName||"",nominal:0,legend:0};if(e.type==="candidate")p.nominal+=w;if(e.type==="legend")p.legend+=w;partiesMap.set(e.party,p);}
    if(e.zone){const key=`${e.municipality}|${e.zone}`,z=zonesMap.get(key)||{municipality:e.municipality,zone:e.zone,total:0,sections:new Set()};z.total+=w;if(e.section)z.sections.add(e.section);zonesMap.set(key,z);}}
  return {municipalities:[...municipalitiesMap.values()].sort((a,b)=>a.municipality.localeCompare(b.municipality,"pt-BR")),neighborhoods:[...neighborhoodsMap.values()].sort((a,b)=>a.municipality.localeCompare(b.municipality,"pt-BR")||a.neighborhood.localeCompare(b.neighborhood,"pt-BR")),candidates:[...candidatesMap.values()].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")),parties:[...partiesMap.values()].sort((a,b)=>a.party.localeCompare(b.party,"pt-BR")),zones:[...zonesMap.values()].sort((a,b)=>a.municipality.localeCompare(b.municipality,"pt-BR")||Number(a.zone)-Number(b.zone))};
}
function simEmptyRow(cols,text="Nenhum lançamento neste recorte."){return `<tr><td colspan="${cols}" class="sim-empty-cell">${esc(text)}</td></tr>`;}
function renderSimulation(){if(!$("#simLaunchesBody"))return;renderScenarioSelect();const entries=simulationEntriesForOffice(),agg=aggregateSimulation(entries),sum=type=>entries.filter(e=>!type||e.type===type).reduce((a,e)=>a+entryWeight(e),0);$("#simMetricTotal").textContent=fmt.format(sum());$("#simMetricNominal").textContent=fmt.format(sum("candidate"));$("#simMetricLegend").textContent=fmt.format(sum("legend"));$("#simMetricMunicipalities").textContent=fmt.format(agg.municipalities.length);$("#simMetricCandidates").textContent=fmt.format(agg.candidates.length);$("#simMetricParties").textContent=fmt.format(agg.parties.length);
  $("#simByMunicipality").innerHTML=agg.municipalities.length?agg.municipalities.map(x=>`<tr><td>${esc(x.municipality)}</td><td>${fmt.format(x.total)}</td><td>${fmt.format(x.candidates.size)}</td><td>${fmt.format(x.parties.size)}</td></tr>`).join(""):simEmptyRow(4);
  $("#simByNeighborhood").innerHTML=agg.neighborhoods.length?agg.neighborhoods.map(x=>`<tr><td>${esc(x.municipality)}</td><td>${esc(x.neighborhood)}</td><td>${fmt.format(x.total)}</td><td>${fmt.format(x.zones.size)}</td></tr>`).join(""):simEmptyRow(4,"Nenhum lançamento com bairro informado.");
  $("#simByCandidate").innerHTML=agg.candidates.length?agg.candidates.map(x=>`<tr><td><b>${esc(x.name)}</b>${x.number?` <span class="sim-sub">${esc(x.number)}</span>`:""}</td><td>${esc(x.party||"—")}</td><td>${fmt.format(x.total)}</td><td>${fmt.format(x.municipalities.size)}</td></tr>`).join(""):simEmptyRow(4);
  $("#simByParty").innerHTML=agg.parties.length?agg.parties.map(x=>`<tr><td><b>${esc(x.party)}</b>${x.name?` <span class="sim-sub">${esc(x.name)}</span>`:""}</td><td>${fmt.format(x.nominal)}</td><td>${fmt.format(x.legend)}</td><td>${fmt.format(x.nominal+x.legend)}</td></tr>`).join(""):simEmptyRow(4);
  $("#simByZone").innerHTML=agg.zones.length?agg.zones.map(x=>`<tr><td>${esc(x.municipality)}</td><td>${esc(x.zone)}</td><td>${fmt.format(x.total)}</td><td>${fmt.format(x.sections.size)}</td></tr>`).join(""):simEmptyRow(4,"Nenhum lançamento com zona informada.");
  const q=normalize(state.simulationRecordSearch),visible=entries.filter(e=>!q||normalize(`${e.municipality} ${e.neighborhood} ${e.zone} ${e.section} ${e.candidateName} ${e.candidateNumber} ${e.party} ${e.note}`).includes(q)).slice().sort((a,b)=>String(b.at).localeCompare(String(a.at)));$("#simLaunchesBody").innerHTML=visible.length?visible.map(e=>{const typeLabel=e.type==="candidate"?"Nominal":e.type==="legend"?"Legenda":e.type==="blank"?"Branco":"Nulo",target=e.type==="candidate"?`${e.candidateName}${e.candidateNumber?` (${e.candidateNumber})`:""}`:e.type==="legend"?e.party:typeLabel;return `<tr><td>${esc(formatDate(e.at))}</td><td>${esc(e.municipality)}</td><td>${esc(e.neighborhood||"—")}</td><td>${esc(e.zone||"—")}</td><td>${esc(e.section||"—")}</td><td>${esc(typeLabel)}</td><td title="${esc(e.note||"")}">${esc(target)}</td><td>${esc(e.party||"—")}</td><td><button class="sim-delete" type="button" data-sim-delete="${esc(e.id)}" aria-label="Excluir lançamento">×</button></td></tr>`;}).join(""):simEmptyRow(9);$$('[data-sim-delete]').forEach(btn=>btn.onclick=()=>{const scenario=activeScenario();scenario.entries=scenario.entries.filter(e=>e.id!==btn.dataset.simDelete);scenario.updatedAt=new Date().toISOString();saveSimulationStore();renderSimulation();});}
function exportSimulationCsv(){const scenario=activeScenario(),entries=scenario?.entries||[];exportCsv(`lancamentos-${slugify(scenario?.name||"controle")}.csv`,["Data/hora","Cargo","Município","Bairro","Zona","Seção","Tipo","Candidatura","Número","Partido","Observação"],entries.map(e=>[e.at,e.officeLabel||officeLabel(e.office),e.municipality,e.neighborhood||"",e.zone,e.section,e.type,e.candidateName,e.candidateNumber,e.party,e.note]));}
function exportSimulationJson(){const scenario=activeScenario();downloadFile(`lancamentos-${slugify(scenario?.name||"controle")}.json`,JSON.stringify({app:"Cívica MA",kind:"manual-launches",exportedAt:new Date().toISOString(),scenario},null,2),"application/json;charset=utf-8");}
function importSimulationJson(file){const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(reader.result),scenario=data?.scenario||data;if(!scenario||!Array.isArray(scenario.entries))throw new Error("Arquivo inválido");const imported={id:newId("controle"),name:`${String(scenario.name||"Controle importado").slice(0,50)} (importado)`,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),entries:scenario.entries.filter(e=>e&&e.municipality).map(e=>({...e,id:newId("lanc"),quantity:entryWeight(e),neighborhood:e.neighborhood||""}))};const store=loadSimulationStore();store.scenarios.push(imported);store.activeId=imported.id;saveSimulationStore();renderScenarioSelect();renderSimulation();toast("Controle importado.");}catch{toast("Não foi possível importar este arquivo.");}};reader.readAsText(file);}

// Base de pessoas: cofre local criptografado, deliberadamente separado dos lançamentos.
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
  $("#overviewOffice").onchange = async e => { state.office = e.target.value; $("#candidateOffice").value = state.office; await loadOverviewCandidates(state.office); };
  $("#overviewPartyOffice").onchange = e => loadOverviewPartyChart(e.target.value);
  $("#candidateOffice").onchange = async e => { state.office = e.target.value; $("#overviewOffice").value = state.office; state.candidateFilters = { party: "", status: "", search: "", sort: "name", page: 1, pageSize: 24 }; $("#candidateSearch").value = ""; await loadCandidatePage(); };
  $("#candidateParty").onchange = e => { state.candidateFilters.party = e.target.value; state.candidateFilters.page = 1; renderCandidateCatalog(); };
  $("#candidateStatus").onchange = e => { state.candidateFilters.status = e.target.value; state.candidateFilters.page = 1; renderCandidateCatalog(); };
  $("#candidateSearch").oninput = e => { state.candidateFilters.search = e.target.value; state.candidateFilters.page = 1; renderCandidateCatalog(); };
  $("#candidateSort").onchange = e => { state.candidateFilters.sort = e.target.value; state.candidateFilters.page = 1; renderCandidateCatalog(); };
  $("#partyOffice").onchange = e => { state.partyOffice = e.target.value; loadPartiesPage(); };
  $("#partySearch").oninput = e => { state.partySearch = e.target.value; const data = state.candidateData.get(state.partyOffice); if (data) renderPartyGrid(aggregateParties(data.candidates)); };
  $("#sectionMunicipality").onchange = e => { state.municipality = e.target.value; state.sectionFilters = { zone: "", search: "", page: 1, pageSize: 50 }; loadSectionsPage(); };
  $("#sectionZone").onchange = e => { state.sectionFilters.zone = e.target.value; state.sectionFilters.page = 1; const data = state.sectionData.get(state.municipality); if (data) renderSections(data); };
  $("#sectionSearch").oninput = e => { state.sectionFilters.search = e.target.value; state.sectionFilters.page = 1; const data = state.sectionData.get(state.municipality); if (data) renderSections(data); };
  $("#neighborhoodMunicipality").onchange = e => { state.municipality=e.target.value; state.neighborhoodSearch="";$("#neighborhoodSearch").value="";loadNeighborhoodsPage(); };
  $("#neighborhoodSearch").oninput = e => { state.neighborhoodSearch=e.target.value; const data=state.sectionData.get(state.municipality);if(data)renderNeighborhoods(data); };
  $("#municipalitySearch").oninput = e => renderMunicipalities(e.target.value);
  $("#refreshAll").onclick = async () => { state.summary = null; state.candidateData.clear(); state.sectionData.clear(); await Promise.all([checkSources(true), loadOverview(true)]); toast("Dados consultados novamente."); };
  $("#printOverview").onclick = () => window.print();
  $("#exportCandidatesCsv").onclick = () => { const list = filteredCandidates(); exportCsv(`candidaturas-${state.office}-ma-2026.csv`, ["Nome de urna","Nome completo","Número","Partido","Partido - nome","Situação","Coligação","Federação"], list.map(c => [c.name,c.fullName,c.number,c.party,c.partyName,c.status,c.coalition,c.federation])); };
  $("#exportCandidatesXls").onclick = () => { const list = filteredCandidates(); exportXls(`candidaturas-${state.office}-ma-2026.xls`, ["Nome de urna","Nome completo","Número","Partido","Situação"], list.map(c => [c.name,c.fullName,c.number,c.party,c.status])); };
  $("#exportSectionsCsv").onclick = () => { const data=state.sectionData.get(state.municipality);if(!data)return;const list=filteredSections(data);exportCsv(`secoes-${slugify(state.municipality)}-2026.csv`,["Município","Bairro do local","Zona","Seção","Local de votação","Endereço","CEP","Eleitores","Acessibilidade"],list.map(x=>[x.municipio,x.bairro,x.zona,x.secao,x.localNome,x.endereco,x.cep,x.eleitores,x.acessibilidade])); };
  $("#exportSectionsXls").onclick = () => { const data=state.sectionData.get(state.municipality);if(!data)return;const list=filteredSections(data);exportXls(`secoes-${slugify(state.municipality)}-2026.xls`,["Município","Bairro do local","Zona","Seção","Local de votação","Eleitores"],list.map(x=>[x.municipio,x.bairro,x.zona,x.secao,x.localNome,x.eleitores])); };

  $("#vaultUnlock").onclick=unlockPeople;$("#vaultPassword").onkeydown=e=>{if(e.key==="Enter")unlockPeople();};$("#vaultLock").onclick=lockPeople;$("#personSave").onclick=savePerson;$("#personCancel").onclick=clearPersonForm;$("#peopleSearch").oninput=e=>{state.peopleSearch=e.target.value;renderPeople();};$("#peopleImportCsv").onchange=e=>{const f=e.target.files?.[0];if(f)importPeopleCsv(f);e.target.value="";};$("#peopleExportCsv").onclick=exportPeopleCsv;$("#peopleBackup").onclick=backupPeople;$("#peopleRestoreFile").onchange=e=>{const f=e.target.files?.[0];if(f)restorePeopleVault(f);e.target.value="";};

  $("#simScenario").onchange = e => { const store=loadSimulationStore();store.activeId=e.target.value;saveSimulationStore();renderSimulation(); };
  $("#simNewScenario").onclick = () => { const name=prompt("Nome do novo controle:",`Controle ${loadSimulationStore().scenarios.length+1}`);if(name)createScenario(name); };
  $("#simRenameScenario").onclick = () => { const x=activeScenario(),name=prompt("Novo nome do controle:",x.name);if(name?.trim()){x.name=name.trim().slice(0,60);x.updatedAt=new Date().toISOString();saveSimulationStore();renderScenarioSelect();} };
  $("#simDuplicateScenario").onclick = () => { const source=activeScenario(),store=loadSimulationStore(),copy={...source,id:newId("controle"),name:`${source.name} — cópia`,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),entries:source.entries.map(e=>({...e,id:newId("lanc")}))};store.scenarios.push(copy);store.activeId=copy.id;saveSimulationStore();renderScenarioSelect();renderSimulation(); };
  $("#simDeleteScenario").onclick = () => { const store=loadSimulationStore();if(store.scenarios.length<=1)return toast("Mantenha pelo menos um controle.");const x=activeScenario();if(confirm(`Excluir o controle “${x.name}”?`)){store.scenarios=store.scenarios.filter(s=>s.id!==x.id);store.activeId=store.scenarios[0].id;saveSimulationStore();renderScenarioSelect();renderSimulation();} };
  $("#simOffice").onchange = async e => { state.office=e.target.value;await populateSimulationCandidates();updateSimulationVoteMode();renderSimulation(); };
  $("#simMunicipality").onchange = async e => { state.municipality=e.target.value;await populateLaunchGeography();populateLaunchSections(); };
  $("#simNeighborhood").onchange = populateLaunchSections;$("#simZone").onchange = populateLaunchSections;$("#simVoteType").onchange = updateSimulationVoteMode;$("#simAdd").onclick=addSimulationEntry;$("#simRecordSearch").oninput=e=>{state.simulationRecordSearch=e.target.value;renderSimulation();};
  $("#simResetScenario").onclick = () => { const x=activeScenario();if(confirm(`Apagar todos os lançamentos de “${x.name}”?`)){x.entries=[];x.updatedAt=new Date().toISOString();saveSimulationStore();renderSimulation();} };
  $("#simExportCsv").onclick=exportSimulationCsv;$("#simExportJson").onclick=exportSimulationJson;$("#simImportButton").onclick=()=>$("#simImportFile").click();$("#simImportFile").onchange=e=>{const f=e.target.files?.[0];if(f)importSimulationJson(f);e.target.value="";};
  $("#globalSearch").oninput = e => { clearTimeout(state.globalSearchTimer);state.globalSearchTimer=setTimeout(()=>globalSearch(e.target.value),320); };
  $("#globalSearch").onfocus = e => { if(e.target.value.trim().length>=2)globalSearch(e.target.value); };
}

function startClock() {
  const update = () => { const el = $("#clock"); if (el) el.textContent = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" }); };
  update(); setInterval(update, 1000);
}

async function init() {
  loadSimulationStore(); fillOfficeSelects(); fillMunicipalitySelect(); bindEvents(); startClock();
  checkSources(); route();
}

init();
