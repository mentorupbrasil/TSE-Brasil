import { inflateRawSync } from "node:zlib";

const TSE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";
const CKAN_ELECTORATE = "https://dadosabertos.tse.jus.br/api/3/action/package_show?id=eleitorado-2026";
export const ELECTION_ID = "20322002026";
export const OFFICES = {"3":"Governador","5":"Senador","6":"Deputado federal","7":"Deputado estadual","1":"Presidente"};

const memory = new Map();
const DEFAULT_TTL = 10 * 60 * 1000;
const HEALTH_TTL = 5 * 60 * 1000;

async function cached(key, loader, ttl = DEFAULT_TTL) {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.fetchedAt < ttl) {
    return { value: hit.value, fetchedAt: hit.fetchedAt, stale: false, cache: "hit" };
  }
  try {
    const value = await loader();
    const fetchedAt = Date.now();
    memory.set(key, { value, fetchedAt });
    return { value, fetchedAt, stale: false, cache: hit ? "refresh" : "miss" };
  } catch (error) {
    if (hit) return { value: hit.value, fetchedAt: hit.fetchedAt, stale: true, cache: "stale", fallbackError: error.message };
    throw error;
  }
}

async function fetchJson(url, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Civica-MA/3.0", "Accept": "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Fonte respondeu ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function extractFirstCsv(zipBuffer) {
  const b = Buffer.from(zipBuffer), sig = 0x06054b50;
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === sig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP inválido");
  const entries = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) break;
    const method = b.readUInt16LE(p + 10), size = b.readUInt32LE(p + 20), nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32), localOffset = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (name.toLowerCase().endsWith(".csv")) {
      const localNameLen = b.readUInt16LE(localOffset + 26), localExtraLen = b.readUInt16LE(localOffset + 28), start = localOffset + 30 + localNameLen + localExtraLen;
      const data = b.subarray(start, start + size);
      if (method === 0) return data.toString("latin1");
      if (method === 8) return inflateRawSync(data).toString("latin1");
      throw new Error("Método ZIP não suportado");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("CSV não encontrado no ZIP");
}

function parseCsvLine(line) {
  const out = []; let current = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ';' && !quoted) { out.push(current); current = ""; }
    else current += c;
  }
  out.push(current);
  return out;
}

function norm(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function candidateSourceUpdatedAt(data) {
  return data?.dataHoraGeracao || data?.dataGeracao || data?.dataAtualizacao || data?.timestamp || null;
}

function normalizeCandidate(c) {
  return {
    id: String(c.id || c.idCandidato || c.sqCand || c.numero || ""),
    name: c.nomeUrna || c.nomeCompleto || c.nome || "",
    fullName: c.nomeCompleto || c.nome || c.nomeUrna || "",
    number: String(c.numero || ""),
    party: c.partido?.sigla || c.siglaPartido || "",
    partyName: c.partido?.nome || c.nomePartido || "",
    status: c.descricaoSituacao || c.situacao || c.descricaoTotalizacao || "",
    photo: c.urlFoto || c.fotoUrl || null,
    coalition: c.nomeColigacao || c.coligacao?.nome || "",
    federation: c.federacao?.nome || c.nomeFederacao || ""
  };
}

export async function candidatesByOffice(cargo = "6") {
  cargo = String(cargo || "6");
  if (!OFFICES[cargo]) throw new Error("Cargo inválido");
  const scope = cargo === "1" ? "BR" : "MA";
  const hit = await cached(`candidates-${cargo}`, async () => {
    const raw = await fetchJson(`${TSE}/candidatura/listar/2026/${scope}/${ELECTION_ID}/${cargo}/candidatos`);
    return { raw, candidates: (raw.candidatos || []).map(normalizeCandidate) };
  });
  const data = hit.value;
  return {
    source: "TSE DivulgaCandContas",
    sourceUrl: "https://divulgacandcontas.tse.jus.br/divulga/",
    queriedAt: new Date(hit.fetchedAt).toISOString(),
    sourceUpdatedAt: candidateSourceUpdatedAt(data.raw),
    stale: hit.stale,
    cache: hit.cache,
    fallbackError: hit.fallbackError || null,
    office: cargo,
    officeLabel: OFFICES[cargo],
    count: data.candidates.length,
    candidates: data.candidates
  };
}

async function sectionData() {
  const hit = await cached("sections-ma", async () => {
    const pkg = await fetchJson(CKAN_ELECTORATE);
    const resources = pkg?.result?.resources || [];
    const resource = resources.find(x => x.id === "76bf9d43-02ef-4d74-9507-482b7cb349ee") || resources.find(x => /MA.*se[cç][aã]o/i.test(`${x.name} ${x.description || ""}`));
    if (!resource?.url) throw new Error("Recurso MA por seção não localizado");
    const response = await fetch(resource.url, { headers: { "User-Agent": "Civica-MA/3.0" } });
    if (!response.ok) throw new Error(`Download de seções respondeu ${response.status}`);
    const text = extractFirstCsv(await response.arrayBuffer());
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = parseCsvLine(lines[0]);
    const idx = Object.fromEntries(headers.map((h, i) => [h.replace(/^\uFEFF/, ""), i]));
    const keys = { municipality: idx.NM_MUNICIPIO, zone: idx.NR_ZONA, section: idx.NR_SECAO, electors: idx.QT_ELEITORES_PERFIL };
    if (Object.values(keys).some(v => v === undefined)) throw new Error("Layout do arquivo de seções mudou");
    const map = new Map();
    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const municipality = row[keys.municipality], zone = row[keys.zone], section = row[keys.section];
      if (!municipality || !zone || !section) continue;
      const key = `${municipality}|${zone}|${section}`;
      const previous = map.get(key) || { municipio: municipality, zona: Number(zone), secao: Number(section), eleitores: 0 };
      previous.eleitores += Number(row[keys.electors] || 0);
      map.set(key, previous);
    }
    const rows = [...map.values()].sort((a, b) => a.municipio.localeCompare(b.municipio, "pt-BR") || a.zona - b.zona || a.secao - b.secao);
    return {
      rows,
      resourceName: resource.name || "Perfil do eleitorado por seção eleitoral - 2026 - MA",
      sourceUrl: resource.url,
      sourceUpdatedAt: resource.last_modified || pkg?.result?.metadata_modified || null
    };
  }, 30 * 60 * 1000);
  return { ...hit.value, queriedAt: new Date(hit.fetchedAt).toISOString(), stale: hit.stale, cache: hit.cache, fallbackError: hit.fallbackError || null };
}

export async function sectionsByMunicipality(municipio = "") {
  const data = await sectionData();
  const query = norm(municipio);
  const filtered = query ? data.rows.filter(x => norm(x.municipio) === query) : data.rows;
  const zoneMap = new Map();
  for (const row of filtered) {
    const zone = zoneMap.get(row.zona) || { zona: row.zona, secoes: 0, eleitores: 0 };
    zone.secoes += 1;
    zone.eleitores += row.eleitores;
    zoneMap.set(row.zona, zone);
  }
  const zones = [...zoneMap.values()].sort((a, b) => a.zona - b.zona);
  return {
    source: "TSE Dados Abertos — Perfil do eleitorado por seção 2026 MA",
    sourceUrl: data.sourceUrl,
    resourceName: data.resourceName,
    queriedAt: data.queriedAt,
    sourceUpdatedAt: data.sourceUpdatedAt,
    stale: data.stale,
    cache: data.cache,
    fallbackError: data.fallbackError,
    municipio: municipio || null,
    count: filtered.length,
    zoneCount: zones.length,
    zones,
    eleitores: filtered.reduce((sum, row) => sum + row.eleitores, 0),
    sections: filtered
  };
}

export async function summary() {
  const candidateResults = await Promise.all(Object.keys(OFFICES).map(async office => {
    try { return await candidatesByOffice(office); }
    catch (error) { return { office, officeLabel: OFFICES[office], count: null, error: error.message, candidates: [] }; }
  }));
  let sections = null;
  try {
    const data = await sectionData();
    sections = {
      count: data.rows.length,
      zones: new Set(data.rows.map(x => x.zona)).size,
      electors: data.rows.reduce((sum, row) => sum + row.eleitores, 0),
      queriedAt: data.queriedAt,
      sourceUpdatedAt: data.sourceUpdatedAt,
      stale: data.stale
    };
  } catch (error) {
    sections = { count: null, zones: null, electors: null, error: error.message };
  }
  const federal = candidateResults.find(x => x.office === "6")?.candidates || [];
  const partyMap = new Map();
  for (const c of federal) {
    const key = c.party || "SEM SIGLA";
    const item = partyMap.get(key) || { party: key, partyName: c.partyName || "", count: 0 };
    item.count++;
    if (!item.partyName && c.partyName) item.partyName = c.partyName;
    partyMap.set(key, item);
  }
  return {
    generatedAt: new Date().toISOString(),
    totalCandidates: candidateResults.reduce((sum, x) => sum + (Number.isFinite(x.count) ? x.count : 0), 0),
    offices: candidateResults.map(x => ({ office: x.office, label: x.officeLabel, count: x.count, error: x.error || null, stale: !!x.stale })),
    federalParties: [...partyMap.values()].sort((a, b) => b.count - a.count || a.party.localeCompare(b.party)),
    sections
  };
}

export async function searchCandidates(term = "") {
  const q = norm(term).trim();
  if (q.length < 2) return { query: term, results: [] };
  const lists = await Promise.all(Object.keys(OFFICES).map(async office => {
    try { return await candidatesByOffice(office); } catch { return { office, officeLabel: OFFICES[office], candidates: [] }; }
  }));
  const results = [];
  for (const data of lists) {
    for (const c of data.candidates) {
      const haystack = norm(`${c.name} ${c.fullName} ${c.number} ${c.party} ${c.partyName}`);
      if (haystack.includes(q)) results.push({ ...c, office: data.office, officeLabel: data.officeLabel });
      if (results.length >= 30) break;
    }
    if (results.length >= 30) break;
  }
  return { query: term, results };
}

export async function sourceHealth() {
  const hit = await cached("source-health", async () => {
    const candidateUrl = `${TSE}/candidatura/listar/2026/MA/${ELECTION_ID}/6/candidatos`;
    const checks = await Promise.allSettled([
      fetchJson(candidateUrl, 9000),
      fetchJson(CKAN_ELECTORATE, 9000)
    ]);
    return {
      candidates: checks[0].status === "fulfilled" ? { ok: true } : { ok: false, error: checks[0].reason?.message || "Falha" },
      electorate: checks[1].status === "fulfilled" ? { ok: true, updatedAt: checks[1].value?.result?.metadata_modified || null } : { ok: false, error: checks[1].reason?.message || "Falha" }
    };
  }, HEALTH_TTL);
  return { checkedAt: new Date(hit.fetchedAt).toISOString(), stale: hit.stale, ...hit.value };
}
