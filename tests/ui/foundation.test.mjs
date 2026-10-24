import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { open, teardown } from "./helpers.mjs";

after(teardown);

const tok = (page, n) => page.evaluate((n) => getComputedStyle(document.body).getPropertyValue(n).trim(), n);

test("Polaris elements are defined", async () => {
  const { page, ctx } = await open();
  assert.ok(await page.evaluate(() => !!customElements.get("s-button")));
  await ctx.close();
});

test("body uses Plus Jakarta Sans and the font loads", async () => {
  const { page, ctx } = await open();
  assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Plus Jakarta Sans/);
  assert.equal(await page.evaluate(() => document.fonts.check('600 16px "Plus Jakarta Sans"')), true);
  assert.match(await tok(page, "--p-font-family-sans-f4125"), /Plus Jakarta Sans/);
  await ctx.close();
});

test("light theme: Polaris tokens follow the Purrclub palette", async () => {
  const { page, ctx } = await open({ scheme: "light" });
  assert.equal(await tok(page, "--p-color-button-primary-bg-f4125"), "#d9560b");
  assert.equal(await tok(page, "--p-color-bg-surface-f4125"), "#fffaf0");
  assert.equal(await tok(page, "--p-color-text-f4125"), "#241733");
  await ctx.close();
});

test("dark theme: Polaris tokens follow the dark palette", async () => {
  const { page, ctx } = await open({ scheme: "dark" });
  assert.equal(await tok(page, "--p-color-button-primary-bg-f4125"), "#ff8a1f");
  assert.equal(await tok(page, "--p-color-bg-surface-f4125"), "#231636");
  assert.equal(await tok(page, "--p-color-text-f4125"), "#f3ead8");
  await ctx.close();
});

test("dark theme: neutral badge has a visible pill (surface2)", async () => {
  const { page, ctx } = await open({ scheme: "dark" });
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('s-badge[tone="neutral"]').shadowRoot.querySelector(".badge")).backgroundColor);
  assert.equal(bg, "rgb(47, 31, 71)");
  await ctx.close();
});

test("every theme token name exists in the live polaris.js", async () => {
  const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const names = [...new Set([...html.matchAll(/(--p-[a-z0-9-]+-f4125)\s*:/g)].map((m) => m[1]))];
  assert.ok(names.length >= 40, "theme block missing or too small: " + names.length);
  const js = await (await fetch("https://cdn.shopify.com/shopifycloud/polaris.js")).text();
  assert.deepEqual(names.filter((n) => !js.includes(n)), []);
});

test("shows a reload notice when polaris.js fails to load", async () => {
  const { page, ctx } = await open({ block: ["**/polaris.js"] });
  assert.equal(await page.locator("#nopolaris").isVisible(), true);
  await ctx.close();
});

test("notice stays hidden when polaris.js loads", async () => {
  const { page, ctx } = await open();
  assert.equal(await page.locator("#nopolaris").isVisible(), false);
  await ctx.close();
});

test("no dead styles or legacy markup classes remain", () => {
  const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const dead = [".ov", ".sheet", ".mtxt", ".mrow", ".linkbox", ".pri{", ".ghost{", ".danger{", ".tblWrap", ".recapCta", ".banner{", ".mh{", ".btns", "button.sm", "nav button"];
  assert.deepEqual(dead.filter((d) => css.includes(d)), []);
  const body = html.slice(html.indexOf("<body>"));
  assert.equal(/class="(pri|ghost|danger|tblWrap|recapCta|sheet|mrow)\b/.test(body), false);
});
