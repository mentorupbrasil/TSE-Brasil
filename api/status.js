import { sourceHealth, ELECTION_ID } from "../lib/tse.js";
export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=600");
    const health = await sourceHealth();
    res.status(200).json({ ok: health.candidates.ok || health.electorate.ok, ano: 2026, uf: "MA", eleicaoId: ELECTION_ID, ...health });
  } catch (error) {
    res.status(502).json({ ok: false, error: "Falha ao verificar fontes.", detail: error.message });
  }
}
