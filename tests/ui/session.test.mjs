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

test("session card says how many matches each player gets and updates after a manual game", async () => {
  const { page, ctx } = await open({ routes: fakeApi() });
  await waitLive(page);
  const card = page.locator("#jadwal .sesscard");
  assert.ok((await card.textContent()).includes("Tiap pemain main 4 game"));
  assert.ok((await card.textContent()).includes("10 pemain · 10 match"));
  await page.evaluate(async () => {
    await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "addmatch", a: [0, 1], b: [2, 3] }) });
  });
  await page.waitForFunction(() => document.querySelector("#jadwal .sesscard").textContent.includes("6 orang main 4 kali, 4 orang main 5 kali"));
  assert.ok((await card.textContent()).includes("Paling sedikit (4 game)"));
  await ctx.close();
});

test("klasemen: phones show the match count under the name; wide screens keep the Main column only", async () => {
  for (const [w, visible] of [[390, true], [768, false]]) {
    const { page, ctx } = await open({ routes: fakeApi(), width: w, height: 900 });
    await waitLive(page);
    await page.click('[data-tab="klasemen"]');
    const cnt = page.locator("#klasemen .cnt").first();
    assert.equal(await cnt.isVisible(), visible, `${w}px`);
    assert.equal((await cnt.textContent()).trim(), "main 0/4");
    await ctx.close();
  }
});

test("klasemen: on a phone the match count sits on its own line under the name", async () => {
  const { page, ctx } = await open({ routes: fakeApi(), width: 390, height: 900 });
  await waitLive(page);
  await page.click('[data-tab="klasemen"]');
  const g = await page.evaluate(() => {
    const pn = document.querySelector("#klasemen .pn");
    return { nameBottom: pn.querySelector("b").getBoundingClientRect().bottom, cntTop: pn.querySelector(".cnt").getBoundingClientRect().top };
  });
  assert.ok(g.cntTop >= g.nameBottom - 0.5, `cnt top ${g.cntTop} should be below name bottom ${g.nameBottom}`);
  await ctx.close();
});

test("history: open an old session read-only, go back, or make it active", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  await createSession(page);
  await titleIs(page, "Mabar Kamis");

  await page.click('[data-act="hist"]');
  await waitModal(page, true);
  await page.waitForSelector('s-modal [data-act="histopen"]');
  assert.equal(await page.locator('s-modal [data-act="histopen"]').count(), 2);
  await page.click('s-modal [data-act="histopen"][data-id="halloween"]');
  await waitModal(page, false);
  await page.waitForFunction(() => document.getElementById("sTitle").textContent === "Halloween Tennis" && document.querySelector("#jadwal s-banner[heading='Sesi lama']"));
  for (const sel of ["[data-pt]", "[data-sub]", "[data-setcur]", '[data-act="addgame"]', '[data-act="addplayer"]', "#tools s-button"]) {
    assert.equal(await page.locator(sel).count(), 0, sel);
  }
  assert.equal(await page.locator('[data-act="histback"]').count(), 1);
  assert.equal(await page.locator(".match").count(), 10);

  await page.click('[data-act="histback"]');
  await titleIs(page, "Mabar Kamis");
  assert.equal(await page.locator("#jadwal s-banner[heading='Sesi lama']").count(), 0);
  assert.equal(await page.locator('[data-act="addgame"]').count(), 1);

  // make the old one active again
  await page.click('[data-act="hist"]');
  await page.waitForSelector('s-modal [data-act="histopen"]');
  await page.click('s-modal [data-act="histopen"][data-id="halloween"]');
  await page.waitForSelector('[data-act="histactivate"]');
  await page.click('[data-act="histactivate"]');
  await page.waitForFunction(() => !document.querySelector("#jadwal s-banner[heading='Sesi lama']") && document.querySelector('[data-act="addgame"]'));
  assert.equal(await page.evaluate(async () => (await (await fetch("/api/sessions")).json()).active), "halloween");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("writes to an old session are refused even if the controls were somehow used", async () => {
  const { page, ctx } = await open({ routes: fakeApi() });
  await waitLive(page);
  await createSession(page);
  await titleIs(page, "Mabar Kamis");
  const status = await page.evaluate(async () =>
    (await fetch("/api/state?sid=halloween", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "setcurrent", i: 1 }) })).status);
  assert.equal(status, 409);
  await ctx.close();
});

test("viewing an old session never touches the stored identity or opens the name prompt", async () => {
  const { page, ctx, errors } = await open({ routes: fakeApi() });
  await waitLive(page);
  const mk = (name, players) => ({ ...body, name, players });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("halloween-tennis-me-v1")));
  await createSession(page, mk("Sesi A", ["A1", "A2", "A3", "A4"]));
  await titleIs(page, "Sesi A");
  await waitModal(page, true, 4000);
  await page.click('s-modal [data-act="choose"][data-p="0"]');
  await page.waitForSelector('s-modal [data-act="close"]');
  await page.click('s-modal [data-act="close"]');
  await waitModal(page, false);
  await createSession(page, mk("Sesi B", ["B1", "B2", "B3", "B4"]));
  await titleIs(page, "Sesi B");
  await waitModal(page, true, 4000);
  await page.click('s-modal [data-act="choose"][data-p="0"]');
  await page.waitForSelector('s-modal [data-act="close"]');
  await page.click('s-modal [data-act="close"]');
  await waitModal(page, false);
  assert.equal((await stored()).name, "B1");

  await page.click('[data-act="hist"]');
  await waitModal(page, true);
  await page.waitForSelector('s-modal [data-act="histopen"]');
  await page.locator('s-modal [data-act="histopen"]', { hasText: "Sesi A" }).click();
  await page.waitForFunction(() => document.getElementById("sTitle").textContent === "Sesi A" && document.querySelector("#jadwal s-banner[heading='Sesi lama']"));
  await page.waitForTimeout(1200);
  assert.equal(await page.locator("s-modal[open], #modal[open]").count() + (await page.evaluate(() => document.getElementById("modal").hasAttribute("open") ? 1 : 0)), 0);
  const during = await stored();
  assert.equal(during.name, "B1");
  assert.notEqual(during.p, null);

  await page.click('[data-act="histback"]');
  await titleIs(page, "Sesi B");
  await page.waitForFunction(() => document.querySelector("#chip").textContent.includes("B1"));
  assert.equal((await stored()).name, "B1");
  assert.deepEqual(errors, []);
  await ctx.close();
});
