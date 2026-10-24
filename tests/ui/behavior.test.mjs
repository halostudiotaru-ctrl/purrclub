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
