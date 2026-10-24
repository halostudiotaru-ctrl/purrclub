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
