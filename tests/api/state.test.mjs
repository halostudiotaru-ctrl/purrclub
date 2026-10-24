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

test("addplayer drops a stale photo left on the reused index", async () => {
  kv.set("ht:photo:10", "stale"); hashOf("ht:photov").set("10", "1");
  kv.set("ht:photo:3", "y"); hashOf("ht:photov").set("3", "1");
  const r = await post({ op: "addplayer", name: "Tamu" });
  assert.equal(r.status, 200);
  assert.equal(kv.has("ht:photo:10"), false);
  assert.equal(hashOf("ht:photov").has("10"), false);
  assert.equal(kv.get("ht:photo:3"), "y");
  assert.equal(hashOf("ht:photov").get("3"), "1");
});

test("addmatch is capped at 40 matches", async () => {
  for (let k = 0; k < 30; k++) assert.equal((await post({ op: "addmatch", a: [0, 1], b: [2, 3] })).status, 200);
  const r = await post({ op: "addmatch", a: [0, 1], b: [2, 3] });
  assert.equal(r.status, 409);
  assert.equal((await get()).body.matches.length, 40);
});
