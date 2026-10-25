// Render the actual nested React components without sockets or a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import { childView } from "../server/index.js";
import { offlineReply } from "../server/buddy.js";

const source = await readFile(new URL("src/Child.jsx", import.meta.url), "utf8");
const result = await build({
  stdin: { contents: source + "\nexport { Home, Album, Buddy, MoneySheet, Missions, PlaceSheet };", resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react"], define: { "import.meta.env.PROD": "false" },
});
const module = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url) });
const noop = () => {};

test("W3.1: Home, Album, Chat and kid sheets render Bo without Maple text", () => {
  const db = seed(Date.now());
  db.child.bear.name = "Bo";
  db.missions.push({ id: "idea", title: "Compare prices", status: "open", createdBy: "buddy", points: 20 });
  db.postcards.push({ id: "friend-card", defId: "seattle", source: "trade", from: "Maya", collectedAt: Date.now() });
  db.buddy.chat.push({ id: "hello", role: "assistant", text: offlineReply(db, "Hi"), ts: Date.now() });
  const state = childView(db);
  for (const [name, extra] of [["Home", {}], ["Album", {}], ["Buddy", {}], ["MoneySheet", { start: "ask" }], ["Missions", {}], ["PlaceSheet", { id: "seattle" }]]) {
    const html = renderToStaticMarkup(createElement(module.exports[name], { state, setTab: noop, open: noop, run: noop, close: noop, goMap: noop, openCard: noop, startTalk: noop, ...extra }));
    assert.doesNotMatch(html, /Maple/, name);
    if (name !== "Album") assert.match(html, /Bo/, name);
    if (name === "MoneySheet") assert.match(html, /Bo can&#x27;t move money/);
    if (name === "Missions") assert.match(html, /Idea from Bo/);
    if (name === "PlaceSheet") assert.match(html, /Maybe Bo will visit one day/);
  }
});

test("W3.7/8: demo creates a payday before duplicate injection and docs explain funding and Apple Cash", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const demo = readme.split("## Two-minute demo")[1].split("## How it's built")[0];
  assert.ok(demo.indexOf("Fast-forward to payday") >= 0);
  assert.ok(demo.indexOf("Post a duplicate") > demo.indexOf("Fast-forward to payday"));
  assert.match(readme.split("## Accounts and family devices")[1].split("## Two-minute demo")[0], /Add money.*does not move real money/);
  const limitations = readme.split("## Known limitations")[1].split("## Testing")[0];
  assert.match(limitations, /\[Apple Cash tracking\]\(docs\/apple-cash-shortcut.md\)/);
  assert.match(limitations, /purchases logged manually or by an iPhone Shortcut/);
  assert.match(limitations, /cannot send Apple Cash or read the actual Wallet balance/);
  assert.doesNotMatch(limitations, /coming in the next release|cannot fund allowance/);
});
