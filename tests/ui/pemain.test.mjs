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
