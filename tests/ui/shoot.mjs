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
