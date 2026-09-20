import { summary } from "../lib/tse.js";
export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    res.status(200).json(await summary());
  } catch (error) {
    res.status(502).json({ error: "Não foi possível montar o resumo agora.", detail: error.message });
  }
}
