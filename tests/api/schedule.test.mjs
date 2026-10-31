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
