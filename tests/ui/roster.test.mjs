import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown, waitModal } from "./helpers.mjs";
import { fakeApi, waitLive } from "./fakeapi.mjs";

after(teardown);

const teamsText = (page, i) => page.locator(".match").nth(i).locator("s-grid").first().textContent();

test("substitute: replace a player in an unfinished match", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  assert.equal(await page.locator("[data-sub]").count(), 10);
  await page.click('[data-sub="1"]');
  await waitModal(page, true);
  // match 2 is Angel & Norman vs Aya & Fai; replace Angel (side 0, slot 0)
  await page.click('s-modal [data-act="subpick"][data-side="0"][data-slot="0"]');
  // substitutes exclude the four players already in the match
  assert.equal(await page.locator('s-modal [data-act="subto"]').count(), 6);
  await page.click('s-modal [data-act="subto"][data-p="1"]'); // Faiz
  await waitModal(page, false);
  await page.waitForFunction(() => document.querySelectorAll(".match")[1].querySelector("s-grid").textContent.includes("Faiz"));
  const t = await teamsText(page, 1);
  assert.ok(t.includes("Faiz") && !t.includes("Angel"), t);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("manual player and manual game appear in klasemen; the new player has a recap", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi(), block: [/fonts\.g(oogleapis|static)\.com/] });
  await waitLive(page);

  // new player (index 10)
  await page.click('[data-act="addplayer"]');
  await waitModal(page, true);
  await page.fill("s-text-field#npIn input", "Tamu");
  await page.click('[data-act="npok"]');
  await waitModal(page, false);
  await page.waitForSelector('#pemain s-section[heading="Tamu"]', { state: "attached" });

  // manual game: Tamu & Angel vs Faiz & Bella; the start button needs four players
  await page.click('[data-act="addgame"]');
  await waitModal(page, true);
  assert.notEqual(await page.locator('s-modal [data-act="gamego"]').getAttribute("disabled"), null);
  for (const p of [10, 0, 1, 2]) await page.click(`s-modal [data-act="gametoggle"][data-p="${p}"]`);
  assert.equal(await page.locator('s-modal [data-act="gamego"]').getAttribute("disabled"), null);
  await page.click('s-modal [data-act="gamego"]');
  await waitModal(page, false);
  await page.waitForFunction(() => document.querySelectorAll(".match").length === 11);
  assert.ok((await page.locator(".match").nth(10).textContent()).includes("Game manual"));

  // play it: make it live, Tamu & Angel win 4-0
  await page.click('[data-setcur="10"]');
  for (let k = 0; k < 16; k++) await page.click('[data-pt="10:0"]');
  await page.waitForFunction(() => document.querySelectorAll(".match")[10].textContent.includes("Selesai"));

  // klasemen has a row for Tamu with 1/1 played, and a recap that renders
  await page.click('[data-tab="klasemen"]');
  const row = page.locator("#klasemen s-table-row", { hasText: "Tamu" });
  assert.equal(await row.count(), 1);
  assert.ok((await row.textContent()).includes("1/1"));
  await page.click('#klasemen [data-act="recap"][data-p="10"]');
  await waitModal(page, true);
  await page.waitForSelector("#rbox img", { timeout: 10000 });
  assert.ok((await page.locator("#modal").getAttribute("heading")).includes("Tamu"));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("game modal can add a new player inline and keeps the picks", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  await page.click('[data-act="addgame"]');
  await waitModal(page, true);
  await page.click('s-modal [data-act="gametoggle"][data-p="0"]');
  await page.fill("s-text-field#gpIn input", "Budi");
  await page.click('s-modal [data-act="gameaddplayer"]');
  await page.waitForSelector('s-modal [data-act="gametoggle"][data-p="10"]');
  assert.ok((await page.locator('s-modal [data-act="gametoggle"][data-p="0"]').getAttribute("class")).includes("sel"));
  assert.deepEqual(errors, []);
  await ctx.close();
});
