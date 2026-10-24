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
  // s-button hosts are display:contents (no box), so measure the real <button> in their shadow root.
for (const sel of ['[data-tab="jadwal"] button', "#chip s-clickable", '[data-act="resetall"] button']) {
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
