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
