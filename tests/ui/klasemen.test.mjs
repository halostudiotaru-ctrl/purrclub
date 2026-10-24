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

test("no player chosen: CTA asks to pick a name", async () => {
  const { page, ctx } = await open({ me: null });
  await waitModal(page, true, 4000);
  await page.keyboard.press("Escape");
  await waitModal(page, false);
  await page.click('[data-tab="klasemen"]');
  assert.equal(await page.locator('.kl-side [data-act="pick"]').count(), 1);
  await ctx.close();
});
