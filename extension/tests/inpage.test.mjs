import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptSender, sanitizeInpage, isUsableCookieName, INPAGE_TYPE, MAX_BATCH_COUNT, MAX_NAMES, MAX_NAME_LENGTH,
} from "../lib/inpage.js";

const msg = (extra = {}) => ({ type: INPAGE_TYPE, v: 1, ...extra });

test("a normal message is accepted and reshaped", () => {
  const clean = sanitizeInpage(msg({ canvas: 2, webgl: 1, audio: 0, font: 3, geo: 4, cookies: ["a", "b"] }));
  assert.deepEqual(clean, {
    fingerprinting: { canvas: 2, webgl: 1, audio: 0, font: 3 },
    geolocation: 4,
    names: ["a", "b"],
  });
});

test("things that are not our message are refused", () => {
  for (const bad of [null, undefined, 5, "text", [], {}, { type: "other", v: 1, canvas: 1 }, msg({ v: 2, canvas: 1 }), { type: INPAGE_TYPE, canvas: 1 }]) {
    assert.equal(sanitizeInpage(bad), null);
  }
});

test("a message that reports nothing is dropped", () => {
  assert.equal(sanitizeInpage(msg()), null);
  assert.equal(sanitizeInpage(msg({ canvas: 0, cookies: [] })), null);
});

test("counts are clamped, and bad numbers become zero", () => {
  const clean = sanitizeInpage(msg({ canvas: 1e12, webgl: -5, audio: 1.5, font: "7", geo: NaN, cookies: ["x"] }));
  assert.equal(clean.fingerprinting.canvas, MAX_BATCH_COUNT);
  assert.equal(clean.fingerprinting.webgl, 0);
  assert.equal(clean.fingerprinting.audio, 0);
  assert.equal(clean.fingerprinting.font, 0);
  assert.equal(clean.geolocation, 0);
  assert.equal(sanitizeInpage(msg({ canvas: Infinity })), null); // not a usable number, so nothing to report
});

test("cookie names are validated and capped", () => {
  const tooMany = Array.from({ length: 200 }, (_, i) => `n${i}`);
  assert.equal(sanitizeInpage(msg({ cookies: tooMany })).names.length, MAX_NAMES);

  const clean = sanitizeInpage(msg({
    cookies: ["ok", "", "a\u0000b", "line\nbreak", "x".repeat(MAX_NAME_LENGTH + 1), 42, null, {}, ["z"], "tab\there", "fine_2"],
  }));
  assert.deepEqual(clean.names, ["ok", "fine_2"]);
  assert.equal(isUsableCookieName("x".repeat(MAX_NAME_LENGTH)), true);
  assert.equal(isUsableCookieName("x".repeat(MAX_NAME_LENGTH + 1)), false);
});

test("unknown fields, such as a made-up host, are dropped", () => {
  const clean = sanitizeInpage(msg({ canvas: 1, host: "evil.example", site: "evil.example", url: "https://evil.example/x" }));
  assert.deepEqual(Object.keys(clean).sort(), ["fingerprinting", "geolocation", "names"]);
  assert.ok(!JSON.stringify(clean).includes("evil"));
});

test("only our own extension's messages from a real tab are accepted, and the sender is read from Chrome's fields", () => {
  const good = { id: "abc", tab: { id: 7 }, frameId: 3, url: "https://x.example/p" };
  assert.deepEqual(acceptSender(good, "abc"), { tabId: 7, frameId: 3, url: "https://x.example/p" });
  assert.equal(acceptSender({ ...good, id: "someone-else" }, "abc"), null);       // another extension
  assert.equal(acceptSender({ ...good, id: undefined }, "abc"), null);
  assert.equal(acceptSender({ id: "abc", url: "chrome-extension://abc/popup.html" }, "abc"), null); // not from a tab
  assert.equal(acceptSender({ ...good, tab: { id: -1 } }, "abc"), null);
  assert.equal(acceptSender({ ...good, tab: { id: "7" } }, "abc"), null);
  assert.equal(acceptSender(null, "abc"), null);
  assert.deepEqual(acceptSender({ id: "abc", tab: { id: 1 } }, "abc"), { tabId: 1, frameId: 0, url: "" });
});
