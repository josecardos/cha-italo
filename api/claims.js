// API da lista do Chá do Ítalo (Vercel + Upstash Redis).
// GET    /api/claims          -> lista de marcações
// POST   /api/claims          -> { item, name } cria marcação, devolve { id, token }
// DELETE /api/claims?id=...   -> remove (header x-token = token que o próprio convidado recebeu)

const crypto = require("crypto");

const ITENS = ["fralda-p", "fralda-m", "fralda-g", "leno", "sabonete"];
const CHAVE = "cha:claims";

async function redis(comando) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("sem-banco");
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(comando),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

async function todos() {
  const plano = (await redis(["HGETALL", CHAVE])) || [];
  const lista = [];
  for (let i = 0; i < plano.length; i += 2) {
    try { lista.push(JSON.parse(plano[i + 1])); } catch (e) {}
  }
  return lista;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const lista = (await todos()).map(c => ({ id: c.id, item: c.item, name: c.name, at: c.at }));
      return res.status(200).json(lista);
    }

    if (req.method === "POST") {
      let corpo = req.body;
      if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = {}; } }
      corpo = corpo || {};
      const item = String(corpo.item || "");
      const nome = String(corpo.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!ITENS.includes(item) || !nome) return res.status(400).json({ erro: "dados" });

      const repetido = (await todos()).some(c => c.item === item && String(c.name).toLowerCase() === nome.toLowerCase());
      if (repetido) return res.status(409).json({ erro: "repetido" });

      const id = crypto.randomUUID();
      const token = crypto.randomUUID();
      await redis(["HSET", CHAVE, id, JSON.stringify({ id, item, name: nome, at: Date.now(), token })]);
      return res.status(201).json({ id, token });
    }

    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      if (!id) return res.status(400).json({ erro: "dados" });
      const bruto = await redis(["HGET", CHAVE, id]);
      if (!bruto) return res.status(200).json({ ok: true });
      let reg = {};
      try { reg = JSON.parse(bruto); } catch (e) {}
      if (!reg.token || req.headers["x-token"] !== reg.token) return res.status(403).json({ erro: "permissao" });
      await redis(["HDEL", CHAVE, id]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ erro: "metodo" });
  } catch (e) {
    return res.status(500).json({ erro: e.message === "sem-banco" ? "banco" : "falha" });
  }
};
