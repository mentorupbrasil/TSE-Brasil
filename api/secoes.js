import { sectionsByMunicipality } from '../lib/tse.js';
export default async function handler(req,res){try{res.setHeader('Cache-Control','s-maxage=120, stale-while-revalidate=300');res.status(200).json(await sectionsByMunicipality(req.query?.municipio||''))}catch(e){res.status(502).json({error:'Não foi possível consultar zonas e seções no TSE agora.',detail:e.message})}}
