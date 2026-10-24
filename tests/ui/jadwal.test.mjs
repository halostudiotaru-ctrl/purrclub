import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown } from "./helpers.mjs";

after(teardown);

const box = (page, i) => page.locator(".match").nth(i).boundingBox();

test("match cards use s-section; header has a badge; no raw buttons", async () => {
  const { page, ctx } = await open();
  assert.equal(await page.locator(".match s-section").count(), 10);
  assert.equal(await page.locator(".match s-badge").count(), 10);
  // light DOM only: Playwright's css locator pierces s-button shadow roots
  assert.equal(await page.evaluate(() => document.querySelectorAll("#jadwal button").length), 0);
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
    const inner = page.locator(`[data-pt="0:${i}"] button`);
    assert.ok((await inner.boundingBox()).height >= 56 - 0.01);
  }
  await pts.nth(0).click();
  await page.waitForFunction(() => document.getElementById("jadwal").textContent.includes("15"));
  await ctx.close();
});

test("undo/reset buttons appear after a point and are >= 44px", async () => {
  const { page, ctx } = await open();
  await page.click('[data-pt="0:1"]');
  await page.waitForSelector('[data-reset="0"]');
  assert.ok((await page.locator('[data-reset="0"] button').boundingBox()).height >= 44 - 0.01);
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
