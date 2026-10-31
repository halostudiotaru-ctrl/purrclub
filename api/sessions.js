const Sess = require("../lib/sessions");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") return res.status(200).json(await Sess.overview());
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!b || typeof b !== "object") throw Sess.err(400, "Body kosong");
      if (b.op === "preview") return res.status(200).json(Sess.preview(b));
      if (b.op === "activate") await Sess.activate(b.id);
      else if (b.op === undefined || b.op === "create") await Sess.createSession(b);
      else throw Sess.err(400, "Operasi tidak dikenal");
      return res.status(200).json(await Sess.overview());
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: String(e.message || e) });
  }
};
