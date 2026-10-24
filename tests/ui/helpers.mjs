import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let server = null, browser = null, base = null;

export async function setup() {
  if (!server) {
    server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      if (u.pathname.startsWith("/api/")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end('{"error":"offline"}');
        return;
      }
      const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = "http://127.0.0.1:" + server.address().port;
  }
  if (!browser) browser = await chromium.launch({ channel: "chrome" });
  return { base, browser };
}

export async function teardown() {
  if (browser) await browser.close();
  if (server) server.close();
  browser = server = base = null;
}

// routes: [[pattern, handler]] registered on the context before the page loads (e.g. to mock /api/*).
export async function open({ width = 390, height = 844, scheme = "light", me = 0, block = [], routes = [] } = {}) {
  const { base, browser } = await setup();
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  if (me !== null) {
    await ctx.addInitScript((p) => localStorage.setItem("halloween-tennis-me-v1", JSON.stringify({ p, photo: null })), me);
  }
  for (const pat of block) await ctx.route(pat, (r) => r.abort());
  for (const [pat, handler] of routes) await ctx.route(pat, handler);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base);
  await page.waitForSelector(".match");
  await page.evaluate(() => document.fonts.ready);
  return { page, ctx, errors };
}

// Works with the old overlay (#ov.on) and the new s-modal (#modal, internal <dialog>).
export const modalOpen = (page) =>
  page.evaluate(() => {
    const m = document.getElementById("modal");
    if (m) { const d = m.shadowRoot && m.shadowRoot.querySelector("dialog"); return !!(d && d.open); }
    const o = document.getElementById("ov");
    return !!(o && o.classList.contains("on"));
  });

export const modalText = (page) =>
  page.evaluate(() => {
    const m = document.getElementById("modal");
    if (m) return (m.getAttribute("heading") || "") + " " + m.textContent;
    const o = document.getElementById("ov");
    return o ? o.textContent : "";
  });

export async function waitModal(page, open = true, ms = 3000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if ((await modalOpen(page)) === open) return;
    await page.waitForTimeout(50);
  }
  throw new Error("modal did not become " + (open ? "open" : "closed"));
}

export async function waitModalText(page, sub, ms = 3000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if ((await modalText(page)).includes(sub)) return;
    await page.waitForTimeout(50);
  }
  throw new Error("modal text never included: " + sub);
}
