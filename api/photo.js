const { cmd } = require("../lib/redis");
const { MAX_PLAYERS } = require("../lib/score");
const Sess = require("../lib/sessions");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const q = req.query || {};
    const idx = await Sess.loadIndex();
    const sid = Sess.resolve(idx, q.sid);
    const K = Sess.keys(sid);
    if (req.method === "GET") {
      const p = Number(q.p);
      if (!Number.isInteger(p) || p < 0 || p >= MAX_PLAYERS) return res.status(400).json({ error: "p tidak valid" });
      const photo = await cmd(["GET", K.photo(p)]);
      return res.status(200).json({ photo: photo || null });
    }
    if (req.method === "POST") {
      if (sid !== idx.active) throw Sess.err(409, "Sesi ini bukan sesi aktif");
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const p = Number(body && body.p), photo = body && body.photo;
      if (!Number.isInteger(p) || p < 0 || p >= MAX_PLAYERS) return res.status(400).json({ error: "p tidak valid" });
      if (typeof photo !== "string" || !photo.startsWith("data:image/jpeg;base64,") || photo.length > 250000)
        return res.status(400).json({ error: "Foto tidak valid atau terlalu besar" });
      const ts = String(Date.now());
      await cmd(["SET", K.photo(p), photo]);
      await cmd(["HSET", K.photov, String(p), ts]);
      return res.status(200).json({ ok: true, v: ts });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: String(e.message || e) });
  }
};
