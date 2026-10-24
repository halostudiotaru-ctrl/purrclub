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
  assert.equal(await page.evaluate(() => document.querySelectorAll("#klasemen table").length), 0);
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
  assert.ok((await page.locator('#klasemen [data-act="recap"] button').first().boundingBox()).height >= 44 - 0.01);
  assert.equal(await b.first().evaluate((e) => e.tagName), "S-BUTTON");
  await ctx.close();
});

test("phone: compact standings list, name and Recap on one row, Main/Game hidden", async () => {
  const { page, ctx } = await klasemen({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const hs = await page.evaluate(() =>
    [...document.querySelectorAll("#klasemen s-table-row")].map((r) => r.shadowRoot.querySelector("section").getBoundingClientRect().height));
  assert.equal(hs.length, 10);
  const avg = hs.reduce((a, b) => a + b, 0) / hs.length;
  assert.ok(avg <= 110, `average row height ${avg}px (rows: ${hs.map(Math.round)})`);
  const rec = page.locator('#klasemen s-table-row [data-act="recap"] button').first();
  assert.equal(await rec.isVisible(), true);
  const rb = await rec.boundingBox();
  assert.ok(rb.height >= 44 - 0.01, `recap button ${rb.height}px`);
  // name and Recap share a row
  const nb = await page.locator("#klasemen s-table-row .pn").first().boundingBox();
  assert.ok(Math.abs((nb.y + nb.height / 2) - (rb.y + rb.height / 2)) <= 6, `name y ${nb.y} recap y ${rb.y}`);
  // Main (played/sched, e.g. "0/4") is not shown on phone
  const shown = (n) => page.evaluate((n) => document.querySelector("#klasemen s-table-row").querySelectorAll("s-table-cell")[n].querySelector("span").getClientRects().length > 0, n);
  assert.equal(await shown(1), false, "Main is hidden on phone");
  assert.equal(await shown(4), false, "Game is hidden on phone");
  assert.equal(await shown(2), true, "Menang is shown on phone");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await ctx.close();
});

test("iPad: wide table shows all 7 column headers incl. Recap", async () => {
  const { page, ctx } = await klasemen({ width: 768, height: 1000 });
  const heads = await page.locator("#klasemen s-table-header").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(heads, ["Pemain", "Main", "Menang", "Kalah", "Game", "Selisih", "Recap"]);
  for (const n of [1, 4]) {
    assert.equal(await page.evaluate((n) => document.querySelector("#klasemen s-table-row").querySelectorAll("s-table-cell")[n].querySelector("span").getClientRects().length > 0, n), true, `column ${n} shown on iPad`);
  }
  assert.equal(await page.locator('#klasemen s-table-row [data-act="recap"]').first().getAttribute("variant"), "secondary");
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
