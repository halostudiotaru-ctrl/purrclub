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
