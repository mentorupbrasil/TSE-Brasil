import { inflateRawSync } from "node:zlib";
import { Readable } from "node:stream";
import readline from "node:readline";
import unzipper from "unzipper";

const TSE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";
const CANDIDATES_ZIP = "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip";
const LOCAL_VOTING_ZIP = "https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip";
const LOCAL_VOTING_RESOURCE = "https://dadosabertos.tse.jus.br/dataset/eleitorado-2026/resource/300626b4-2b24-4d2e-b4fc-46b569cfffe5";

export const ELECTION_ID = "20322002026";
export const OFFICES = { "3": "Governador", "5": "Senador", "6": "Deputado federal", "7": "Deputado estadual", "1": "Presidente" };

const memory = new Map();
const DEFAULT_TTL = 10 * 60 * 1000;
const LOCAL_DATA_TTL = 6 * 60 * 60 * 1000;
const HEALTH_TTL = 5 * 60 * 1000;
const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
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
  if (/out of available memory|heap|memory/i.test(message)) return "A consulta excedeu temporariamente os recursos do servidor.";
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
  const response = await fetchWithTimeout(url, { timeoutMs, headers: { "Accept": "application/json, text/plain, */*", "Referer": referer } });
  if (!response.ok) throw new Error(`Fonte respondeu ${response.status}`);
  return await response.json();
}

async function fetchBuffer(url, timeoutMs = 35000) {
  const response = await fetchWithTimeout(url, { timeoutMs, headers: { "Accept": "application/zip, application/octet-stream, */*", "Referer": "https://dadosabertos.tse.jus.br/" } });
  if (!response.ok) throw new Error(`CDN oficial respondeu ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function zipCsvEntries(zipBuffer) {
  const b = Buffer.from(zipBuffer), sig = 0x06054b50;
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === sig) { eocd = i; break; }
  if (eocd < 0) throw new Error("ZIP oficial inválido");
  const entries = b.readUInt16LE(eocd + 10); let p = b.readUInt32LE(eocd + 16); const out = [];
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
  const parsed = zipCsvEntries(zipBuffer); let entry = parsed.entries.find(e => matcher(e.name));
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
  out.push(current); return out;
}

function parseTable(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error("CSV oficial vazio");
  const headers = parseCsvLine(lines[0]).map(h => h.replace(/^\uFEFF/, "").trim());
  return { lines, idx: Object.fromEntries(headers.map((h, i) => [h, i])) };
}

function value(row, idx, ...names) { for (const name of names) if (idx[name] !== undefined) return row[idx[name]] ?? ""; return ""; }
function norm(input = "") { return String(input).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); }
function asNumber(value) { const n = Number(String(value ?? "").replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : 0; }
function candidateSourceUpdatedAt(data) { return data?.dataHoraGeracao || data?.dataGeracao || data?.dataAtualizacao || data?.timestamp || null; }

function normalizeCandidate(c) {
  return {
    id: String(c.id || c.idCandidato || c.sqCand || c.numero || ""), name: c.nomeUrna || c.nomeCompleto || c.nome || "", fullName: c.nomeCompleto || c.nome || c.nomeUrna || "",
    number: String(c.numero || ""), party: c.partido?.sigla || c.siglaPartido || "", partyName: c.partido?.nome || c.nomePartido || "", status: c.descricaoSituacao || c.situacao || c.descricaoTotalizacao || "",
    photo: c.urlFoto || c.fotoUrl || null, coalition: c.nomeColigacao || c.coligacao?.nome || "", federation: c.federacao?.nome || c.nomeFederacao || ""
  };
}

async function candidatesFromCdn(cargo) {
  const scope = cargo === "1" ? "BR" : "MA";
  const zip = await cached("official-candidates-zip", () => fetchBuffer(CANDIDATES_ZIP), 30 * 60 * 1000);
  const wanted = cargo === "1" ? /(?:BRASIL|_BR)(?:\.[^.]*)?\.csv$|consulta_cand_2026_BRASIL\.csv$/i : /(?:^|[_-])MA\.csv$/i;
  let extracted;
  try { extracted = extractCsv(zip.value, name => wanted.test(name.replace(/\\/g, "/"))); } catch { extracted = extractCsv(zip.value, () => true); }
  const { lines, idx } = parseTable(extracted.text); const candidates = []; let generatedAt = null;
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]); const rowOffice = String(value(row, idx, "CD_CARGO")).trim(); if (rowOffice !== cargo) continue;
    const uf = value(row, idx, "SG_UF").trim().toUpperCase(); if (scope === "MA" && uf && uf !== "MA") continue;
    const id = value(row, idx, "SQ_CANDIDATO", "SQ_CAND"), number = value(row, idx, "NR_CANDIDATO"), fullName = value(row, idx, "NM_CANDIDATO"), name = value(row, idx, "NM_URNA_CANDIDATO", "NM_CANDIDATO");
    if (!id && !number && !fullName) continue;
    if (!generatedAt) { const date = value(row, idx, "DT_GERACAO"), time = value(row, idx, "HH_GERACAO"); generatedAt = [date, time].filter(Boolean).join(" ") || null; }
    candidates.push({ id: String(id || number || ""), name, fullName, number: String(number || ""), party: value(row, idx, "SG_PARTIDO"), partyName: value(row, idx, "NM_PARTIDO"), status: value(row, idx, "DS_SITUACAO_CANDIDATURA", "DS_DETALHE_SITUACAO_CAND"), photo: null, coalition: value(row, idx, "NM_COLIGACAO"), federation: value(row, idx, "NM_FEDERACAO") });
  }
  return { candidates, sourceUpdatedAt: generatedAt, fileName: extracted.name, transport: "cdn" };
}

export async function candidatesByOffice(cargo = "6") {
  cargo = String(cargo || "6"); if (!OFFICES[cargo]) throw new Error("Cargo inválido"); const scope = cargo === "1" ? "BR" : "MA";
  const hit = await cached(`candidates-${cargo}`, async () => {
    try {
      const raw = await fetchJson(`${TSE}/candidatura/listar/2026/${scope}/${ELECTION_ID}/${cargo}/candidatos`, { referer: "https://divulgacandcontas.tse.jus.br/divulga/" });
      return { candidates: (raw.candidatos || []).map(normalizeCandidate), sourceUpdatedAt: candidateSourceUpdatedAt(raw), transport: "divulgacand" };
    } catch (primaryError) { const cdn = await candidatesFromCdn(cargo); return { ...cdn, primaryFallback: friendlyError(primaryError) }; }
  });
  const data = hit.value;
  return { source: data.transport === "cdn" ? "TSE Dados Abertos — Candidatos 2026" : "TSE DivulgaCandContas", sourceUrl: data.transport === "cdn" ? "https://dadosabertos.tse.jus.br/dataset/candidatos-2026" : "https://divulgacandcontas.tse.jus.br/divulga/", transport: data.transport, queriedAt: new Date(hit.fetchedAt).toISOString(), sourceUpdatedAt: data.sourceUpdatedAt || null, stale: hit.stale, cache: hit.cache, fallbackError: hit.fallbackError || null, office: cargo, officeLabel: OFFICES[cargo], count: data.candidates.length, candidates: data.candidates };
}

async function readLocalVotingMA() {
  const hit = await cached("local-voting-ma-stream-v1", async () => {
    const response = await fetchWithTimeout(LOCAL_VOTING_ZIP, { timeoutMs: 90000, headers: { "Accept": "application/zip, application/octet-stream, */*", "Referer": "https://dadosabertos.tse.jus.br/dataset/eleitorado-2026" } });
    if (!response.ok || !response.body) throw new Error(`CDN oficial de locais respondeu ${response.status}`);
    const sectionMap = new Map(), locationMap = new Map(); let generatedAt = null, foundCsv = false, foundMaRows = false;
    const parser = Readable.fromWeb(response.body).pipe(unzipper.Parse({ forceStream: true }));
    for await (const entry of parser) {
      const entryPath = String(entry.path || "");
      if (!entryPath.toLowerCase().endsWith(".csv")) { entry.autodrain(); continue; }
      foundCsv = true; entry.setEncoding("latin1");
      const lines = readline.createInterface({ input: entry, crlfDelay: Infinity }); let idx = null;
      for await (const line of lines) {
        if (!line) continue;
        if (!idx) {
          const headers = parseCsvLine(line).map(h => h.replace(/^\uFEFF/, "").trim()); idx = Object.fromEntries(headers.map((h, i) => [h, i]));
          const required = ["SG_UF", "NM_MUNICIPIO", "NR_ZONA", "NR_SECAO"];
          if (required.some(k => idx[k] === undefined)) throw new Error("Layout do arquivo oficial de locais de votação mudou");
          continue;
        }
        const row = parseCsvLine(line); const uf = String(value(row, idx, "SG_UF")).trim().toUpperCase(); if (uf !== "MA") continue; foundMaRows = true;
        const municipio = String(value(row, idx, "NM_MUNICIPIO")).trim(), zona = asNumber(value(row, idx, "NR_ZONA")), secao = asNumber(value(row, idx, "NR_SECAO"));
        if (!municipio || !zona || !secao) continue;
        if (!generatedAt) { const date = value(row, idx, "DT_GERACAO"), time = value(row, idx, "HH_GERACAO"); generatedAt = [date, time].filter(Boolean).join(" ") || null; }
        const localCode = String(value(row, idx, "NR_LOCAL_VOTACAO", "CD_LOCAL_VOTACAO") || "").trim();
        const localName = String(value(row, idx, "NM_LOCAL_VOTACAO") || "").trim();
        const bairro = String(value(row, idx, "NM_BAIRRO") || "Não informado").trim() || "Não informado";
        const endereco = String(value(row, idx, "DS_ENDERECO") || "").trim();
        const cep = String(value(row, idx, "NR_CEP") || "").trim();
        const telefone = String(value(row, idx, "NR_TELEFONE_LOCAL") || "").trim();
        const latitude = String(value(row, idx, "NR_LATITUDE") || "").trim(), longitude = String(value(row, idx, "NR_LONGITUDE") || "").trim();
        const acessibilidade = String(value(row, idx, "DS_SITU_SECAO_ACESSIBILIDADE") || "").trim();
        const eleitoresSecao = asNumber(value(row, idx, "QT_ELEITOR_SECAO", "QT_ELEITORES"));
        const eleitoresEstadual = asNumber(value(row, idx, "QT_ELEITOR_ELEICAO_ESTADUAL"));
        const eleitores = eleitoresEstadual || eleitoresSecao;
        const key = `${municipio}|${zona}|${secao}`;
        const previous = sectionMap.get(key);
        const section = { municipio, zona, secao, eleitores, eleitoresSecao, eleitoresEstadual, bairro, localCodigo: localCode, localNome: localName, endereco, cep, telefone, latitude, longitude, acessibilidade };
        if (!previous || section.eleitores > previous.eleitores) sectionMap.set(key, section);
        const locationKey = `${municipio}|${zona}|${localCode || localName || bairro}`;
        let location = locationMap.get(locationKey);
        if (!location) {
          location = { municipio, zona, codigo: localCode, nome: localName || "Local não informado", bairro, endereco, cep, telefone, latitude, longitude, secoes: new Set(), eleitores: 0 };
          locationMap.set(locationKey, location);
        }
        if (!location.secoes.has(secao)) { location.secoes.add(secao); location.eleitores += eleitores; }
      }
      if (foundMaRows) break;
    }
    if (!foundCsv) throw new Error("CSV de locais de votação não encontrado no ZIP oficial");
    if (!foundMaRows) throw new Error("Registros do Maranhão não foram localizados no arquivo oficial");
    const sections = [...sectionMap.values()].sort((a, b) => a.municipio.localeCompare(b.municipio, "pt-BR") || a.zona - b.zona || a.secao - b.secao);
    const locations = [...locationMap.values()].map(x => ({ ...x, secoes: [...x.secoes].sort((a, b) => a - b), sectionCount: x.secoes.size })).sort((a, b) => a.municipio.localeCompare(b.municipio, "pt-BR") || a.bairro.localeCompare(b.bairro, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
    return { sections, locations, sourceUpdatedAt: generatedAt, sourceUrl: LOCAL_VOTING_RESOURCE, transport: "cdn-stream" };
  }, LOCAL_DATA_TTL);
  return { ...hit.value, queriedAt: new Date(hit.fetchedAt).toISOString(), stale: hit.stale, cache: hit.cache, fallbackError: hit.fallbackError || null };
}

export async function sectionsByMunicipality(municipio = "") {
  const query = norm(municipio).trim(); if (!query) throw new Error("Município obrigatório para esta consulta");
  const data = await readLocalVotingMA();
  const sections = data.sections.filter(x => norm(x.municipio) === query);
  const locations = data.locations.filter(x => norm(x.municipio) === query);
  const zoneMap = new Map(), neighborhoodMap = new Map();
  for (const row of sections) {
    const zone = zoneMap.get(row.zona) || { zona: row.zona, secoes: 0, eleitores: 0, bairros: new Set(), locais: new Set() };
    zone.secoes++; zone.eleitores += row.eleitores; if (row.bairro) zone.bairros.add(row.bairro); if (row.localCodigo || row.localNome) zone.locais.add(row.localCodigo || row.localNome); zoneMap.set(row.zona, zone);
    const neighborhoodName = row.bairro || "Não informado";
    const neighborhood = neighborhoodMap.get(neighborhoodName) || { bairro: neighborhoodName, secoes: 0, eleitores: 0, zonas: new Set(), locais: new Set() };
    neighborhood.secoes++; neighborhood.eleitores += row.eleitores; neighborhood.zonas.add(row.zona); if (row.localCodigo || row.localNome) neighborhood.locais.add(row.localCodigo || row.localNome); neighborhoodMap.set(neighborhoodName, neighborhood);
  }
  const zones = [...zoneMap.values()].map(x => ({ zona: x.zona, secoes: x.secoes, eleitores: x.eleitores, bairros: x.bairros.size, locais: x.locais.size })).sort((a, b) => a.zona - b.zona);
  const neighborhoods = [...neighborhoodMap.values()].map(x => ({ bairro: x.bairro, secoes: x.secoes, eleitores: x.eleitores, zonas: [...x.zonas].sort((a, b) => a - b), zoneCount: x.zonas.size, locais: x.locais.size })).sort((a, b) => a.bairro.localeCompare(b.bairro, "pt-BR"));
  return {
    source: "TSE Dados Abertos — Eleitorado por local de votação 2026", sourceUrl: data.sourceUrl, resourceName: "Eleitorado por local de votação - 2026", transport: data.transport,
    queriedAt: data.queriedAt, sourceUpdatedAt: data.sourceUpdatedAt, stale: data.stale, cache: data.cache, fallbackError: data.fallbackError,
    municipio, count: sections.length, zoneCount: zones.length, neighborhoodCount: neighborhoods.length, locationCount: locations.length,
    zones, neighborhoods, locations, eleitores: sections.reduce((sum, row) => sum + row.eleitores, 0), sections
  };
}

export async function summary() {
  const candidateResults = await Promise.all(Object.keys(OFFICES).map(async office => {
    try { return await candidatesByOffice(office); } catch (error) { return { office, officeLabel: OFFICES[office], count: null, error: friendlyError(error), candidates: [] }; }
  }));
  const federal = candidateResults.find(x => x.office === "6")?.candidates || []; const partyMap = new Map();
  for (const c of federal) { const key = c.party || "SEM SIGLA"; const item = partyMap.get(key) || { party: key, partyName: c.partyName || "", count: 0 }; item.count++; if (!item.partyName && c.partyName) item.partyName = c.partyName; partyMap.set(key, item); }
  return {
    generatedAt: new Date().toISOString(), totalCandidates: candidateResults.reduce((sum, x) => sum + (Number.isFinite(x.count) ? x.count : 0), 0),
    offices: candidateResults.map(x => ({ office: x.office, label: x.officeLabel, count: x.count, error: x.error || null, stale: !!x.stale })),
    federalParties: [...partyMap.values()].sort((a, b) => b.count - a.count || a.party.localeCompare(b.party)),
    sections: { count: null, zones: null, electors: null, deferred: true, note: "Abra Zonas e seções para consultar o município desejado." }
  };
}

export async function searchCandidates(term = "") {
  const q = norm(term).trim(); if (q.length < 2) return { query: term, results: [] };
  const lists = await Promise.all(Object.keys(OFFICES).map(async office => { try { return await candidatesByOffice(office); } catch { return { office, officeLabel: OFFICES[office], candidates: [] }; } }));
  const results = [];
  for (const data of lists) {
    for (const c of data.candidates) { const haystack = norm(`${c.name} ${c.fullName} ${c.number} ${c.party} ${c.partyName}`); if (haystack.includes(q)) results.push({ ...c, office: data.office, officeLabel: data.officeLabel }); if (results.length >= 30) break; }
    if (results.length >= 30) break;
  }
  return { query: term, results };
}

async function probeSource(url, { referer = "https://dadosabertos.tse.jus.br/", timeoutMs = 9000 } = {}) {
  try {
    let response = await fetchWithTimeout(url, { method: "HEAD", timeoutMs, headers: { "Referer": referer, "Accept": "*/*" } });
    if (response.ok) return { ok: true, status: response.status };
    response = await fetchWithTimeout(url, { method: "GET", timeoutMs, headers: { "Referer": referer, "Accept": "*/*", "Range": "bytes=0-0" } });
    const result = { ok: response.ok || response.status === 206, status: response.status };
    try { await response.body?.cancel(); } catch {}
    return result;
  } catch (error) { return { ok: false, error: friendlyError(error) }; }
}

export async function sourceHealth() {
  const hit = await cached("source-health-v3", async () => {
    const candidateUrl = `${TSE}/candidatura/listar/2026/MA/${ELECTION_ID}/6/candidatos`;
    const [candidatePrimary, candidateCdn, electorateProbe] = await Promise.all([
      probeSource(candidateUrl, { referer: "https://divulgacandcontas.tse.jus.br/divulga/" }),
      probeSource(CANDIDATES_ZIP, { referer: "https://dadosabertos.tse.jus.br/dataset/candidatos-2026" }),
      probeSource(LOCAL_VOTING_ZIP, { referer: "https://dadosabertos.tse.jus.br/dataset/eleitorado-2026" })
    ]);
    const candidates = candidatePrimary.ok
      ? { ok: true, transport: "DivulgaCandContas", status: candidatePrimary.status }
      : candidateCdn.ok
        ? { ok: true, transport: "CDN TSE — Candidatos 2026 (contingência)", status: candidateCdn.status }
        : { ok: false, error: candidatePrimary.error || candidateCdn.error || `HTTP ${candidatePrimary.status || candidateCdn.status || "—"}` };
    return {
      candidates,
      electorate: electorateProbe.ok ? { ok: true, transport: "CDN TSE — locais de votação", status: electorateProbe.status } : { ok: false, error: electorateProbe.error || `HTTP ${electorateProbe.status}` }
    };
  }, HEALTH_TTL);
  return { checkedAt: new Date(hit.fetchedAt).toISOString(), stale: hit.stale, ...hit.value };
}
