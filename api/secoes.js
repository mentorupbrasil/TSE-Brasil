import { sectionsByMunicipality } from "../lib/tse.js";
export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    res.status(200).json(await sectionsByMunicipality(req.query?.municipio || ""));
  } catch (error) {
    res.status(502).json({ error: "Não foi possível consultar a estrutura eleitoral deste município agora.", detail: error.message });
  }
}
