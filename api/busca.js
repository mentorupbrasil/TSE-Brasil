import { searchCandidates } from "../lib/tse.js";
export default async function handler(req, res) {
  try {
    const q = String(req.query?.q || "").slice(0, 100);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=180");
    res.status(200).json(await searchCandidates(q));
  } catch (error) {
    res.status(502).json({ error: "Não foi possível pesquisar candidaturas agora.", detail: error.message });
  }
}
