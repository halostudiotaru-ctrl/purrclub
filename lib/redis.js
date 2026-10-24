// Klien Redis REST minimal (Upstash / Vercel). Tanpa dependency.
// Mengenali nama variabel apa pun, termasuk yang diberi awalan (misal STORAGE_KV_REST_API_URL).
function findEnv(suffixes) {
  for (const s of suffixes) {
    if (process.env[s]) return process.env[s];
  }
  for (const k of Object.keys(process.env)) {
    for (const s of suffixes) {
      if (k.endsWith("_" + s) && process.env[k]) return process.env[k];
    }
  }
  return undefined;
}
const URL_ = findEnv(["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"]);
const TOKEN = findEnv(["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"]);

async function cmd(args) {
  if (!URL_ || !TOKEN) throw new Error("Database belum terhubung (variabel REST URL / TOKEN tidak ditemukan)");
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
module.exports = { cmd };
