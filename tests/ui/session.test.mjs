import test, { after } from "node:test";
import assert from "node:assert/strict";
import { open, teardown, waitModal } from "./helpers.mjs";
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
