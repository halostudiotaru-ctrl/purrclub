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
