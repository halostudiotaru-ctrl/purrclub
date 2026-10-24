# Purrclub → Polaris Web Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every UI element of `index.html` with Shopify App Home web components (`s-*`), keeping the Purrclub color scheme, switching the font to Plus Jakarta Sans, and making the layout work well on phone and iPad.

**Architecture:** `index.html` stays a single file with string-built `innerHTML` render functions; only the markup they emit changes. Polaris's `polaris.js` is loaded from Shopify's CDN. A single theme block on `body` maps the existing `:root` palette variables onto Polaris's per-component CSS variables (`--p-color-…-f4125`), so light/dark switching keeps working. Page-level layout (1/2/3 columns) uses CSS media queries; inner layout uses `s-stack`/`s-grid`. Behavior is protected by Playwright smoke tests that drive the real page in Chrome, written before each change.

**Tech Stack:** Vanilla JS, Shopify `polaris.js` web components (CDN), Plus Jakarta Sans (Google Fonts), `playwright-core` + `node:test` for UI tests (dev-only, in `tests/ui/`).

**Spec:** [docs/superpowers/specs/2026-10-24-polaris-web-components-design.md](../specs/2026-10-24-polaris-web-components-design.md)

## Global Constraints

- Color scheme stays the existing palette: `--bg --surface --surface2 --ink --muted --pumpkin --pumpkin-ink --line --win --lose --live`, light and dark. Components get colors only through the theme block, which references those variables (never new literal hex values, except the new `--lose-ink`).
- Font: Plus Jakarta Sans everywhere (weights 400/500/600/700/800), set via `--p-font-family-sans-f4125` and on `body`. Eater / Barlow font links stay loaded **only** because the recap canvas (`drawRecap`) still draws with them. Do not touch `drawRecap`, `rr`, `fit`, `loadImg`.
- Breakpoints: phone `<700px`, iPad portrait `700–1023px`, iPad landscape `≥1024px`. Page max width: full / 880px / 1120px; gutters 16 / 24 / 32px.
- Touch targets ≥ 44px tall; `+ Poin` buttons ≥ 56px tall.
- No horizontal page scroll at 390, 768 and 1180px wide.
- Keep `data-act`, `data-pt`, `data-undo`, `data-reset`, `data-tab`, `data-p` attributes and element ids `chip jadwal klasemen pemain tools toast sync rstIn rbox selfieIn galleryIn` unchanged. App logic, API calls, scoring, Redis and recap artwork are out of scope.
- The custom `#toast` stays (restyled with palette variables).
- Do not change files outside `index.html`, `tests/ui/`, `.gitignore`, `README.md`, `docs/`.
- Commit messages end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## File Structure

- Modify: `index.html` — head (fonts, script, theme, CSS), body markup, render/modal/event JS.
- Create: `tests/ui/package.json` — dev dependency + `npm test`.
- Create: `tests/ui/helpers.mjs` — static server, browser launch, `open()`, modal helpers.
- Create: `tests/ui/behavior.test.mjs` — behavior that must survive the migration (green first).
- Create: `tests/ui/foundation.test.mjs` — font, theme tokens, load-failure notice.
- Create: `tests/ui/shell.test.mjs`, `modals.test.mjs`, `jadwal.test.mjs`, `klasemen.test.mjs`, `pemain.test.mjs` — one per task.
- Create: `tests/ui/shoot.mjs` — screenshot matrix for visual review (not a test).
- Create: `.gitignore` — `node_modules/`, `tests/ui/out/`.
- Modify: `README.md` — one line each about the Polaris CDN dependency and how to run UI tests.

Every task: run its new test first and watch it fail, implement, run `cd tests/ui && npm test` (whole suite) and watch it pass, commit.

---

### Task 1: UI test harness and behavior baseline

**Files:**
- Create: `.gitignore`, `tests/ui/package.json`, `tests/ui/helpers.mjs`, `tests/ui/behavior.test.mjs`

**Interfaces:**
- Produces (used by every later test file): from `helpers.mjs` — `open({width=390,height=844,scheme="light",me=0,block=[]}) → {page,ctx,errors}` (`me:null` = no player chosen yet; `block` = URL globs to abort), `waitModal(page,open=true,ms=3000)`, `waitModalText(page,substring,ms=3000)`, `modalText(page) → string`, `modalOpen(page) → boolean`, `teardown()`. `open()` waits for `.match` and fonts.

- [ ] **Step 1: Check prerequisites**

Run: `node -v && ls "/Applications/Google Chrome.app" >/dev/null && echo chrome-ok`
Expected: Node `v18` or newer, then `chrome-ok`.

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
tests/ui/out/
```

- [ ] **Step 3: Create `tests/ui/package.json`**

```json
{
  "name": "purrclub-ui-tests",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" },
  "devDependencies": { "playwright-core": "^1.49.0" }
}
```

- [ ] **Step 4: Create `tests/ui/helpers.mjs`**

```js
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

export async function open({ width = 390, height = 844, scheme = "light", me = 0, block = [] } = {}) {
  const { base, browser } = await setup();
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  if (me !== null) {
    await ctx.addInitScript((p) => localStorage.setItem("halloween-tennis-me-v1", JSON.stringify({ p, photo: null })), me);
  }
  for (const pat of block) await ctx.route(pat, (r) => r.abort());
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
```

- [ ] **Step 5: Create `tests/ui/behavior.test.mjs`**

```js
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown, waitModal, waitModalText, modalText } from "./helpers.mjs";

after(teardown);

const freshMatches = () =>
  Array.from({ length: 10 }, () => ({ games: [0, 0], p: [0, 0], adv: null, deuceN: 0, sudden: false, done: false, hn: 0 }));
const RESET_INPUT = "input#rstIn, s-text-field#rstIn input";

test("renders 10 matches without page errors", async () => {
  const { page, ctx, errors } = await open();
  assert.equal(await page.locator(".match").count(), 10);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("tabs switch sections", async () => {
  const { page, ctx } = await open();
  await page.click('[data-tab="klasemen"]');
  assert.equal(await page.locator("#klasemen.on").count(), 1);
  assert.equal(await page.locator("#jadwal.on").count(), 0);
  await page.click('[data-tab="pemain"]');
  assert.equal(await page.locator("#pemain.on").count(), 1);
  await ctx.close();
});

test("first visit: pick player, selfie step, close", async () => {
  const { page, ctx } = await open({ me: null });
  await waitModal(page, true, 4000);
  assert.match(await modalText(page), /Kamu yang mana\?/);
  await page.click('[data-act="choose"][data-p="1"]');
  await waitModalText(page, "Selfie buat recap-mu");
  await page.click('[data-act="close"]');
  await waitModal(page, false);
  assert.match(await page.locator("#chip").textContent(), /Kamu: Faiz/);
  await ctx.close();
});

test("adding a point shows 15 on the live match", async () => {
  const { page, ctx } = await open();
  await page.click('[data-pt="0:0"]');
  await page.waitForFunction(() => document.getElementById("jadwal").textContent.includes("15"));
  await ctx.close();
});

test("reset match asks first; cancel keeps the score", async () => {
  const { page, ctx } = await open();
  await page.click('[data-pt="0:0"]');
  await page.waitForSelector('[data-reset="0"]');
  await page.click('[data-reset="0"]');
  await waitModal(page, true);
  assert.match(await modalText(page), /Reset skor Match 1\?/);
  await page.click('[data-act="no"]');
  await waitModal(page, false);
  assert.ok((await page.locator("#jadwal").textContent()).includes("15"));
  await ctx.close();
});

test("reset all needs RESET typed", async () => {
  const { page, ctx } = await open();
  await page.route("**/api/state", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rev: 1, matches: freshMatches(), photos: {} }) }));
  await page.click('[data-act="resetall"]');
  await waitModal(page, true);
  await page.fill(RESET_INPUT, "nope");
  await page.click('[data-act="rstok"]');
  await page.waitForFunction(() => document.getElementById("toast").textContent === "Ketik RESET dulu");
  await page.fill(RESET_INPUT, "RESET");
  await page.click('[data-act="rstok"]');
  await waitModal(page, false);
  await page.waitForFunction(() => document.getElementById("toast").textContent === "Semua skor dihapus");
  await ctx.close();
});

test("recap with no finished match explains and closes", async () => {
  const { page, ctx } = await open();
  await page.click('[data-tab="klasemen"]');
  await page.locator('[data-act="recap"]').first().click();
  await waitModal(page, true);
  assert.match(await modalText(page), /Belum ada match yang selesai/);
  await page.click('[data-act="close"]');
  await waitModal(page, false);
  await ctx.close();
});
```

- [ ] **Step 6: Install and run the baseline against the unmodified app**

Run: `cd tests/ui && npm install && npm test`
Expected: all 7 tests PASS (this proves the harness before any migration). If one fails, fix the **test** (selector/timing), not `index.html`.

- [ ] **Step 7: Commit**

```bash
git add .gitignore tests/ui/package.json tests/ui/package-lock.json tests/ui/helpers.mjs tests/ui/behavior.test.mjs
git commit -m "test: add Playwright UI harness and behavior baseline

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Foundation — fonts, Polaris script, theme tokens, load-failure notice

**Files:**
- Modify: `index.html` (head `<link>`/`<script>`, `<style>` palette + new theme block, body: add `#nopolaris`, add inline `load` check)
- Create: `tests/ui/foundation.test.mjs`

**Interfaces:**
- Produces: CSS variable `--font`; `--lose-ink`; tint variables `--tint-win --tint-lose --tint-live` (on `body`); the theme block (all `--p-…-f4125` overrides on `body`); element `#nopolaris`; global rule `[hidden]{display:none!important}`; helper CSS class `.tap` (touch-target padding wrapper).

- [ ] **Step 1: Write the failing test `tests/ui/foundation.test.mjs`**

```js
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { open, teardown } from "./helpers.mjs";

after(teardown);

const tok = (page, n) => page.evaluate((n) => getComputedStyle(document.body).getPropertyValue(n).trim(), n);

test("Polaris elements are defined", async () => {
  const { page, ctx } = await open();
  assert.ok(await page.evaluate(() => !!customElements.get("s-button")));
  await ctx.close();
});

test("body uses Plus Jakarta Sans and the font loads", async () => {
  const { page, ctx } = await open();
  assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Plus Jakarta Sans/);
  assert.equal(await page.evaluate(() => document.fonts.check('600 16px "Plus Jakarta Sans"')), true);
  assert.match(await tok(page, "--p-font-family-sans-f4125"), /Plus Jakarta Sans/);
  await ctx.close();
});

test("light theme: Polaris tokens follow the Purrclub palette", async () => {
  const { page, ctx } = await open({ scheme: "light" });
  assert.equal(await tok(page, "--p-color-button-primary-bg-f4125"), "#d9560b");
  assert.equal(await tok(page, "--p-color-bg-surface-f4125"), "#fffaf0");
  assert.equal(await tok(page, "--p-color-text-f4125"), "#241733");
  await ctx.close();
});

test("dark theme: Polaris tokens follow the dark palette", async () => {
  const { page, ctx } = await open({ scheme: "dark" });
  assert.equal(await tok(page, "--p-color-button-primary-bg-f4125"), "#ff8a1f");
  assert.equal(await tok(page, "--p-color-bg-surface-f4125"), "#231636");
  assert.equal(await tok(page, "--p-color-text-f4125"), "#f3ead8");
  await ctx.close();
});

test("every theme token name exists in the live polaris.js", async () => {
  const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const names = [...new Set([...html.matchAll(/(--p-[a-z0-9-]+-f4125)\s*:/g)].map((m) => m[1]))];
  assert.ok(names.length >= 40, "theme block missing or too small: " + names.length);
  const js = await (await fetch("https://cdn.shopify.com/shopifycloud/polaris.js")).text();
  assert.deepEqual(names.filter((n) => !js.includes(n)), []);
});

test("shows a reload notice when polaris.js fails to load", async () => {
  const { page, ctx } = await open({ block: ["**/polaris.js"] });
  assert.equal(await page.locator("#nopolaris").isVisible(), true);
  await ctx.close();
});

test("notice stays hidden when polaris.js loads", async () => {
  const { page, ctx } = await open();
  assert.equal(await page.locator("#nopolaris").isVisible(), false);
  await ctx.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/ui && node --test foundation.test.mjs`
Expected: FAIL — `s-button` undefined, font missing, tokens empty, `#nopolaris` not found.

- [ ] **Step 3: Update the head links and add the Polaris script**

In `index.html`, replace the Google Fonts `<link href=…>` line with the two lines below, and add the script directly after them (keep the existing `preconnect` link above them):

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Eater&family=Barlow+Condensed:wght@500;700&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
```

(Eater/Barlow remain only for the recap canvas.)

- [ ] **Step 4: Add palette extras to `:root` and the dark blocks**

In the first `:root{…}` block add `--font:'Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',sans-serif; --lose-ink:#ffffff;` after the existing color variables. In **both** dark blocks (`:root:not([data-theme="light"])` inside the media query, and `:root[data-theme="dark"]`) add `--lose-ink:#241733;` after `--live:#b99cff;`.

- [ ] **Step 5: Add the theme block after the `body{…}` rule**

Replace the existing `body{margin:0;…font-family:'Barlow',system-ui,sans-serif;…}` rule with the following (same properties, new font) and add the theme block right after it:

```css
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.45;min-height:100%}
[hidden]{display:none!important}

/* Polaris web components theme: Purrclub palette -> Polaris tokens.
   Token names are per component; "f4125" is Polaris's build hash.
   tests/ui/foundation.test.mjs fails if a name here disappears from polaris.js. */
body{
  --p-font-family-sans-f4125:var(--font);
  --tint-win:color-mix(in srgb,var(--win) 18%,var(--surface));
  --tint-lose:color-mix(in srgb,var(--lose) 16%,var(--surface));
  --tint-live:color-mix(in srgb,var(--live) 16%,var(--surface));

  /* surfaces, text, borders */
  --p-color-bg-f4125:var(--bg);
  --p-color-bg-surface-f4125:var(--surface);
  --p-color-bg-surface-hover-f4125:var(--surface2);
  --p-color-bg-surface-active-f4125:var(--surface2);
  --p-color-bg-surface-secondary-f4125:var(--surface2);
  --p-color-bg-surface-secondary-hover-f4125:var(--surface2);
  --p-color-bg-surface-secondary-active-f4125:var(--surface2);
  --p-color-bg-surface-tertiary-f4125:var(--surface2);
  --p-color-bg-fill-tertiary-f4125:var(--surface2);
  --p-color-border-f4125:var(--line);
  --p-color-border-secondary-f4125:var(--line);
  --p-color-border-focus-f4125:var(--live);
  --p-color-text-f4125:var(--ink);
  --p-color-text-secondary-f4125:var(--muted);
  --p-color-text-tertiary-f4125:var(--muted);
  --p-color-text-link-f4125:var(--ink);
  --p-color-text-link-hover-f4125:var(--pumpkin);
  --p-color-text-link-active-f4125:var(--pumpkin);

  /* primary button */
  --p-color-button-primary-bg-f4125:var(--pumpkin);
  --p-color-button-primary-bg-hover-f4125:color-mix(in srgb,var(--pumpkin) 85%,black);
  --p-color-button-primary-bg-active-f4125:color-mix(in srgb,var(--pumpkin) 72%,black);
  --p-color-button-primary-text-f4125:var(--pumpkin-ink);
  --p-color-button-primary-text-hover-f4125:var(--pumpkin-ink);
  --p-color-button-primary-text-active-f4125:var(--pumpkin-ink);
  /* critical primary button */
  --p-color-button-primary-bg-critical-f4125:var(--lose);
  --p-color-button-primary-bg-critical-hover-f4125:color-mix(in srgb,var(--lose) 85%,black);
  --p-color-button-primary-bg-critical-active-f4125:color-mix(in srgb,var(--lose) 72%,black);
  --p-color-button-primary-text-critical-f4125:var(--lose-ink);
  /* secondary button */
  --p-color-button-bg-fill-f4125:var(--surface);
  --p-color-button-bg-fill-hover-f4125:var(--surface2);
  --p-color-button-bg-fill-active-f4125:var(--surface2);
  --p-color-button-gradient-bg-fill-f4125:var(--surface);
  --p-color-button-bg-fill-critical-f4125:var(--surface);
  --p-color-button-bg-fill-critical-hover-f4125:var(--tint-lose);
  --p-color-button-bg-fill-critical-active-f4125:var(--tint-lose);
  --p-color-button-gradient-bg-fill-critical-f4125:var(--surface);
  --p-color-text-critical-f4125:var(--lose);

  /* inputs */
  --p-color-input-bg-surface-f4125:var(--bg);
  --p-color-input-bg-surface-hover-f4125:var(--bg);
  --p-color-input-bg-surface-active-f4125:var(--bg);
  --p-color-input-border-f4125:var(--line);
  --p-color-input-border-hover-f4125:var(--muted);
  --p-color-input-border-active-f4125:var(--live);

  /* badges + banner */
  --p-color-bg-fill-success-secondary-f4125:var(--tint-win);
  --p-color-badge-bg-fill-success-f4125:var(--tint-win);
  --p-color-badge-text-success-f4125:var(--win);
  --p-color-bg-fill-critical-secondary-f4125:var(--tint-lose);
  --p-color-badge-bg-fill-critical-f4125:var(--tint-lose);
  --p-color-badge-text-critical-f4125:var(--lose);
  --p-color-bg-fill-info-secondary-f4125:var(--tint-live);
  --p-color-badge-bg-fill-info-f4125:var(--tint-live);
  --p-color-badge-text-info-f4125:var(--live);
  --p-color-bg-surface-info-f4125:var(--tint-live);
  --p-color-icon-info-accent-f4125:var(--live);
  --p-color-text-success-f4125:var(--win);

  /* avatars: Polaris picks one of seven colors by initials; make all pumpkin */
  --p-color-avatar-text-on-bg-fill-f4125:var(--pumpkin-ink);
  --p-color-avatar-one-bg-fill-f4125:var(--pumpkin);   --p-color-avatar-one-text-on-bg-fill-f4125:var(--pumpkin-ink);
  --p-color-avatar-two-bg-fill-f4125:var(--pumpkin);   --p-color-avatar-two-text-on-bg-fill-f4125:var(--pumpkin-ink);
  --p-color-avatar-three-bg-fill-f4125:var(--pumpkin); --p-color-avatar-three-text-on-bg-fill-f4125:var(--pumpkin-ink);
  --p-color-avatar-four-bg-fill-f4125:var(--pumpkin);  --p-color-avatar-four-text-on-bg-fill-f4125:var(--pumpkin-ink);
  --p-color-avatar-five-bg-fill-f4125:var(--pumpkin);  --p-color-avatar-five-text-on-bg-fill-f4125:var(--pumpkin-ink);
  --p-color-avatar-six-bg-fill-f4125:var(--pumpkin);   --p-color-avatar-six-text-on-bg-fill-f4125:var(--pumpkin-ink);
  --p-color-avatar-seven-bg-fill-f4125:var(--pumpkin); --p-color-avatar-seven-text-on-bg-fill-f4125:var(--pumpkin-ink);
}

/* touch-target helper: wrap button labels so buttons are >= 44px tall */
.tap{display:block;padding-block:8px;line-height:1.3;text-align:center}
```

- [ ] **Step 6: Add the load-failure notice**

Directly after `<body>` add:

```html
<div id="nopolaris" hidden>
  <p>Tampilan gagal dimuat. Cek koneksi internet, lalu muat ulang.</p>
  <button type="button" onclick="location.reload()">Muat ulang</button>
</div>
<script>window.addEventListener("load",function(){if(!customElements.get("s-button"))document.getElementById("nopolaris").hidden=false})</script>
```

And add to the `<style>` block:

```css
#nopolaris{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;background:var(--bg);color:var(--ink);font-family:var(--font)}
#nopolaris button{padding:12px 20px;border:0;border-radius:10px;background:var(--pumpkin);color:var(--pumpkin-ink);font:700 16px var(--font);cursor:pointer}
```

- [ ] **Step 7: Run the new tests, then the whole suite**

Run: `cd tests/ui && node --test foundation.test.mjs && npm test`
Expected: foundation tests PASS; behavior tests still PASS (app still uses old markup; only fonts/tokens changed). If "every theme token name exists" lists missing names, delete those lines from the theme block (they are not real tokens) and re-run.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/ui/foundation.test.mjs
git commit -m "feat(ui): load Polaris components, Plus Jakarta Sans and palette theme tokens

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shell — header, rules banner, chip, avatar, tabs, tools, click handler

**Files:**
- Modify: `index.html` (CSS, body markup, `avatar`, `renderChip`, `render`, the global click handler's selector and tab branch)
- Create: `tests/ui/shell.test.mjs`

**Interfaces:**
- Consumes: `.tap` (Task 2), theme tokens.
- Produces: JS helper `btn(attrs, labelHtml) → string` (an `s-button` whose label is wrapped in `.tap`); `avatar(p,size) → string` now emits `<s-avatar>`; click handler matches `s-button, s-clickable, button`; CSS classes `.wrap .title .sub .rules .chip .tabs .tools`.

- [ ] **Step 1: Write the failing test `tests/ui/shell.test.mjs`**

```js
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown } from "./helpers.mjs";

after(teardown);

for (const [w, expected] of [[390, 390], [768, 768], [1180, 1120]]) {
  test(`shell is ${expected}px wide and does not scroll sideways at ${w}px`, async () => {
    const { page, ctx } = await open({ width: w, height: 900 });
    const box = await page.locator(".wrap").boundingBox();
    assert.ok(Math.abs(box.width - expected) <= 1, `wrap width ${box.width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await ctx.close();
  });
}

test("tabs are s-buttons and the selected one is primary", async () => {
  const { page, ctx } = await open();
  assert.equal(await page.locator("nav [data-tab]").evaluateAll((els) => els.map((e) => e.tagName)).then((t) => t.join()), "S-BUTTON,S-BUTTON,S-BUTTON");
  assert.equal(await page.locator('[data-tab="jadwal"]').getAttribute("variant"), "primary");
  await page.click('[data-tab="klasemen"]');
  assert.equal(await page.locator('[data-tab="klasemen"]').getAttribute("variant"), "primary");
  assert.equal(await page.locator('[data-tab="jadwal"]').getAttribute("variant"), "secondary");
  assert.equal(await page.locator('[data-tab="klasemen"]').getAttribute("aria-selected"), "true");
  await ctx.close();
});

test("chip is an s-clickable with an s-avatar (no old .av)", async () => {
  const { page, ctx } = await open({ me: 0 });
  assert.equal(await page.locator("#chip s-clickable[data-act='profile']").count(), 1);
  assert.equal(await page.locator("#chip s-avatar").count(), 1);
  assert.equal(await page.locator(".av").count(), 0);
  await ctx.close();
});

test("chip CTA is a primary s-button when no player is chosen", async () => {
  const { page, ctx } = await open({ me: null });
  assert.equal(await page.locator('#chip s-button[data-act="pick"][variant="primary"]').count(), 1);
  await ctx.close();
});

test("header controls are at least 44px tall", async () => {
  const { page, ctx } = await open();
  for (const sel of ['[data-tab="jadwal"]', "#chip s-clickable", '[data-act="resetall"]']) {
    const box = await page.locator(sel).first().boundingBox();
    assert.ok(box.height >= 43.5, `${sel} is ${box.height}px tall`);
  }
  await ctx.close();
});

test("rules are an s-banner and the map link is an s-link", async () => {
  const { page, ctx } = await open();
  assert.equal(await page.locator("header s-banner").count(), 1);
  assert.equal(await page.locator("header s-link").count(), 1);
  await ctx.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/ui && node --test shell.test.mjs`
Expected: FAIL (tabs are `BUTTON`, no `s-clickable`, etc.).

- [ ] **Step 3: Replace the body markup**

In `index.html`, replace everything from `<div class="wrap">` through the line `<div class="tools" id="tools">…</div>` and its closing `</div>` of `.wrap` (i.e. the block ending just before `<div class="ov" id="ov"></div>`) with:

```html
<div class="wrap">
<header>
  <h1 class="title">Halloween Tennis</h1>
  <p class="sub">Sabtu, 24 Okt · 17:00–22:00 · <s-link href="https://maps.app.goo.gl/8W14SVu49JueAfwQA?g_st=ic" target="_blank">Medco Ampera</s-link></p>
  <div id="chip"></div>
  <s-banner class="rules" tone="info" heading="Aturan">
    Doubles, partner berganti tiap match. Satu match sampai <b>4 game</b>. Setiap game: 15–30–40, <b>deuce hanya 1 kali</b>, deuce kedua jadi <b>sudden death</b> (poin berikutnya menang). 10 match × 30 menit di 1 lapangan, tiap orang main <b>4 kali</b>.
  </s-banner>
</header>

<nav class="tabs" role="tablist">
  <s-button role="tab" aria-selected="true" variant="primary" inlineSize="fill" data-tab="jadwal"><span class="tap">Jadwal</span></s-button>
  <s-button role="tab" aria-selected="false" variant="secondary" inlineSize="fill" data-tab="klasemen"><span class="tap">Klasemen</span></s-button>
  <s-button role="tab" aria-selected="false" variant="secondary" inlineSize="fill" data-tab="pemain"><span class="tap">Pemain</span></s-button>
</nav>

<section id="jadwal" class="on"></section>
<section id="klasemen"></section>
<section id="pemain"></section>

<div class="tools" id="tools"></div>
</div>
```

Keep the following lines unchanged: `<div class="ov" id="ov"></div>`, `<div id="toast" …>`, and the two hidden `<input type="file">`.

- [ ] **Step 4: Replace shell CSS**

In the `<style>` block **delete** these rules: `.wrap{…}`, `header{…}`, `h1{…}`, `.sub{…}`, `.sub a{…}`, `.rules{…}`, `.rules b{…}`, `#chip{…}`, `.chip{…}`, `.chip.cta{…}`, `.av{…}`, `nav{…}`, `nav button{…}`, `nav button[aria-selected="true"]{…}`, `button:focus-visible{…}`, `.tools{…}`, `.tools button{…}`, `.tools button.dg{…}`. Add:

```css
.wrap{width:100%;max-width:1120px;margin:0 auto;padding:0 16px 40px}
@media (min-width:700px){.wrap{max-width:880px;padding:0 24px 48px}}
@media (min-width:1024px){.wrap{max-width:1120px;padding:0 32px 56px}}
header{padding:22px 0 12px}
.title{margin:0;font-weight:800;font-size:clamp(34px,9vw,52px);line-height:1.05;letter-spacing:-.02em;color:var(--pumpkin)}
.sub{margin:8px 0 0;color:var(--muted);font-size:14.5px}
#chip{margin-top:12px;display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.rules{display:block;margin-top:14px}
.chip{display:inline-flex;align-items:center;min-block-size:44px;padding:5px 16px 5px 5px;border:1px solid var(--line);border-radius:999px;background:var(--surface);cursor:pointer}
.tabs{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;display:flex;gap:8px;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--line)}
.tabs>[data-tab]{flex:1;min-inline-size:0}
.tools{margin-top:24px}
```

- [ ] **Step 5: Add `btn`, replace `avatar` and `renderChip`**

Add `btn` in the `/* ---------- util ---------- */` section after `slotTime`:

```js
function btn(attrs,label){return '<s-button '+attrs+'><span class="tap">'+label+'</span></s-button>'}
```

Replace the whole `avatar` function and the whole `renderChip` function (find them by name) with:

```js
function avatarSize(px){return px<=40?"small":px<=72?"large":"large-200"}
function avatar(p,size){
  var src=photos[p]?' src="'+photos[p]+'"':'';
  return '<s-avatar'+src+' initials="'+esc(PLAYERS[p].charAt(0))+'" alt="'+esc(PLAYERS[p])+'" size="'+avatarSize(size)+'"></s-avatar>';
}
function renderChip(){
  var h;
  if(me.p===null)h=btn('variant="primary" data-act="pick"','Pilih namamu');
  else h='<s-clickable class="chip" data-act="profile" accessibilityLabel="Profil '+esc(PLAYERS[me.p])+'"><s-stack direction="inline" alignItems="center" gap="small">'+avatar(me.p,34)+'<s-text type="strong">Kamu: '+esc(PLAYERS[me.p])+'</s-text></s-stack></s-clickable>';
  h+='<s-text id="sync" color="subdued"></s-text>';
  $("chip").innerHTML=h;
  var se=$("sync");if(se&&online!==null)se.textContent=online?"● Live":"● Offline, coba lagi otomatis";
}
```

- [ ] **Step 6: Update `render()` tools line**

Replace the line `$("tools").innerHTML='<button class="dg" data-act="resetall">Hapus semua skor</button>';` inside `render()` with:

```js
  $("tools").innerHTML=btn('variant="secondary" tone="critical" data-act="resetall"','Hapus semua skor');
```

- [ ] **Step 7: Update the click handler selector and tab branch**

In the `document.addEventListener("click", …)` handler change `var t=e.target.closest("button");` to:

```js
  var t=e.target.closest("s-button, s-clickable, button");
```

and replace the `if(t.dataset.tab){…}` branch with:

```js
  if(t.dataset.tab){
    document.querySelectorAll("nav [data-tab]").forEach(function(b){var on=b===t;b.setAttribute("aria-selected",on?"true":"false");b.setAttribute("variant",on?"primary":"secondary")});
    document.querySelectorAll("section").forEach(function(s){s.classList.toggle("on",s.id===t.dataset.tab)});
    window.scrollTo(0,0);return;
  }
```

- [ ] **Step 8: Run new tests, then full suite**

Run: `cd tests/ui && node --test shell.test.mjs && npm test`
Expected: all PASS. If "header controls are at least 44px" fails with a height just under 44, raise `.tap{padding-block:…}` (Task 2) by 1–2px and re-run.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/ui/shell.test.mjs
git commit -m "feat(ui): shell, tabs, chip and avatar as Polaris components

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Modals — one `s-modal`, all dialog bodies

**Files:**
- Modify: `index.html` (markup `#ov` → `s-modal`, CSS, `openModal`/`closeModal`/`confirmBox`/`answerConfirm`, `resetAllModal`, `pickPlayer`, `selfieStep`, `profileModal`, `openRecap`, click handler overlay branch + `rstIn` keydown)
- Create: `tests/ui/modals.test.mjs`

**Interfaces:**
- Consumes: `btn`, `avatar`, `.tap` (Tasks 2–3).
- Produces: `openModal(heading, bodyHtml, opts)` where `opts` is `{primary?:{act,label,critical?}, secondary?:{act,label}, size?:"small"|"base"|"large"}`; `closeModal()`; `confirmBox(msg, okLabel) → Promise<boolean>` (unchanged signature); element `s-modal#modal`. `heading` is plain text (not HTML-escaped; set via `setAttribute`).

- [ ] **Step 1: Write the failing test `tests/ui/modals.test.mjs`**

```js
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown, waitModal, waitModalText } from "./helpers.mjs";

after(teardown);

const freshMatches = () =>
  Array.from({ length: 10 }, () => ({ games: [0, 0], p: [0, 0], adv: null, deuceN: 0, sudden: false, done: false, hn: 0 }));

test("uses one s-modal; old overlay is gone", async () => {
  const { page, ctx } = await open();
  assert.equal(await page.locator("s-modal#modal").count(), 1);
  assert.equal(await page.locator("#ov, .sheet").count(), 0);
  await ctx.close();
});

test("confirm dialog has heading, critical primary action and a cancel", async () => {
  const { page, ctx } = await open();
  await page.click('[data-pt="0:0"]');
  await page.click('[data-reset="0"]');
  await waitModal(page, true);
  assert.equal(await page.locator('s-modal [slot="primary-action"][tone="critical"][data-act="ok"]').count(), 1);
  assert.equal(await page.locator('s-modal [slot="secondary-actions"][data-act="no"]').count(), 1);
  await page.click('[data-act="no"]');
  await waitModal(page, false);
  await ctx.close();
});

test("Escape closes the confirm dialog and counts as cancel", async () => {
  const { page, ctx } = await open();
  await page.click('[data-pt="0:0"]');
  await page.click('[data-reset="0"]');
  await waitModal(page, true);
  await page.keyboard.press("Escape");
  await waitModal(page, false);
  assert.ok((await page.locator("#jadwal").textContent()).includes("15"));
  // pending was cleared: a second confirm still works
  await page.click('[data-reset="0"]');
  await waitModal(page, true);
  await page.click('[data-act="no"]');
  await waitModal(page, false);
  await ctx.close();
});

test("pick-player modal: one s-clickable per player, 2 columns on phone, 3 on iPad", async () => {
  for (const [w, cols] of [[390, 2], [768, 3]]) {
    const { page, ctx } = await open({ width: w, height: 900, me: null });
    await waitModal(page, true, 4000);
    const items = page.locator('s-modal [data-act="choose"]');
    assert.equal(await items.count(), 10);
    const xs = [];
    for (let i = 0; i < 4; i++) xs.push(Math.round((await items.nth(i).boundingBox()).x));
    assert.equal(new Set(xs).size, cols, `${w}px: expected ${cols} columns, x positions ${xs}`);
    await ctx.close();
  }
});

test("selfie step shows an avatar and stacked full-width actions", async () => {
  const { page, ctx } = await open({ me: null });
  await waitModal(page, true, 4000);
  await page.click('[data-act="choose"][data-p="2"]');
  await waitModalText(page, "Selfie buat recap-mu");
  assert.equal(await page.locator('s-modal s-avatar').count(), 1);
  for (const a of ["selfie", "gallery", "close"]) assert.equal(await page.locator(`s-modal [data-act="${a}"]`).count(), 1);
  await ctx.close();
});

test("Enter in the RESET field confirms", async () => {
  const { page, ctx } = await open();
  await page.route("**/api/state", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rev: 1, matches: freshMatches(), photos: {} }) }));
  await page.click('[data-act="resetall"]');
  await waitModal(page, true);
  await page.fill("s-text-field#rstIn input", "RESET");
  await page.press("s-text-field#rstIn input", "Enter");
  await waitModal(page, false);
  await ctx.close();
});

test("modal buttons are at least 44px tall", async () => {
  const { page, ctx } = await open();
  await page.click('[data-act="resetall"]');
  await waitModal(page, true);
  for (const sel of ['[data-act="close"]', '[data-act="rstok"]']) {
    const box = await page.locator(`s-modal ${sel}`).boundingBox();
    assert.ok(box.height >= 43.5, `${sel} ${box.height}px`);
  }
  await ctx.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/ui && node --test modals.test.mjs`
Expected: FAIL (`s-modal#modal` not found).

- [ ] **Step 3: Swap the overlay element for the modal**

In the body markup replace `<div class="ov" id="ov"></div>` with:

```html
<s-modal id="modal" heading=""></s-modal>
```

- [ ] **Step 4: Replace modal CSS**

**Delete** the rules: `.ov`, `.ov.on`, `.sheet`, `.sheet h3`, `.mtxt`, `.mrow`, `.mrow.col`, `.mrow.col button`, `.pick`, `.pick button`, `.pick button.sel`, `.center`, `.linkbox`, `.pri`, `.ghost`, `.danger`. Keep `.rbox`, `.rbox img`, `#toast`, `.note`. Add:

```css
.pick{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@media (min-width:700px){.pick{grid-template-columns:repeat(3,minmax(0,1fr))}}
.pickItem{display:block;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:var(--bg);cursor:pointer}
.pickItem.sel{border-color:var(--pumpkin);background:var(--surface2)}
.rbox{margin-bottom:12px}
```

Also restyle `#toast` colors if needed: it already uses `var(--ink)`/`var(--bg)`; change its `font-size` line to include `font-family:var(--font);` (add `font-family:var(--font)` to the rule).

- [ ] **Step 5: Replace the modal functions**

Replace `openModal`, `closeModal`, `confirmBox`, `answerConfirm` (the whole `/* ---------- modal ---------- */` section) with:

```js
/* ---------- modal ---------- */
var modal=$("modal");
function openModal(heading,bodyHtml,opts){
  opts=opts||{};
  var h=bodyHtml||"";
  if(opts.secondary)h+=btn('slot="secondary-actions" variant="secondary" data-act="'+opts.secondary.act+'"',esc(opts.secondary.label));
  if(opts.primary)h+=btn('slot="primary-action" variant="primary"'+(opts.primary.critical?' tone="critical"':'')+' data-act="'+opts.primary.act+'"',esc(opts.primary.label));
  modal.setAttribute("heading",heading||"");
  modal.setAttribute("size",opts.size||"base");
  modal.innerHTML=h;
  modal.showOverlay();
}
function closeModal(){modal.hideOverlay()}
modal.addEventListener("hide",function(){if(pending){var p=pending;pending=null;p(false)}});
function confirmBox(msg,okLabel){
  return new Promise(function(res){
    pending=res;
    openModal("Konfirmasi",'<s-paragraph>'+esc(msg)+'</s-paragraph>',{secondary:{act:"no",label:"Batal"},primary:{act:"ok",label:okLabel,critical:true}});
  });
}
function answerConfirm(v){var p=pending;pending=null;modal.hideOverlay();if(p)p(v)}
```

- [ ] **Step 6: Replace each dialog builder (find by function name)**

`resetAllModal`:

```js
function resetAllModal(){
  openModal("Hapus semua skor?",'<s-paragraph>Ini menghapus skor semua match untuk semua orang. Ketik RESET untuk lanjut.</s-paragraph><s-text-field id="rstIn" label="Ketik RESET" placeholder="RESET" autocomplete="off"></s-text-field>',
    {secondary:{act:"close",label:"Batal"},primary:{act:"rstok",label:"Hapus skor",critical:true}});
}
```

`pickPlayer`:

```js
function pickPlayer(){
  var h='<div class="pick">';
  PLAYERS.forEach(function(n,i){h+='<s-clickable class="pickItem'+(i===me.p?' sel':'')+'" data-act="choose" data-p="'+i+'" accessibilityLabel="'+esc(n)+'"><s-stack direction="inline" alignItems="center" gap="small">'+avatar(i,32)+'<s-text type="strong">'+esc(n)+'</s-text></s-stack></s-clickable>'});
  h+='</div>';
  openModal("Kamu yang mana?",h,{secondary:{act:"close",label:"Nanti saja"}});
}
```

`selfieStep`:

```js
function selfieStep(){
  var h='<s-stack alignItems="center" gap="base">'+avatar(me.p,140)+'<s-paragraph color="subdued">Foto dipakai di kartu recap dan tersimpan di HP ini saja.</s-paragraph></s-stack>';
  h+='<s-stack gap="small">'+btn('variant="primary" inlineSize="fill" data-act="selfie"',me.photo?'Ambil ulang selfie':'Ambil selfie')+btn('variant="secondary" inlineSize="fill" data-act="gallery"','Pilih dari galeri')+btn('variant="tertiary" inlineSize="fill" data-act="close"',me.photo?'Selesai':'Lewati')+'</s-stack>';
  openModal("Selfie buat recap-mu",h);
}
```

`profileModal`:

```js
function profileModal(){
  var h='<s-stack alignItems="center" gap="base">'+avatar(me.p,120)+'</s-stack>';
  h+='<s-stack gap="small">'+btn('variant="primary" inlineSize="fill" data-act="recap" data-p="'+me.p+'"','Lihat recap-ku')+btn('variant="secondary" inlineSize="fill" data-act="selfiestep"',me.photo?'Ganti foto':'Tambah selfie')+btn('variant="secondary" inlineSize="fill" data-act="pick"','Ganti pemain')+btn('variant="tertiary" inlineSize="fill" data-act="close"','Tutup')+'</s-stack>';
  openModal(PLAYERS[me.p],h);
}
```

`openRecap` (leave the `drawRecap(d).then(...)` logic identical except the two message strings):

```js
function openRecap(p){
  var d=recapData(p),title="Recap "+PLAYERS[p];
  if(!d.played){openModal(title,'<s-paragraph>Belum ada match yang selesai. Recap muncul setelah match pertama selesai.</s-paragraph>',{secondary:{act:"close",label:"Tutup"}});return}
  recapBlob=null;
  openModal(title,'<div class="rbox" id="rbox"><s-text color="subdued">Menyiapkan gambar…</s-text></div><s-stack gap="small">'+btn('variant="primary" inlineSize="fill" data-act="sharerecap"','Bagikan ke Story')+btn('variant="secondary" inlineSize="fill" data-act="saverecap"','Simpan gambar')+btn('variant="tertiary" inlineSize="fill" data-act="close"','Tutup')+'</s-stack><s-paragraph color="subdued">Tombol bagikan membuka menu share di HP-mu. Pilih Instagram, lalu Story.</s-paragraph>',{size:"large"});
  drawRecap(d).then(function(c){
    var url=c.toDataURL("image/png");
    c.toBlob(function(b){recapBlob=b;recapName="halloween-tennis-"+PLAYERS[p].toLowerCase()+".png"},"image/png");
    var box=$("rbox");if(box)box.innerHTML='<img alt="Kartu recap '+esc(PLAYERS[p])+'" src="'+url+'">';
  }).catch(function(){var box=$("rbox");if(box)box.innerHTML='<s-text color="subdued">Gambar gagal dibuat. Coba tutup dan buka lagi.</s-text>'});
}
```

- [ ] **Step 7: Update the click handler**

Change the first lines of the handler from

```js
  var t=e.target.closest("s-button, s-clickable, button");
  if(!t){if(e.target.id==="ov"){if(pending)answerConfirm(false);else closeModal()}return}
```

to

```js
  var t=e.target.closest("s-button, s-clickable, button");
  if(!t)return;
```

The `rstIn` Enter handler (`document.addEventListener("keydown", …)`) stays as is: events from inside the `s-text-field` shadow DOM are retargeted to the host, which keeps `id="rstIn"`.

- [ ] **Step 8: Run new tests, then full suite**

Run: `cd tests/ui && node --test modals.test.mjs && npm test`
Expected: all PASS. Known-risk notes: (a) if "Escape closes" fails because the `hide` event does not fire on Escape, add `modal.addEventListener("afterhide",…)` with the same pending-resolution body and re-run; (b) if the 3-column pick test fails at 768px, check `.pick` media query and that `modal size="base"` is wide enough, otherwise use `size="large"` for `pickPlayer`.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/ui/modals.test.mjs
git commit -m "feat(ui): replace hand-built overlay with s-modal

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Jadwal — match cards, scoring buttons, responsive grid

**Files:**
- Modify: `index.html` (CSS, `banner`, `renderJadwal`)
- Create: `tests/ui/jadwal.test.mjs`

**Interfaces:**
- Consumes: `btn`, `nm`, `slotTime`, `canScore`, `canAct`, `firstOpen`, `pointText`, `PTS` (existing).
- Produces: CSS `.matches` (grid), `.match` / `.match.live` / `.match.done`, `.games`, `.pt`, `.state`, `.pt-btn`.

- [ ] **Step 1: Write the failing test `tests/ui/jadwal.test.mjs`**

```js
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown } from "./helpers.mjs";

after(teardown);

const box = (page, i) => page.locator(".match").nth(i).boundingBox();

test("match cards use s-section; header has a badge; no raw buttons", async () => {
  const { page, ctx } = await open();
  assert.equal(await page.locator(".match s-section").count(), 10);
  assert.equal(await page.locator(".match s-badge").count(), 10);
  assert.equal(await page.locator("#jadwal button").count(), 0);
  assert.equal(await page.locator("#jadwal s-banner").count(), 1);
  await ctx.close();
});

test("phone: single column", async () => {
  const { page, ctx } = await open({ width: 390, height: 900 });
  const a = await box(page, 1), b = await box(page, 2);
  assert.ok(Math.abs(a.x - b.x) <= 1 && b.y > a.y, "cards should stack");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await ctx.close();
});

for (const w of [768, 1180]) {
  test(`${w}px: two columns, live match spans both`, async () => {
    const { page, ctx } = await open({ width: w, height: 1000 });
    const live = await box(page, 0), a = await box(page, 1), b = await box(page, 2);
    assert.ok(Math.abs(a.y - b.y) <= 2 && b.x - a.x > 100, `cards 2 and 3 should sit side by side (${a.x},${a.y}) (${b.x},${b.y})`);
    assert.ok(live.width >= a.width + b.width, `live ${live.width} should span both columns`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await ctx.close();
  });
}

test("scoring buttons are s-buttons, >= 56px tall, and scoring works", async () => {
  const { page, ctx } = await open({ width: 768, height: 1000 });
  const pts = page.locator("[data-pt]");
  assert.equal(await pts.count(), 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(await pts.nth(i).evaluate((e) => e.tagName), "S-BUTTON");
    assert.ok((await pts.nth(i).boundingBox()).height >= 55.5);
  }
  await pts.nth(0).click();
  await page.waitForFunction(() => document.getElementById("jadwal").textContent.includes("15"));
  await ctx.close();
});

test("undo/reset buttons appear after a point and are >= 44px", async () => {
  const { page, ctx } = await open();
  await page.click('[data-pt="0:1"]');
  await page.waitForSelector('[data-reset="0"]');
  for (const sel of ['[data-reset="0"]']) assert.ok((await page.locator(sel).boundingBox()).height >= 43.5);
  await ctx.close();
});

test("score digits use Plus Jakarta Sans at weight 800", async () => {
  const { page, ctx } = await open();
  const s = await page.locator(".games").first().evaluate((e) => { const c = getComputedStyle(e); return [c.fontFamily, c.fontWeight]; });
  assert.match(s[0], /Plus Jakarta Sans/);
  assert.equal(s[1], "800");
  await ctx.close();
});

test("live card is outlined with the live color; done state uses a success badge", async () => {
  const { page, ctx } = await open();
  assert.equal(await page.locator(".match.live").count(), 1);
  assert.equal(await page.locator(".match.live s-badge").first().getAttribute("tone"), "info");
  assert.equal(await page.locator(".match:not(.live) s-badge").first().getAttribute("tone"), "neutral");
  await ctx.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/ui && node --test jadwal.test.mjs`
Expected: FAIL (no `s-section`/`s-badge` in matches).

- [ ] **Step 3: Replace match CSS**

**Delete** rules: `.banner`, `.banner button`, `.match`, `.match.live`, `.match.done`, `.mh`, `.mh .t`, `.mh .tag`, `.tag.liveTag`, `.teams`, `.team`, `.team .n`, `.team.w .n`, `.vs`, `.scoreRow`, `.games`, `.mid`, `.pt`, `.pt.big`, `.btns`, `.btns button`, `.btns button:active`, `.state`, `.mini`, `button.sm,.mini button`, `.rest`. Keep `.me-n`. Add:

```css
s-banner.gap{display:block;margin-bottom:16px}
.matches{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
@media (min-width:700px){.matches{grid-template-columns:repeat(2,minmax(0,1fr))}}
.match{display:block;border-radius:16px}
.match.live{grid-column:1/-1;outline:2px solid var(--live)}
.match.done{opacity:.92}
.games{font-weight:800;font-size:48px;line-height:1;text-align:center;font-variant-numeric:tabular-nums}
@media (min-width:700px){.games{font-size:56px}}
@media (min-width:1024px){.games{font-size:64px}}
.pt{font-weight:700;font-size:26px;text-align:center;color:var(--ink);font-variant-numeric:tabular-nums}
.state{text-align:center;font-weight:600;color:var(--live);min-height:22px}
.pt-btn .tap{padding-block:14px}
```

- [ ] **Step 4: Replace `banner` and `renderJadwal`**

```js
function banner(){
  var c=firstOpen();
  if(c<0)return '';
  return '<s-banner class="gap" tone="info" heading="Match '+(c+1)+' sedang main">Siapa saja bisa mencatat poin di kartu bertanda biru. Skor tampil live di semua HP.</s-banner>';
}
```

Keep `firstOpen` and `nm` unchanged. Replace `renderJadwal`:

```js
function teamHtml(t,win){
  var tone=win?' tone="success"':'';
  return '<s-stack alignItems="center" gap="small-200"><s-text type="strong"'+tone+'>'+nm(t[0])+'</s-text><s-text type="strong"'+tone+'>'+nm(t[1])+'</s-text></s-stack>';
}
function renderJadwal(){
  var cur=firstOpen(),h=banner()+'<div class="matches">';
  state.matches.forEach(function(m,i){
    var players=m.a.concat(m.b);
    var rest=PLAYERS.map(function(_,k){return k}).filter(function(k){return players.indexOf(k)<0});
    var live=(i===cur);
    var winA=m.done&&m.games[0]>m.games[1],winB=m.done&&m.games[1]>m.games[0];
    var tone=m.done?'success':live?'info':'neutral',label=m.done?'Selesai':live?'Giliran main':'Menunggu';
    var started=m.games[0]+m.games[1]+m.p[0]+m.p[1]>0||m.adv!==null;
    h+='<article class="match'+(live?' live':'')+(m.done?' done':'')+'"><s-section><s-stack gap="base">';
    h+='<s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="small"><s-heading>Match '+(i+1)+' · '+slotTime(i)+'</s-heading><s-badge tone="'+tone+'">'+label+'</s-badge></s-stack>';
    h+='<s-grid gridTemplateColumns="1fr auto 1fr" alignItems="center" gap="base">'+teamHtml(m.a,winA)+'<s-text color="subdued">lawan</s-text>'+teamHtml(m.b,winB)+'</s-grid>';
    h+='<s-grid gridTemplateColumns="1fr auto 1fr" alignItems="center" gap="base"><div class="games">'+m.games[0]+'</div><s-text color="subdued">game</s-text><div class="games">'+m.games[1]+'</div></s-grid>';
    if(canScore(i)){
      var noPt=(m.adv!==null||m.sudden||(m.p[0]===3&&m.p[1]===3));
      var l0=noPt?"–":PTS[m.p[0]],l1=noPt?"–":PTS[m.p[1]];
      if(m.adv===0){l0="Adv";l1="–"}if(m.adv===1){l1="Adv";l0="–"}
      h+='<s-grid gridTemplateColumns="1fr auto 1fr" alignItems="center" gap="base"><div class="pt">'+l0+'</div><s-text color="subdued">poin</s-text><div class="pt">'+l1+'</div></s-grid>';
      h+='<div class="state" aria-live="polite">'+esc(pointText(m))+'</div>';
      h+='<s-grid gridTemplateColumns="1fr 1fr" gap="base">'
        +btn('class="pt-btn" variant="primary" inlineSize="fill" data-pt="'+i+':0"','+ Poin<br>'+esc(PLAYERS[m.a[0]])+' &amp; '+esc(PLAYERS[m.a[1]]))
        +btn('class="pt-btn" variant="primary" inlineSize="fill" data-pt="'+i+':1"','+ Poin<br>'+esc(PLAYERS[m.b[0]])+' &amp; '+esc(PLAYERS[m.b[1]]))
        +'</s-grid>';
    }
    if(canAct(i)){
      var mini='';
      if((m.hn||0)>0)mini+=btn('variant="secondary" data-undo="'+i+'"','Undo poin');
      if(started||m.done)mini+=btn('variant="secondary" data-reset="'+i+'"','Reset match');
      if(mini)h+='<s-stack direction="inline" gap="small">'+mini+'</s-stack>';
    }
    h+='<s-text color="subdued">Istirahat: '+esc(rest.map(function(k){return PLAYERS[k]}).join(", "))+'</s-text>';
    h+='</s-stack></s-section></article>';
  });
  $("jadwal").innerHTML=h+'</div>';
}
```

- [ ] **Step 5: Run new tests, then full suite**

Run: `cd tests/ui && node --test jadwal.test.mjs && npm test`
Expected: all PASS. If `+ Poin` buttons measure under 56px, raise `.pt-btn .tap{padding-block:…}`; if the two-column test fails because `.matches` grid is not applied, check that `renderJadwal` output starts with `.matches` wrapper.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/ui/jadwal.test.mjs
git commit -m "feat(ui): match cards as Polaris sections with responsive grid

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Klasemen — standings table and recap panel

**Files:**
- Modify: `index.html` (CSS, `renderKlasemen`)
- Create: `tests/ui/klasemen.test.mjs`

**Interfaces:**
- Consumes: `btn`, `avatar`, `ranked`, `banner`.
- Produces: CSS `.kl .kl-main .kl-side .topn`.

- [ ] **Step 1: Write the failing test `tests/ui/klasemen.test.mjs`**

```js
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown, waitModal } from "./helpers.mjs";

after(teardown);

async function klasemen(opts) {
  const o = await open(opts);
  await o.page.click('[data-tab="klasemen"]');
  await o.page.waitForSelector("#klasemen s-table");
  return o;
}

test("standings use s-table with 7 headers and 10 rows, no raw table", async () => {
  const { page, ctx } = await klasemen({ width: 1180, height: 1000 });
  assert.equal(await page.locator("#klasemen table").count(), 0);
  assert.equal(await page.locator("#klasemen s-table-header").count(), 7);
  assert.equal(await page.locator("#klasemen s-table-row").count(), 10);
  assert.match(await page.locator("#klasemen s-table-row").first().textContent(), /1\. Angel/);
  await ctx.close();
});

test("my row has a 'kamu' badge", async () => {
  const { page, ctx } = await klasemen({ me: 0 });
  assert.equal(await page.locator("#klasemen s-table-row s-badge").count(), 1);
  assert.match(await page.locator("#klasemen s-table-row s-badge").textContent(), /kamu/);
  await ctx.close();
});

test("phone and iPad portrait: recap panel stacks above the standings", async () => {
  for (const w of [390, 768]) {
    const { page, ctx } = await klasemen({ width: w, height: 1000 });
    const side = await page.locator(".kl-side").boundingBox(), main = await page.locator(".kl-main").boundingBox();
    assert.ok(side.y < main.y && Math.abs(side.x - main.x) <= 1, `${w}px: side (${side.x},${side.y}) main (${main.x},${main.y})`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await ctx.close();
  }
});

test("iPad landscape: two panes, standings left, recap right", async () => {
  const { page, ctx } = await klasemen({ width: 1180, height: 1000 });
  const side = await page.locator(".kl-side").boundingBox(), main = await page.locator(".kl-main").boundingBox();
  assert.ok(side.x > main.x + main.width - 2, "recap should be to the right of the standings");
  assert.ok(main.width > side.width * 1.8, `main ${main.width} should be about 2/3`);
  await ctx.close();
});

test("recap buttons are s-buttons >= 44px tall and open the recap", async () => {
  const { page, ctx } = await klasemen({ width: 1180, height: 1000 });
  const b = page.locator('#klasemen [data-act="recap"]');
  assert.ok((await b.first().boundingBox()).height >= 43.5);
  assert.equal(await b.first().evaluate((e) => e.tagName), "S-BUTTON");
  await ctx.close();
});

test("no player chosen: CTA asks to pick a name", async () => {
  const { page, ctx } = await open({ me: null });
  await waitModal(page, true, 4000);
  await page.keyboard.press("Escape");
  await waitModal(page, false);
  await page.click('[data-tab="klasemen"]');
  assert.equal(await page.locator('.kl-side [data-act="pick"]').count(), 1);
  await ctx.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/ui && node --test klasemen.test.mjs`
Expected: FAIL (no `s-table`).

- [ ] **Step 3: Replace standings CSS**

**Delete** rules: `table`, `th,td`, `th`, `td:first-child,th:first-child`, `td.name`, `tr.top td.name`, `tr.mine td`, `td button.sm`, `.tblWrap`, `.recapCta`, `.recapCta h3`, `.recapCta p`. Keep `.note`. Add:

```css
.kl{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;grid-template-areas:"side" "main"}
.kl-side{grid-area:side}
.kl-main{grid-area:main;min-width:0}
@media (min-width:1024px){
  .kl{grid-template-columns:minmax(0,1fr) 320px;grid-template-areas:"main side";align-items:start}
  .kl-side{position:sticky;top:88px}
}
.topn{color:var(--pumpkin)}
```

- [ ] **Step 4: Replace `renderKlasemen`**

```js
function renderKlasemen(){
  var s=ranked(),h=banner()+'<div class="kl"><aside class="kl-side">';
  if(me.p!==null){
    var mine=s.filter(function(r){return r.i===me.p})[0];
    h+='<s-section><s-stack direction="inline" alignItems="center" gap="base">'+avatar(me.p,64)+'<s-stack gap="small-200"><s-heading>Recap '+esc(PLAYERS[me.p])+'</s-heading><s-text color="subdued">'+(mine.played?mine.played+' match selesai · '+mine.w+' menang':'Muncul setelah match pertamamu selesai')+'</s-text>'+btn('variant="primary" data-act="recap" data-p="'+me.p+'"','Lihat recap-ku')+'</s-stack></s-stack></s-section>';
  }else{
    h+='<s-section><s-stack gap="small-200"><s-heading>Mau recap sendiri?</s-heading><s-text color="subdued">Pilih namamu dan ambil selfie dulu.</s-text>'+btn('variant="primary" data-act="pick"','Pilih namamu')+'</s-stack></s-section>';
  }
  h+='</aside><div class="kl-main"><s-section padding="none"><s-table>';
  h+='<s-table-header-row><s-table-header listSlot="primary">Pemain</s-table-header><s-table-header listSlot="labeled" format="numeric">Main</s-table-header><s-table-header listSlot="labeled" format="numeric">Menang</s-table-header><s-table-header listSlot="labeled" format="numeric">Kalah</s-table-header><s-table-header listSlot="labeled" format="numeric">Game</s-table-header><s-table-header listSlot="labeled" format="numeric">Selisih</s-table-header><s-table-header listSlot="inline"></s-table-header></s-table-header-row><s-table-body>';
  s.forEach(function(r,idx){
    var d=r.gw-r.gl,top=(idx===0&&r.played>0);
    var name='<span'+(top?' class="topn"':'')+'><b>'+(idx+1)+'. '+esc(r.name)+'</b></span>'+(r.i===me.p?' <s-badge tone="info">kamu</s-badge>':'');
    h+='<s-table-row><s-table-cell>'+name+'</s-table-cell><s-table-cell>'+r.played+'/'+r.sched+'</s-table-cell><s-table-cell>'+r.w+'</s-table-cell><s-table-cell>'+r.l+'</s-table-cell><s-table-cell>'+r.gw+'–'+r.gl+'</s-table-cell><s-table-cell>'+(d>0?'+':'')+d+'</s-table-cell><s-table-cell>'+btn('variant="tertiary" data-act="recap" data-p="'+r.i+'"','Recap')+'</s-table-cell></s-table-row>';
  });
  h+='</s-table-body></s-table></s-section><p class="note">Urutan: jumlah menang, lalu selisih game. Tiap pemain dijadwalkan sama: 4 match.</p></div></div>';
  $("klasemen").innerHTML=h;
}
```

- [ ] **Step 5: Run new tests, then full suite**

Run: `cd tests/ui && node --test klasemen.test.mjs && npm test`
Expected: all PASS. Notes: (a) the "no player chosen" test presses Escape to dismiss the auto-opened pick modal; (b) if `s-table-header` count differs because the empty last header is dropped, give it a non-empty accessible label by changing it to `<s-table-header listSlot="inline">Recap</s-table-header>` and keep the count at 7; (c) if the phone list view hides the Recap button, change its header `listSlot` to `labeled`.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/ui/klasemen.test.mjs
git commit -m "feat(ui): standings as s-table with two-pane iPad landscape layout

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pemain — player cards

**Files:**
- Modify: `index.html` (CSS, `renderPemain`)
- Create: `tests/ui/pemain.test.mjs`

**Interfaces:**
- Consumes: `slotTime`, `PLAYERS`, `state`, `me`.
- Produces: CSS `.pgrid`.

- [ ] **Step 1: Write the failing test `tests/ui/pemain.test.mjs`**

```js
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown } from "./helpers.mjs";

after(teardown);

async function pemain(opts) {
  const o = await open(opts);
  await o.page.click('[data-tab="pemain"]');
  await o.page.waitForSelector("#pemain s-section");
  return o;
}

test("ten player cards as s-section with schedule details; mine is marked", async () => {
  const { page, ctx } = await pemain({ me: 0 });
  assert.equal(await page.locator("#pemain s-section").count(), 10);
  const first = await page.locator("#pemain s-section").first().textContent();
  assert.match(first, /Main di:/);
  assert.match(first, /Partner:/);
  assert.match(first, /Lawan:/);
  assert.equal(await page.locator("#pemain s-section[heading*='(kamu)']").count(), 1);
  await ctx.close();
});

for (const [w, cols] of [[390, 1], [768, 2], [1180, 3]]) {
  test(`${w}px: ${cols} column(s) of player cards, no sideways scroll`, async () => {
    const { page, ctx } = await pemain({ width: w, height: 1000 });
    const cards = page.locator("#pemain .pcard");
    const xs = [];
    for (let i = 0; i < 4; i++) xs.push(Math.round((await cards.nth(i).boundingBox()).x));
    assert.equal(new Set(xs).size, Math.min(cols, 4), `x positions ${xs}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await ctx.close();
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/ui && node --test pemain.test.mjs`
Expected: FAIL (no `s-section` in `#pemain`).

- [ ] **Step 3: Replace player-card CSS**

**Delete** rules `.pcard`, `.pcard h3`, `.pcard p`, `.pcard .k`. Add:

```css
.pgrid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
@media (min-width:700px){.pgrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:1024px){.pgrid{grid-template-columns:repeat(3,minmax(0,1fr))}}
.pcard{display:block}
```

- [ ] **Step 4: Replace the output lines in `renderPemain`**

Change `var h="";` to `var h='<div class="pgrid">';`. Replace the `h+='<div class="pcard">…</div>';` line with:

```js
    h+='<div class="pcard"><s-section heading="'+esc(n)+(p===me.p?' (kamu)':'')+'"><s-stack gap="small-200"><s-paragraph><s-text color="subdued">Main di:</s-text> '+esc(slots.join(", "))+'</s-paragraph><s-paragraph><s-text color="subdued">Partner:</s-text> '+esc(partners.join(", "))+'</s-paragraph><s-paragraph><s-text color="subdued">Lawan:</s-text> '+esc(ol)+'</s-paragraph></s-stack></s-section></div>';
```

and replace `$("pemain").innerHTML=h;` with `$("pemain").innerHTML=h+'</div>';`.

- [ ] **Step 5: Run new tests, then full suite**

Run: `cd tests/ui && node --test pemain.test.mjs && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/ui/pemain.test.mjs
git commit -m "feat(ui): player cards as Polaris sections in a responsive grid

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Cleanup, docs, and visual review

**Files:**
- Modify: `index.html` (remove leftover dead CSS), `README.md`
- Create: `tests/ui/shoot.mjs`

- [ ] **Step 1: Write the leftover-check test (fails until cleanup is done)**

Append to `tests/ui/foundation.test.mjs`:

```js
test("no dead styles or legacy markup classes remain", () => {
  const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const dead = [".ov", ".sheet", ".mtxt", ".mrow", ".linkbox", ".pri{", ".ghost{", ".danger{", ".tblWrap", ".recapCta", ".banner{", ".mh{", ".btns", "button.sm", "nav button"];
  assert.deepEqual(dead.filter((d) => css.includes(d)), []);
  const body = html.slice(html.indexOf("<body>"));
  assert.equal(/class="(pri|ghost|danger|tblWrap|recapCta|sheet|mrow)\b/.test(body), false);
});
```

- [ ] **Step 2: Run to see what is left**

Run: `cd tests/ui && node --test foundation.test.mjs`
Expected: FAIL listing any leftover selector, or PASS if every task cleaned up after itself.

- [ ] **Step 3: Remove leftovers**

Delete each listed leftover rule from the `<style>` block. Also remove the now-unused `@media (prefers-reduced-motion…)` rule only if nothing animates (keep it otherwise). Keep `.rbox`, `.rbox img`, `.note`, `.me-n`, `#toast`.

- [ ] **Step 4: Create the screenshot script `tests/ui/shoot.mjs`**

```js
// Visual review helper (not a test): node shoot.mjs  ->  tests/ui/out/*.png
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setup, teardown, waitModal } from "./helpers.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
fs.mkdirSync(OUT, { recursive: true });

const FIXED = [1,2,9,7,0,8,6,3,7,2,4,5,1,6,3,9,0,5,8,4,7,3,9,6,2,5,0,1,7,4,8,9,6,0,5,1,8,3,4,2];
const scores = [[4, 2], [4, 3], [1, 4]];
const seeded = {
  matches: Array.from({ length: 10 }, (_, m) => {
    const f = FIXED.slice(m * 4, m * 4 + 4);
    const done = m < 3;
    return { a: [f[0], f[1]], b: [f[2], f[3]], games: done ? scores[m] : m === 3 ? [2, 1] : [0, 0], p: m === 3 ? [2, 1] : [0, 0], adv: null, deuceN: 0, sudden: false, done, hn: m === 3 ? 5 : 0 };
  }),
};

const sizes = [[390, 844, "phone"], [768, 1024, "ipad-portrait"], [1180, 820, "ipad-landscape"]];
const { base, browser } = await setup();
for (const scheme of ["light", "dark"]) {
  for (const [w, h, label] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    await ctx.addInitScript(([s]) => {
      localStorage.setItem("halloween-tennis-me-v1", JSON.stringify({ p: 0, photo: null }));
      localStorage.setItem("halloween-tennis-v3", JSON.stringify(s));
    }, [seeded]);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForSelector(".match");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    const shot = (name) => page.screenshot({ path: path.join(OUT, `${label}-${scheme}-${name}.png`), fullPage: true });
    await shot("jadwal");
    for (const tab of ["klasemen", "pemain"]) { await page.click(`[data-tab="${tab}"]`); await page.waitForTimeout(400); await shot(tab); }
    await page.click('[data-tab="jadwal"]');
    await page.click('[data-act="profile"]'); await waitModal(page, true); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${label}-${scheme}-modal-profile.png`) });
    await ctx.close();
  }
}
await teardown();
console.log("screenshots in", OUT);
```

- [ ] **Step 5: Run the full suite and the screenshots**

Run: `cd tests/ui && npm test && node shoot.mjs && ls out | wc -l`
Expected: all tests PASS; `ls` shows 24 files.

- [ ] **Step 6: Review the screenshots (all 24) against the spec**

Open each image in `tests/ui/out/` and check, noting any defect:
1. Colors: cream/pumpkin/purple in light; dark purple/orange in dark; no leftover Polaris gray primary buttons, no teal avatars, no white-on-cream cards in dark mode.
2. Font looks like Plus Jakarta Sans (geometric, rounded); title and score digits bold.
3. Phone: single column, standings as a list, nothing clipped, no sideways scroll.
4. iPad portrait: two columns for matches (live match full width), full table for standings, 2-column player cards.
5. iPad landscape: standings left + recap panel right; 3-column player cards; content width capped.
6. Live match has a purple outline; badges readable in both themes.

Fix defects by adjusting theme tokens (Task 2 block) or the CSS added in Tasks 3–7, re-run `npm test` and `node shoot.mjs` after each fix. If a color token has no visible effect, find the correct per-component token with `grep -o -E "\-\-p-color-[a-z0-9-]+-f4125" <(curl -s https://cdn.shopify.com/shopifycloud/polaris.js) | sort -u` and add it to the theme block (the "every theme token exists" test keeps names honest).

- [ ] **Step 7: Manual click-through in a real browser**

Run: `python3 -m http.server 8080` in the repo root, open `http://localhost:8080` in Chrome and in Safari (iPad/phone simulator or device if available). Walk through: pick player → selfie step → add points → undo (needs API; expect the "Gagal kirim skor" toast offline — acceptable) → reset match confirm/cancel → reset all (wrong text, then cancel) → open recap from standings → share/save buttons visible → rotate the device/resize window across 700px and 1024px and confirm layouts reflow without reload. Note: the live API (`/api/state`) only exists on Vercel; deploy a preview to test undo/reset-match/reset-all end to end.

- [ ] **Step 8: Update `README.md`**

Under `## Isi` add the lines:

```
- `tests/ui/`  tes UI (Playwright + Chrome). Jalankan: `cd tests/ui && npm install && npm test`
```

and add a short section before `## Isi`:

```
## Tampilan
UI memakai Shopify Polaris web components (`s-button`, `s-table`, `s-modal`, dll.) dari CDN `cdn.shopify.com/shopifycloud/polaris.js`, dengan warna Purrclub dan font Plus Jakarta Sans. Perlu koneksi internet untuk memuat komponen; jika gagal, muncul tombol "Muat ulang".
```

- [ ] **Step 9: Commit**

```bash
git add index.html README.md tests/ui/foundation.test.mjs tests/ui/shoot.mjs
git commit -m "chore(ui): remove legacy styles, add screenshot review script and docs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review (spec coverage)

| Spec requirement | Task |
|---|---|
| Real components from CDN (`polaris.js`) | 2 |
| Palette → Polaris tokens via one theme block referencing existing vars; dark mode automatic | 2 (+ tests light/dark) |
| Avatar color token | 2 (all seven avatar tokens), 3 |
| Plus Jakarta Sans everywhere; keep Eater/Barlow links for recap canvas | 2 |
| Score digits Plus Jakarta Sans 800 + tabular nums | 5 |
| Component mapping: buttons, tabs, chip, avatar, badges, banner, sections, grid/stack, table, text field, modal, pick grid | 3, 4, 5, 6, 7 |
| Modal: single `s-modal`, `openModal(heading, body, opts)`, slots, `hide` resolves pending, overlay CSS/branch removed | 4 |
| Events: click selector, `rstIn` Enter, data attributes unchanged | 3, 4 |
| Layout table: widths/gutters, tabs, Jadwal 1/2/2 cols, live spans both, Klasemen two-pane, Pemain 1/2/3, pick modal 2/3, score digit sizes | 3, 5, 6, 7, 4 |
| Touch targets ≥44, `+ Poin` ≥56 | 3, 4, 5, 6 (tests) |
| Safe-area insets kept; orientation reflow by CSS only | 3 (kept `:root`/`.tabs` safe-area rules), 8 step 7 |
| Standings table auto list/table + fallback decision | 6 (notes), 8 step 6 |
| Load-failure notice | 2 |
| Custom toast kept | 4 (font), Global Constraints |
| Recap canvas untouched | Global Constraints; 4 only changes the modal wrapper |
| Verification: screenshots at 390/768/1180, light+dark; click-through; no console errors | 1 (`errors` assertion), 8 |

Known limits to tell the user after execution: undo / reset-match / reset-all against the **live** API can only be exercised on a Vercel preview (tests mock `/api/state` for reset-all); the `f4125` token hash may change if Shopify rebuilds `polaris.js` — `foundation.test.mjs` detects that.
