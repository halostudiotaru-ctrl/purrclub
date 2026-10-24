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
    // let the modal's open animation finish so x positions are stable
    await page.waitForFunction(() => {
      const d = document.getElementById("modal").shadowRoot.querySelector("dialog");
      return d.getAnimations({ subtree: true }).length === 0;
    });
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
  assert.equal(await page.locator("s-modal .big-av").count(), 1);
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
    const box = await page.locator(`s-modal ${sel} button`).boundingBox();
    assert.ok(box.height >= 44 - 0.01, `${sel} ${box.height}px`);
  }
  await ctx.close();
});

test("toast is above the open modal (top layer)", async () => {
  const { page, ctx } = await open();
  await page.click('[data-act="resetall"]');
  await waitModal(page, true);
  await page.click('[data-act="rstok"]');
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("Ketik RESET dulu"));
  await page.waitForTimeout(100);
  const box = await page.locator("#toast").boundingBox();
  assert.ok(box && box.width > 0, "toast is visible");
  const hit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y), t = document.getElementById("toast");
    return { onToast: !!el && (el === t || t.contains(el)), tag: el && el.tagName };
  }, [box.x + box.width / 2, box.y + box.height / 2]);
  assert.ok(hit.onToast, `elementFromPoint at the toast centre hit ${hit.tag}`);
  await ctx.close();
});

test("profile modal shows a large (>= 100px) round photo/initial", async () => {
  const { page, ctx } = await open({ me: 0 });
  await page.click('[data-act="profile"]');
  await waitModal(page, true);
  await page.waitForTimeout(400);
  const b = await page.locator("s-modal .big-av").boundingBox();
  assert.ok(b && b.width >= 100, `big avatar width ${b && b.width}`);
  assert.equal(Math.round(b.width), Math.round(b.height));
  await ctx.close();
});

test("a malicious photo src from the server cannot inject attributes", async () => {
  const evil = 'data:image/jpeg;base64,x" onerror="window.__xss=1';
  const { page, ctx } = await open({
    me: 0,
    routes: [
      ["**/api/state", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rev: 1, matches: freshMatches(), photos: { 0: 1 } }) })],
      ["**/api/photo?p=0", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ photo: evil }) })],
    ],
  });
  await page.click('[data-tab="klasemen"]');
  // the photo arrived and was rendered (chip avatar carries a src)
  await page.waitForFunction(() => document.querySelector("#chip s-avatar[src]"), null, { timeout: 5000 });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.evaluate(() => document.querySelectorAll("[onerror]").length), 0);
  await ctx.close();
});
