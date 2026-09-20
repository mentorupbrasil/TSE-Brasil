import { inflateRawSync } from "node:zlib";

const TSE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";
const CKAN_ELECTORATE = "https://dadosabertos.tse.jus.br/api/3/action/package_show?id=eleitorado-2026";
const CANDIDATES_ZIP = "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip";
const ELECTORATE_MA_ZIP = "https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_eleitor_secao/perfil_eleitor_secao_2026_MA.zip";

export const ELECTION_ID = "20322002026";
export const OFFICES = { "3": "Governador", "5": "Senador", "6": "Deputado federal", "7": "Deputado estadual", "1": "Presidente" };

const memory = new Map();
const DEFAULT_TTL = 10 * 60 * 1000;
const HEALTH_TTL = 5 * 60 * 1000;
const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache"
};

async function cached(key, loader, ttl = DEFAULT_TTL) {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.fetchedAt < ttl) return { value: hit.value, fetchedAt: hit.fetchedAt, stale: false, cache: "hit" };
  try {
    const value = await loader();
    const fetchedAt = Date.now();
    memory.set(key, { value, fetchedAt });
    return { value, fetchedAt, stale: false, cache: hit ? "refresh" : "miss" };
  } catch (error) {
    if (hit) return { value: hit.value, fetchedAt: hit.fetchedAt, stale: true, cache: "stale", fallbackError: friendlyError(error) };
    throw error;
  }
}

function friendlyError(error) {
  const message = String(error?.message || error || "Falha na fonte oficial");
  if (/\b403\b/.test(message)) return "A fonte oficial bloqueou temporariamente a consulta automática.";
  if (/\b429\b/.test(message)) return "A fonte oficial limitou temporariamente o número de consultas.";
  if (/abort|timeout/i.test(message)) return "A fonte oficial demorou além do limite para responder.";
  return message;
}

async function fetchWithTimeout(url, { timeoutMs = 20000, headers = {}, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, headers: { ...browserHeaders, ...headers }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, { timeoutMs = 18000, referer = "https://dadosabertos.tse.jus.br/" } = {}) {
  const response = await fetchWithTimeout(url, {
    timeoutMs,
    headers: { "Accept": "application/json, text/plain, */*", "Referer": referer }
  });
  if (!response.ok) throw new Error(`Fonte respondeu ${response.status}`);
  return await response.json();
}

async function fetchBuffer(url, timeoutMs = 35000) {
  const response = await fetchWithTimeout(url, {
    timeoutMs,
    headers: {
      "Accept": "application/zip, application/octet-stream, */*",
      "Referer": "https://dadosabertos.tse.jus.br/"
    }
  });
  if (!response.ok) throw new Error(`CDN oficial respondeu ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function zipCsvEntries(zipBuffer) {
  const b = Buffer.from(zipBuffer), sig = 0x06054b50;
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === sig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP oficial inválido");
  const entries = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < entries; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) break;
    const method = b.readUInt16LE(p + 10), size = b.readUInt32LE(p + 20), nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32), localOffset = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (name.toLowerCase().endsWith(".csv")) out.push({ name, method, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { buffer: b, entries: out };
}

function extractCsv(zipBuffer, matcher = () => true) {
  const parsed = zipCsvEntries(zipBuffer);
  let entry = parsed.entries.find(e => matcher(e.name));
  if (!entry && parsed.entries.length === 1) entry = parsed.entries[0];
  if (!entry) throw new Error("CSV esperado não encontrado no ZIP oficial");
  const b = parsed.buffer, lo = entry.localOffset;
  if (lo + 30 > b.length || b.readUInt32LE(lo) !== 0x04034b50) throw new Error("Entrada ZIP inválida");
  const localNameLen = b.readUInt16LE(lo + 26), localExtraLen = b.readUInt16LE(lo + 28), start = lo + 30 + localNameLen + localExtraLen;
  const data = b.subarray(start, start + entry.size);
  if (entry.method === 0) return { name: entry.name, text: data.toString("latin1") };
  if (entry.method === 8) return { name: entry.name, text: inflateRawSync(data).toString("latin1") };
  throw new Error("Método de compactação do ZIP não suportado");
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

function parseTable(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error("CSV oficial vazio");
  const headers = parseCsvLine(lines[0]).map(h => h.replace(/^\uFEFF/, "").trim());
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  return { lines, idx };
}

function value(row, idx, ...names) {
  for (const name of names) if (idx[name] !== undefined) return row[idx[name]] ?? "";
  return "";
}

function norm(input = "") { return String(input).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); }

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

async function candidatesFromCdn(cargo) {
  const scope = cargo === "1" ? "BR" : "MA";
  const zip = await cached("official-candidates-zip", () => fetchBuffer(CANDIDATES_ZIP), 30 * 60 * 1000);
  const wanted = cargo === "1" ? /(?:BRASIL|_BR)(?:\.[^.]*)?\.csv$|consulta_cand_2026_BRASIL\.csv$/i : /(?:^|[_-])MA\.csv$/i;
  let extracted;
  try { extracted = extractCsv(zip.value, name => wanted.test(name.replace(/\\/g, "/"))); }
  catch {
    // Alguns pacotes do TSE trazem um CSV único com todas as UFs.
    extracted = extractCsv(zip.value, () => true);
  }
  const { lines, idx } = parseTable(extracted.text);
  const candidates = [];
  let generatedAt = null;
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    const rowOffice = String(value(row, idx, "CD_CARGO")).trim();
    if (rowOffice !== cargo) continue;
    const uf = value(row, idx, "SG_UF").trim().toUpperCase();
    if (scope === "MA" && uf && uf !== "MA") continue;
    const id = value(row, idx, "SQ_CANDIDATO", "SQ_CAND");
    const number = value(row, idx, "NR_CANDIDATO");
    const fullName = value(row, idx, "NM_CANDIDATO");
    const name = value(row, idx, "NM_URNA_CANDIDATO", "NM_CANDIDATO");
    if (!id && !number && !fullName) continue;
    if (!generatedAt) {
      const date = value(row, idx, "DT_GERACAO");
      const time = value(row, idx, "HH_GERACAO");
      generatedAt = [date, time].filter(Boolean).join(" ") || null;
    }
    candidates.push({
      id: String(id || number || ""),
      name,
      fullName,
      number: String(number || ""),
      party: value(row, idx, "SG_PARTIDO"),
      partyName: value(row, idx, "NM_PARTIDO"),
      status: value(row, idx, "DS_SITUACAO_CANDIDATURA", "DS_DETALHE_SITUACAO_CAND"),
      photo: null,
      coalition: value(row, idx, "NM_COLIGACAO"),
      federation: value(row, idx, "NM_FEDERACAO")
    });
  }
  return { candidates, sourceUpdatedAt: generatedAt, fileName: extracted.name, transport: "cdn" };
}

export async function candidatesByOffice(cargo = "6") {
  cargo = String(cargo || "6");
  if (!OFFICES[cargo]) throw new Error("Cargo inválido");
  const scope = cargo === "1" ? "BR" : "MA";
  const hit = await cached(`candidates-${cargo}`, async () => {
    try {
      const raw = await fetchJson(`${TSE}/candidatura/listar/2026/${scope}/${ELECTION_ID}/${cargo}/candidatos`, {
        referer: "https://divulgacandcontas.tse.jus.br/divulga/"
      });
      return { candidates: (raw.candidatos || []).map(normalizeCandidate), sourceUpdatedAt: candidateSourceUpdatedAt(raw), transport: "divulgacand" };
    } catch (primaryError) {
      const cdn = await candidatesFromCdn(cargo);
      return { ...cdn, primaryFallback: friendlyError(primaryError) };
    }
  });
  const data = hit.value;
  return {
    source: data.transport === "cdn" ? "TSE Dados Abertos — Candidatos 2026" : "TSE DivulgaCandContas",
    sourceUrl: data.transport === "cdn" ? "https://dadosabertos.tse.jus.br/dataset/candidatos-2026" : "https://divulgacandcontas.tse.jus.br/divulga/",
    transport: data.transport,
    queriedAt: new Date(hit.fetchedAt).toISOString(),
    sourceUpdatedAt: data.sourceUpdatedAt || null,
    stale: hit.stale,
    cache: hit.cache,
    fallbackError: hit.fallbackError || null,
    office: cargo,
    officeLabel: OFFICES[cargo],
    count: data.candidates.length,
    candidates: data.candidates
  };
}

async function electorateResource() {
  try {
    const pkg = await fetchJson(CKAN_ELECTORATE, { referer: "https://dadosabertos.tse.jus.br/dataset/eleitorado-2026" });
    const resources = pkg?.result?.resources || [];
    const resource = resources.find(x => x.id === "76bf9d43-02ef-4d74-9507-482b7cb349ee") || resources.find(x => /MA.*se[cç][aã]o/i.test(`${x.name} ${x.description || ""}`));
    if (resource?.url) return { url: resource.url, name: resource.name || "Perfil do eleitorado por seção eleitoral - 2026 - MA", updatedAt: resource.last_modified || pkg?.result?.metadata_modified || null, transport: "ckan-cdn" };
  } catch { /* usa URL oficial estável do CDN */ }
  return { url: ELECTORATE_MA_ZIP, name: "MA - Perfil do eleitorado por seção eleitoral - 2026", updatedAt: null, transport: "cdn" };
}

async function sectionData() {
  const hit = await cached("sections-ma", async () => {
    const resource = await electorateResource();
    const zip = await fetchBuffer(resource.url, 40000);
    const extracted = extractCsv(zip, name => /MA.*\.csv$|perfil_eleitor_secao_2026_MA\.csv$/i.test(name.replace(/\\/g, "/")));
    const { lines, idx } = parseTable(extracted.text);
    const required = ["NM_MUNICIPIO", "NR_ZONA", "NR_SECAO", "QT_ELEITORES_PERFIL"];
    if (required.some(k => idx[k] === undefined)) throw new Error("Layout do arquivo oficial de seções mudou");
    const map = new Map();
    let generatedAt = resource.updatedAt;
    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const municipality = value(row, idx, "NM_MUNICIPIO"), zone = value(row, idx, "NR_ZONA"), section = value(row, idx, "NR_SECAO");
      if (!municipality || !zone || !section) continue;
      if (!generatedAt) {
        const date = value(row, idx, "DT_GERACAO");
        const time = value(row, idx, "HH_GERACAO");
        generatedAt = [date, time].filter(Boolean).join(" ") || null;
      }
      const key = `${municipality}|${zone}|${section}`;
      const previous = map.get(key) || { municipio: municipality, zona: Number(zone), secao: Number(section), eleitores: 0 };
      previous.eleitores += Number(value(row, idx, "QT_ELEITORES_PERFIL") || 0);
      map.set(key, previous);
    }
    const rows = [...map.values()].sort((a, b) => a.municipio.localeCompare(b.municipio, "pt-BR") || a.zona - b.zona || a.secao - b.secao);
    return { rows, resourceName: resource.name, sourceUrl: resource.url, sourceUpdatedAt: generatedAt, transport: resource.transport };
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
    transport: data.transport,
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
    catch (error) { return { office, officeLabel: OFFICES[office], count: null, error: friendlyError(error), candidates: [] }; }
  }));
  let sections;
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
    sections = { count: null, zones: null, electors: null, error: friendlyError(error) };
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
    const checks = await Promise.allSettled([candidatesByOffice("6"), sectionData()]);
    return {
      candidates: checks[0].status === "fulfilled" ? { ok: true, transport: checks[0].value.transport, sourceUpdatedAt: checks[0].value.sourceUpdatedAt || null } : { ok: false, error: friendlyError(checks[0].reason) },
      electorate: checks[1].status === "fulfilled" ? { ok: true, transport: checks[1].value.transport, updatedAt: checks[1].value.sourceUpdatedAt || null } : { ok: false, error: friendlyError(checks[1].reason) }
    };
  }, HEALTH_TTL);
  return { checkedAt: new Date(hit.fetchedAt).toISOString(), stale: hit.stale, ...hit.value };
}
