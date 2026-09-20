import { candidatesByOffice } from "../lib/tse.js";
export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
    res.status(200).json(await candidatesByOffice(req.query?.cargo || "6"));
  } catch (error) {
    res.status(502).json({ error: "Não foi possível consultar candidaturas no TSE agora.", detail: error.message });
  }
}
