import { territorySummaryMA } from "../lib/tse.js";

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    res.status(200).json(await territorySummaryMA());
  } catch (error) {
    res.status(502).json({ error: "Não foi possível carregar o resumo territorial do Maranhão.", detail: error.message });
  }
}
