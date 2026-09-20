import { ELECTION_ID } from '../lib/tse.js';
export default function handler(req,res){res.status(200).json({ok:true,ano:2026,uf:'MA',eleicaoId:ELECTION_ID,fontes:['DivulgaCandContas/TSE','Portal de Dados Abertos do TSE']})}
