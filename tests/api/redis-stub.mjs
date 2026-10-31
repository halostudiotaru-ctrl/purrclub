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
