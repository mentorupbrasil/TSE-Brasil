import { sectionsByMunicipality } from "../lib/tse.js";
export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=1800");
    res.status(200).json(await sectionsByMunicipality(req.query?.municipio || ""));
  } catch (error) {
    res.status(502).json({ error: "Não foi possível consultar zonas e seções no TSE agora.", detail: error.message });
  }
}
