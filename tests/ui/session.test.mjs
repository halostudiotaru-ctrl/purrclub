import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown, waitModal, waitModalText } from "./helpers.mjs";
import { fakeApi, waitLive } from "./fakeapi.mjs";

after(teardown);

const body = { name: "Mabar Kamis", players: ["Budi", "Cici", "Angel", "Dodi", "Eka", "Fajar", "Gita"], durationMin: 180, slotMin: 30, startTime: "19:00", note: "Kamis 5 Nov" };
// What another phone would do: start a session through the api.
const createSession = (page, b = body) =>
  page.evaluate(async (b) => (await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).status, b);
const titleIs = (page, t) => page.waitForFunction((t) => document.getElementById("sTitle").textContent === t, t);

test("a session started elsewhere replaces header, schedule and slot times on this phone", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  assert.equal(await page.locator("header s-link").count(), 1);      // the Halloween header keeps its map link
  assert.equal(await createSession(page), 200);
  await titleIs(page, "Mabar Kamis");
  assert.equal(await page.locator(".match").count(), 6);
  assert.ok((await page.locator(".match").first().textContent()).includes("19:00–19:30"));
  assert.ok((await page.locator(".match").nth(1).textContent()).includes("19:30–20:00"));
  assert.equal(await page.locator("header s-link").count(), 0);
  const sub = await page.locator("#sSub").textContent();
  assert.ok(sub.includes("Kamis 5 Nov") && sub.includes("19:00–22:00"), sub);
  assert.ok((await page.locator("#toast").textContent()).includes("Sesi aktif: Mabar Kamis"));
  assert.equal(await page.title(), "Mabar Kamis");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("my identity follows my name into the new session", async () => {
  const { page, ctx } = await open({ routes: fakeApi(), me: 0 });          // index 0 = Angel in Halloween
  await waitLive(page);
  await createSession(page);                                               // Angel is index 2 here
  await titleIs(page, "Mabar Kamis");
  assert.ok((await page.locator("#chip .chip").textContent()).includes("Angel"));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("halloween-tennis-me-v1")));
  assert.equal(stored.p, 2);
  assert.equal(stored.name, "Angel");
  await ctx.close();
});

test("if my name is not in the new session I am asked who I am", async () => {
  const { page, ctx } = await open({ routes: fakeApi(), me: 0 });
  await waitLive(page);
  await createSession(page, { ...body, players: ["Budi", "Cici", "Dodi", "Eka"] });
  await titleIs(page, "Mabar Kamis");
  await waitModal(page, true, 4000);
  assert.equal(await page.locator("#modal").getAttribute("heading"), "Kamu yang mana?");
  await ctx.close();
});

const fill = (page, id, v) => page.fill(`s-text-field#${id} input`, v);
const addPlayers = async (page, list) => {
  for (const n of list) { await fill(page, "wzPn", n); await page.click('s-modal [data-act="wzadd"]'); }
};

test("create flow: settings, players, fairness summary with a suggestion, then the session is live", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  await page.click('[data-act="wznew"]');
  await waitModal(page, true);
  await fill(page, "wzName", "Mabar Tes");
  await fill(page, "wzDur", "150");
  await fill(page, "wzSlot", "30");
  await fill(page, "wzStart", "19:00");
  await page.click('s-modal [data-act="wznext"]');
  await waitModalText(page, "2/3");

  await addPlayers(page, ["Budi", "Cici", "Dodi"]);
  await page.click('s-modal [data-act="wznext"]');                       // only three players
  assert.ok((await page.locator("#toast").textContent()).includes("Minimal 4 pemain"));
  await addPlayers(page, ["Eka", "Fajar", "Gita", "Hana"]);
  assert.equal(await page.locator('s-modal [data-act="wzrm"]').count(), 7);
  await page.click('s-modal [data-act="wznext"]');

  await waitModalText(page, "Tiap pemain main 2–3 game");                // 7 players, 5 matches
  assert.equal(await page.locator('s-modal [data-act="wzsug"]').count(), 1);
  await page.click('s-modal [data-act="wzsug"]');                         // 7 matches: everyone plays 4
  await waitModalText(page, "Semua pemain main 4 game");
  await page.waitForFunction(() => !document.querySelector('s-modal [data-act="wzgo"]').hasAttribute("disabled"));
  await page.click('s-modal [data-act="wzgo"]');
  await waitModal(page, false);

  await titleIs(page, "Mabar Tes");
  assert.equal(await page.locator(".match").count(), 7);
  assert.ok((await page.locator(".match").first().textContent()).includes("19:00–19:30"));
  assert.ok((await page.locator("#sSub").textContent()).includes("19:00–22:30"));
  assert.equal(await page.locator("#pemain s-section").count(), 7);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("create flow: names can be copied from an earlier session and removed again", async () => {
  const { page, ctx } = await open({ routes: fakeApi() });
  await waitLive(page);
  await page.click('[data-act="wznew"]');
  await waitModal(page, true);
  await page.click('s-modal [data-act="wznext"]');                       // defaults are valid
  await waitModalText(page, "2/3");
  await page.waitForSelector('s-modal [data-act="wzcopy"]');
  await page.click('s-modal [data-act="wzcopy"]');
  await page.click('s-modal [data-act="wzcopyfrom"][data-id="halloween"]');
  await waitModalText(page, "10 pemain");
  assert.equal(await page.locator('s-modal [data-act="wzrm"]').count(), 10);
  await page.click('s-modal [data-act="wzrm"] >> nth=0');
  assert.equal(await page.locator('s-modal [data-act="wzrm"]').count(), 9);
  await page.keyboard.press("Escape");
  await waitModal(page, false);
  await ctx.close();
});

test("create flow: step 1 rejects bad numbers and the summary offers both nearby equal counts", async () => {
  const { page, ctx } = await open({ routes: fakeApi() });
  await waitLive(page);
  await page.click('[data-act="wznew"]');
  await waitModal(page, true);
  await fill(page, "wzDur", "5");
  await page.click('s-modal [data-act="wznext"]');
  assert.ok((await page.locator("#toast").textContent()).includes("Durasi harus 10-720 menit"));
  await fill(page, "wzDur", "180");
  await fill(page, "wzStart", "7pm");
  await page.click('s-modal [data-act="wznext"]');
  assert.ok((await page.locator("#toast").textContent()).includes("HH:MM"));
  await fill(page, "wzStart", "9:30");                                    // normalised to 09:30
  await page.click('s-modal [data-act="wznext"]');
  await waitModalText(page, "2/3");
  await addPlayers(page, ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "B1"]);   // 10 players, 6 matches
  await page.click('s-modal [data-act="wznext"]');
  await waitModalText(page, "Tiap pemain main 2–3 game");
  assert.equal(await page.locator('s-modal [data-act="wzsug"]').count(), 2);            // 5 and 10 matches
  await page.keyboard.press("Escape");
  await ctx.close();
});

test("create flow: a suggestion never goes past the 720-minute limit", async () => {
  const { page, ctx } = await open({ routes: fakeApi() });
  await waitLive(page);
  await page.click('[data-act="wznew"]');
  await waitModal(page, true);
  await fill(page, "wzDur", "600");
  await fill(page, "wzSlot", "60");
  await page.click('s-modal [data-act="wznext"]');
  await waitModalText(page, "2/3");
  await addPlayers(page, ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]);     // 10 matches: 7 is fair, 14 would be 840 min
  await page.click('s-modal [data-act="wznext"]');
  await waitModalText(page, "Tiap pemain main 5–6 game");
  assert.equal(await page.locator('s-modal [data-act="wzsug"]').count(), 1);
  assert.ok((await page.locator('s-modal [data-act="wzsug"]').textContent()).includes("7 match"));
  await page.keyboard.press("Escape");
  await ctx.close();
});
