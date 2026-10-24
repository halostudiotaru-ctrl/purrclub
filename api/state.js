const { cmd } = require("../lib/redis");
const S = require("../lib/score");

const err = (status, message) => Object.assign(new Error(message), { status });

async function loadState() {
  const raw = await cmd(["GET", "ht:state"]);
  return raw ? JSON.parse(raw) : { rev: 0, matches: S.initial() };
}
function publicMatches(ms) {
  return ms.map(m => ({ games: m.games, p: m.p, adv: m.adv, deuceN: m.deuceN, sudden: m.sudden, done: m.done, hn: m.hist.length }));
}
async function withLock(fn) {
  const tok = String(Math.random());
  for (let k = 0; k < 25; k++) {
    const ok = await cmd(["SET", "ht:lock", tok, "NX", "PX", "3000"]);
    if (ok === "OK") {
      try { return await fn(); } finally { await cmd(["DEL", "ht:lock"]).catch(() => {}); }
    }
    await new Promise(r => setTimeout(r, 80));
  }
  throw err(503, "Server sibuk, coba lagi");
}

function apply(st, b) {
  const ms = st.matches, cur = S.currentIndex(ms);
  if (b.op === "resetall") {
    if (b.confirm !== "RESET") throw err(400, "Konfirmasi salah");
    st.matches = S.initial();
    return;
  }
  const i = Number(b.i);
  if (!Number.isInteger(i) || i < 0 || i >= S.M) throw err(400, "Match tidak valid");
  const m = ms[i];
  if (b.op === "point") {
    const s = Number(b.s);
    if (s !== 0 && s !== 1) throw err(400, "Sisi tidak valid");
    if (i !== cur) throw err(409, "Match ini bukan yang sedang main");
    m.hist.push(S.snap(m)); if (m.hist.length > 40) m.hist.shift();
    S.addPoint(m, s);
    return;
  }
  if (i !== cur && i !== cur - 1) throw err(409, "Match ini sudah lewat");
  if (b.op === "undo") {
    if (!m.hist.length) throw err(409, "Tidak ada yang bisa di-undo");
    S.restore(m, m.hist.pop());
    return;
  }
  if (b.op === "resetmatch") { ms[i] = S.fresh(); return; }
  throw err(400, "Operasi tidak dikenal");
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const st = await loadState();
      const flat = (await cmd(["HGETALL", "ht:photov"])) || [];
      const photos = {};
      for (let i = 0; i + 1 < flat.length; i += 2) photos[flat[i]] = flat[i + 1];
      return res.status(200).json({ rev: st.rev, matches: publicMatches(st.matches), photos });
    }
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!b || typeof b !== "object") throw err(400, "Body kosong");
      const out = await withLock(async () => {
        const st = await loadState();
        apply(st, b);
        st.rev = Date.now();
        await cmd(["SET", "ht:state", JSON.stringify(st)]);
        return st;
      });
      return res.status(200).json({ rev: out.rev, matches: publicMatches(out.matches) });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: String(e.message || e) });
  }
};
