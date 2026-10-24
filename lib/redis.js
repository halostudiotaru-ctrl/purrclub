// Klien Redis REST minimal (Upstash / Vercel KV). Tanpa dependency.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function cmd(args) {
  if (!URL_ || !TOKEN) throw new Error("Database belum terhubung (env KV_REST_API_URL / KV_REST_API_TOKEN kosong)");
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
