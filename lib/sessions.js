// Sessions: storage keys, the index, and loading (with the fill-in for pre-session data). No HTTP here.
const { cmd } = require("./redis");
const S = require("./score");
const Sch = require("./schedule");

const LEGACY_ID = "halloween";
const LEGACY_NAME = "Halloween Tennis";
const LEGACY_NOTE = "Sabtu 24 Okt · Medco Ampera";
const LOCK_SESSIONS = "ht:lock:sessions";

const err = (status, message) => Object.assign(new Error(message), { status });
const cleanName = (v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

// The first session keeps the pre-session keys, so existing state and photos are used in place.
function keys(id) {
  if (id === LEGACY_ID) return { state: "ht:state", photo: (p) => "ht:photo:" + p, photov: "ht:photov", lock: "ht:lock" };
  return { state: "ht:session:" + id, photo: (p) => "ht:photo:" + id + ":" + p, photov: "ht:photov:" + id, lock: "ht:lock:" + id };
}

async function withLock(key, fn) {
  const tok = String(Math.random());
  for (let k = 0; k < 25; k++) {
    const ok = await cmd(["SET", key, tok, "NX", "PX", "3000"]);
    if (ok === "OK") {
      try { return await fn(); } finally { await cmd(["DEL", key]).catch(() => {}); }
    }
    await new Promise(r => setTimeout(r, 80));
  }
  throw err(503, "Server sibuk, coba lagi");
}

// {active, list:[{id,name,createdAt}]}. The first read creates it with the legacy session.
async function loadIndex() {
  const raw = await cmd(["GET", "ht:sessions"]);
  if (raw) return JSON.parse(raw);
  const idx = { active: LEGACY_ID, list: [{ id: LEGACY_ID, name: LEGACY_NAME, createdAt: Date.now() }] };
  await cmd(["SET", "ht:sessions", JSON.stringify(idx)]);
  return idx;
}
async function saveIndex(idx) { await cmd(["SET", "ht:sessions", JSON.stringify(idx)]); }

// A missing sid means the active session; an id that is not in the index is a 404 (this also keeps odd ids out of key names).
function resolve(idx, sid) {
  if (sid === undefined || sid === null || sid === "") return idx.active;
  if (typeof sid !== "string" || !idx.list.some(e => e.id === sid)) throw err(404, "Sesi tidak ditemukan");
  return sid;
}

async function loadSession(id, idx) {
  const raw = await cmd(["GET", keys(id).state]);
  if (!raw && id !== LEGACY_ID) throw err(404, "Sesi tidak ditemukan");
  const st = S.migrate(raw ? JSON.parse(raw) : S.initialState());
  const entry = idx.list.find(e => e.id === id);
  if (!st.config) st.config = { durationMin: 300, slotMin: 30, startTime: "17:00" };
  if (!st.name) st.name = entry ? entry.name : LEGACY_NAME;
  if (st.note === undefined) st.note = id === LEGACY_ID ? LEGACY_NOTE : "";
  if (!st.createdAt) st.createdAt = entry ? entry.createdAt : Date.now();
  if (!st.base) st.base = S.defaultBase();
  return st;
}

function validateCreate(b) {
  const name = cleanName(b.name);
  if (name.length < 1 || name.length > 40) throw err(400, "Nama sesi harus 1-40 karakter");
  if (!Array.isArray(b.players)) throw err(400, "Daftar pemain tidak valid");
  const players = b.players.map(cleanName);
  if (players.some(n => n.length < 1 || n.length > 20)) throw err(400, "Nama pemain harus 1-20 karakter");
  if (players.length < 4 || players.length > S.MAX_PLAYERS) throw err(400, "Pemain harus 4 sampai " + S.MAX_PLAYERS);
  if (new Set(players.map(n => n.toLowerCase())).size !== players.length) throw err(409, "Nama pemain tidak boleh sama");
  const durationMin = b.durationMin, slotMin = b.slotMin;
  if (!Number.isInteger(durationMin) || durationMin < 10 || durationMin > 720) throw err(400, "Durasi harus 10-720 menit");
  if (!Number.isInteger(slotMin) || slotMin < 10 || slotMin > 120) throw err(400, "Menit per match harus 10-120");
  const startTime = typeof b.startTime === "string" ? b.startTime : "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) throw err(400, "Jam mulai harus berformat HH:MM");
  const matchCount = Math.floor(durationMin / slotMin);
  if (matchCount < 1) throw err(400, "Durasi lebih pendek dari satu match");
  if (matchCount > Sch.MAX_GENERATED) throw err(400, "Maksimal " + Sch.MAX_GENERATED + " match, kurangi durasi");
  const note = typeof b.note === "string" ? cleanName(b.note).slice(0, 40) : "";
  return { name, players, durationMin, slotMin, startTime, matchCount, note };
}

function summary(id, st) {
  return {
    id, name: st.name, note: st.note, createdAt: st.createdAt, players: st.players,
    playerCount: st.players.length, matchCount: st.matches.length, doneCount: st.matches.filter(m => m.done).length,
  };
}
async function overview() {
  const idx = await loadIndex();
  const sessions = [];
  for (const e of idx.list.slice().reverse()) sessions.push(summary(e.id, await loadSession(e.id, idx)));
  return { active: idx.active, sessions };
}

// Dry run of create: same validation and generator, nothing written.
function preview(b) {
  const v = validateCreate(b);
  return { matches: Sch.generate(v.players.length, v.matchCount), matchCount: v.matchCount };
}

// Best effort: a missing or failing photo never blocks the new session.
async function copyPhotos(source, id, names) {
  const Ks = keys(source.id), Kd = keys(id);
  const lower = source.st.players.map(n => n.toLowerCase());
  for (let j = 0; j < names.length; j++) {
    const k = lower.indexOf(names[j].toLowerCase());
    if (k < 0) continue;
    try {
      const photo = await cmd(["GET", Ks.photo(k)]);
      if (!photo) continue;
      await cmd(["SET", Kd.photo(j), photo]);
      await cmd(["HSET", Kd.photov, String(j), String(Date.now())]);
    } catch (e) { /* ignore */ }
  }
}

async function createSession(b) {
  const v = validateCreate(b);
  let source = null, id, st;
  await withLock(LOCK_SESSIONS, async () => {
    const idx = await loadIndex();
    if (b.copyFrom !== undefined && b.copyFrom !== null && b.copyFrom !== "") {
      const sid = resolve(idx, b.copyFrom);
      source = { id: sid, st: await loadSession(sid, idx) };
    }
    do { id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4); } while (idx.list.some(e => e.id === id));
    const now = Date.now();
    const teams = Sch.generate(v.players.length, v.matchCount);
    st = {
      rev: now, cur: null, players: v.players.slice(), matches: teams.map(t => S.fresh(t)),
      name: v.name, note: v.note, createdAt: now,
      config: { durationMin: v.durationMin, slotMin: v.slotMin, startTime: v.startTime },
      base: { players: v.players.slice(), teams },
    };
    await cmd(["SET", keys(id).state, JSON.stringify(st)]);
    idx.list.push({ id, name: st.name, createdAt: now });
    idx.active = id;
    await saveIndex(idx);
  });
  // Outside the 3 s lock: up to 60 sequential calls, best effort.
  if (source) await copyPhotos(source, id, st.players);
}

async function activate(id) {
  if (typeof id !== "string" || !id) throw err(400, "Sesi tidak valid");
  await withLock(LOCK_SESSIONS, async () => {
    const idx = await loadIndex();
    resolve(idx, id);
    idx.active = id;
    await saveIndex(idx);
  });
}

module.exports = { LEGACY_ID, LOCK_SESSIONS, err, cleanName, keys, withLock, loadIndex, saveIndex, resolve, loadSession, overview, preview, createSession, activate };
