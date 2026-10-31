// Sessions: storage keys, the index, and loading (with the fill-in for pre-session data). No HTTP here.
const { cmd } = require("./redis");
const S = require("./score");

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

module.exports = { LEGACY_ID, LOCK_SESSIONS, err, cleanName, keys, withLock, loadIndex, saveIndex, resolve, loadSession };
