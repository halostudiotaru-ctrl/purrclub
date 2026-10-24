const { cmd } = require("../lib/redis");
const S = require("../lib/score");

const err = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => (typeof v === "number" ? v : NaN);
const isPlayer = (st, p) => Number.isInteger(p) && p >= 0 && p < st.players.length;
const cleanName = (v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

async function loadState() {
  const raw = await cmd(["GET", "ht:state"]);
  return S.migrate(raw ? JSON.parse(raw) : S.initialState());
}
function publicMatches(ms) {
  return ms.map(m => ({ a: m.a, b: m.b, manual: !!m.manual, games: m.games, p: m.p, adv: m.adv, deuceN: m.deuceN, sudden: m.sudden, done: m.done, hn: m.hist.length }));
}
function publicState(st) {
  return { rev: st.rev, cur: S.currentIndex(st.matches, st.cur), players: st.players, matches: publicMatches(st.matches) };
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
// After a full reset the roster is back to the defaults, so photos of manual players must go.
async function dropExtraPhotos() {
  const flat = (await cmd(["HGETALL", "ht:photov"])) || [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    if (Number(flat[i]) >= S.DEFAULT_PLAYERS.length) {
      await cmd(["DEL", "ht:photo:" + flat[i]]);
      await cmd(["HDEL", "ht:photov", flat[i]]);
    }
  }
}

function apply(st, b) {
  const ms = st.matches, cur = S.currentIndex(ms, st.cur);
  if (b.op === "resetall") {
    if (b.confirm !== "RESET") throw err(400, "Konfirmasi salah");
    const f = S.initialState();
    st.players = f.players; st.matches = f.matches; st.cur = null;
    return;
  }
  if (b.op === "addplayer") {
    const name = cleanName(b.name);
    if (name.length < 1 || name.length > 20) throw err(400, "Nama harus 1-20 karakter");
    if (st.players.length >= S.MAX_PLAYERS) throw err(409, "Jumlah pemain sudah penuh");
    if (st.players.some(n => n.toLowerCase() === name.toLowerCase())) throw err(409, "Nama sudah dipakai");
    st.players.push(name);
    return;
  }
  if (b.op === "addmatch") {
    const team = t => Array.isArray(t) && t.length === 2;
    if (!team(b.a) || !team(b.b)) throw err(400, "Tim tidak valid");
    const ids = b.a.concat(b.b).map(num);
    if (!ids.every(p => isPlayer(st, p))) throw err(400, "Pemain tidak valid");
    if (new Set(ids).size !== 4) throw err(400, "Empat pemain harus berbeda");
    ms.push(S.fresh({ a: ids.slice(0, 2), b: ids.slice(2), manual: true }));
    return;
  }
  const i = Number(b.i);
  if (!Number.isInteger(i) || i < 0 || i >= ms.length) throw err(400, "Match tidak valid");
  const m = ms[i];
  if (b.op === "setcurrent") {
    if (m.done) throw err(409, "Match ini sudah selesai");
    st.cur = i;
    return;
  }
  if (b.op === "substitute") {
    const side = num(b.side), slot = num(b.slot), p = num(b.p);
    if ((side !== 0 && side !== 1) || (slot !== 0 && slot !== 1)) throw err(400, "Posisi tidak valid");
    if (!isPlayer(st, p)) throw err(400, "Pemain tidak valid");
    if (m.done) throw err(409, "Match ini sudah selesai");
    if (m.a.concat(m.b).includes(p)) throw err(409, "Pemain itu sudah ada di match ini");
    (side === 0 ? m.a : m.b)[slot] = p;
    return;
  }
  if (b.op === "point") {
    const s = Number(b.s);
    if (s !== 0 && s !== 1) throw err(400, "Sisi tidak valid");
    if (i !== cur) throw err(409, "Match ini bukan yang sedang main");
    m.hist.push(S.snap(m)); if (m.hist.length > 40) m.hist.shift();
    S.addPoint(m, s);
    return;
  }
  if (i !== cur && !m.done && !m.hist.length) throw err(409, "Match ini belum dimulai");
  if (b.op === "undo") {
    if (!m.hist.length) throw err(409, "Tidak ada yang bisa di-undo");
    S.restore(m, m.hist.pop());
    return;
  }
  if (b.op === "resetmatch") { ms[i] = S.fresh(m); return; }
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
      return res.status(200).json({ ...publicState(st), photos });
    }
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!b || typeof b !== "object") throw err(400, "Body kosong");
      const out = await withLock(async () => {
        const st = await loadState();
        apply(st, b);
        st.rev = Date.now();
        await cmd(["SET", "ht:state", JSON.stringify(st)]);
        if (b.op === "resetall") await dropExtraPhotos();
        return st;
      });
      return res.status(200).json(publicState(out));
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: String(e.message || e) });
  }
};
