import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { inflateRawSync } from "node:zlib";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const types = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml"};
const TSE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";
const CKAN = "https://dadosabertos.tse.jus.br/api/3/action/package_show?id=eleitorado-2026";
const ELECTION_ID = "20322002026";
const cache = new Map();
const ttl = 10 * 60 * 1000;

const json = (res, status, data) => { res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=120"}); res.end(JSON.stringify(data)); };
async function cached(key, loader) { const hit=cache.get(key); if(hit && Date.now()-hit.at<ttl) return hit.value; const value=await loader(); cache.set(key,{at:Date.now(),value}); return value; }
async function fetchJson(url) { const r=await fetch(url,{headers:{"User-Agent":"Civica-MA/2.0","Accept":"application/json"}}); if(!r.ok) throw new Error(`Fonte respondeu ${r.status}`); return r.json(); }

function extractFirstCsv(zipBuffer) {
  const b = Buffer.from(zipBuffer);
  const eocdSig = 0x06054b50; let eocd = -1;
  for (let i=b.length-22; i>=Math.max(0,b.length-65557); i--) { if (b.readUInt32LE(i)===eocdSig) {eocd=i; break;} }
  if(eocd<0) throw new Error("ZIP inválido");
  const entries=b.readUInt16LE(eocd+10), centralOffset=b.readUInt32LE(eocd+16); let p=centralOffset;
  for(let n=0;n<entries;n++) {
    if(b.readUInt32LE(p)!==0x02014b50) break;
    const method=b.readUInt16LE(p+10), compSize=b.readUInt32LE(p+20), nameLen=b.readUInt16LE(p+28), extraLen=b.readUInt16LE(p+30), commentLen=b.readUInt16LE(p+32), localOffset=b.readUInt32LE(p+42);
    const name=b.subarray(p+46,p+46+nameLen).toString("utf8");
    if(name.toLowerCase().endsWith(".csv")) {
      const ln=b.readUInt16LE(localOffset+26), le=b.readUInt16LE(localOffset+28), start=localOffset+30+ln+le, data=b.subarray(start,start+compSize);
      if(method===0) return data.toString("latin1");
      if(method===8) return inflateRawSync(data).toString("latin1");
      throw new Error("Método ZIP não suportado");
    }
    p += 46+nameLen+extraLen+commentLen;
  }
  throw new Error("CSV não encontrado no ZIP");
}
function parseCsvLine(line) { const out=[]; let cur="", q=false; for(let i=0;i<line.length;i++){ const c=line[i]; if(c==='"'){ if(q && line[i+1]==='"'){cur+='"';i++;} else q=!q; } else if(c===';'&&!q){out.push(cur);cur="";} else cur+=c;} out.push(cur); return out; }
function normalizeText(s=""){return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();}
async function sectionData() {
  return cached("sections-ma", async()=>{
    const pkg=await fetchJson(CKAN); const resources=pkg?.result?.resources||[];
    const res=resources.find(x=>x.id==="76bf9d43-02ef-4d74-9507-482b7cb349ee") || resources.find(x=>/MA.*se[cç][aã]o/i.test(`${x.name} ${x.description||""}`));
    if(!res?.url) throw new Error("Recurso MA por seção não localizado");
    const r=await fetch(res.url,{headers:{"User-Agent":"Civica-MA/2.0"}}); if(!r.ok) throw new Error(`Download de seções respondeu ${r.status}`);
    const text=extractFirstCsv(await r.arrayBuffer()); const lines=text.split(/\r?\n/).filter(Boolean); const hdr=parseCsvLine(lines[0]); const idx=Object.fromEntries(hdr.map((h,i)=>[h.replace(/^\uFEFF/,""),i]));
    const keys={mun:idx.NM_MUNICIPIO,zona:idx.NR_ZONA,secao:idx.NR_SECAO,eleitores:idx.QT_ELEITORES_PERFIL};
    if(Object.values(keys).some(v=>v===undefined)) throw new Error("Layout do arquivo de seções mudou");
    const map=new Map();
    for(let i=1;i<lines.length;i++){ const row=parseCsvLine(lines[i]); const mun=row[keys.mun], zona=row[keys.zona], secao=row[keys.secao]; if(!mun||!zona||!secao) continue; const k=`${mun}|${zona}|${secao}`; const prev=map.get(k)||{municipio:mun,zona:Number(zona),secao:Number(secao),eleitores:0}; prev.eleitores += Number(row[keys.eleitores]||0); map.set(k,prev); }
    return [...map.values()];
  });
}

async function api(pathname, url, req, res) {
  if(pathname==="/api/status") return json(res,200,{ok:true,ano:2026,uf:"MA",eleicaoId:ELECTION_ID,fontes:["DivulgaCandContas/TSE","Portal de Dados Abertos do TSE"]});
  if(pathname==="/api/candidatos") {
    const cargo=String(url.searchParams.get("cargo")||"6"); const allowed=new Set(["1","3","5","6","7"]); if(!allowed.has(cargo)) return json(res,400,{error:"Cargo inválido"});
    const data=await cached(`cand-${cargo}`,()=>fetchJson(`${TSE}/candidatura/listar/2026/${cargo==="1"?"BR":"MA"}/${ELECTION_ID}/${cargo}/candidatos`));
    const list=(data.candidatos||[]).map(c=>({id:c.id||c.idCandidato||c.sqCand,name:c.nomeUrna||c.nomeCompleto||c.nome,fullName:c.nomeCompleto||c.nome,number:String(c.numero||""),party:c.partido?.sigla||c.siglaPartido||"",partyName:c.partido?.nome||c.nomePartido||"",status:c.descricaoSituacao||c.situacao||c.descricaoTotalizacao||"",photo:c.urlFoto||c.fotoUrl||null,coalition:c.nomeColigacao||c.coligacao?.nome||""}));
    return json(res,200,{source:"TSE DivulgaCandContas",updatedAt:new Date().toISOString(),cargo:data.cargo||null,count:list.length,candidates:list});
  }
  if(pathname==="/api/secoes") {
    const all=await sectionData(); const q=normalizeText(url.searchParams.get("municipio")||""); const filtered=q?all.filter(x=>normalizeText(x.municipio)===q):all; const zones=[...new Set(filtered.map(x=>x.zona))].sort((a,b)=>a-b); const eleitores=filtered.reduce((s,x)=>s+x.eleitores,0);
    return json(res,200,{source:"TSE Dados Abertos — Perfil do eleitorado por seção 2026 MA",updatedAt:new Date().toISOString(),municipio:url.searchParams.get("municipio")||null,count:filtered.length,zones,eleitores,sections:filtered});
  }
  return false;
}

createServer(async (request,response)=>{
  try {
    const url=new URL(request.url,"http://localhost"), pathname=url.pathname;
    if(pathname.startsWith("/api/")) { const handled=await api(pathname,url,request,response); if(handled!==false)return; }
    const requested=pathname==="/"?"/index.html":pathname; const safePath=normalize(requested).replace(/^([.][.][/\\])+/g,""); let filePath=join(root,safePath);
    if(!filePath.startsWith(root)){response.writeHead(403);response.end("Acesso negado");return;}
    const details=await stat(filePath); if(details.isDirectory()) filePath=join(filePath,"index.html"); const body=await readFile(filePath);
    response.writeHead(200,{"Content-Type":types[extname(filePath)]||"application/octet-stream","Cache-Control":"no-cache"}); response.end(body);
  } catch(error) { if(request.url?.startsWith("/api/")) return json(response,502,{error:"Não foi possível consultar a fonte oficial agora.",detail:error.message}); response.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"}); response.end("Arquivo não encontrado"); }
}).listen(port,"0.0.0.0",()=>console.log(`Cívica disponível em http://localhost:${port}`));
