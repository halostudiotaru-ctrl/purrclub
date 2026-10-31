# Mabar Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can start a new mabar session (name, players, duration); the system generates a fair schedule with the current rules, old sessions stay available as history, and the manual-game modal recommends the players with the fewest matches.

**Architecture:** Each session is a separate Redis record with today's state shape plus `name`, `note`, `createdAt`, `config` and `base`. A small index key `ht:sessions` (`{active, list}`) says which session is active; the pre-session data becomes the first session (`halloween`) and keeps its old keys. A pure generator (`lib/schedule.js`) picks the four fewest-played players per match, so counts never differ by more than 1. The client follows the active session, shows old ones read-only, and gets a 3-step create modal.

**Tech Stack:** Vanilla JS client in `index.html` (Polaris `s-*` web components), Vercel serverless functions (`api/*.js`, CommonJS), Upstash Redis REST (only GET, SET, DEL, HSET, HDEL, HGETALL are used or stubbed), `node:test` for server tests, Playwright (`tests/ui`) for UI tests.

**Spec:** `docs/superpowers/specs/2026-10-31-mabar-sessions-design.md`

## Global Constraints

- One court; one active session at a time; sessions are separate containers; old sessions are kept.
- `matchCount = floor(durationMin / slotMin)`; generated matches must be 1 to 30 (`MAX_GENERATED = 30`). `durationMin` integer 10-720, `slotMin` integer 10-120 (default 30), `startTime` `HH:MM`.
- Session name 1-40 chars. Players 4 to 20 (`MAX_PLAYERS = 20`), each name 1-20 chars, unique case-insensitively.
- Fairness: players' match counts differ by at most 1 (the generator never breaks this); the create flow suggests nearby match counts where everyone is exactly equal.
- Recommendation basis for manual games: each player's total matches in the session (finished plus still scheduled, including earlier manual games); ties: fewer finished matches, then longest rest, then lowest index.
- Reset ("Hapus semua skor", type RESET) restores the active session to its `base`.
- The first session has id `halloween`, name "Halloween Tennis", note "Sabtu 24 Okt · Medco Ampera", config `{durationMin: 300, slotMin: 30, startTime: "17:00"}`, and keeps the old Redis keys (`ht:state`, `ht:photo:<p>`, `ht:photov`, `ht:lock`). Its header and rules text stay exactly as they are today.
- Write ops to a session that is not active return 409 "Sesi ini bukan sesi aktif". Unknown `sid` returns 404.
- Clients that send no `sid` get the active session; responses only gain fields, so the previous release keeps working.
- Server code is CommonJS with no new dependencies. Do not add Redis commands beyond GET, SET, DEL, HSET, HDEL, HGETALL (the test stubs support only these).
- UI copy is Indonesian. Use the existing `btn()` helper and Polaris `s-*` components; no new CSS framework.
- Existing suites must keep passing: `node --test tests/api/state.test.mjs` (12) and `cd tests/ui && npm test` (60). Where a task's change legitimately breaks an existing assertion, adapt only that assertion and say so in the report.

## Rulings (small deviations from the spec, already folded into the spec where noted)

1. The session index and the active id live in one key, `ht:sessions` = `{active, list: [{id, name, createdAt}]}`. A poll then costs 3 Redis commands instead of 4 (it was 2 before sessions).
2. `GET /api/sessions` entries also carry `players` (names), which "Ambil dari sesi sebelumnya" needs.
3. `POST /api/sessions` accepts `op: "preview"` (validate and generate, write nothing) so step 3 can show exactly who plays one fewer. Create returns `{active, sessions}` (the same shape as GET); the client then polls the state.
4. The switch toast is "Sesi aktif: <name>" (a phone cannot tell creation from activation).
5. The localStorage cache is shown until the first poll (about a second) and is then replaced; a cache for another session is never merged.

## File Structure

- `lib/schedule.js` (create): `generate`, `recommend`, `summarize`, `suggestCounts`. Pure, no I/O.
- `lib/sessions.js` (create): key helpers, index load/save, `resolve`, `loadSession` (with legacy fill-in), locking, and (Task 3) create/preview/activate/overview with photo copy.
- `lib/score.js` (modify): `defaultBase`, `fromBase`; `initialState` built on them.
- `api/state.js` (modify): session-scoped keys, read-only enforcement, `resetall` from `base`, payload extras (`sid`, `active`, `session`, `suggest`).
- `api/photo.js` (modify): session-scoped keys.
- `api/sessions.js` (create): list, preview, create, activate.
- `index.html` (modify): session-aware sync, header, create modal, session bar, fairness display, history/read-only, recommendation UI.
- `tests/api/redis-stub.mjs` (create): shared in-memory Redis for the new API tests.
- `tests/api/schedule.test.mjs`, `tests/api/sessions.test.mjs`, `tests/api/sessions-api.test.mjs` (create).
- `tests/ui/fakeapi.mjs` (modify), `tests/ui/session.test.mjs` (create), `tests/ui/roster.test.mjs` (modify).
- `README.md` (modify).

---

### Task 1: Schedule generator, recommender and fairness arithmetic

**Files:**
- Create: `lib/schedule.js`
- Create: `tests/api/schedule.test.mjs`

**Interfaces:**
- Produces (`require("./schedule")`):
  - `MAX_GENERATED = 30`
  - `generate(n: int >= 4, matchCount: int >= 1) -> [{a:[p,p], b:[p,p]}]` (player indexes 0..n-1; deterministic; prefix-stable, i.e. `generate(n, k)` equals the first `k` entries of `generate(n, 30)`; throws `Error` with an Indonesian message on bad input).
  - `recommend(n, matches: [{a, b, done}]) -> {a:[p,p], b:[p,p]} | null` (`null` when `n < 4`).
  - `summarize(n, matchCount) -> {min, max, extra, equal}`.
  - `suggestCounts(n, matchCount, max = 30) -> {down: int|null, up: int|null}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/schedule.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Sch = require("../../lib/schedule.js");

const totals = (n, ms) => { const c = Array(n).fill(0); ms.forEach(m => m.a.concat(m.b).forEach(p => c[p]++)); return c; };
const spread = (c) => Math.max(...c) - Math.min(...c);
const maxPartnerRepeat = (ms) => {
  const seen = new Map();
  ms.forEach(m => [m.a, m.b].forEach(t => { const k = t.join(","); seen.set(k, (seen.get(k) || 0) + 1); }));
  return Math.max(...seen.values());
};
const m = (a, b, done) => ({ a, b, done: !!done });
const four = (r) => r.a.concat(r.b).sort((x, y) => x - y);

test("generate: four distinct valid players per match; counts differ by at most 1 after every match (4-20 players)", () => {
  for (let n = 4; n <= 20; n++) {
    const ms = Sch.generate(n, Sch.MAX_GENERATED);
    assert.equal(ms.length, Sch.MAX_GENERATED);
    ms.forEach((x, i) => {
      const f = x.a.concat(x.b);
      assert.equal(new Set(f).size, 4, `n=${n} match ${i}`);
      assert.ok(f.every(p => Number.isInteger(p) && p >= 0 && p < n), `n=${n} match ${i}`);
      const c = totals(n, ms.slice(0, i + 1));
      assert.ok(spread(c) <= 1, `n=${n} after match ${i + 1}: ${c}`);
    });
  }
});

test("generate: total slots equal 4 x matchCount and everyone plays floor or ceil of the average", () => {
  for (const [n, M] of [[7, 6], [8, 14], [5, 5], [10, 10], [13, 9]]) {
    const c = totals(n, Sch.generate(n, M));
    assert.equal(c.reduce((a, b) => a + b, 0), 4 * M);
    c.forEach(v => assert.ok(v === Math.floor(4 * M / n) || v === Math.ceil(4 * M / n), `n=${n} M=${M}: ${c}`));
  }
});

test("generate: deterministic and prefix-stable", () => {
  assert.deepEqual(Sch.generate(9, 12), Sch.generate(9, 12));
  assert.deepEqual(Sch.generate(9, 7), Sch.generate(9, 30).slice(0, 7));
});

test("generate: partners are not repeated in short schedules", () => {
  for (const [n, M] of [[7, 7], [8, 7], [10, 10], [12, 9]]) {
    assert.equal(maxPartnerRepeat(Sch.generate(n, M)), 1, `n=${n} M=${M}`);
  }
});

test("generate: rejects fewer than four players and invalid match counts", () => {
  assert.throws(() => Sch.generate(3, 5), /Minimal 4 pemain/);
  assert.throws(() => Sch.generate(6, 0), /Jumlah match tidak valid/);
  assert.throws(() => Sch.generate(6, 2.5), /Jumlah match tidak valid/);
});

test("recommend: lowest total matches first, tie goes to the pair with fewer repeats", () => {
  // player 4 has no match yet; 0-3 played once
  const r = Sch.recommend(5, [m([0, 1], [2, 3], true)]);
  assert.deepEqual(r, { a: [0, 2], b: [1, 4] });
});

test("recommend: ties on total prefer fewer finished matches", () => {
  // 1,2,3 played a finished match; 4,5,6 are scheduled in an unfinished one; all have total 1 (0 has 2)
  const r = Sch.recommend(7, [m([0, 1], [2, 3], true), m([4, 5], [6, 0], false)]);
  assert.deepEqual(four(r), [1, 4, 5, 6]);
});

test("recommend: remaining ties prefer the longest rest, then the lowest index", () => {
  // totals: 0:1 4:1 (lowest) then 1,2,3 tie on total, finished count and last finished match -> lowest index
  const r = Sch.recommend(5, [m([0, 1], [2, 3], true), m([1, 2], [3, 4], true)]);
  assert.deepEqual(four(r), [0, 1, 2, 4]);
  // with no matches yet the first four players are suggested
  assert.deepEqual(four(Sch.recommend(8, [])), [0, 1, 2, 3]);
});

test("recommend: null below four players", () => {
  assert.equal(Sch.recommend(3, []), null);
});

test("summarize and suggestCounts", () => {
  assert.deepEqual(Sch.summarize(7, 6), { min: 3, max: 4, extra: 3, equal: false });
  assert.deepEqual(Sch.summarize(8, 14), { min: 7, max: 7, extra: 0, equal: true });
  assert.deepEqual(Sch.suggestCounts(7, 6), { down: null, up: 7 });
  assert.deepEqual(Sch.suggestCounts(7, 10), { down: 7, up: 14 });
  assert.deepEqual(Sch.suggestCounts(8, 14), { down: null, up: null });   // already equal
  assert.deepEqual(Sch.suggestCounts(9, 6), { down: null, up: 9 });
  assert.deepEqual(Sch.suggestCounts(7, 30), { down: 28, up: null });     // 35 would exceed 30
  assert.deepEqual(Sch.suggestCounts(4, 3), { down: null, up: null });    // 4 players are always equal
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/api/schedule.test.mjs`
Expected: FAIL (`Cannot find module '../../lib/schedule.js'`).

- [ ] **Step 3: Write `lib/schedule.js`**

```js
// Pure schedule helpers (no I/O): fair match generation, manual-game recommendation, fairness arithmetic.
// The client carries a copy of summarize/suggestCounts (it cannot require this file).
const MAX_GENERATED = 30;

const pairKey = (a, b) => (a < b ? a + "," + b : b + "," + a);
const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);

function newStats(n) {
  return { plays: Array(n).fill(0), last: Array(n).fill(-1), partner: new Map(), opp: new Map() };
}
// Count one match (teams a and b) as played at index idx.
function record(st, a, b, idx) {
  a.concat(b).forEach(p => { st.plays[p]++; st.last[p] = idx; });
  bump(st.partner, pairKey(a[0], a[1]));
  bump(st.partner, pairKey(b[0], b[1]));
  a.forEach(x => b.forEach(y => bump(st.opp, pairKey(x, y))));
}
// The three ways to split four players (sorted ascending) into two teams.
function splits(f) {
  return [[[f[0], f[1]], [f[2], f[3]]], [[f[0], f[2]], [f[1], f[3]]], [[f[0], f[3]], [f[1], f[2]]]];
}
// Repeated partners weigh 3x repeated opponents.
function splitCost(st, a, b) {
  let c = 3 * ((st.partner.get(pairKey(a[0], a[1])) || 0) + (st.partner.get(pairKey(b[0], b[1])) || 0));
  a.forEach(x => b.forEach(y => { c += st.opp.get(pairKey(x, y)) || 0; }));
  return c;
}
// All k-element combinations of arr, in lexicographic order of positions.
function combos(arr, k) {
  const out = [];
  (function rec(start, cur) {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i <= arr.length - (k - cur.length); i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
  })(0, []);
  return out;
}

// Pick the four players and the team split for match idx. Players with the fewest matches are forced in;
// the remaining seats come from the group tied at the boundary, by lowest cost, then longest rest.
function pickMatch(st, n, idx) {
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((x, y) => st.plays[x] - st.plays[y] || st.last[x] - st.last[y] || x - y);
  const bound = st.plays[order[3]];
  const forced = order.filter(p => st.plays[p] < bound);
  const pool = order.filter(p => st.plays[p] === bound);
  let best = null;
  for (const extra of combos(pool, 4 - forced.length)) {
    const four = forced.concat(extra).sort((x, y) => x - y);
    const back = four.reduce((s, p) => s + (st.last[p] === idx - 1 ? 2 : 0), 0);
    const rest = four.reduce((s, p) => s + st.last[p], 0);
    for (const [a, b] of splits(four)) {
      const cost = splitCost(st, a, b) + back;
      if (!best || cost < best.cost || (cost === best.cost && rest < best.rest)) best = { a, b, cost, rest };
    }
  }
  return best;
}

// generate(n, matchCount) -> [{a:[x,y], b:[z,w]}]; deterministic; match counts differ by at most 1.
function generate(n, matchCount) {
  if (!Number.isInteger(n) || n < 4) throw new Error("Minimal 4 pemain");
  if (!Number.isInteger(matchCount) || matchCount < 1) throw new Error("Jumlah match tidak valid");
  const st = newStats(n), out = [];
  for (let i = 0; i < matchCount; i++) {
    const m = pickMatch(st, n, i);
    record(st, m.a, m.b, i);
    out.push({ a: m.a, b: m.b });
  }
  return out;
}

// recommend(n, matches) -> {a, b} | null. The four players with the fewest total matches (finished and still
// scheduled); ties: fewer finished matches, then longest rest (last finished match), then lowest index.
function recommend(n, matches) {
  if (!Number.isInteger(n) || n < 4) return null;
  const st = newStats(n), done = Array(n).fill(0), lastDone = Array(n).fill(-1);
  matches.forEach((m, i) => {
    record(st, m.a, m.b, i);
    if (m.done) m.a.concat(m.b).forEach(p => { done[p]++; lastDone[p] = i; });
  });
  const four = Array.from({ length: n }, (_, i) => i)
    .sort((x, y) => st.plays[x] - st.plays[y] || done[x] - done[y] || lastDone[x] - lastDone[y] || x - y)
    .slice(0, 4).sort((x, y) => x - y);
  let best = null;
  for (const [a, b] of splits(four)) {
    const c = splitCost(st, a, b);
    if (!best || c < best.c) best = { a, b, c };
  }
  return { a: best.a, b: best.b };
}

// Fairness arithmetic for n players and matchCount matches: everyone plays min or min+1 matches.
function summarize(n, matchCount) {
  const slots = 4 * matchCount, min = Math.floor(slots / n), extra = slots % n;
  return { min, max: extra ? min + 1 : min, extra, equal: extra === 0 };
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// Nearest match counts (below and above matchCount) at which every player plays exactly the same; null if none in 1..max.
function suggestCounts(n, matchCount, max = MAX_GENERATED) {
  const step = n / gcd(n, 4);
  if (matchCount % step === 0) return { down: null, up: null };
  const down = Math.floor(matchCount / step) * step, up = down + step;
  return { down: down >= 1 ? down : null, up: up <= max ? up : null };
}

module.exports = { MAX_GENERATED, generate, recommend, summarize, suggestCounts };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/api/schedule.test.mjs`
Expected: PASS (10 tests), finishing in well under a few seconds.

- [ ] **Step 5: Commit**

```bash
git add lib/schedule.js tests/api/schedule.test.mjs
git commit -m "feat(api): fair schedule generator and manual-game recommender

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Session-scoped state and photo APIs (with legacy migration)

After this task the app behaves exactly as before for the `halloween` session, the API understands `?sid=`, and a second session can exist in Redis (created by hand in tests; the create endpoint comes in Task 3).

**Files:**
- Modify: `lib/score.js`
- Create: `lib/sessions.js`
- Modify: `api/state.js` (full replacement below)
- Modify: `api/photo.js` (full replacement below)
- Create: `tests/api/redis-stub.mjs`
- Create: `tests/api/sessions.test.mjs`

**Interfaces:**
- Consumes: `Sch.recommend` (Task 1).
- Produces:
  - `lib/score.js`: `defaultBase() -> {players: string[10], teams: [{a,b}] x10}`, `fromBase(base) -> {players, matches}`; `initialState()` now `{rev:0, cur:null, players, matches}` built via `fromBase(defaultBase())`.
  - `lib/sessions.js`: `LEGACY_ID = "halloween"`, `err(status, message)`, `cleanName(v)`, `keys(id) -> {state, photo(p), photov, lock}`, `withLock(key, fn)`, `loadIndex() -> {active, list:[{id,name,createdAt}]}` (creates the index with the legacy session on first read), `saveIndex(idx)`, `resolve(idx, sid) -> id` (blank sid gives `idx.active`; unknown sid throws 404), `loadSession(id, idx) -> state` with `name, note, createdAt, config, base` filled in for legacy data.
  - `GET /api/state[?sid=]` and `POST /api/state[?sid=]` payload: the previous fields plus `sid`, `active`, `session: {name, note, createdAt, config, readOnly}`, `suggest: {a, b} | null`.
  - `GET/POST /api/photo[?sid=]`.

- [ ] **Step 1: Write the shared stub and the failing tests**

Create `tests/api/redis-stub.mjs`:

```js
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const kv = new Map();
export const hs = new Map();
export const hashOf = (k) => hs.get(k) || hs.set(k, new Map()).get(k);
export const reset = () => { kv.clear(); hs.clear(); };

// In-memory stand-in for lib/redis.js. Import this module before requiring any api/ or lib/sessions module.
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
```

Create `tests/api/sessions.test.mjs`:

```js
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { kv, hashOf, reset } from "./redis-stub.mjs";

const require = createRequire(import.meta.url);
const S = require("../../lib/score.js");
const Sch = require("../../lib/schedule.js");
const stateHandler = require("../../api/state.js");
const photoHandler = require("../../api/photo.js");

async function call(handler, req) {
  let out;
  const res = { setHeader() {}, status(c) { out = { status: c }; return { json(j) { out.body = j; } }; } };
  await handler(req, res);
  return out;
}
const get = (sid) => call(stateHandler, { method: "GET", query: sid ? { sid } : {} });
const post = (body, sid) => call(stateHandler, { method: "POST", body, query: sid ? { sid } : {} });
const photoGet = (p, sid) => call(photoHandler, { method: "GET", query: sid ? { p: String(p), sid } : { p: String(p) } });
const photoPost = (p, sid) => call(photoHandler, { method: "POST", body: { p, photo: JPEG }, query: sid ? { sid } : {} });
const JPEG = "data:image/jpeg;base64,AAAA";

beforeEach(reset);

// A second session saved directly in the store (the create endpoint is tested in sessions-api.test.mjs).
function seedSecond({ active = false } = {}) {
  const players = ["A", "B", "C", "D", "E"];
  const teams = Sch.generate(5, 5);
  const st = {
    rev: 1, cur: null, players, matches: teams.map(t => S.fresh(t)),
    name: "Mabar Tes", note: "Sabtu 31 Okt", createdAt: 2,
    config: { durationMin: 150, slotMin: 30, startTime: "19:00" },
    base: { players: players.slice(), teams },
  };
  kv.set("ht:session:sx1", JSON.stringify(st));
  kv.set("ht:sessions", JSON.stringify({
    active: active ? "sx1" : "halloween",
    list: [{ id: "halloween", name: "Halloween Tennis", createdAt: 1 }, { id: "sx1", name: "Mabar Tes", createdAt: 2 }],
  }));
}

test("fresh store: the legacy session is created, active and described", async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.body.sid, "halloween");
  assert.equal(r.body.active, "halloween");
  assert.equal(r.body.session.name, "Halloween Tennis");
  assert.equal(r.body.session.note, "Sabtu 24 Okt · Medco Ampera");
  assert.deepEqual(r.body.session.config, { durationMin: 300, slotMin: 30, startTime: "17:00" });
  assert.equal(r.body.session.readOnly, false);
  assert.equal(r.body.suggest.a.length, 2);
  assert.equal(r.body.suggest.b.length, 2);
  const idx = JSON.parse(kv.get("ht:sessions"));
  assert.equal(idx.active, "halloween");
  assert.equal(idx.list.length, 1);
});

test("legacy state without session fields keeps its scores and gains the fields on the next write", async () => {
  const ms = S.initial().map(x => { delete x.a; delete x.b; delete x.manual; return x; });
  ms[0].games = [2, 1];
  kv.set("ht:state", JSON.stringify({ rev: 5, matches: ms }));
  const r = await get();
  assert.deepEqual(r.body.matches[0].games, [2, 1]);
  assert.equal(r.body.rev, 5);
  await post({ op: "setcurrent", i: 1 });
  const saved = JSON.parse(kv.get("ht:state"));
  assert.equal(saved.name, "Halloween Tennis");
  assert.equal(saved.base.players.length, 10);
  assert.equal(saved.base.teams.length, 10);
  assert.deepEqual(saved.config, { durationMin: 300, slotMin: 30, startTime: "17:00" });
});

test("sid selects a session; a non-active session is read-only; unknown sid is 404", async () => {
  seedSecond();
  const second = await get("sx1");
  assert.equal(second.body.sid, "sx1");
  assert.equal(second.body.active, "halloween");
  assert.equal(second.body.session.readOnly, true);
  assert.deepEqual(second.body.players, ["A", "B", "C", "D", "E"]);
  assert.equal(second.body.matches.length, 5);
  assert.equal((await get()).body.sid, "halloween");
  assert.equal((await get("nope")).status, 404);
  const blocked = await post({ op: "setcurrent", i: 1 }, "sx1");
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /bukan sesi aktif/);
  assert.equal((await post({ op: "setcurrent", i: 1 })).status, 200);
});

test("writes without sid go to the active session and leave the legacy keys alone", async () => {
  seedSecond({ active: true });
  assert.equal((await post({ op: "setcurrent", i: 2 })).status, 200);
  assert.equal(JSON.parse(kv.get("ht:session:sx1")).cur, 2);
  assert.equal(kv.has("ht:state"), false);
  assert.equal((await post({ op: "setcurrent", i: 1 }, "halloween")).status, 409);
});

test("suggest matches the recommender for the stored matches", async () => {
  seedSecond({ active: true });
  const r = await get();
  assert.deepEqual(r.body.suggest, Sch.recommend(5, JSON.parse(kv.get("ht:session:sx1")).matches));
});

test("photos are stored per session; the legacy session keeps the old photo keys", async () => {
  seedSecond({ active: true });
  assert.equal((await photoPost(0)).status, 200);
  assert.equal(kv.get("ht:photo:sx1:0"), JPEG);
  assert.equal(hashOf("ht:photov:sx1").has("0"), true);
  assert.equal(kv.has("ht:photo:0"), false);
  assert.equal((await photoGet(0, "sx1")).body.photo, JPEG);
  assert.equal((await photoGet(0, "halloween")).body.photo, null);
  assert.equal((await photoPost(0, "halloween")).status, 409);
  assert.equal((await photoGet(0, "nope")).status, 404);
  const g = await get();
  assert.deepEqual(Object.keys(g.body.photos), ["0"]);
  // legacy active: the old keys are used
  kv.set("ht:sessions", JSON.stringify({ active: "halloween", list: JSON.parse(kv.get("ht:sessions")).list }));
  assert.equal((await photoPost(1)).status, 200);
  assert.equal(kv.get("ht:photo:1"), JPEG);
  assert.equal(hashOf("ht:photov").has("1"), true);
});

test("resetall rebuilds the session from its base and drops photos beyond it", async () => {
  seedSecond({ active: true });
  await post({ op: "addplayer", name: "F" });
  await post({ op: "addmatch", a: [5, 0], b: [1, 2] });
  kv.set("ht:photo:sx1:5", "x"); hashOf("ht:photov:sx1").set("5", "1");
  kv.set("ht:photo:sx1:1", "y"); hashOf("ht:photov:sx1").set("1", "1");
  assert.equal((await post({ op: "resetall", confirm: "nope" })).status, 400);
  const r = await post({ op: "resetall", confirm: "RESET" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.players, ["A", "B", "C", "D", "E"]);
  assert.equal(r.body.matches.length, 5);
  assert.equal(kv.has("ht:photo:sx1:5"), false);
  assert.equal(hashOf("ht:photov:sx1").has("5"), false);
  assert.equal(kv.get("ht:photo:sx1:1"), "y");
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/api/sessions.test.mjs`
Expected: FAIL (e.g. `r.body.sid` is undefined; `Cannot find module` for nothing yet because api modules exist, but assertions fail).

- [ ] **Step 3: Update `lib/score.js`**

Add after the `initial()` function and replace `initialState`:

```js
// The roster and schedule a session starts from; "Hapus semua skor" returns to it.
function defaultBase() { return { players: DEFAULT_PLAYERS.slice(), teams: Array.from({ length: M }, (_, i) => teams(i)) }; }
function fromBase(base) { return { players: base.players.slice(), matches: base.teams.map(t => fresh(t)) }; }
function initialState() { const f = fromBase(defaultBase()); return { rev: 0, cur: null, players: f.players, matches: f.matches }; }
```

(The old one-line `initialState` is removed.) Update the export line to add the new functions:

```js
module.exports = { FIXED, M, DEFAULT_PLAYERS, MAX_PLAYERS, players, fresh, initial, defaultBase, fromBase, initialState, migrate, snap, restore, addPoint, currentIndex };
```

- [ ] **Step 4: Create `lib/sessions.js`**

```js
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
```

- [ ] **Step 5: Replace `api/state.js`**

```js
const { cmd } = require("../lib/redis");
const S = require("../lib/score");
const Sch = require("../lib/schedule");
const Sess = require("../lib/sessions");

const { err, cleanName } = Sess;
const num = (v) => (typeof v === "number" ? v : NaN);
const isPlayer = (st, p) => Number.isInteger(p) && p >= 0 && p < st.players.length;

function publicMatches(ms) {
  return ms.map(m => ({ a: m.a, b: m.b, manual: !!m.manual, games: m.games, p: m.p, adv: m.adv, deuceN: m.deuceN, sudden: m.sudden, done: m.done, hn: m.hist.length }));
}
function publicState(st, sid, idx) {
  return {
    rev: st.rev, cur: S.currentIndex(st.matches, st.cur), players: st.players, matches: publicMatches(st.matches),
    sid, active: idx.active,
    session: { name: st.name, note: st.note, createdAt: st.createdAt, config: st.config, readOnly: sid !== idx.active },
    suggest: Sch.recommend(st.players.length, st.matches),
  };
}
// After a full reset the roster is back to the session's base, so photos of players beyond it must go.
async function dropExtraPhotos(K, keep) {
  const flat = (await cmd(["HGETALL", K.photov])) || [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    if (Number(flat[i]) >= keep) {
      await cmd(["DEL", K.photo(flat[i])]);
      await cmd(["HDEL", K.photov, flat[i]]);
    }
  }
}

function apply(st, b) {
  const ms = st.matches, cur = S.currentIndex(ms, st.cur);
  if (b.op === "resetall") {
    if (b.confirm !== "RESET") throw err(400, "Konfirmasi salah");
    const f = S.fromBase(st.base);
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
    if (ms.length >= 40) throw err(409, "Jumlah match sudah penuh");
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
    const idx = await Sess.loadIndex();
    const sid = Sess.resolve(idx, (req.query || {}).sid);
    const K = Sess.keys(sid);
    if (req.method === "GET") {
      const st = await Sess.loadSession(sid, idx);
      const flat = (await cmd(["HGETALL", K.photov])) || [];
      const photos = {};
      for (let i = 0; i + 1 < flat.length; i += 2) photos[flat[i]] = flat[i + 1];
      return res.status(200).json({ ...publicState(st, sid, idx), photos });
    }
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!b || typeof b !== "object") throw err(400, "Body kosong");
      if (sid !== idx.active) throw err(409, "Sesi ini bukan sesi aktif");
      const out = await Sess.withLock(K.lock, async () => {
        const st = await Sess.loadSession(sid, idx);
        apply(st, b);
        st.rev = Date.now();
        await cmd(["SET", K.state, JSON.stringify(st)]);
        if (b.op === "resetall") await dropExtraPhotos(K, st.base.players.length);
        if (b.op === "addplayer") {
          // the index may be reused after a reset: never inherit an old selfie
          const at = st.players.length - 1;
          await cmd(["DEL", K.photo(at)]);
          await cmd(["HDEL", K.photov, String(at)]);
        }
        return st;
      });
      return res.status(200).json(publicState(out, sid, idx));
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: String(e.message || e) });
  }
};
```

- [ ] **Step 6: Replace `api/photo.js`**

```js
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
```

- [ ] **Step 7: Run all API tests**

Run: `node --test tests/api/sessions.test.mjs tests/api/state.test.mjs tests/api/schedule.test.mjs`
Expected: PASS: 7 new tests, the 12 existing state tests, and the 10 schedule tests; 0 failures. (The existing state tests exercise the legacy session through the new code, which is the regression check for this refactor.)

- [ ] **Step 8: Commit**

```bash
git add lib/score.js lib/sessions.js api/state.js api/photo.js tests/api/redis-stub.mjs tests/api/sessions.test.mjs
git commit -m "feat(api): session-scoped state and photos with legacy migration

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sessions API (list, preview, create, activate)

**Files:**
- Modify: `lib/sessions.js` (append, and replace the export line)
- Create: `api/sessions.js`
- Create: `tests/api/sessions-api.test.mjs`

**Interfaces:**
- Consumes: Task 1 `Sch.generate`, `Sch.MAX_GENERATED`; Task 2 `Sess.*`.
- Produces:
  - `Sess.overview() -> {active, sessions: [{id, name, note, createdAt, players, playerCount, matchCount, doneCount}]}` (newest first).
  - `Sess.preview(body) -> {matches: [{a,b}], matchCount}`; `Sess.createSession(body) -> void` (activates the new session); `Sess.activate(id) -> void`.
  - HTTP: `GET /api/sessions` -> overview; `POST /api/sessions` with `op: "preview"` -> `{matches, matchCount}`, with no `op` or `op: "create"` -> overview, with `op: "activate", id` -> overview. Errors: 400 invalid input, 404 unknown id/copyFrom, 409 duplicate player names.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/sessions-api.test.mjs`:

```js
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { kv, hashOf, reset } from "./redis-stub.mjs";

const require = createRequire(import.meta.url);
const Sch = require("../../lib/schedule.js");
const sessionsHandler = require("../../api/sessions.js");
const stateHandler = require("../../api/state.js");

async function call(handler, req) {
  let out;
  const res = { setHeader() {}, status(c) { out = { status: c }; return { json(j) { out.body = j; } }; } };
  await handler(req, res);
  return out;
}
const list = () => call(sessionsHandler, { method: "GET" });
const post = (body) => call(sessionsHandler, { method: "POST", body });
const state = (sid) => call(stateHandler, { method: "GET", query: sid ? { sid } : {} });
const names = (n) => Array.from({ length: n }, (_, i) => "P" + (i + 1));
const base = { name: "Mabar Sabtu", players: names(7), durationMin: 180, slotMin: 30, startTime: "19:00", note: "Sabtu 31 Okt" };
const JPEG = "data:image/jpeg;base64,AAAA";

beforeEach(reset);

test("list on a fresh store shows the legacy session with counts and names", async () => {
  const r = await list();
  assert.equal(r.status, 200);
  assert.equal(r.body.active, "halloween");
  assert.equal(r.body.sessions.length, 1);
  const s = r.body.sessions[0];
  assert.equal(s.id, "halloween");
  assert.equal(s.playerCount, 10);
  assert.equal(s.matchCount, 10);
  assert.equal(s.doneCount, 0);
  assert.equal(s.players[0], "Angel");
});

test("create: new active session with a fair generated schedule; the old one stays", async () => {
  const r = await post(base);
  assert.equal(r.status, 200);
  const id = r.body.active;
  assert.notEqual(id, "halloween");
  assert.equal(r.body.sessions.length, 2);
  assert.equal(r.body.sessions[0].id, id);              // newest first
  assert.equal(r.body.sessions[0].matchCount, 6);
  assert.equal(r.body.sessions[0].playerCount, 7);
  assert.equal(r.body.sessions[1].id, "halloween");

  const s = await state();
  assert.equal(s.body.sid, id);
  assert.equal(s.body.session.name, "Mabar Sabtu");
  assert.equal(s.body.session.note, "Sabtu 31 Okt");
  assert.deepEqual(s.body.session.config, { durationMin: 180, slotMin: 30, startTime: "19:00" });
  assert.deepEqual(s.body.players, names(7));
  assert.equal(s.body.matches.length, 6);
  const counts = Array(7).fill(0);
  s.body.matches.forEach(m => m.a.concat(m.b).forEach(p => counts[p]++));
  assert.equal(counts.reduce((a, b) => a + b, 0), 24);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, String(counts));
  assert.deepEqual(s.body.matches.map(m => ({ a: m.a, b: m.b })), Sch.generate(7, 6));

  const legacy = await state("halloween");
  assert.equal(legacy.body.session.readOnly, true);
  assert.equal(legacy.body.matches.length, 10);
});

test("create: the new session is playable through the state api", async () => {
  await post(base);
  const r = await call(stateHandler, { method: "POST", body: { op: "point", i: 0, s: 0 }, query: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.matches[0].p, [1, 0]);
});

test("create accepts exactly 30 matches", async () => {
  const r = await post({ ...base, durationMin: 300, slotMin: 10 });
  assert.equal(r.status, 200);
  assert.equal(r.body.sessions[0].matchCount, 30);
});

test("preview returns the schedule and writes nothing", async () => {
  const r = await post({ ...base, op: "preview" });
  assert.equal(r.status, 200);
  assert.equal(r.body.matchCount, 6);
  assert.deepEqual(r.body.matches, Sch.generate(7, 6));
  assert.equal((await list()).body.sessions.length, 1);
});

test("validation errors create nothing", async () => {
  const bad = [
    [{ ...base, name: "  " }, 400],
    [{ ...base, name: "x".repeat(41) }, 400],
    [{ ...base, players: names(3) }, 400],
    [{ ...base, players: names(21) }, 400],
    [{ ...base, players: "abc" }, 400],
    [{ ...base, players: ["A", "B", "C", "a"] }, 409],
    [{ ...base, players: ["A", "B", "C", ""] }, 400],
    [{ ...base, players: ["A", "B", "C", "x".repeat(21)] }, 400],
    [{ ...base, durationMin: 5 }, 400],
    [{ ...base, durationMin: 721 }, 400],
    [{ ...base, durationMin: "180" }, 400],
    [{ ...base, slotMin: 9 }, 400],
    [{ ...base, durationMin: 20, slotMin: 30 }, 400],
    [{ ...base, durationMin: 310, slotMin: 10 }, 400],     // 31 matches
    [{ ...base, startTime: "7pm" }, 400],
    [{ ...base, startTime: "24:00" }, 400],
    [{ ...base, op: "bogus" }, 400],
  ];
  for (const [body, status] of bad) {
    const r = await post(body);
    assert.equal(r.status, status, JSON.stringify(body).slice(0, 80));
  }
  assert.equal((await list()).body.sessions.length, 1);
  assert.equal((await call(sessionsHandler, { method: "POST", body: null })).status, 400);
});

test("activate switches the active session and rejects unknown or missing ids", async () => {
  const created = (await post(base)).body.active;
  const back = await post({ op: "activate", id: "halloween" });
  assert.equal(back.status, 200);
  assert.equal(back.body.active, "halloween");
  assert.equal((await post({ op: "activate", id: created })).body.active, created);
  assert.equal((await post({ op: "activate", id: "nope" })).status, 404);
  assert.equal((await post({ op: "activate" })).status, 400);
});

test("copyFrom copies photos by name (case-insensitive) and nothing else", async () => {
  kv.set("ht:photo:1", JPEG); hashOf("ht:photov").set("1", "5");        // Faiz in the legacy session
  kv.set("ht:photo:2", JPEG); hashOf("ht:photov").set("2", "6");        // Bella, not in the new session
  const r = await post({ ...base, players: ["faiz", "X", "Y", "Z"], copyFrom: "halloween" });
  assert.equal(r.status, 200);
  const id = r.body.active;
  assert.equal(kv.get("ht:photo:" + id + ":0"), JPEG);
  assert.deepEqual([...hashOf("ht:photov:" + id).keys()], ["0"]);
  assert.equal(kv.get("ht:photo:1"), JPEG);                              // source untouched
});

test("copyFrom with an unknown session is 404 and creates nothing", async () => {
  const r = await post({ ...base, copyFrom: "nope" });
  assert.equal(r.status, 404);
  assert.equal((await list()).body.sessions.length, 1);
});

test("list is newest first and counts finished matches", async () => {
  await post({ ...base, name: "Pertama" });
  await post({ ...base, name: "Kedua" });
  const r = await list();
  assert.deepEqual(r.body.sessions.map(s => s.name), ["Kedua", "Pertama", "Halloween Tennis"]);
  for (let k = 0; k < 16; k++) await call(stateHandler, { method: "POST", body: { op: "point", i: 0, s: 0 }, query: {} });
  assert.equal((await list()).body.sessions[0].doneCount, 1);
});
```

- [ ] **Step 2: Run to verify the tests fail**

Run: `node --test tests/api/sessions-api.test.mjs`
Expected: FAIL (`Cannot find module '../../api/sessions.js'`).

- [ ] **Step 3: Extend `lib/sessions.js`**

Add `const Sch = require("./schedule");` below the `S` require. Then, above the `module.exports` line, add:

```js
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
  await withLock(LOCK_SESSIONS, async () => {
    const idx = await loadIndex();
    let source = null;
    if (b.copyFrom !== undefined && b.copyFrom !== null && b.copyFrom !== "") {
      const sid = resolve(idx, b.copyFrom);
      source = { id: sid, st: await loadSession(sid, idx) };
    }
    let id;
    do { id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4); } while (idx.list.some(e => e.id === id));
    const now = Date.now();
    const teams = Sch.generate(v.players.length, v.matchCount);
    const st = {
      rev: now, cur: null, players: v.players.slice(), matches: teams.map(t => S.fresh(t)),
      name: v.name, note: v.note, createdAt: now,
      config: { durationMin: v.durationMin, slotMin: v.slotMin, startTime: v.startTime },
      base: { players: v.players.slice(), teams },
    };
    await cmd(["SET", keys(id).state, JSON.stringify(st)]);
    if (source) await copyPhotos(source, id, st.players);
    idx.list.push({ id, name: st.name, createdAt: now });
    idx.active = id;
    await saveIndex(idx);
  });
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
```

and replace the export line with:

```js
module.exports = { LEGACY_ID, LOCK_SESSIONS, err, cleanName, keys, withLock, loadIndex, saveIndex, resolve, loadSession, overview, preview, createSession, activate };
```

- [ ] **Step 4: Create `api/sessions.js`**

```js
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
```

`Sch.generate` throws plain `Error`s only for inputs the validation already rejected, so no extra mapping is needed.

- [ ] **Step 5: Run all API tests**

Run: `node --test tests/api/sessions-api.test.mjs tests/api/sessions.test.mjs tests/api/state.test.mjs tests/api/schedule.test.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add lib/sessions.js api/sessions.js tests/api/sessions-api.test.mjs
git commit -m "feat(api): sessions endpoint with preview, create, activate and photo copy

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Client follows the active session (sync, header, slot times, recap, identity)

No new buttons yet. After this task a session created elsewhere (here: through a direct API call in the test) replaces the header, schedule, times and recap texts on every phone, and the "Kamu" identity follows by name.

**Files:**
- Modify: `index.html`
- Modify: `tests/ui/fakeapi.mjs`
- Create: `tests/ui/session.test.mjs`

**Interfaces:**
- Consumes: Task 2/3 HTTP payloads (`sid`, `active`, `session`, `suggest`; `POST /api/sessions`).
- Produces (client globals inside the IIFE, used by later tasks): `viewSid` (string|null, an explicitly viewed old session), `quiet` (bool, suppress the switch toast once), `synced`, `wz` (create-modal context, declared here, used from Task 5), `state.sid`, `state.active`, `state.session`, `state.suggest`, `hm(min) -> "HH:MM"`, `sess()`, `cfg()`, `startMin(cfg)`, `slotTime(i)`, `isLegacy()`, `isRO()`, `sidQ(sep)`, `renderHeader()`. Test helpers: `fakeApi()` now also serves `/api/sessions` and passes `?sid=`.

- [ ] **Step 1: Update the fake API and write the failing tests**

In `tests/ui/fakeapi.mjs` replace the handler import and `fakeApi` with:

```js
const stateHandler = require("../../api/state.js");
const sessionsHandler = require("../../api/sessions.js");

const json = (route, status, body) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function run(handler, route) {
  const req = route.request();
  const out = { status: 200, body: {} };
  const res = { setHeader() {}, status(c) { out.status = c; return { json(j) { out.body = j; } }; } };
  const query = Object.fromEntries(new URL(req.url()).searchParams);
  await handler({ method: req.method(), body: req.postData() || undefined, query }, res);
  await json(route, out.status, out.body);
}

// Route entries for open({ routes }): the real api handlers backed by memory, and photos that are always empty.
export function fakeApi() {
  kv.clear(); hs.clear();
  return [
    [/\/api\/state(\?|$)/, (route) => run(stateHandler, route)],
    [/\/api\/sessions(\?|$)/, (route) => run(sessionsHandler, route)],
    [/\/api\/photo/, (route) => json(route, 200, { photo: null })],
  ];
}
```

(Remove the old `const handler = require("../../api/state.js");` and the old `json`/`fakeApi`; keep the stub block and `waitLive`.)

Create `tests/ui/session.test.mjs`:

```js
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown, waitModal } from "./helpers.mjs";
import { fakeApi, waitLive } from "./fakeapi.mjs";

after(teardown);

const body = { name: "Mabar Kamis", players: ["Budi", "Cici", "Angel", "Dodi", "Eka", "Fajar", "Gita"], durationMin: 180, slotMin: 30, startTime: "19:00", note: "Kamis 5 Nov" };
// What another phone would do: start a session through the api.
const createSession = (page, b = body) =>
  page.evaluate(async (b) => (await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).status, b);
const titleIs = (page, t) => page.waitForFunction((t) => document.getElementById("sTitle").textContent === t, t);

test("a session started elsewhere replaces header, schedule and slot times on this phone", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  assert.equal(await page.locator("header s-link").count(), 1);      // the Halloween header keeps its map link
  assert.equal(await createSession(page), 200);
  await titleIs(page, "Mabar Kamis");
  assert.equal(await page.locator(".match").count(), 6);
  assert.ok((await page.locator(".match").first().textContent()).includes("19:00–19:30"));
  assert.ok((await page.locator(".match").nth(1).textContent()).includes("19:30–20:00"));
  assert.equal(await page.locator("header s-link").count(), 0);
  const sub = await page.locator("#sSub").textContent();
  assert.ok(sub.includes("Kamis 5 Nov") && sub.includes("19:00–22:00"), sub);
  assert.ok((await page.locator("#toast").textContent()).includes("Sesi aktif: Mabar Kamis"));
  assert.equal(await page.title(), "Mabar Kamis");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("my identity follows my name into the new session", async () => {
  const { page, ctx } = await open({ routes: fakeApi(), me: 0 });          // index 0 = Angel in Halloween
  await waitLive(page);
  await createSession(page);                                               // Angel is index 2 here
  await titleIs(page, "Mabar Kamis");
  assert.ok((await page.locator("#chip .chip").textContent()).includes("Angel"));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("halloween-tennis-me-v1")));
  assert.equal(stored.p, 2);
  assert.equal(stored.name, "Angel");
  await ctx.close();
});

test("if my name is not in the new session I am asked who I am", async () => {
  const { page, ctx } = await open({ routes: fakeApi(), me: 0 });
  await waitLive(page);
  await createSession(page, { ...body, players: ["Budi", "Cici", "Dodi", "Eka"] });
  await titleIs(page, "Mabar Kamis");
  await waitModal(page, true, 4000);
  assert.equal(await page.locator("#modal").getAttribute("heading"), "Kamu yang mana?");
  await ctx.close();
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd tests/ui && node --test session.test.mjs`
Expected: FAIL (`#sTitle` does not exist).

- [ ] **Step 3: Header markup and CSS in `index.html`**

Four small edits in the `<header>` block:

- `<h1 class="title">Halloween Tennis</h1>` -> `<h1 class="title" id="sTitle">Halloween Tennis</h1>`
- `<p class="sub">` -> `<p class="sub" id="sSub">` (only the opening tag; the content stays)
- `<div id="chip"></div>` -> `<div id="chip"></div>` followed on the next line by `<div id="sessbar" class="sessbar"></div>`
- `<s-banner class="rules" tone="info" heading="Aturan">` -> `<s-banner class="rules" id="rules" tone="info" heading="Aturan">`

In the `<style>` block, after the `.rules{display:block;margin-top:14px}` line add:

```css
.sessbar{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px}
```

- [ ] **Step 4: Client state and helpers**

Replace the line `var rev=0,inflight=0,online=null,uploadingFor=null;` with:

```js
var rev=0,inflight=0,online=null,uploadingFor=null;
var viewSid=null,quiet=false,synced=false,hdrKey=null,wz=null,LEGACY_ID="halloween";
var HEAD0={title:$("sTitle").innerHTML,sub:$("sSub").innerHTML,rules:$("rules").innerHTML,doc:document.title};
```

Replace the one-line `slotTime` function with:

```js
function hm(m){m=((m%1440)+1440)%1440;var h=Math.floor(m/60),mi=m%60;return (h<10?"0":"")+h+":"+(mi<10?"0":"")+mi}
function sess(){return (state&&state.session)||null}
function cfg(){var s=sess();return s&&s.config?s.config:{startTime:"17:00",slotMin:30,durationMin:300}}
function startMin(c){var p=String(c.startTime).split(":");return (+p[0])*60+(+p[1])}
function slotTime(i){var c=cfg(),s=startMin(c)+i*c.slotMin;return hm(s)+"–"+hm(s+c.slotMin)}
function isLegacy(){return !state.sid||state.sid===LEGACY_ID}
function isRO(){var s=sess();return !!(s&&s.readOnly)}
function sidQ(sep){return state&&state.sid?sep+"sid="+encodeURIComponent(state.sid):""}
```

- [ ] **Step 5: Sync functions**

Replace the functions `fixMe`, `adopt`, `sendOp`, `pull` and `uploadPhoto` (keep `api`, `setOnline`, `resetAllModal` as they are) with:

```js
function fixMe(){
  if(me.p===null)return false;
  if(me.p>=PLAYERS.length||(me.name&&PLAYERS[me.p]!==me.name)){
    var k=me.name?PLAYERS.indexOf(me.name):-1;
    if(k>=0){me.p=k;saveMe();return false}
    me.p=null;me.photo=null;me.name=null;saveMe();return true;
  }
  if(!me.name){me.name=PLAYERS[me.p];saveMe()}
  return false;
}
function adopt(r){
  var prev=state.sid||null,isNew=!!(r.sid&&r.sid!==prev),switched=!!(isNew&&prev);
  if(isNew){photos={};photoVer={};rev=0;subCtx=null;gameCtx=null;wz=null}
  state.sid=r.sid||null;state.active=r.active||null;state.session=r.session||null;state.suggest=r.suggest||null;
  state.cur=typeof r.cur==="number"?r.cur:null;
  if(Array.isArray(r.players))state.players=r.players;
  PLAYERS=state.players;
  state.matches=r.matches.map(function(m,i){
    var old=state.matches[i]||{};
    return {a:m.a||old.a||[0,1],b:m.b||old.b||[2,3],manual:!!m.manual,games:m.games,p:m.p,adv:m.adv,deuceN:m.deuceN,sudden:m.sudden,done:m.done,hn:m.hn||0};
  });
  var announce=switched&&synced&&!quiet;
  if(announce){if(modalIsOpen())closeModal();toast("Sesi aktif: "+((r.session&&r.session.name)||""))}
  if(switched)quiet=false;
  if(fixMe()){
    if(announce)setTimeout(function(){if(!modalIsOpen())pickPlayer()},350);
    else if(!modalIsOpen())pickPlayer();
  }
  if(isNew&&me.photo&&me.p!==null)photos[me.p]=me.photo;
  synced=true;
  try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}
}
function sendOp(body){
  if(isRO()){toast("Sesi lama hanya bisa dilihat");return Promise.resolve(false)}
  inflight++;
  return api("/api/state"+sidQ("?"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){setOnline(true);inflight--;if(inflight===0){adopt(r);rev=r.rev;render()}return true})
    .catch(function(e){
      inflight--;
      if(e.status&&e.status<500){toast(e.message)}else{setOnline(false);toast("Gagal kirim skor, cek koneksi")}
      pull(true);
      return false;
    });
}
function pull(force){
  return api("/api/state"+(viewSid?"?sid="+encodeURIComponent(viewSid):"")).then(function(s){
    setOnline(true);
    var changed=false;
    if(s.matches&&(inflight===0||force)&&s.rev!==rev){adopt(s);rev=s.rev;changed=true}
    var jobs=[];
    Object.keys(s.photos||{}).forEach(function(k){
      var p=+k;
      if(photoVer[p]!==s.photos[k]){
        photoVer[p]=s.photos[k];
        jobs.push(api("/api/photo?p="+p+sidQ("&")).then(function(r){if(r.photo){photos[p]=r.photo;changed=true}}).catch(function(){photoVer[p]=null}));
      }
    });
    if(s.photos){
      Object.keys(photos).forEach(function(k){
        var p=+k;
        if(s.photos[k]!==undefined||(p===me.p&&me.photo))return;
        delete photos[p];delete photoVer[p];changed=true;
      });
    }
    return Promise.all(jobs).then(function(){
      if(me.p!==null&&me.photo&&!isRO()&&!(s.photos&&s.photos[me.p]))uploadPhoto(me.p,me.photo);
      if(changed)render();
    });
  }).catch(function(e){
    if(e&&e.status===404&&viewSid){viewSid=null;quiet=true;return pull(true)}
    setOnline(false);
  });
}
function uploadPhoto(p,data){
  if(uploadingFor===p)return;uploadingFor=p;
  return api("/api/photo"+sidQ("?"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({p:p,photo:data})})
    .then(function(r){photoVer[p]=r.v;toast("Foto terkirim ke semua orang")})
    .catch(function(){toast("Foto tersimpan di HP, belum terkirim")})
    .then(function(){uploadingFor=null});
}
```

- [ ] **Step 6: Header rendering, recap texts**

Add this block right before `function render(){`:

```js
var RULES_NEW='Doubles, partner berganti tiap match. Satu match sampai <b>4 game</b>. Setiap game: 15–30–40, <b>deuce hanya 1 kali</b>, deuce kedua jadi <b>sudden death</b> (poin berikutnya menang). Jadwal dibuat otomatis supaya jumlah main tiap orang sama atau selisih satu. Game manual dan pergantian pemain bisa ditambah di tab Jadwal.';
function renderHeader(){
  var s=sess(),legacy=isLegacy();
  var key=legacy?"legacy":state.sid+"|"+s.name+"|"+s.note+"|"+s.config.startTime+"|"+s.config.durationMin;
  if(key===hdrKey)return;
  hdrKey=key;
  var t=$("sTitle"),sub=$("sSub"),ru=$("rules");
  if(legacy){t.innerHTML=HEAD0.title;sub.innerHTML=HEAD0.sub;ru.innerHTML=HEAD0.rules;document.title=HEAD0.doc;return}
  t.textContent=s.name;
  sub.textContent=(s.note?s.note+" · ":"")+hm(startMin(s.config))+"–"+hm(startMin(s.config)+s.config.durationMin);
  ru.innerHTML=RULES_NEW;
  document.title=s.name;
}
```

and change `render()` to call it first:

```js
function render(){
  renderHeader();renderChip();renderJadwal();renderKlasemen();renderPemain();
  $("tools").innerHTML=btn('variant="secondary" tone="critical" data-act="resetall"','Hapus semua skor');
}
```

For the recap, add next to `drawRecap`:

```js
function recapTitle(){return isLegacy()?"Halloween Tennis":(sess().name||"Mabar")}
function recapNote(){return isLegacy()?"Sabtu 24 Okt · Medco Ampera":(sess().note||"")}
function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"recap"}
```

and in `drawRecap` replace the title line and the footer line:

```js
  var rt=recapTitle();
  x.fillStyle="#ff8a1f";fit(x,rt,900,92,F_DISP,"400");x.fillText(rt,540,290);
  x.fillStyle="#f3ead8";x.font="600 40px "+F_TXT;x.fillText(isLegacy()?"Recap malam ini":"Recap sesi ini",540,345);
```
(these replace the two existing lines that draw "Halloween Tennis" and "Recap malam ini"), and

```js
  x.fillStyle="#a898bd";x.font="500 32px "+F_TXT;x.fillText(recapNote(),540,1636);
```
(replacing the line that draws "Sabtu 24 Okt · Medco Ampera"). In `openRecap` change the filename assignment to
`recapName=slug(recapTitle())+"-"+slug(PLAYERS[p])+".png";` and in `shareRecap` change the share title to `title:recapTitle()+" Recap"`.

- [ ] **Step 7: Run the tests**

Run: `cd tests/ui && node --test session.test.mjs` then `npm test`
Expected: the 3 new tests PASS and the full UI suite passes (60 existing + 3 new). If an existing test fails because of a header or timing assumption, report which and adapt only that assertion. Also run `node --test tests/api/*.test.mjs` from the repo root: still green.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/ui/fakeapi.mjs tests/ui/session.test.mjs
git commit -m "feat(ui): follow the active session (header, slot times, recap, identity by name)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: "Sesi baru" create modal (3 steps)

**Files:**
- Modify: `index.html`
- Modify: `tests/ui/session.test.mjs`

**Interfaces:**
- Consumes: `wz` and `viewSid` (Task 4); `POST /api/sessions` with `op: "preview"` and create; `readName(id)`, `openModal`, `closeModal`, `btn`, `esc`, `toast`, `hm`, `startMin`, `pull` (existing).
- Produces: `data-act="wznew"` button in `#sessbar`; modal steps with `data-act` values `wzdur`, `wznext`, `wzback`, `wzadd`, `wzrm`, `wzcopy`, `wzcopyfrom`, `wzsug`, `wzgo`; field ids `wzName`, `wzDur`, `wzSlot`, `wzStart`, `wzPn`; `dateNote(Date) -> "Kamis 5 Nov"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/session.test.mjs` (add `waitModalText` to the helper import: `import { open, teardown, waitModal, waitModalText } from "./helpers.mjs";`):

```js
const fill = (page, id, v) => page.fill(`s-text-field#${id} input`, v);
const addPlayers = async (page, list) => {
  for (const n of list) { await fill(page, "wzPn", n); await page.click('s-modal [data-act="wzadd"]'); }
};

test("create flow: settings, players, fairness summary with a suggestion, then the session is live", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  await page.click('[data-act="wznew"]');
  await waitModal(page, true);
  await fill(page, "wzName", "Mabar Tes");
  await fill(page, "wzDur", "150");
  await fill(page, "wzSlot", "30");
  await fill(page, "wzStart", "19:00");
  await page.click('s-modal [data-act="wznext"]');
  await waitModalText(page, "2/3");

  await addPlayers(page, ["Budi", "Cici", "Dodi"]);
  await page.click('s-modal [data-act="wznext"]');                       // only three players
  assert.ok((await page.locator("#toast").textContent()).includes("Minimal 4 pemain"));
  await addPlayers(page, ["Eka", "Fajar", "Gita", "Hana"]);
  assert.equal(await page.locator('s-modal [data-act="wzrm"]').count(), 7);
  await page.click('s-modal [data-act="wznext"]');

  await waitModalText(page, "Tiap pemain main 2–3 game");                // 7 players, 5 matches
  assert.equal(await page.locator('s-modal [data-act="wzsug"]').count(), 1);
  await page.click('s-modal [data-act="wzsug"]');                         // 7 matches: everyone plays 4
  await waitModalText(page, "Semua pemain main 4 game");
  await page.waitForFunction(() => !document.querySelector('s-modal [data-act="wzgo"]').hasAttribute("disabled"));
  await page.click('s-modal [data-act="wzgo"]');
  await waitModal(page, false);

  await titleIs(page, "Mabar Tes");
  assert.equal(await page.locator(".match").count(), 7);
  assert.ok((await page.locator(".match").first().textContent()).includes("19:00–19:30"));
  assert.ok((await page.locator("#sSub").textContent()).includes("19:00–22:30"));
  assert.equal(await page.locator("#pemain s-section").count(), 7);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("create flow: names can be copied from an earlier session and removed again", async () => {
  const { page, ctx } = await open({ routes: fakeApi() });
  await waitLive(page);
  await page.click('[data-act="wznew"]');
  await waitModal(page, true);
  await page.click('s-modal [data-act="wznext"]');                       // defaults are valid
  await waitModalText(page, "2/3");
  await page.waitForSelector('s-modal [data-act="wzcopy"]');
  await page.click('s-modal [data-act="wzcopy"]');
  await page.click('s-modal [data-act="wzcopyfrom"][data-id="halloween"]');
  await waitModalText(page, "10 pemain");
  assert.equal(await page.locator('s-modal [data-act="wzrm"]').count(), 10);
  await page.click('s-modal [data-act="wzrm"] >> nth=0');
  assert.equal(await page.locator('s-modal [data-act="wzrm"]').count(), 9);
  await page.keyboard.press("Escape");
  await waitModal(page, false);
  await ctx.close();
});

test("create flow: step 1 rejects bad numbers and the summary offers both nearby equal counts", async () => {
  const { page, ctx } = await open({ routes: fakeApi() });
  await waitLive(page);
  await page.click('[data-act="wznew"]');
  await waitModal(page, true);
  await fill(page, "wzDur", "5");
  await page.click('s-modal [data-act="wznext"]');
  assert.ok((await page.locator("#toast").textContent()).includes("Durasi harus 10-720 menit"));
  await fill(page, "wzDur", "180");
  await fill(page, "wzStart", "7pm");
  await page.click('s-modal [data-act="wznext"]');
  assert.ok((await page.locator("#toast").textContent()).includes("HH:MM"));
  await fill(page, "wzStart", "9:30");                                    // normalised to 09:30
  await page.click('s-modal [data-act="wznext"]');
  await waitModalText(page, "2/3");
  await addPlayers(page, ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "B1"]);   // 10 players, 6 matches
  await page.click('s-modal [data-act="wznext"]');
  await waitModalText(page, "Tiap pemain main 2–3 game");
  assert.equal(await page.locator('s-modal [data-act="wzsug"]').count(), 2);            // 5 and 10 matches
  await page.keyboard.press("Escape");
  await ctx.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests/ui && node --test session.test.mjs`
Expected: the 3 new tests FAIL (`[data-act="wznew"]` not found).

- [ ] **Step 3: Session bar and create-modal code in `index.html`**

Add `wz=null;` to the modal `hide` listener (next to `subCtx=null;gameCtx=null;`).

Add this block after `paintGame()`:

```js
/* ---------- sesi baru ---------- */
var MON=["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"],DAY=["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
function dateNote(d){return DAY[d.getDay()]+" "+d.getDate()+" "+MON[d.getMonth()]}
function defaultStart(){var d=new Date();return hm(Math.ceil((d.getHours()*60+d.getMinutes())/5)*5)}
function durLabel(m){return String(m/60).replace(".",",")+" jam"}
/* salinan dari lib/schedule.js (klien tidak bisa require) */
function fairSummary(n,M){var slots=4*M,min=Math.floor(slots/n),extra=slots%n;return {min:min,max:extra?min+1:min,extra:extra,equal:extra===0}}
function gcd(a,b){return b?gcd(b,a%b):a}
function fairSuggest(n,M){var step=n/gcd(n,4);if(M%step===0)return {down:null,up:null};var d=Math.floor(M/step)*step,u=d+step;return {down:d>=1?d:null,up:u<=30?u:null}}
function renderSessBar(){
  $("sessbar").innerHTML=btn('variant="secondary" data-act="wznew"','+ Sesi baru');
}
function wzOpen(){
  var d=new Date();
  wz={step:1,name:"Mabar "+d.getDate()+" "+MON[d.getMonth()],dur:"180",slot:"30",start:defaultStart(),players:[],copyFrom:null,sessions:null,preview:null,busy:false};
  api("/api/sessions").then(function(r){if(wz){wz.sessions=r.sessions;if(wz.step===2)wz2()}}).catch(function(){});
  wzShow();
}
function wzShow(){
  if(!wz)return;
  if(wz.step===1)wz1();else if(wz.step===2)wz2();else if(wz.step==="copy")wzCopy();else wz3();
}
function wz1(){
  var quick=[60,90,120,150,180].map(function(m){return btn('variant="secondary" data-act="wzdur" data-min="'+m+'"',durLabel(m))}).join("");
  openModal("Sesi baru · 1/3",
    '<s-stack gap="base"><s-text-field id="wzName" label="Nama sesi" maxlength="40" autocomplete="off"></s-text-field>'
    +'<s-text-field id="wzDur" label="Durasi (menit)" autocomplete="off"></s-text-field>'
    +'<s-stack direction="inline" gap="small">'+quick+'</s-stack>'
    +'<s-text-field id="wzSlot" label="Menit per match" autocomplete="off"></s-text-field>'
    +'<s-text-field id="wzStart" label="Jam mulai (HH:MM)" placeholder="19:00" autocomplete="off"></s-text-field></s-stack>',
    {secondary:{act:"close",label:"Batal"},primary:{act:"wznext",label:"Lanjut"}});
  $("wzName").value=wz.name;$("wzDur").value=wz.dur;$("wzSlot").value=wz.slot;$("wzStart").value=wz.start;
}
function wzRead1(){wz.name=readName("wzName");wz.dur=readName("wzDur");wz.slot=readName("wzSlot");wz.start=readName("wzStart")}
function wzErr1(){
  var dur=+wz.dur,slot=+wz.slot;
  if(!wz.name)return "Isi nama sesi dulu";
  if(!(Number.isInteger(dur)&&dur>=10&&dur<=720))return "Durasi harus 10-720 menit";
  if(!(Number.isInteger(slot)&&slot>=10&&slot<=120))return "Menit per match harus 10-120";
  if(!/^([01]?\d|2[0-3]):[0-5]\d$/.test(wz.start))return "Jam mulai harus berformat HH:MM";
  return "";
}
function wzAddName(n,silent){
  n=String(n).trim().replace(/\s+/g," ");
  if(!n||n.length>20){if(!silent)toast("Nama harus 1-20 karakter");return false}
  if(wz.players.length>=20){if(!silent)toast("Maksimal 20 pemain");return false}
  if(wz.players.some(function(x){return x.toLowerCase()===n.toLowerCase()})){if(!silent)toast("Nama sudah ada");return false}
  wz.players.push(n);return true;
}
function wz2(){
  var chips=wz.players.map(function(n,i){return '<s-clickable class="pickItem" data-act="wzrm" data-i="'+i+'" accessibilityLabel="Hapus '+esc(n)+'"><s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="small"><s-text type="strong">'+esc(n)+'</s-text><s-text color="subdued">✕</s-text></s-stack></s-clickable>'}).join("");
  var copy=wz.sessions&&wz.sessions.length?btn('variant="secondary" data-act="wzcopy"','Ambil dari sesi sebelumnya'):'';
  openModal("Sesi baru · 2/3",
    '<s-stack gap="base"><s-paragraph color="subdued">'+wz.players.length+' pemain (minimal 4, maksimal 20). Ketuk nama untuk menghapus.</s-paragraph>'
    +'<s-stack direction="inline" gap="small" alignItems="end"><s-text-field id="wzPn" label="Nama pemain" placeholder="Nama" maxlength="20" autocomplete="off"></s-text-field>'+btn('variant="secondary" data-act="wzadd"','Tambah')+'</s-stack>'
    +copy+'<div class="pick">'+chips+'</div></s-stack>',
    {secondary:{act:"wzback",label:"Kembali"},primary:{act:"wznext",label:"Lanjut"}});
}
function wzCopy(){
  var rows=wz.sessions.map(function(s){return '<s-clickable class="pickItem" data-act="wzcopyfrom" data-id="'+esc(s.id)+'" accessibilityLabel="'+esc(s.name)+'"><s-stack gap="small-200"><s-text type="strong">'+esc(s.name)+'</s-text><s-text color="subdued">'+s.playerCount+' pemain</s-text></s-stack></s-clickable>'}).join("");
  openModal("Ambil dari sesi",'<s-stack gap="small">'+rows+'</s-stack>',{secondary:{act:"wzback",label:"Kembali"}});
}
function wzCopyFrom(id){
  var s=(wz.sessions||[]).filter(function(x){return x.id===id})[0];
  if(!s)return;
  (s.players||[]).forEach(function(n){wzAddName(n,true)});
  wz.copyFrom=id;wz.step=2;wz2();
}
function wz3(){
  var n=wz.players.length,slot=+wz.slot,dur=+wz.dur,M=Math.floor(dur/slot);
  var bad=M<1?"Durasi lebih pendek dari satu match":M>30?"Maksimal 30 match, kurangi durasi":"";
  var key=wz.players.join("|")+"/"+M+"/"+wz.name;
  var h='<s-stack gap="base">',ready=false;
  if(bad){h+='<s-banner tone="critical">'+esc(bad)+'</s-banner>'}
  else if(wz.preview&&wz.preview.key===key){
    if(wz.preview.error){h+='<s-banner tone="critical">'+esc(wz.preview.error)+'</s-banner>'}
    else{
      var counts=Array(n).fill(0);
      wz.preview.matches.forEach(function(m){m.a.concat(m.b).forEach(function(p){counts[p]++})});
      var mn=Math.min.apply(null,counts),mx=Math.max.apply(null,counts),s0=startMin({startTime:wz.start});
      h+='<s-text type="strong">'+n+' pemain · '+M+' match · '+hm(s0)+'–'+hm(s0+dur)+'</s-text>';
      if(mn===mx)h+='<s-text>Semua pemain main '+mn+' game.</s-text>';
      else{
        var fewer=wz.players.filter(function(_,i){return counts[i]===mn});
        h+='<s-text>Tiap pemain main '+mn+'–'+mx+' game.</s-text><s-text color="subdued">Main '+mn+' game: '+esc(fewer.join(", "))+'</s-text>';
        var sg=fairSuggest(n,M);
        if(sg.down)h+=btn('variant="secondary" data-act="wzsug" data-m="'+sg.down+'"','Kurangi jadi '+sg.down+' match (tiap orang '+(4*sg.down/n)+' game)');
        if(sg.up)h+=btn('variant="secondary" data-act="wzsug" data-m="'+sg.up+'"','Tambah jadi '+sg.up+' match (tiap orang '+(4*sg.up/n)+' game)');
      }
      ready=true;
    }
  }else{
    h+='<s-text color="subdued">Menghitung jadwal…</s-text>';
    api("/api/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"preview",name:wz.name,players:wz.players,durationMin:dur,slotMin:slot,startTime:wz.start})})
      .then(function(r){if(wz&&wz.step===3){wz.preview={key:key,matches:r.matches};wz3()}})
      .catch(function(e){if(wz&&wz.step===3){wz.preview={key:key,error:e.message};wz3()}});
  }
  openModal("Sesi baru · 3/3",h+'</s-stack>',{secondary:{act:"wzback",label:"Kembali"},primary:{act:"wzgo",label:"Mulai sesi"}});
  var go=modal.querySelector('[data-act="wzgo"]');if(go)go.toggleAttribute("disabled",!ready);
}
function wzNext(){
  if(wz.step===1){
    wzRead1();var e=wzErr1();if(e){toast(e);return}
    wz.start=("0"+wz.start).slice(-5);wz.step=2;wz2();
  }else if(wz.step===2){
    var t=readName("wzPn");if(t)wzAddName(t);
    if(wz.players.length<4){toast("Minimal 4 pemain");wz2();return}
    wz.step=3;wz.preview=null;wz3();
  }
}
function wzGo(){
  if(!wz||wz.busy)return;
  var body={name:wz.name,players:wz.players.slice(),durationMin:+wz.dur,slotMin:+wz.slot,startTime:wz.start,note:dateNote(new Date())};
  if(wz.copyFrom)body.copyFrom=wz.copyFrom;
  wz.busy=true;
  api("/api/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(function(){closeModal();viewSid=null;pull(true)})
    .catch(function(e){if(wz)wz.busy=false;toast(e.message)});
}
```

Change `render()` to also draw the bar:

```js
function render(){
  renderHeader();renderSessBar();renderChip();renderJadwal();renderKlasemen();renderPemain();
  $("tools").innerHTML=btn('variant="secondary" tone="critical" data-act="resetall"','Hapus semua skor');
}
```

In the click handler's `a===` chain, add before `else if(a==="pick")`:

```js
  else if(a==="wznew"){wzOpen()}
  else if(a==="wzdur"&&wz){var df=$("wzDur");if(df)df.value=t.dataset.min}
  else if(a==="wznext"&&wz){wzNext()}
  else if(a==="wzback"&&wz){wz.step=wz.step==="copy"?2:wz.step-1;wzShow()}
  else if(a==="wzadd"&&wz){if(wzAddName(readName("wzPn")))wz2()}
  else if(a==="wzrm"&&wz){wz.players.splice(+t.dataset.i,1);wz2()}
  else if(a==="wzcopy"&&wz){wz.step="copy";wzShow()}
  else if(a==="wzcopyfrom"&&wz){wzCopyFrom(t.dataset.id)}
  else if(a==="wzsug"&&wz){wz.dur=String((+t.dataset.m)*(+wz.slot));wz.preview=null;wz3()}
  else if(a==="wzgo"&&wz){wzGo()}
```

and extend the Enter-key handler's id map so Enter in the player field adds the name:
`var act=e.target.id==="rstIn"?"rstok":e.target.id==="npIn"?"npok":e.target.id==="gpIn"?"gameaddplayer":e.target.id==="wzPn"?"wzadd":null;`

- [ ] **Step 4: Run the tests**

Run: `cd tests/ui && node --test session.test.mjs` then `npm test`
Expected: all session tests PASS and the full UI suite passes. If an existing test fails because `#sessbar` adds a header control (for example a height or count assertion), adapt only that assertion and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui/session.test.mjs
git commit -m "feat(ui): three-step create-session modal with fairness summary

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Fairness display (session card and match count on phones)

**Files:**
- Modify: `index.html`
- Modify: `tests/ui/session.test.mjs`

**Interfaces:**
- Consumes: `stats()` (existing; `sched` = total matches per player, `played` = finished matches).
- Produces: `fairLine() -> string`, `sessionCard() -> html` (a `.sesscard` block at the top of Jadwal), `.cnt` span under the player name in the klasemen (phones only).

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/session.test.mjs`:

```js
test("session card says how many matches each player gets and updates after a manual game", async () => {
  const { page, ctx } = await open({ routes: fakeApi() });
  await waitLive(page);
  const card = page.locator("#jadwal .sesscard");
  assert.ok((await card.textContent()).includes("Tiap pemain main 4 game"));
  assert.ok((await card.textContent()).includes("10 pemain · 10 match"));
  await page.evaluate(async () => {
    await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "addmatch", a: [0, 1], b: [2, 3] }) });
  });
  await page.waitForFunction(() => document.querySelector("#jadwal .sesscard").textContent.includes("6 orang main 4 kali, 4 orang main 5 kali"));
  assert.ok((await card.textContent()).includes("Paling sedikit (4 game)"));
  await ctx.close();
});

test("klasemen: phones show the match count under the name; wide screens keep the Main column only", async () => {
  for (const [w, visible] of [[390, true], [768, false]]) {
    const { page, ctx } = await open({ routes: fakeApi(), width: w, height: 900 });
    await waitLive(page);
    await page.click('[data-tab="klasemen"]');
    const cnt = page.locator("#klasemen .cnt").first();
    assert.equal(await cnt.isVisible(), visible, `${w}px`);
    assert.equal((await cnt.textContent()).trim(), "main 0/4");
    await ctx.close();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests/ui && node --test session.test.mjs`
Expected: the 2 new tests FAIL (`.sesscard` not found).

- [ ] **Step 3: Implement in `index.html`**

CSS (next to the `.toolbar` rule):

```css
s-stack.sesscard{display:flex;margin-bottom:12px}
.cnt{display:block;font-size:12.5px;font-weight:500;color:var(--muted)}
@media (min-width:490px){#klasemen .cnt{display:none}}
```

JS, placed before `renderJadwal`:

```js
function fairLine(){
  var c={};
  stats().forEach(function(r){c[r.sched]=(c[r.sched]||0)+1});
  var ks=Object.keys(c).map(Number).sort(function(a,b){return a-b});
  if(ks.length===1)return "Tiap pemain main "+ks[0]+" game";
  return ks.map(function(k){return c[k]+" orang main "+k+" kali"}).join(", ");
}
function sessionCard(){
  if(!state.matches.length)return '';
  var st=stats(),sc=st.map(function(r){return r.sched}),mn=Math.min.apply(null,sc),mx=Math.max.apply(null,sc);
  var h='<s-stack class="sesscard" gap="small-200"><s-text type="strong">'+esc(fairLine())+'</s-text><s-text color="subdued">'+PLAYERS.length+' pemain · '+state.matches.length+' match</s-text>';
  if(mn<mx)h+='<s-text color="subdued">Paling sedikit ('+mn+' game): '+esc(st.filter(function(r){return r.sched===mn}).map(function(r){return r.name}).join(", "))+'</s-text>';
  return h+'</s-stack>';
}
```

In `renderJadwal` change the first line to start with the card:
`var cur=firstOpen(),h=sessionCard()+banner()+'<s-stack class="toolbar" ...` (only prefix `sessionCard()+`; the rest of the line stays).

In `renderKlasemen` change the `name` variable so the count sits under the name inside `.pn`:

```js
    var name='<span class="pn"><b'+(top?' class="topn"':'')+'>'+(idx+1)+'. '+esc(r.name)+'</b>'+(r.i===me.p?'<s-badge tone="info">kamu</s-badge>':'')+'<span class="cnt">main '+r.played+'/'+r.sched+'</span></span>';
```

- [ ] **Step 4: Run the tests**

Run: `cd tests/ui && node --test session.test.mjs` then `npm test`
Expected: PASS. The existing test "phone: compact standings list, name and Recap on one row" measures row height (average at most 110px) and name/Recap vertical alignment; if the extra line breaks it, make `.cnt` inline instead (`display:inline;margin-left:8px`) rather than weakening the test, and report which variant you used. The check that the Main and Game columns are hidden on phones must keep passing unchanged.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui/session.test.mjs
git commit -m "feat(ui): session fairness card and match counts under names on phones

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Session history and read-only view

**Files:**
- Modify: `index.html`
- Modify: `tests/ui/session.test.mjs`

**Interfaces:**
- Consumes: `viewSid`, `quiet`, `isRO()` (Task 4); `GET /api/sessions`; `POST /api/sessions {op:"activate", id}`.
- Produces: `data-act` values `hist`, `histopen` (`data-id`), `histback`, `histactivate`; read-only mode (no scoring or editing controls, banner "Sesi lama").

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/session.test.mjs`:

```js
test("history: open an old session read-only, go back, or make it active", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  await createSession(page);
  await titleIs(page, "Mabar Kamis");

  await page.click('[data-act="hist"]');
  await waitModal(page, true);
  await page.waitForSelector('s-modal [data-act="histopen"]');
  assert.equal(await page.locator('s-modal [data-act="histopen"]').count(), 2);
  await page.click('s-modal [data-act="histopen"][data-id="halloween"]');
  await waitModal(page, false);
  await page.waitForFunction(() => document.getElementById("sTitle").textContent === "Halloween Tennis" && document.querySelector("#jadwal s-banner[heading='Sesi lama']"));
  for (const sel of ["[data-pt]", "[data-sub]", "[data-setcur]", '[data-act="addgame"]', '[data-act="addplayer"]', "#tools s-button"]) {
    assert.equal(await page.locator(sel).count(), 0, sel);
  }
  assert.equal(await page.locator('[data-act="histback"]').count(), 1);
  assert.equal(await page.locator(".match").count(), 10);

  await page.click('[data-act="histback"]');
  await titleIs(page, "Mabar Kamis");
  assert.equal(await page.locator("#jadwal s-banner[heading='Sesi lama']").count(), 0);
  assert.equal(await page.locator('[data-act="addgame"]').count(), 1);

  // make the old one active again
  await page.click('[data-act="hist"]');
  await page.waitForSelector('s-modal [data-act="histopen"]');
  await page.click('s-modal [data-act="histopen"][data-id="halloween"]');
  await page.waitForSelector('[data-act="histactivate"]');
  await page.click('[data-act="histactivate"]');
  await page.waitForFunction(() => !document.querySelector("#jadwal s-banner[heading='Sesi lama']") && document.querySelector('[data-act="addgame"]'));
  assert.equal(await page.evaluate(async () => (await (await fetch("/api/sessions")).json()).active), "halloween");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("writes to an old session are refused even if the controls were somehow used", async () => {
  const { page, ctx } = await open({ routes: fakeApi() });
  await waitLive(page);
  await createSession(page);
  await titleIs(page, "Mabar Kamis");
  const status = await page.evaluate(async () =>
    (await fetch("/api/state?sid=halloween", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "setcurrent", i: 1 }) })).status);
  assert.equal(status, 409);
  await ctx.close();
});
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `cd tests/ui && node --test session.test.mjs`
Expected: the history test FAILS (`[data-act="hist"]` not found); the 409 test already passes (server behavior from Task 2).

- [ ] **Step 3: Implement in `index.html`**

Session bar gets the second button:

```js
function renderSessBar(){
  $("sessbar").innerHTML=btn('variant="secondary" data-act="wznew"','+ Sesi baru')+btn('variant="secondary" data-act="hist"','Riwayat');
}
```

History modal and helpers (place after `wzGo()`):

```js
var histActive=null;
function histModal(){
  openModal("Riwayat sesi",'<div id="histBody"><s-text color="subdued">Memuat…</s-text></div>',{secondary:{act:"close",label:"Tutup"}});
  api("/api/sessions").then(function(r){
    var box=$("histBody");if(!box)return;
    histActive=r.active;
    var rows=r.sessions.map(function(s){
      var shown=viewSid?s.id===viewSid:s.id===r.active;
      return '<s-clickable class="pickItem'+(shown?' sel':'')+'" data-act="histopen" data-id="'+esc(s.id)+'" accessibilityLabel="'+esc(s.name)+'"><s-stack gap="small-200"><s-stack direction="inline" alignItems="center" gap="small"><s-text type="strong">'+esc(s.name)+'</s-text>'+(s.id===r.active?'<s-badge tone="success">Aktif</s-badge>':'')+'</s-stack><s-text color="subdued">'+esc((s.note?s.note+" · ":"")+s.playerCount+" pemain · "+s.doneCount+"/"+s.matchCount+" match")+'</s-text></s-stack></s-clickable>';
    }).join("");
    box.innerHTML='<s-stack gap="small">'+rows+'</s-stack>';
  }).catch(function(){var box=$("histBody");if(box)box.innerHTML='<s-text color="subdued">Gagal memuat riwayat. Coba lagi.</s-text>'});
}
function roBar(){
  return '<s-stack class="toolbar" direction="inline" gap="small">'+btn('variant="primary" data-act="histback"','Kembali ke sesi aktif')+btn('variant="secondary" data-act="histactivate"','Jadikan aktif')+'</s-stack>';
}
```

Read-only effects:

```js
function canScore(i){return !isRO()&&i===curIdx()&&!state.matches[i].done}
function canAct(i){var m=state.matches[i];return !isRO()&&(i===curIdx()||m.done||(m.hn||0)>0)}
```
(replace the existing two functions), and in `banner()` add as the first statement:

```js
  if(isRO())return '<s-banner class="gap" tone="warning" heading="Sesi lama">Kamu sedang melihat sesi ini hanya-lihat. Skor tidak bisa diubah.</s-banner>';
```

In `renderJadwal`: replace the toolbar piece of the first line so it reads

```js
  var cur=firstOpen(),h=sessionCard()+banner()+(isRO()?roBar():'<s-stack class="toolbar" direction="inline" gap="small">'+btn('variant="secondary" data-act="addgame"','+ Game manual')+btn('variant="secondary" data-act="addplayer"','+ Pemain baru')+'</s-stack>')+'<div class="matches">';
```

and change `if(!m.done){` (the block that builds the "Ganti pemain" / "Jadikan sedang main" buttons) to `if(!m.done&&!isRO()){`. In `render()` change the tools line to `$("tools").innerHTML=isRO()?'':btn('variant="secondary" tone="critical" data-act="resetall"','Hapus semua skor');`.

Click handlers (add before `else if(a==="pick")`):

```js
  else if(a==="hist"){histModal()}
  else if(a==="histopen"){
    var hid=t.dataset.id,cur0=viewSid;
    viewSid=(hid===histActive)?null:hid;
    if(viewSid!==cur0){quiet=true;rev=0}
    closeModal();pull(true);
  }
  else if(a==="histback"){viewSid=null;quiet=true;rev=0;pull(true)}
  else if(a==="histactivate"&&viewSid){
    var aid=viewSid;
    api("/api/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"activate",id:aid})})
      .then(function(){viewSid=null;rev=0;return pull(true)})
      .then(function(){toast("Sesi diaktifkan: "+((sess()&&sess().name)||""))})
      .catch(function(e){toast(e.message)});
  }
```

(`rev=0` forces the next poll to re-adopt even when the revision number happens to match.)

- [ ] **Step 4: Run the tests**

Run: `cd tests/ui && node --test session.test.mjs` then `npm test`
Expected: PASS, full UI suite green.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui/session.test.mjs
git commit -m "feat(ui): session history with read-only view and activation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Manual-game recommendation

**Files:**
- Modify: `index.html`
- Modify: `tests/ui/roster.test.mjs`

**Interfaces:**
- Consumes: `state.suggest` (`{a:[p,p], b:[p,p]} | null`, from the server since Task 2), `stats()`, `gameCtx`, `pickBtn`/`avatar`/`esc`, `btn`.
- Produces: `suggestIds() -> [a0,a1,b0,b1] | []`, `gameBtn(p, selected, recommended, statsRow)`; a "Pakai saran" button (`data-act="gamesuggest"`) and "Disarankan" badges in the "+ Game manual" modal. Existing `data-act="gametoggle"` / `data-p` attributes are unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/roster.test.mjs`:

```js
test("manual game: the four players with the fewest matches are suggested and 'Pakai saran' fills them", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  await page.click('[data-act="addgame"]');
  await waitModal(page, true);
  assert.equal(await page.locator("s-modal .pickItem s-badge").count(), 4);
  assert.ok((await page.locator("s-modal").first().textContent()).includes("Disarankan"));
  assert.notEqual(await page.locator('s-modal [data-act="gamego"]').getAttribute("disabled"), null);
  const sug = await page.evaluate(async () => (await (await fetch("/api/state")).json()).suggest);
  await page.click('s-modal [data-act="gamesuggest"]');
  const sel = await page.locator("s-modal .pickItem.sel").evaluateAll((els) => els.map((e) => +e.dataset.p));
  assert.deepEqual(sel, [...sug.a, ...sug.b]);
  assert.equal(await page.locator('s-modal [data-act="gamego"]').getAttribute("disabled"), null);
  // the picks stay editable
  await page.click(`s-modal [data-act="gametoggle"][data-p="${sel[3]}"]`);
  assert.notEqual(await page.locator('s-modal [data-act="gamego"]').getAttribute("disabled"), null);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("manual game: a new player with no matches goes to the top of the list with the count shown", async () => {
  const { page, ctx } = await open({ routes: fakeApi() });
  await waitLive(page);
  await page.click('[data-act="addgame"]');
  await waitModal(page, true);
  await page.fill("s-text-field#gpIn input", "Tamu");
  await page.click('s-modal [data-act="gameaddplayer"]');
  await page.waitForSelector('s-modal [data-act="gametoggle"][data-p="10"]');
  // the four suggested players come first (the new player is one of them); everyone after them is not suggested
  const items = page.locator("s-modal .pickItem");
  for (let k = 0; k < 4; k++) assert.ok((await items.nth(k).textContent()).includes("Disarankan"), `item ${k}`);
  assert.ok(!(await items.nth(4).textContent()).includes("Disarankan"));
  const tamu = page.locator('s-modal [data-act="gametoggle"][data-p="10"]');
  assert.ok((await tamu.textContent()).includes("Disarankan"));
  assert.ok((await tamu.textContent()).includes("main 0/0"));
  assert.ok((await page.locator('s-modal [data-act="gametoggle"][data-p="9"]').textContent()).includes("main 0/4"));
  await ctx.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests/ui && node --test roster.test.mjs`
Expected: the 2 new tests FAIL (no badges, no `gamesuggest`).

- [ ] **Step 3: Implement in `index.html`**

Replace `paintGame()` with the following and add the two helpers above it:

```js
function suggestIds(){
  var g=state.suggest;
  if(!g||!g.a||!g.b)return [];
  var ids=g.a.concat(g.b);
  return ids.every(function(p){return Number.isInteger(p)&&p>=0&&p<PLAYERS.length})?ids:[];
}
function gameBtn(p,sel,rec,r){
  return '<s-clickable class="pickItem'+(sel?' sel':'')+'" data-act="gametoggle" data-p="'+p+'" accessibilityLabel="'+esc(PLAYERS[p])+'"><s-stack direction="inline" alignItems="center" gap="small">'+avatar(p,32)+'<s-stack gap="small-200"><s-text type="strong">'+esc(PLAYERS[p])+'</s-text><s-text color="subdued">main '+r.played+'/'+r.sched+'</s-text></s-stack>'+(rec?'<s-badge tone="info">Disarankan</s-badge>':'')+'</s-stack></s-clickable>';
}
function paintGame(){
  var box=$("gameBody");if(!box||!gameCtx)return;
  var keep=($("gpIn")||{}).value||"";
  var sel=gameCtx.sel=gameCtx.sel.filter(function(p){return p<PLAYERS.length});
  var rec=suggestIds(),st=stats();
  var order=rec.concat(st.slice().sort(function(a,b){return a.sched-b.sched||a.played-b.played||a.i-b.i}).map(function(r){return r.i}).filter(function(p){return rec.indexOf(p)<0}));
  function nameAt(k){return sel[k]!==undefined?PLAYERS[sel[k]]:"…"}
  var h='<s-stack gap="base"><s-paragraph color="subdued">Pilih 4 pemain. Dua yang pertama jadi Tim A, dua berikutnya Tim B. Ketuk lagi untuk batal.</s-paragraph>';
  if(rec.length===4)h+='<s-stack direction="inline" gap="small" alignItems="center">'+btn('variant="secondary" data-act="gamesuggest"','Pakai saran')+'<s-text color="subdued">Pemain dengan jumlah main paling sedikit</s-text></s-stack>';
  h+='<s-text type="strong">Tim A: '+esc(nameAt(0)+" & "+nameAt(1))+'</s-text><s-text type="strong">Tim B: '+esc(nameAt(2)+" & "+nameAt(3))+'</s-text><div class="pick">';
  order.forEach(function(p){h+=gameBtn(p,sel.indexOf(p)>=0,rec.indexOf(p)>=0,st[p])});
  h+='</div><s-stack direction="inline" gap="small" alignItems="end"><s-text-field id="gpIn" label="Pemain baru" placeholder="Nama" maxlength="20" autocomplete="off"></s-text-field>'+btn('variant="secondary" data-act="gameaddplayer"','Tambah')+'</s-stack></s-stack>';
  box.innerHTML=h;
  var f=$("gpIn");if(f)f.value=keep;
  var go=modal.querySelector('[data-act="gamego"]');if(go)go.toggleAttribute("disabled",sel.length!==4);
}
```

Click handler, next to `gametoggle`:

```js
  else if(a==="gamesuggest"&&gameCtx){var ids=suggestIds();if(ids.length===4){gameCtx.sel=ids;paintGame()}}
```

- [ ] **Step 4: Run the tests**

Run: `cd tests/ui && node --test roster.test.mjs` then `npm test`
Expected: PASS. The two existing manual-game tests (`gametoggle` by `data-p`, inline add) must still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui/roster.test.mjs
git commit -m "feat(ui): recommend the players with the fewest matches for manual games

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: README and full regression

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the feature**

In `README.md`, under "Cara pakai", add:

```markdown
- Sesi baru: tombol "+ Sesi baru" di bagian atas. Isi nama, durasi, menit per match, dan jam mulai; tambah pemain (atau "Ambil dari sesi sebelumnya" untuk menyalin nama dan fotonya); lihat ringkasannya, lalu "Mulai sesi". Jadwal dibuat otomatis: jumlah main tiap pemain sama atau selisih paling banyak satu. Kalau belum pas sama rata, ringkasan memberi saran jumlah match terdekat yang membuat semua orang main sama banyak.
- Semua HP otomatis pindah ke sesi yang baru dimulai. Ketuk "Riwayat" untuk melihat sesi lama (hanya-lihat) atau menjadikannya aktif lagi.
- Game manual: di dialog "+ Game manual", pemain dengan jumlah main paling sedikit diberi label "Disarankan"; "Pakai saran" mengisi keempat pemain itu (masih bisa diubah).
- Jumlah main tiap pemain tampil di bawah namanya di Klasemen (HP) dan di kartu ringkasan di tab Jadwal.
```

Under "Isi", add the new files:

```markdown
- `lib/schedule.js`  pembuat jadwal yang adil dan rekomendasi pemain untuk game manual
- `lib/sessions.js`  penyimpanan sesi (indeks, kunci Redis, migrasi data Halloween jadi sesi pertama)
- `api/sessions.js`  daftar sesi, pratinjau jadwal, buat sesi, aktifkan sesi
```

Also add one sentence to the deploy notes: "Data Halloween yang sudah ada otomatis menjadi sesi pertama ("Halloween Tennis"); tidak ada langkah migrasi." and update the line that describes `api/state.js`/`api/photo.js` to mention the optional `?sid=` parameter.

- [ ] **Step 2: Full regression**

Run:
```bash
node --test tests/api/schedule.test.mjs tests/api/sessions.test.mjs tests/api/sessions-api.test.mjs tests/api/state.test.mjs
cd tests/ui && npm test
```
Expected: every test passes (API: 10 schedule + 7 sessions + 10 sessions-api + 12 state = 39; UI: 60 existing + 12 new = 72). Report the exact counts.

- [ ] **Step 3: Check the Redis command surface**

Run: `grep -rhoE 'cmd\(\["[A-Z]+"' api lib | sort | uniq -c`
Expected: only `GET`, `SET`, `DEL`, `HSET`, `HDEL`, `HGETALL` appear.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: sessions, fair schedule and manual-game recommendations

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
