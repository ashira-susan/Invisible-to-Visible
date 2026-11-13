// Loads the REAL background.js against a fake `chrome`, with strict timers, and drives it the
// way Chrome does: webRequest events, webNavigation.onCommitted, runtime messages from the
// relay. This is the layer the pure-logic tests cannot see (M2c shipped green and still failed
// in Chrome for exactly this kind of reason). It does NOT replace a check in real Chrome: the
// fake only knows what we told it about Chrome's event order and fields.
//
// Strict timers: setTimeout/clearTimeout throw "Illegal invocation" when called as a method
// of another object, like in a real service worker.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONSENT_VERSION } from "../lib/config.js";

const ASSET = (p) => new URL(`../${p}`, import.meta.url);
const INSTALL_ID = "11111111-1111-4111-8111-111111111111";
const EXT = "ext-id";
const TAB = 1;
let runs = 0;

function install({ local, session, clock } = {}) {
  const listeners = {};
  const event = (name) => ({ addListener: (fn) => (listeners[name] ??= []).push(fn) });
  local ??= { consentGranted: true, consentVersion: CONSENT_VERSION, installId: INSTALL_ID, fullAccess: true, paused: false, queue: [] };
  session ??= {};
  clock ??= { t: Date.UTC(2026, 10, 1, 10, 0, 0) };
  const posted = [];
  const timers = [];

  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, now: Date.now };
  const strict = (name, impl) => function (...args) {
    if (this !== undefined && this !== globalThis) throw new TypeError(`Illegal invocation: ${name} called as a method`);
    return impl(...args);
  };
  globalThis.setTimeout = strict("setTimeout", (fn, ms) => { timers.push({ fn, at: clock.t + ms }); return timers.length - 1; });
  globalThis.clearTimeout = strict("clearTimeout", (id) => { if (timers[id]) timers[id].dead = true; });
  Date.now = () => clock.t;

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith(`chrome-extension://${EXT}/`)) {
      const text = readFileSync(ASSET(u.slice(`chrome-extension://${EXT}/`.length)), "utf8");
      return { json: async () => JSON.parse(text), text: async () => text };
    }
    if (u.endsWith("/api/v1/scans") && init?.method === "POST") {
      posted.push(JSON.parse(init.body));
      return { ok: true, status: 201 };
    }
    throw new Error(`unexpected fetch ${u}`);
  };

  globalThis.chrome = {
    runtime: { id: EXT, getURL: (p) => `chrome-extension://${EXT}/${p}`, onInstalled: event("runtime.onInstalled"), onStartup: event("runtime.onStartup"), onMessage: event("runtime.onMessage") },
    storage: {
      local: { get: async (d) => ({ ...d, ...local }), set: async (patch) => { Object.assign(local, patch); } },
      session: { get: async (d) => ({ ...d, ...session }), set: async (patch) => { Object.assign(session, JSON.parse(JSON.stringify(patch))); } },
      onChanged: event("storage.onChanged"),
    },
    permissions: { contains: async () => true, onAdded: event("permissions.onAdded"), onRemoved: event("permissions.onRemoved") },
    webNavigation: { onCommitted: event("webNavigation.onCommitted") },
    tabs: { onRemoved: event("tabs.onRemoved"), create: () => {} },
    alarms: { get: (name, cb) => cb(undefined), create: () => {}, onAlarm: event("alarms.onAlarm") },
    webRequest: { onBeforeRequest: event("webRequest.onBeforeRequest"), onHeadersReceived: event("webRequest.onHeadersReceived"), onSendHeaders: event("webRequest.onSendHeaders") },
  };

  const fire = async (name, ...args) => { for (const fn of listeners[name] ?? []) await fn(...args); };
  const quiet = async () => { for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); };
  // Fires only the timers that are due at the fake clock's time.
  const runTimers = async () => {
    for (const t of timers) {
      if (!t.dead && !t.done && t.at <= clock.t) { t.done = true; await t.fn(); }
    }
    await quiet();
  };

  const api = {
    local, session, clock, posted, listeners, fire, quiet,
    restore() {
      Object.assign(globalThis, { chrome: saved.chrome, fetch: saved.fetch, setTimeout: saved.setTimeout, clearTimeout: saved.clearTimeout });
      Date.now = saved.now;
    },
    async load() { await import(`${new URL("../background.js", import.meta.url).href}?run=${++runs}`); await quiet(); },
    async advance(ms) { clock.t += ms; await runTimers(); },
    // What Chrome does for a top-level navigation, in the order it does it.
    async navigate(url, { documentId, requestId, referer, cookies = [] }) {
      await fire("webRequest.onBeforeRequest", { tabId: TAB, frameId: 0, type: "main_frame", requestId, url });
      if (referer) await fire("webRequest.onSendHeaders", { tabId: TAB, frameId: 0, type: "main_frame", requestId, url, requestHeaders: [{ name: "Referer", value: referer }] });
      if (cookies.length) await fire("webRequest.onHeadersReceived", { tabId: TAB, frameId: 0, type: "main_frame", requestId, url, responseHeaders: cookies.map((value) => ({ name: "Set-Cookie", value })) });
      await fire("webNavigation.onCommitted", { tabId: TAB, frameId: 0, url, documentId });
      await quiet();
    },
    async subresource(url, { documentId, frameId = 0, type = "script" }) {
      await fire("webRequest.onBeforeRequest", { tabId: TAB, frameId, type, requestId: `s${++runs}`, url, documentId });
      await quiet();
    },
    async relayMessage(message, { documentId, frameId = 0, url }) {
      await fire("runtime.onMessage", message, { id: EXT, tab: { id: TAB }, frameId, url, documentId });
      await quiet();
    },
  };
  return api;
}

const A = "https://first.example/";
const B = "https://second.example/";
const beat = { type: "itv-inpage", v: 1, hb: 1 };

test("worker: a late beacon from a settled page is not counted for the next page", async (t) => {
  const w = install(); t.after(() => w.restore());
  await w.load();
  await w.navigate(A, { documentId: "doc-A", requestId: "r1" });
  await w.subresource("https://px.doubleclick.net/early", { documentId: "doc-A" }); // counted: A is open
  await w.advance(10_000);                                                          // A settles and is sent
  await w.subresource("https://px.doubleclick.net/late-beacon", { documentId: "doc-A" }); // the tab has no page now
  await w.advance(1_000);
  await w.navigate(B, { documentId: "doc-B", requestId: "r2" });
  await w.advance(10_000);
  assert.equal(w.posted.length, 2);
  assert.equal(w.posted[0].signals.third_party_requests, 1);
  assert.equal(w.posted[1].site.domain, "second.example");
  assert.equal(w.posted[1].signals.third_party_requests, 0);
  assert.deepEqual(w.posted[1].signals.trackers ?? [], []);
});

test("worker: the new page's response cookies and referrer reach the new page, not the one on screen", async (t) => {
  const w = install(); t.after(() => w.restore());
  await w.load();
  await w.navigate(A, { documentId: "doc-A", requestId: "r1" });
  await w.navigate(B, { documentId: "doc-B", requestId: "r2", referer: "https://search.example/results?q=private", cookies: ["sid=1; Path=/"] });
  await w.advance(10_000);
  const [first, second] = w.posted;
  assert.equal(first.signals.cookies.first_party, 0);
  assert.equal(second.signals.cookies.first_party, 1);
  assert.equal(second.site.referrer_origin, "https://search.example");
  assert.ok(!JSON.stringify(w.posted).includes("private"));
});

test("worker: a redirected navigation keeps its referrer", async (t) => {
  const w = install(); t.after(() => w.restore());
  await w.load();
  await w.fire("webRequest.onBeforeRequest", { tabId: TAB, frameId: 0, type: "main_frame", requestId: "r1", url: "http://short.example/x" });
  await w.fire("webRequest.onSendHeaders", { tabId: TAB, frameId: 0, type: "main_frame", requestId: "r1", url: "http://short.example/x", requestHeaders: [{ name: "Referer", value: "https://search.example/" }] });
  await w.fire("webRequest.onBeforeRequest", { tabId: TAB, frameId: 0, type: "main_frame", requestId: "r1", url: "https://www.final.example/" }); // redirect hop: same id
  await w.fire("webNavigation.onCommitted", { tabId: TAB, frameId: 0, url: "https://www.final.example/", documentId: "doc-F" });
  await w.quiet();
  await w.advance(10_000);
  assert.equal(w.posted[0].site.referrer_origin, "https://search.example");
});

test("worker: a heartbeat from the top frame of the page's own document marks it checked", async (t) => {
  const w = install(); t.after(() => w.restore());
  await w.load();
  await w.navigate(B, { documentId: "doc-B", requestId: "r1" });
  await w.relayMessage(beat, { documentId: "doc-B", url: B });
  await w.advance(10_000);
  assert.equal(w.posted[0].signals.inpage_checked, true);
  assert.equal(w.posted[0].signals.trackers_checked, true);
});

test("worker: no heartbeat, a sub-frame heartbeat or a heartbeat for another document leaves it not checked", async (t) => {
  const w = install(); t.after(() => w.restore());
  await w.load();
  await w.navigate(B, { documentId: "doc-B", requestId: "r1" });
  await w.relayMessage(beat, { documentId: "doc-B", frameId: 2, url: "https://second.example/embed" });
  await w.relayMessage(beat, { documentId: "doc-A", url: B });
  await w.relayMessage(beat, { url: B }); // Chrome gave no documentId
  await w.advance(10_000);
  assert.equal(w.posted[0].signals.inpage_checked, false);
});

test("worker: a heartbeat that arrives before the page commits still counts, for its own document only", async (t) => {
  const w = install(); t.after(() => w.restore());
  await w.load();
  await w.fire("webRequest.onBeforeRequest", { tabId: TAB, frameId: 0, type: "main_frame", requestId: "r1", url: B });
  await w.relayMessage(beat, { documentId: "doc-B", url: B }); // the relay is quicker than onCommitted
  await w.fire("webNavigation.onCommitted", { tabId: TAB, frameId: 0, url: B, documentId: "doc-B" });
  await w.quiet();
  await w.advance(10_000);
  assert.equal(w.posted[0].signals.inpage_checked, true);
});

test("worker: nothing is sent or held when only site names are allowed", async (t) => {
  const w = install({ local: { consentGranted: true, consentVersion: CONSENT_VERSION, installId: INSTALL_ID, fullAccess: false, paused: false, queue: [] } });
  t.after(() => w.restore());
  await w.load();
  await w.navigate(B, { documentId: "doc-B", requestId: "r1", referer: "https://search.example/", cookies: ["a=1"] });
  await w.relayMessage(beat, { documentId: "doc-B", url: B });
  await w.advance(10_000);
  assert.equal(w.posted.length, 1);
  assert.equal(w.posted[0].signals?.trackers_checked ?? false, false);
  assert.equal(w.posted[0].signals?.inpage_checked ?? false, false);
  assert.equal(w.posted[0].site.referrer_origin ?? null, null);
});

test("worker: a restart mid-visit keeps the page and its heartbeat", async (t) => {
  const first = install(); 
  await first.load();
  await first.navigate(B, { documentId: "doc-B", requestId: "r1" });
  await first.relayMessage(beat, { documentId: "doc-B", url: B });
  await first.advance(600); // lets the debounced save run
  const { local, session, clock } = first;
  first.restore();

  const second = install({ local, session, clock }); // a new worker, the same storage
  t.after(() => second.restore());
  await second.load();
  await second.advance(10_000);
  assert.equal(second.posted.length, 1);
  assert.equal(second.posted[0].site.domain, "second.example");
  assert.equal(second.posted[0].signals.inpage_checked, true);
});

test("worker: the real BBC to Wikipedia sequence from Chrome: cached BBC frames do not leak into Wikipedia", async (t) => {
  const w = install(); t.after(() => w.restore());
  await w.load();
  await w.navigate("https://www.bbc.com/", { documentId: "B58A8E", requestId: "r1" });
  await w.subresource("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", { documentId: "B58A8E" });
  await w.subresource("https://uk-script.dotmetrics.net/door.js", { documentId: "B58A8E" });
  await w.advance(100_000);                                                   // BBC settles and is sent
  await w.navigate("https://www.wikipedia.org/", { documentId: "23F1F3", requestId: "r2" });
  // Chrome puts BBC in the back/forward cache; its frozen frames flush requests
  const cached = { tabId: TAB, type: "image", url: "https://pagead2.googlesyndication.com/pagead/gen_204?id=av-js", documentLifecycle: "cached" };
  await w.fire("webRequest.onBeforeRequest", { ...cached, requestId: "c1", frameId: 445, documentId: "B58A8E" });
  await w.fire("webRequest.onBeforeRequest", { ...cached, requestId: "c2", frameId: 456, documentId: "DCD7A1", parentDocumentId: "B58A8E" });
  await w.fire("webRequest.onBeforeRequest", { ...cached, requestId: "c3", frameId: 455, parentDocumentId: "B58A8E", url: "https://uk-script.dotmetrics.net/BeaconEvent.dotmetrics" });
  await w.subresource("https://www.wikipedia.org/portal/wikipedia.org/assets/js/index.js", { documentId: "23F1F3" }); // first-party: ignored
  await w.advance(10_000);
  assert.equal(w.posted.length, 2);
  assert.equal(w.posted[0].site.domain, "www.bbc.com");
  assert.equal(w.posted[0].signals.third_party_requests, 2);
  assert.equal(w.posted[1].site.domain, "www.wikipedia.org");
  assert.equal(w.posted[1].signals.third_party_requests, 0);
  assert.deepEqual(w.posted[1].signals.trackers ?? [], []);
});

test("worker: a real third-party request from the new page's own ad frame is still counted", async (t) => {
  const w = install(); t.after(() => w.restore());
  await w.load();
  await w.navigate(B, { documentId: "doc-B", requestId: "r1" });
  await w.fire("webRequest.onBeforeRequest", { tabId: TAB, type: "sub_frame", requestId: "f1", frameId: 7, parentDocumentId: "doc-B", documentLifecycle: "active", url: "https://securepubads.g.doubleclick.net/gampad/ads" });
  await w.fire("webRequest.onBeforeRequest", { tabId: TAB, type: "image", requestId: "f2", frameId: 7, documentId: "doc-FRAME", parentDocumentId: "doc-B", documentLifecycle: "active", url: "https://pagead2.googlesyndication.com/x.gif" });
  await w.advance(10_000);
  assert.equal(w.posted[0].signals.third_party_requests, 2);
});

test("worker: a page restored from the back/forward cache is checked only by a heartbeat that arrives after its commit", async (t) => {
  const w = install(); t.after(() => w.restore());
  await w.load();
  await w.navigate(B, { documentId: "doc-B", requestId: "r1" });
  await w.advance(10_000);                                                   // first visit sent
  // Back/forward restore: the same document commits again, with no main-frame request
  await w.relayMessage(beat, { documentId: "doc-B", url: B });               // too early: nothing is open, nothing is held
  await w.fire("webNavigation.onCommitted", { tabId: TAB, frameId: 0, url: B, documentId: "doc-B" });
  await w.quiet();
  await w.relayMessage(beat, { documentId: "doc-B", url: B });               // the repeat a second later
  await w.advance(10_000);
  assert.equal(w.posted.length, 2);
  assert.equal(w.posted[1].signals.inpage_checked, true);

  // and without the repeat the restored visit honestly reads "not checked"
  await w.fire("webNavigation.onCommitted", { tabId: TAB, frameId: 0, url: B, documentId: "doc-B" });
  await w.quiet();
  await w.advance(10_000);
  assert.equal(w.posted[2].signals.inpage_checked, false);
});
