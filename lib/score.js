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
