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
