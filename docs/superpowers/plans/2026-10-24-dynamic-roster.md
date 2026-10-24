# Dynamic Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone substitute a player in a scheduled match, add an impromptu doubles game, and add a new player by name, with manual games and players appearing in the klasemen and getting recaps.

**Architecture:** The server owns the roster (`players`) and the match list (each match stores its own teams `a`/`b`). The client adopts both from every poll instead of using hard-coded `PLAYERS`/`FIXED`. Legacy stored state is migrated on load. New server ops: `substitute`, `addplayer`, `addmatch`; `resetall` restores the defaults.

**Tech Stack:** Vanilla JS client in `index.html` (Polaris web components `s-*`), Vercel serverless functions (`api/*.js`, CommonJS), Upstash Redis REST, `node:test` (server tests) and Playwright (`tests/ui`, existing harness).

**Spec:** `docs/superpowers/specs/2026-10-24-dynamic-roster-design.md`

## Global Constraints

- Substitute: per match, replaces one player; the whole match is credited to the new player. Finished matches cannot be edited. A match with points can be.
- Manual game: doubles 2 vs 2, four distinct players, same scoring (first to 4 games, one deuce then sudden death), appended to the end of the schedule.
- Manual player: name only, 1-20 chars, unique case-insensitively, max 20 players (`MAX_PLAYERS = 20`).
- No PIN or roles.
- "Hapus semua skor" (type RESET) restores the original 10 players and schedule, removes manual players, games and substitutions, and deletes photos of players with index >= 10.
- UI copy is Indonesian, matching the existing app. Use the existing `btn()` helper and Polaris `s-*` components; no new CSS framework.
- The 56 existing Playwright tests (`cd tests/ui && npm test`) must keep passing.
- Server code is CommonJS, no new dependencies.

## File Structure

- `lib/score.js` (modify): default roster constants, `fresh(t)` that carries teams, `initialState`, `migrate`, `currentIndex` using `ms.length`.
- `api/state.js` (modify): load+migrate, public payload with `players`/teams, new ops, `resetall` photo cleanup.
- `api/photo.js` (modify): bound the photo index by `MAX_PLAYERS`.
- `tests/api/state.test.mjs` (create): server ops, migration, reset, photo bounds, with an in-memory Redis stub.
- `index.html` (modify): dynamic roster, substitute modal, add-player and add-game modals, toolbar, labels.
- `tests/ui/fakeapi.mjs` (create): serves the real `/api/state` handler from memory for Playwright.
- `tests/ui/roster.test.mjs` (create): substitute, manual player, manual game, klasemen, recap.
- `README.md` (modify): document the new features and the test commands.

---

### Task 1: Server model, ops and tests

**Files:**
- Modify: `lib/score.js`
- Modify: `api/state.js`
- Modify: `api/photo.js`
- Create: `tests/api/state.test.mjs`

**Interfaces:**
- Produces (`lib/score.js` exports): `DEFAULT_PLAYERS: string[10]`, `MAX_PLAYERS = 20`, `fresh({a,b,manual}) -> match`, `initial() -> match[10]`, `initialState() -> {rev:0,cur:null,players,matches}`, `migrate(st) -> st`, `currentIndex(ms, cur) -> number` (returns `ms.length` when all done).
- Produces (HTTP): `GET /api/state` and `POST /api/state` both return `{rev, cur, players: string[], matches: [{a:[n,n], b:[n,n], manual:boolean, games:[n,n], p:[n,n], adv, deuceN, sudden, done, hn}]}`; GET also returns `photos`.
- Produces (ops, `POST` body `op`): `substitute {i,side,slot,p}`, `addplayer {name}`, `addmatch {a:[x,y], b:[z,w]}`; existing ops unchanged. Errors are `{error}` with status 400 (invalid input) or 409 (rule violation).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/state.test.mjs`:

```js
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const kv = new Map();
const hs = new Map();
const hashOf = (k) => hs.get(k) || hs.set(k, new Map()).get(k);

// In-memory stand-in for lib/redis.js (must be installed before api/state.js is loaded).
require.cache[require.resolve("../../lib/redis.js")] = {
  id: "redis-stub", filename: "redis-stub", loaded: true,
  exports: {
    cmd: async (a) => {
      const [op, k, v] = a;
      if (op === "GET") return kv.has(k) ? kv.get(k) : null;
      if (op === "SET") { if (a[3] === "NX" && kv.has(k)) return null; kv.set(k, v); return "OK"; }
      if (op === "DEL") { kv.delete(k); return 1; }
      if (op === "HSET") { hashOf(k).set(a[2], a[3]); return 1; }
      if (op === "HDEL") { hashOf(k).delete(a[2]); return 1; }
      if (op === "HGETALL") return [...hashOf(k)].flat();
      throw new Error("stub: unsupported " + op);
    },
  },
};

const S = require("../../lib/score.js");
const stateHandler = require("../../api/state.js");
const photoHandler = require("../../api/photo.js");

async function call(handler, req) {
  let out;
  const res = { setHeader() {}, status(c) { out = { status: c }; return { json(j) { out.body = j; } }; } };
  await handler(req, res);
  return out;
}
const get = () => call(stateHandler, { method: "GET" });
const post = (body) => call(stateHandler, { method: "POST", body });
const play = async (i, n) => { for (let k = 0; k < n; k++) await post({ op: "point", i, s: 0 }); };

beforeEach(() => { kv.clear(); hs.clear(); });

test("fresh state: 10 default players, 10 matches with teams from the fixed schedule", async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.body.players.length, 10);
  assert.equal(r.body.players[0], "Angel");
  assert.equal(r.body.matches.length, 10);
  assert.deepEqual(r.body.matches[0].a, [1, 2]);
  assert.deepEqual(r.body.matches[0].b, [9, 7]);
  assert.equal(r.body.matches[0].manual, false);
});

test("legacy state without players/teams is migrated and keeps its scores", async () => {
  const ms = S.initial().map((m) => { delete m.a; delete m.b; delete m.manual; return m; });
  ms[0].games = [2, 1];
  kv.set("ht:state", JSON.stringify({ rev: 5, matches: ms }));
  const r = await get();
  assert.equal(r.body.players.length, 10);
  assert.deepEqual(r.body.matches[0].a, [1, 2]);
  assert.deepEqual(r.body.matches[0].games, [2, 1]);
  assert.equal(r.body.rev, 5);
});

test("substitute replaces one player and keeps the score", async () => {
  await post({ op: "setcurrent", i: 1 });
  await post({ op: "point", i: 1, s: 0 });
  const r = await post({ op: "substitute", i: 1, side: 0, slot: 0, p: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.matches[1].a, [1, 8]);
  assert.deepEqual(r.body.matches[1].p, [1, 0]);
});

test("substitute rejects: player already in match, finished match, bad input", async () => {
  assert.equal((await post({ op: "substitute", i: 1, side: 0, slot: 0, p: 8 })).status, 409);
  assert.equal((await post({ op: "substitute", i: 1, side: 0, slot: 0, p: 99 })).status, 400);
  assert.equal((await post({ op: "substitute", i: 1, side: 2, slot: 0, p: 1 })).status, 400);
  assert.equal((await post({ op: "substitute", i: 1, side: 0, slot: 0, p: null })).status, 400);
  await play(0, 16);
  assert.equal((await post({ op: "substitute", i: 0, side: 0, slot: 0, p: 4 })).status, 409);
});

test("addplayer: appends, trims, rejects duplicates (case-insensitive), empty, long, and a full roster", async () => {
  const r = await post({ op: "addplayer", name: "  Tamu  " });
  assert.equal(r.status, 200);
  assert.equal(r.body.players[10], "Tamu");
  assert.equal((await post({ op: "addplayer", name: "tamu" })).status, 409);
  assert.equal((await post({ op: "addplayer", name: "ANGEL" })).status, 409);
  assert.equal((await post({ op: "addplayer", name: "   " })).status, 400);
  assert.equal((await post({ op: "addplayer", name: "x".repeat(21) })).status, 400);
  assert.equal((await post({ op: "addplayer", name: 5 })).status, 400);
  for (let n = 11; n < S.MAX_PLAYERS; n++) assert.equal((await post({ op: "addplayer", name: "P" + n })).status, 200);
  assert.equal((await post({ op: "addplayer", name: "Terlalu banyak" })).status, 409);
});

test("addmatch appends a manual match that can be played to the end", async () => {
  await post({ op: "addplayer", name: "Tamu" });
  const r = await post({ op: "addmatch", a: [10, 0], b: [1, 2] });
  assert.equal(r.status, 200);
  assert.equal(r.body.matches.length, 11);
  assert.equal(r.body.matches[10].manual, true);
  assert.deepEqual(r.body.matches[10].a, [10, 0]);
  await post({ op: "setcurrent", i: 10 });
  await play(10, 16);
  const g = await get();
  assert.equal(g.body.matches[10].done, true);
  assert.deepEqual(g.body.matches[10].games, [4, 0]);
});

test("addmatch rejects duplicates, unknown players and malformed teams", async () => {
  assert.equal((await post({ op: "addmatch", a: [0, 1], b: [1, 2] })).status, 400);
  assert.equal((await post({ op: "addmatch", a: [0, 1], b: [2, 99] })).status, 400);
  assert.equal((await post({ op: "addmatch", a: [0, 1], b: [2] })).status, 400);
  assert.equal((await post({ op: "addmatch", a: "01", b: [2, 3] })).status, 400);
  assert.equal((await post({ op: "addmatch", a: [0, 1], b: [2, null] })).status, 400);
});

test("resetmatch keeps the (substituted) teams", async () => {
  await post({ op: "substitute", i: 1, side: 0, slot: 0, p: 1 });
  await post({ op: "setcurrent", i: 1 });
  await post({ op: "point", i: 1, s: 0 });
  const r = await post({ op: "resetmatch", i: 1 });
  assert.deepEqual(r.body.matches[1].a, [1, 8]);
  assert.deepEqual(r.body.matches[1].p, [0, 0]);
});

test("resetall restores defaults and deletes photos of manual players only", async () => {
  await post({ op: "addplayer", name: "Tamu" });
  await post({ op: "addmatch", a: [10, 0], b: [1, 2] });
  kv.set("ht:photo:10", "x"); hashOf("ht:photov").set("10", "1");
  kv.set("ht:photo:3", "y"); hashOf("ht:photov").set("3", "1");
  assert.equal((await post({ op: "resetall", confirm: "nope" })).status, 400);
  const r = await post({ op: "resetall", confirm: "RESET" });
  assert.equal(r.status, 200);
  assert.equal(r.body.players.length, 10);
  assert.equal(r.body.matches.length, 10);
  assert.equal(kv.has("ht:photo:10"), false);
  assert.equal(hashOf("ht:photov").has("10"), false);
  assert.equal(kv.get("ht:photo:3"), "y");
  assert.equal(hashOf("ht:photov").get("3"), "1");
});

test("photo api accepts indexes below MAX_PLAYERS only", async () => {
  assert.equal((await call(photoHandler, { method: "GET", query: { p: "15" } })).status, 200);
  assert.equal((await call(photoHandler, { method: "GET", query: { p: String(S.MAX_PLAYERS) } })).status, 400);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/api/state.test.mjs`
Expected: FAIL (e.g. `r.body.players` is undefined, `S.MAX_PLAYERS` is undefined).

- [ ] **Step 3: Update `lib/score.js`**

Replace the top of the file (through `initial`) and `currentIndex`/exports. The final file:

```js
// Jadwal awal + aturan skor (dipakai server; klien memakai salinan logika yang sama).
const DEFAULT_PLAYERS = ["Angel", "Faiz", "Bella", "Fai", "Dian", "Aryo", "Aya", "Rini", "Norman", "Fran"];
const MAX_PLAYERS = 20;
const FIXED = [1,2,9,7,0,8,6,3,7,2,4,5,1,6,3,9,0,5,8,4,7,3,9,6,2,5,0,1,7,4,8,9,6,0,5,1,8,3,4,2];
const M = 10;

function teams(i) { const f = FIXED.slice(i * 4, i * 4 + 4); return { a: [f[0], f[1]], b: [f[2], f[3]] }; }
function players(i) { const t = teams(i); return t.a.concat(t.b); }
// t = { a:[p,p], b:[p,p], manual? }. Teams live on the match so substitutions and manual games are possible.
function fresh(t) {
  return { a: t.a.slice(), b: t.b.slice(), manual: !!t.manual, games: [0, 0], p: [0, 0], adv: null, deuceN: 0, sudden: false, done: false, hist: [] };
}
function initial() { return Array.from({ length: M }, (_, i) => fresh(teams(i))); }
function initialState() { return { rev: 0, cur: null, players: DEFAULT_PLAYERS.slice(), matches: initial() }; }
// State saved before teams/players were stored: fill them in from the fixed schedule.
function migrate(st) {
  if (!Array.isArray(st.players)) st.players = DEFAULT_PLAYERS.slice();
  st.matches.forEach((m, i) => { if (!m.a) { const t = teams(i); m.a = t.a; m.b = t.b; } });
  return st;
}

function snap(m) { return JSON.stringify({ games: m.games, p: m.p, adv: m.adv, deuceN: m.deuceN, sudden: m.sudden, done: m.done }); }
function restore(m, s) { const o = JSON.parse(s); m.games = o.games; m.p = o.p; m.adv = o.adv; m.deuceN = o.deuceN; m.sudden = o.sudden; m.done = o.done; }

function winGame(m, s) {
  m.games[s]++; m.p = [0, 0]; m.adv = null; m.deuceN = 0; m.sudden = false;
  if (m.games[s] >= 4) m.done = true;
}
function addPoint(m, s) {
  if (m.sudden) { winGame(m, s); }
  else if (m.adv !== null) {
    if (m.adv === s) winGame(m, s);
    else { m.adv = null; m.deuceN++; if (m.deuceN >= 2) m.sudden = true; }
  }
  else if (m.p[0] === 3 && m.p[1] === 3) { m.adv = s; }
  else {
    m.p[s]++;
    if (m.p[s] >= 4) winGame(m, s);
    else if (m.p[0] === 3 && m.p[1] === 3) m.deuceN = 1;
  }
}
// Match yang sedang main = pilihan manual (cur) bila valid dan belum selesai,
// jika tidak, match pertama yang belum selesai (ms.length jika semua selesai).
function currentIndex(ms, cur) {
  if (Number.isInteger(cur) && cur >= 0 && cur < ms.length && !ms[cur].done) return cur;
  for (let i = 0; i < ms.length; i++) if (!ms[i].done) return i;
  return ms.length;
}

module.exports = { FIXED, M, DEFAULT_PLAYERS, MAX_PLAYERS, players, fresh, initial, initialState, migrate, snap, restore, addPoint, currentIndex };
```

- [ ] **Step 4: Update `api/state.js` and `api/photo.js`**

Replace `api/state.js` entirely:

```js
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
```

In `api/photo.js`, add `const { MAX_PLAYERS } = require("../lib/score");` below the redis require, and change both bounds checks from `p > 9` to `p >= MAX_PLAYERS`:

```js
const { cmd } = require("../lib/redis");
const { MAX_PLAYERS } = require("../lib/score");
// ...
if (!Number.isInteger(p) || p < 0 || p >= MAX_PLAYERS) return res.status(400).json({ error: "p tidak valid" });
```

(The line appears twice, once in GET and once in POST; change both.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/api/state.test.mjs`
Expected: PASS, 10 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add lib/score.js api/state.js api/photo.js tests/api/state.test.mjs
git commit -m "feat(api): server-owned roster with substitute, addplayer, addmatch

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Client adopts the dynamic roster

No new UI yet. After this task the app behaves as before, but roster and teams come from the server and nothing assumes 10 matches or 10 players.

**Files:**
- Modify: `index.html` (script block, roughly lines 243-300, 357-361, 513-520, 525-560, 578-598, 632, 723-726)

**Interfaces:**
- Consumes: the `GET`/`POST /api/state` payload from Task 1 (`{rev, cur, players, matches[{a,b,manual,...}]}`).
- Produces: `PLAYERS` is reassigned to `state.players` by `adopt()`; `state.matches[i]` has `{a,b,manual,games,p,adv,deuceN,sudden,done,hn}`; `sendOp(body)` resolves to `true` on success and `false` on failure; `matchLabel(m,i)` returns `"Game manual"` or the time slot.

- [ ] **Step 1: Confirm the baseline is green**

Run: `cd tests/ui && npm test`
Expected: 56 pass, 0 fail.

- [ ] **Step 2: Constants and bootstrap state**

Replace lines 243-246 (`PLAYERS`, `N`/`M`/`KEY`, `BASE`, `FIXED`):

```js
var DEFAULT_PLAYERS=["Angel","Faiz","Bella","Fai","Dian","Aryo","Aya","Rini","Norman","Fran"];
var PLAYERS=DEFAULT_PLAYERS.slice();
var DEFAULT_M=10,KEY="halloween-tennis-v3",MEKEY="halloween-tennis-me-v1";
var BASE="https://claude.ai/artifact/UFPGpWiytzJERZ9XPK2Xsf";
var FIXED=[1,2,9,7,0,8,6,3,7,2,4,5,1,6,3,9,0,5,8,4,7,3,9,6,2,5,0,1,7,4,8,9,6,0,5,1,8,3,4,2];
```

Run `grep -n "\bN\b" index.html` and confirm `N` is not referenced anywhere else (it was only declared). If it is referenced, replace those uses with `PLAYERS.length`.

Replace `freshMatch` and `fixedSchedule` (the offline bootstrap, used until the first poll succeeds):

```js
function freshMatch(f){return {a:[f[0],f[1]],b:[f[2],f[3]],manual:false,games:[0,0],p:[0,0],adv:null,deuceN:0,sudden:false,done:false,hn:0}}
function fixedSchedule(){var ms=[];for(var m=0;m<DEFAULT_M;m++)ms.push(freshMatch(FIXED.slice(m*4,m*4+4)));return {players:DEFAULT_PLAYERS.slice(),cur:null,matches:ms}}
function matchLabel(m,i){return m.manual?"Game manual":slotTime(i)}
```

Replace `load` (keep the same `KEY`, so cached state from the previous version still loads):

```js
function load(){try{var r=localStorage.getItem(KEY);if(r){var s=JSON.parse(r);if(s&&s.matches&&s.matches.length>=1){if(!Array.isArray(s.players))s.players=DEFAULT_PLAYERS.slice();return s}}}catch(e){}return null}
```

- [ ] **Step 3: `adopt`, `sendOp`, `pull`**

Replace `adopt`:

```js
function fixMe(){if(me.p!==null&&me.p>=PLAYERS.length){me.p=null;me.photo=null;saveMe()}}
function adopt(r){
  state.cur=typeof r.cur==="number"?r.cur:null;
  if(Array.isArray(r.players))state.players=r.players;
  PLAYERS=state.players;
  state.matches=r.matches.map(function(m,i){
    var old=state.matches[i]||{};
    return {a:m.a||old.a||[0,1],b:m.b||old.b||[2,3],manual:!!m.manual,games:m.games,p:m.p,adv:m.adv,deuceN:m.deuceN,sudden:m.sudden,done:m.done,hn:m.hn||0};
  });
  fixMe();
  try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}
}
```

(The `old.a` fallback only keeps older API mocks without teams working.)

In `sendOp`, change the success handler to `adopt(r)` and return booleans:

```js
function sendOp(body){
  inflight++;
  return api("/api/state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){setOnline(true);inflight--;if(inflight===0){adopt(r);rev=r.rev;render()}return true})
    .catch(function(e){
      inflight--;
      if(e.status&&e.status<500){toast(e.message)}else{setOnline(false);toast("Gagal kirim skor, cek koneksi")}
      pull(true);
      return false;
    });
}
```

In `pull`, change `adopt(s.matches,s.cur)` to `adopt(s)`:

```js
if(s.matches&&(inflight===0||force)&&s.rev!==rev){adopt(s);rev=s.rev;changed=true}
```

- [ ] **Step 4: Replace the remaining `M` uses and add labels**

`curIdx`, `firstOpen`, and the `setCurrent` toast:

```js
function curIdx(){var i=firstOpen();return i<0?state.matches.length:i}
```
```js
function setCurrent(i){var m=state.matches[i];if(m.done||i===curIdx())return;state.cur=i;render();sendOp({op:"setcurrent",i:i,p:me.p}).then(function(ok){if(ok)toast("Match "+(i+1)+" sedang main")})}
```
```js
function firstOpen(){var n=state.matches.length,c=state.cur;if(typeof c==="number"&&c>=0&&c<n&&!state.matches[c].done)return c;for(var i=0;i<n;i++)if(!state.matches[i].done)return i;return -1}
```

In `renderJadwal`, the card heading uses the label:

```js
h+='<s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="small"><s-heading>Match '+(i+1)+' · '+matchLabel(m,i)+'</s-heading><s-badge tone="'+tone+'">'+label+'</s-badge></s-stack>';
```

In `renderPemain`, the slot text:

```js
slots.push("Match "+(i+1)+" ("+(m.manual?"game manual":slotTime(i).split("–")[0])+")");
```

In `renderKlasemen`, replace the closing note text `Tiap pemain dijadwalkan sama: 4 match.` with `Kolom Main: match selesai / total match pemain, termasuk game manual.` so the line reads:

```js
h+='</s-table-body></s-table></s-section><p class="note">Urutan: jumlah menang, lalu selisih game. Kolom Main: match selesai / total match pemain, termasuk game manual.</p></div></div>';
```

In `drawRecap`, make the rank box dynamic:

```js
var boxes=[["Menang–kalah",d.w+"–"+d.l],["Game menang–kalah",d.gw+"–"+d.gl],["Selisih game",(d.diff>0?"+":"")+d.diff],["Peringkat dari "+PLAYERS.length,"#"+d.rank]];
```

- [ ] **Step 5: Startup**

Replace the two startup lines:

```js
state=load()||fixedSchedule();
PLAYERS=state.players;
fixMe();
render();
```

(`me=loadMe();` and the photo line above stay as they are. Make sure `fixMe()` runs after `state` is set and before `render()`.)

- [ ] **Step 6: Verify nothing regressed**

Run: `grep -n "\bM\b" index.html` — expected: no matches in the script (only unrelated text, if any).
Run: `cd tests/ui && npm test`
Expected: 56 pass, 0 fail.
Run: `node --test tests/api/state.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "refactor(ui): adopt roster and match teams from the server

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Substitute a player (UI) and the fake-API test harness

**Files:**
- Modify: `index.html`
- Create: `tests/ui/fakeapi.mjs`
- Create: `tests/ui/roster.test.mjs`

**Interfaces:**
- Consumes: `sendOp` (resolves boolean), `openModal(heading, bodyHtml, {secondary, primary, size})`, `closeModal()`, `btn(attrs,label)`, `avatar(p,size)`, `PLAYERS`, `state.matches[i].a/.b`, server op `substitute {i,side,slot,p}`.
- Produces: `pickBtn(attrs, p, sel) -> html` (a player `s-clickable.pickItem`, reused in Task 4); `subCtx`; `data-sub="<i>"` button on every unfinished match card; modal actions `subpick` (`data-side`, `data-slot`) and `subto` (`data-p`). Test helpers: `fakeApi() -> routes[]` for `open({routes})` (serves the real `api/state.js` from memory) and `waitLive(page)`.

- [ ] **Step 1: Write the fake API helper**

Create `tests/ui/fakeapi.mjs`:

```js
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const kv = new Map();
const hs = new Map();
const hashOf = (k) => hs.get(k) || hs.set(k, new Map()).get(k);

// In-memory stand-in for lib/redis.js, installed before api/state.js is loaded.
require.cache[require.resolve("../../lib/redis.js")] = {
  id: "redis-stub", filename: "redis-stub", loaded: true,
  exports: {
    cmd: async (a) => {
      const [op, k, v] = a;
      if (op === "GET") return kv.has(k) ? kv.get(k) : null;
      if (op === "SET") { if (a[3] === "NX" && kv.has(k)) return null; kv.set(k, v); return "OK"; }
      if (op === "DEL") { kv.delete(k); return 1; }
      if (op === "HSET") { hashOf(k).set(a[2], a[3]); return 1; }
      if (op === "HDEL") { hashOf(k).delete(a[2]); return 1; }
      if (op === "HGETALL") return [...hashOf(k)].flat();
      throw new Error("stub: unsupported " + op);
    },
  },
};
const handler = require("../../api/state.js");

const json = (route, status, body) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

// Route entries for open({ routes }): the real /api/state handler backed by memory, and photos that are always empty.
export function fakeApi() {
  kv.clear(); hs.clear();
  return [
    [/\/api\/state(\?|$)/, async (route) => {
      const req = route.request();
      const out = { status: 200, body: {} };
      const res = { setHeader() {}, status(c) { out.status = c; return { json(j) { out.body = j; } }; } };
      await handler({ method: req.method(), body: req.postData() || undefined }, res);
      await json(route, out.status, out.body);
    }],
    [/\/api\/photo/, (route) => json(route, 200, { photo: null })],
  ];
}

// Wait until the first poll succeeded so the page is showing server state.
export const waitLive = (page) =>
  page.waitForFunction(() => ((document.getElementById("sync") || {}).textContent || "").includes("Live"));
```

- [ ] **Step 2: Write the failing test**

Create `tests/ui/roster.test.mjs`:

```js
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown, waitModal } from "./helpers.mjs";
import { fakeApi, waitLive } from "./fakeapi.mjs";

after(teardown);

const teamsText = (page, i) => page.locator(".match").nth(i).locator("s-grid").first().textContent();

test("substitute: replace a player in an unfinished match", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  assert.equal(await page.locator("[data-sub]").count(), 10);
  await page.click('[data-sub="1"]');
  await waitModal(page, true);
  // match 2 is Angel & Norman vs Aya & Fai; replace Angel (side 0, slot 0)
  await page.click('s-modal [data-act="subpick"][data-side="0"][data-slot="0"]');
  // substitutes exclude the four players already in the match
  assert.equal(await page.locator('s-modal [data-act="subto"]').count(), 6);
  await page.click('s-modal [data-act="subto"][data-p="1"]'); // Faiz
  await waitModal(page, false);
  await page.waitForFunction(() => document.querySelectorAll(".match")[1].querySelector("s-grid").textContent.includes("Faiz"));
  const t = await teamsText(page, 1);
  assert.ok(t.includes("Faiz") && !t.includes("Angel"), t);
  assert.deepEqual(errors, []);
  await ctx.close();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd tests/ui && node --test roster.test.mjs`
Expected: FAIL (`[data-sub]` count is 0).

- [ ] **Step 4: Implement the substitute UI in `index.html`**

Add a shared player-button helper and the two modal steps right after `pickPlayer()` (in the "avatar & profil" section):

```js
function pickBtn(attrs,p,sel){
  return '<s-clickable class="pickItem'+(sel?' sel':'')+'" '+attrs+' accessibilityLabel="'+esc(PLAYERS[p])+'"><s-stack direction="inline" alignItems="center" gap="small">'+avatar(p,32)+'<s-text type="strong">'+esc(PLAYERS[p])+'</s-text></s-stack></s-clickable>';
}
var subCtx=null;
function subPickModal(i){
  subCtx={i:i,side:null,slot:null};
  var m=state.matches[i],h='<s-paragraph color="subdued">Siapa yang diganti di Match '+(i+1)+'?</s-paragraph><div class="pick">';
  [[0,0],[0,1],[1,0],[1,1]].forEach(function(x){
    var p=(x[0]===0?m.a:m.b)[x[1]];
    h+=pickBtn('data-act="subpick" data-side="'+x[0]+'" data-slot="'+x[1]+'"',p,false);
  });
  openModal("Ganti pemain",h+'</div>',{secondary:{act:"close",label:"Batal"}});
}
function subToModal(){
  var m=state.matches[subCtx.i],inM=m.a.concat(m.b),h='<s-paragraph color="subdued">Diganti oleh siapa?</s-paragraph><div class="pick">';
  PLAYERS.forEach(function(n,p){if(inM.indexOf(p)<0)h+=pickBtn('data-act="subto" data-p="'+p+'"',p,false)});
  openModal("Pilih pengganti",h+'</div>',{secondary:{act:"close",label:"Batal"}});
}
```

In `renderJadwal`, replace the single `setcur` line:

```js
    if(!m.done&&!live)h+='<s-stack direction="inline" gap="small">'+btn('variant="secondary" data-setcur="'+i+'"','Jadikan sedang main')+'</s-stack>';
```

with:

```js
    if(!m.done){
      var mgmt=btn('variant="secondary" data-sub="'+i+'"','Ganti pemain');
      if(!live)mgmt+=btn('variant="secondary" data-setcur="'+i+'"','Jadikan sedang main');
      h+='<s-stack direction="inline" gap="small">'+mgmt+'</s-stack>';
    }
```

In the `modal` `hide` listener, clear the context (add as the first statement inside the listener):

```js
subCtx=null;
```

In the click handler, add next to the other `dataset` checks (before `if(t.dataset.tab)`):

```js
  if(t.dataset.sub){subPickModal(+t.dataset.sub);return}
```

and in the `a===` chain:

```js
  else if(a==="subpick"&&subCtx){subCtx.side=+t.dataset.side;subCtx.slot=+t.dataset.slot;subToModal()}
  else if(a==="subto"&&subCtx){
    var sc=subCtx,sp=+t.dataset.p;
    closeModal();
    sendOp({op:"substitute",i:sc.i,side:sc.side,slot:sc.slot,p:sp}).then(function(ok){if(ok)toast("Pemain diganti: "+PLAYERS[sp])});
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tests/ui && node --test roster.test.mjs`
Expected: PASS.
Run: `cd tests/ui && npm test`
Expected: all pass (56 existing + 1 new).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/ui/fakeapi.mjs tests/ui/roster.test.mjs
git commit -m "feat(ui): substitute a player in a scheduled match

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Manual player, manual game, klasemen and recap, docs

**Files:**
- Modify: `index.html`
- Modify: `tests/ui/roster.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: `pickBtn`, `sendOp` (boolean), `openModal`, `closeModal`, `paintGame`-less existing helpers; server ops `addplayer {name}`, `addmatch {a,b}`.
- Produces: toolbar buttons `data-act="addgame"` and `data-act="addplayer"`; modals with `#npIn` (new player name, action `npok`) and the game picker (`data-act="gametoggle"` with `data-p`, `#gpIn` with action `gameaddplayer`, primary `gamego`, disabled until four players are picked).

- [ ] **Step 1: Write the failing test**

Append to `tests/ui/roster.test.mjs`:

```js
test("manual player and manual game appear in klasemen; the new player has a recap", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi(), block: [/fonts\.g(oogleapis|static)\.com/] });
  await waitLive(page);

  // new player (index 10)
  await page.click('[data-act="addplayer"]');
  await waitModal(page, true);
  await page.fill("s-text-field#npIn input", "Tamu");
  await page.click('[data-act="npok"]');
  await waitModal(page, false);
  await page.waitForFunction(() => document.getElementById("pemain").textContent.includes("Tamu"));

  // manual game: Tamu & Angel vs Faiz & Bella; the start button needs four players
  await page.click('[data-act="addgame"]');
  await waitModal(page, true);
  assert.notEqual(await page.locator('s-modal [data-act="gamego"]').getAttribute("disabled"), null);
  for (const p of [10, 0, 1, 2]) await page.click(`s-modal [data-act="gametoggle"][data-p="${p}"]`);
  assert.equal(await page.locator('s-modal [data-act="gamego"]').getAttribute("disabled"), null);
  await page.click('s-modal [data-act="gamego"]');
  await waitModal(page, false);
  await page.waitForFunction(() => document.querySelectorAll(".match").length === 11);
  assert.ok((await page.locator(".match").nth(10).textContent()).includes("Game manual"));

  // play it: make it live, Tamu & Angel win 4-0
  await page.click('[data-setcur="10"]');
  for (let k = 0; k < 16; k++) await page.click('[data-pt="10:0"]');
  await page.waitForFunction(() => document.querySelectorAll(".match")[10].textContent.includes("Selesai"));

  // klasemen has a row for Tamu with 1/1 played, and a recap that renders
  await page.click('[data-tab="klasemen"]');
  const row = page.locator("#klasemen s-table-row", { hasText: "Tamu" });
  assert.equal(await row.count(), 1);
  assert.ok((await row.textContent()).includes("1/1"));
  await page.click('#klasemen [data-act="recap"][data-p="10"]');
  await waitModal(page, true);
  await page.waitForSelector("#rbox img", { timeout: 10000 });
  assert.ok((await page.locator("#modal").getAttribute("heading")).includes("Tamu"));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("game modal can add a new player inline and keeps the picks", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  await page.click('[data-act="addgame"]');
  await waitModal(page, true);
  await page.click('s-modal [data-act="gametoggle"][data-p="0"]');
  await page.fill("s-text-field#gpIn input", "Budi");
  await page.click('s-modal [data-act="gameaddplayer"]');
  await page.waitForSelector('s-modal [data-act="gametoggle"][data-p="10"]');
  assert.ok((await page.locator('s-modal [data-act="gametoggle"][data-p="0"]').getAttribute("class")).includes("sel"));
  assert.deepEqual(errors, []);
  await ctx.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests/ui && node --test roster.test.mjs`
Expected: the two new tests FAIL (`[data-act="addplayer"]` not found).

- [ ] **Step 3: CSS and toolbar**

Next to `s-banner.gap{display:block;margin-bottom:16px}` add:

```css
s-stack.toolbar{display:flex;flex-wrap:wrap;margin-bottom:16px}
```

In `renderJadwal`, change the first line so the toolbar sits between the banner and the cards:

```js
  var cur=firstOpen(),h=banner()+'<s-stack class="toolbar" direction="inline" gap="small">'+btn('variant="secondary" data-act="addgame"','+ Game manual')+btn('variant="secondary" data-act="addplayer"','+ Pemain baru')+'</s-stack><div class="matches">';
```

- [ ] **Step 4: New-player and manual-game modals**

Add after `subToModal()`:

```js
function readName(id){return (($(id)||{}).value||"").trim().replace(/\s+/g," ")}
function addPlayerModal(){
  openModal("Pemain baru",'<s-text-field id="npIn" label="Nama pemain" placeholder="Nama" maxlength="20" autocomplete="off"></s-text-field>',{secondary:{act:"close",label:"Batal"},primary:{act:"npok",label:"Tambah"}});
}
var gameCtx=null;
function gameModal(){
  gameCtx={sel:[]};
  openModal("Game manual",'<div id="gameBody"></div>',{secondary:{act:"close",label:"Batal"},primary:{act:"gamego",label:"Mulai game"}});
  paintGame();
}
function paintGame(){
  var box=$("gameBody");if(!box||!gameCtx)return;
  var keep=($("gpIn")||{}).value||"";
  var sel=gameCtx.sel=gameCtx.sel.filter(function(p){return p<PLAYERS.length});
  function nameAt(k){return sel[k]!==undefined?PLAYERS[sel[k]]:"…"}
  var h='<s-stack gap="base"><s-paragraph color="subdued">Pilih 4 pemain. Dua yang pertama jadi Tim A, dua berikutnya Tim B. Ketuk lagi untuk batal.</s-paragraph>';
  h+='<s-text type="strong">Tim A: '+esc(nameAt(0)+" & "+nameAt(1))+'</s-text><s-text type="strong">Tim B: '+esc(nameAt(2)+" & "+nameAt(3))+'</s-text><div class="pick">';
  PLAYERS.forEach(function(n,p){h+=pickBtn('data-act="gametoggle" data-p="'+p+'"',p,sel.indexOf(p)>=0)});
  h+='</div><s-stack direction="inline" gap="small" alignItems="end"><s-text-field id="gpIn" label="Pemain baru" placeholder="Nama" maxlength="20" autocomplete="off"></s-text-field>'+btn('variant="secondary" data-act="gameaddplayer"','Tambah')+'</s-stack></s-stack>';
  box.innerHTML=h;
  var f=$("gpIn");if(f)f.value=keep;
  var go=modal.querySelector('[data-act="gamego"]');if(go)go.toggleAttribute("disabled",sel.length!==4);
}
```

In the `modal` `hide` listener, next to `subCtx=null;` add:

```js
gameCtx=null;
```

- [ ] **Step 5: Click and keyboard handlers**

In the `a===` chain of the click handler add:

```js
  else if(a==="addplayer"){addPlayerModal()}
  else if(a==="npok"){
    var nn=readName("npIn");
    if(!nn){toast("Isi namanya dulu");return}
    closeModal();
    sendOp({op:"addplayer",name:nn}).then(function(ok){if(ok)toast("Pemain ditambahkan: "+nn)});
  }
  else if(a==="addgame"){gameModal()}
  else if(a==="gametoggle"&&gameCtx){
    var gp=+t.dataset.p,gi=gameCtx.sel.indexOf(gp);
    if(gi>=0)gameCtx.sel.splice(gi,1);else if(gameCtx.sel.length<4)gameCtx.sel.push(gp);
    paintGame();
  }
  else if(a==="gameaddplayer"&&gameCtx){
    var gn=readName("gpIn");
    if(!gn){toast("Isi namanya dulu");return}
    sendOp({op:"addplayer",name:gn}).then(function(ok){if(ok){toast("Pemain ditambahkan: "+gn);var f=$("gpIn");if(f)f.value="";paintGame()}});
  }
  else if(a==="gamego"&&gameCtx){
    var gs=gameCtx.sel.slice();
    if(gs.length!==4)return;
    closeModal();
    sendOp({op:"addmatch",a:[gs[0],gs[1]],b:[gs[2],gs[3]]}).then(function(ok){if(ok)toast("Game manual ditambahkan")});
  }
```

Replace the existing Enter-key listener:

```js
document.addEventListener("keydown",function(e){
  if(e.key!=="Enter"||!e.target)return;
  var act=e.target.id==="rstIn"?"rstok":e.target.id==="npIn"?"npok":e.target.id==="gpIn"?"gameaddplayer":null;
  if(!act)return;
  e.preventDefault();document.querySelector('[data-act="'+act+'"]').click();
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd tests/ui && node --test roster.test.mjs`
Expected: PASS (3 tests).

If `#rbox img` never appears, the recap canvas is waiting on web fonts; confirm the `block` pattern in the test matches the font host the page actually uses (check `index.html` `<link>` tags) and adjust the pattern, not the production code.

- [ ] **Step 7: README**

In `README.md` under "Cara pakai" add:

```markdown
- Ganti pemain: tombol "Ganti pemain" di kartu match yang belum selesai. Pilih siapa yang diganti, lalu penggantinya. Skor tetap, dan klasemen/recap mengikuti pemain yang benar-benar main.
- Game manual: tombol "+ Game manual" di tab Jadwal. Pilih 4 pemain (2 vs 2). Game ditambahkan di akhir jadwal; pakai "Jadikan sedang main" untuk memainkannya sekarang. Hasilnya masuk klasemen.
- Pemain baru: tombol "+ Pemain baru" (atau lewat dialog game manual). Pemain baru muncul di klasemen dan punya recap sendiri.
- Hapus semua skor juga mengembalikan 10 pemain dan jadwal awal (pemain, game manual, dan penggantian hilang).
```

and add to the "Isi" list:

```markdown
- `tests/api/state.test.mjs`  tes server (jalankan: `node --test tests/api/state.test.mjs`)
- `tests/ui/`  tes UI Playwright (jalankan: `cd tests/ui && npm ci && npm test`)
```

- [ ] **Step 8: Full verification**

Run: `node --test tests/api/state.test.mjs`
Expected: PASS.
Run: `cd tests/ui && npm test`
Expected: every test passes (56 existing + 3 new), 0 fail.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/ui/roster.test.mjs README.md
git commit -m "feat(ui): manual players and manual games in jadwal, klasemen and recap

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
