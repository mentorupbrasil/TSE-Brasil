import { candidateById } from "../lib/tse.js";

export default async function handler(req, res) {
  try {
    const cargo = String(req.query?.cargo || "6");
    const id = String(req.query?.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "Informe o identificador da candidatura (id)." });
      return;
    }
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
    res.status(200).json(await candidateById(cargo, id));
  } catch (error) {
    res.status(502).json({ error: "Não foi possível consultar a ficha oficial no TSE agora.", detail: error.message });
  }
}
