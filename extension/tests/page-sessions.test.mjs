import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PageSessions, MAX_TRACKERS } from "../lib/page-sessions.js";
import { PublicSuffixList } from "../lib/psl.js";
import { TrackerList } from "../lib/trackers.js";
import { cookieKey } from "../lib/cookies.js";

const psl = new PublicSuffixList(readFileSync(new URL("../data/public_suffix_list.dat", import.meta.url), "utf8"));
const trackers = new TrackerList({
  domains: {
    "ads.test": ["advertising", "AdCo", 1],
    "stats.test": ["analytics", "StatCo", 0],
  },
});

function setup(overrides = {}) {
  const clock = { t: 1_000_000 };
  const timers = [];
  const finished = [];
  const stored = { value: {} };
  const sessions = new PageSessions({
    psl,
    trackers,
    store: { get: async () => stored.value, set: async (v) => { stored.value = JSON.parse(JSON.stringify(v)); } },
    onFinalize: async (page) => finished.push(page),
    now: () => clock.t,
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
    cancel: (id) => { if (timers[id]) timers[id].cancelled = true; },
    ...overrides,
  });
  return { sessions, clock, timers, finished, stored };
}

test("counts third-party requests and ignores first-party ones", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, "https://www.news.example/story/42?id=7");
  sessions.addRequest(1, "https://news.example/app.js");        // same site
  sessions.addRequest(1, "https://cdn.news.example/logo.png");   // same site
  sessions.addRequest(1, "https://other.example/lib.js");        // third party
  sessions.addRequest(1, "https://other.example/more.js");       // third party
  await sessions.finalize(1);
  assert.equal(finished.length, 1);
  assert.equal(PageSessions.toSignals(finished[0]).third_party_requests, 2);
});

test("known trackers are listed once each, with category, company and fingerprinter flag", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, "https://site.example/");
  sessions.addRequest(1, "https://px.ads.test/a");
  sessions.addRequest(1, "https://px.ads.test/b");
  sessions.addRequest(1, "https://www.stats.test/c");
  sessions.addRequest(1, "https://unlisted.example/d");
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.equal(signals.third_party_requests, 4);
  assert.equal(signals.trackers_checked, true);
  assert.deepEqual(signals.trackers, [
    { domain: "ads.test", category: "advertising", company: "AdCo", known_fingerprinter: true },
    { domain: "stats.test", category: "analytics", company: "StatCo" },
  ]);
});

test("a tracker on the page's own site is not counted", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, "https://www.ads.test/");
  sessions.addRequest(1, "https://px.ads.test/a");
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.equal(signals.third_party_requests, 0);
  assert.deepEqual(signals.trackers, []);
});

test("nothing from the page address except host and https is kept", async () => {
  const { sessions, finished, stored } = setup();
  await sessions.start(1, "https://user:secret@Mail.Site.example:8443/inbox/42?token=abc#frag");
  sessions.addRequest(1, "https://px.ads.test/collect?uid=12345&email=a@b.c");
  await sessions.flush(); // write the in-progress page to the store, as the real worker does
  assert.ok(Object.keys(stored.value).length === 1, "the in-progress page was stored");
  const text = JSON.stringify(finished) + JSON.stringify(stored.value) + JSON.stringify([...sessions.pages.values()]);
  for (const leak of ["secret", "token", "inbox", "frag", "8443", "uid=", "email", "collect"]) {
    assert.ok(!text.includes(leak), `leaked "${leak}"`);
  }
  assert.equal([...sessions.pages.values()][0].host, "mail.site.example");
});

test("requests that arrive just before the page starts are replayed into it", async () => {
  const { sessions, finished, clock } = setup();
  sessions.addRequest(1, "https://px.ads.test/early");
  clock.t += 500;
  await sessions.start(1, "https://site.example/");
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[0]).third_party_requests, 1);
});

test("old pending requests are not replayed", async () => {
  const { sessions, finished, clock } = setup();
  sessions.addRequest(1, "https://px.ads.test/old");
  clock.t += 10_000;
  await sessions.start(1, "https://site.example/");
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[0]).third_party_requests, 0);
});

test("navigating away finishes the previous page first", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, "https://first.example/");
  sessions.addRequest(1, "https://px.ads.test/a");
  await sessions.start(1, "https://second.example/");
  assert.equal(finished.length, 1);
  assert.equal(finished[0].host, "first.example");
  assert.equal(PageSessions.toSignals(finished[0]).third_party_requests, 1);
});

test("a page is finalised once, even if finalize is called again", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, "https://site.example/");
  await sessions.finalize(1);
  await sessions.finalize(1);
  assert.equal(finished.length, 1);
});

test("the settle timer finishes the page", async () => {
  const { sessions, finished, timers } = setup();
  await sessions.start(1, "https://site.example/");
  const settle = timers.find((t) => t.ms === 10_000);
  assert.ok(settle, "a 10 second settle timer was scheduled");
  settle.fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(finished.length, 1);
});

test("a stale timer from an earlier page does not end the newer page", async () => {
  const { sessions, finished, timers } = setup();
  await sessions.start(1, "https://first.example/");
  const firstTimer = timers.find((t) => t.ms === 10_000);
  await sessions.start(1, "https://second.example/");
  firstTimer.fn(); // fires late
  await new Promise((r) => setImmediate(r));
  assert.equal(finished.length, 1); // only the first page ended (when we navigated)
  assert.equal(sessions.pages.get(1).host, "second.example");
});

test("finalizeStale ends only pages older than the settle time", async () => {
  const { sessions, finished, clock } = setup();
  await sessions.start(1, "https://old.example/");
  clock.t += 8_000;
  await sessions.start(2, "https://newer.example/");
  clock.t += 3_000; // old: 11 s, newer: 3 s
  await sessions.finalizeStale();
  assert.deepEqual(finished.map((p) => p.host), ["old.example"]);
  assert.ok(sessions.pages.has(2));
});

test("pages survive a service-worker restart through the store", async () => {
  const first = setup();
  await first.sessions.start(7, "https://site.example/");
  first.sessions.addRequest(7, "https://px.ads.test/a");
  await first.sessions.flush();

  const second = setup();
  second.stored.value = first.stored.value; // same browser session storage
  await second.sessions.load();
  await second.sessions.finalize(7);
  assert.equal(second.finished.length, 1);
  assert.equal(PageSessions.toSignals(second.finished[0]).trackers[0].domain, "ads.test");
});

test("pages that must not be recorded start no session", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, "chrome://extensions");
  await sessions.start(1, "http://127.0.0.1:8000/app/");
  sessions.addRequest(1, "https://px.ads.test/a");
  assert.equal(sessions.pages.size, 0);
  assert.equal(finished.length, 0);
});

test("the tracker list is capped", async () => {
  const many = {};
  for (let i = 0; i < MAX_TRACKERS + 50; i++) many[`t${i}.test`] = ["advertising", "X", 0];
  const { sessions, finished } = setup({ trackers: new TrackerList({ domains: many }) });
  await sessions.start(1, "https://site.example/");
  for (let i = 0; i < MAX_TRACKERS + 50; i++) sessions.addRequest(1, `https://t${i}.test/x`);
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.equal(signals.trackers.length, MAX_TRACKERS);
  assert.equal(signals.third_party_requests, MAX_TRACKERS + 50);
});

test("closing a tab finishes its page and forgets waiting requests", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, "https://site.example/");
  sessions.addRequest(2, "https://px.ads.test/for-another-tab");
  await sessions.closeTab(1);
  await sessions.closeTab(2);
  assert.equal(finished.length, 1);
  assert.equal(sessions.pending.size, 0);
});


// ---- M2b: cookies and referrer --------------------------------------------------

test("cookies are counted per visit, split into the site's own and other sites'", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, "https://www.shop.example/");
  sessions.addCookies(1, "https://www.shop.example/", ["sid=1; Path=/", "cart=2; Path=/"]);
  sessions.addCookies(1, "https://api.shop.example/x", ["token=3"]);          // same site, different host
  sessions.addCookies(1, "https://px.ads.test/collect", ["uid=9; Max-Age=999"]); // known tracker
  sessions.addCookies(1, "https://other.example/", ["o=1"]);                  // other site, not a tracker
  await sessions.finalize(1);
  const { cookies } = PageSessions.toSignals(finished[0]);
  assert.deepEqual(cookies, { first_party: 3, third_party: 2, by_trackers: 1 });
});

test("the same cookie set twice is counted once; deleting a cookie is not setting one", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, "https://www.shop.example/");
  sessions.addCookies(1, "https://www.shop.example/a", ["sid=1"]);
  sessions.addCookies(1, "https://www.shop.example/b", ["sid=2"]);            // refreshed value, same cookie
  sessions.addCookies(1, "https://www.shop.example/c", ["old=; Max-Age=0"]);  // deletion
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[0]).cookies.first_party, 1);
});

test("cookies from the page's own response (which arrives before the page starts) are counted", async () => {
  const { sessions, finished, clock } = setup();
  sessions.addCookies(1, "https://www.shop.example/", ["sid=1"]);
  clock.t += 400;
  await sessions.start(1, "https://www.shop.example/");
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[0]).cookies.first_party, 1);
});

test("cookie names and values are never stored or sent, only hashes", async () => {
  const { sessions, finished, stored } = setup();
  await sessions.start(1, "https://www.shop.example/");
  sessions.addCookies(1, "https://www.shop.example/", ["super_secret_name=super_secret_value; Path=/"]);
  await sessions.flush();
  const text = JSON.stringify(stored.value) + JSON.stringify(finished);
  assert.ok(!text.includes("super_secret"), "cookie name or value leaked into storage");
  await sessions.finalize(1);
  assert.ok(!JSON.stringify(PageSessions.toSignals(finished[0])).includes("super_secret"));
});

test("the referrer is kept as an origin only", async () => {
  const { sessions } = setup();
  sessions.setReferrer(1, "https://www.google.com/search?q=my+private+query&hl=en#top");
  await sessions.start(1, "https://shop.example/");
  assert.equal(sessions.pages.get(1).referrer, "https://www.google.com");
  const text = JSON.stringify([...sessions.pages.values()]);
  for (const leak of ["search", "private", "hl=en", "top"]) assert.ok(!text.includes(leak), `referrer leaked "${leak}"`);
});

test("a referrer from the same site is dropped", async () => {
  const { sessions } = setup();
  sessions.setReferrer(1, "https://www.shop.example/category/shoes");
  await sessions.start(1, "https://shop.example/product/9");
  assert.equal(sessions.pages.get(1).referrer, null);
});

test("no referrer means null, and an old referrer is not reused for a later page", async () => {
  const { sessions, clock } = setup();
  await sessions.start(1, "https://typed.example/");
  assert.equal(sessions.pages.get(1).referrer, null);

  sessions.setReferrer(1, "https://www.google.com/");
  clock.t += 60_000; // far too long ago
  await sessions.start(1, "https://late.example/");
  assert.equal(sessions.pages.get(1).referrer, null);
});

test("a referrer is used once, by the page it was meant for", async () => {
  const { sessions } = setup();
  sessions.setReferrer(1, "https://news.example/front");
  await sessions.start(1, "https://first.example/");
  await sessions.start(1, "https://second.example/");
  assert.equal(sessions.pages.get(1).referrer, null);
});

test("junk referrers are ignored", async () => {
  const { sessions } = setup();
  for (const bad of ["", "not a url", "ftp://x.example/", "https://[::1]/", "javascript:alert(1)"]) sessions.setReferrer(1, bad);
  await sessions.start(1, "https://site.example/");
  assert.equal(sessions.pages.get(1).referrer, null);
});

test("pages saved by the previous version still load", async () => {
  const { sessions, stored, finished } = setup();
  stored.value = { 3: { seq: 1, host: "old.example", https: true, site: "old.example", startedAt: 1_000_000, thirdParty: 2, trackers: {} } };
  await sessions.load();
  await sessions.finalize(3);
  const signals = PageSessions.toSignals(finished[0]);
  assert.deepEqual(signals.cookies, { first_party: 0, third_party: 0, by_trackers: 0 });
});


// ---- M2c: what the page-world hooks report ---------------------------------------
// Everything below arrives from a web page and is untrusted.

const inpage = (extra = {}) => ({ type: "itv-inpage", v: 1, ...extra });
const SHOP = "https://www.shop.example/";

test("page-world counts fill the fingerprinting and location fields", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, SHOP);
  sessions.addInpage(1, 0, SHOP, inpage({ canvas: 2, webgl: 1, font: 1, geo: 3 }));
  sessions.addInpage(1, 0, SHOP, inpage({ canvas: 1, audio: 4 }));
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.deepEqual(signals.fingerprinting, { canvas: 3, webgl: 1, audio: 4, font: 1 });
  assert.equal(signals.geolocation_calls, 3);
});

test("a page that reports nothing gives zeros", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, SHOP);
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.deepEqual(signals.fingerprinting, { canvas: 0, webgl: 0, audio: 0, font: 0 });
  assert.equal(signals.geolocation_calls, 0);
});

test("counts stop at the contract's maximum however much is reported", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, SHOP);
  for (let i = 0; i < 300; i++) sessions.addInpage(1, 0, SHOP, inpage({ canvas: 1e9, geo: 1000 }));
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.equal(signals.fingerprinting.canvas, 100_000);
  assert.equal(signals.geolocation_calls, 100_000);
});

test("a script-set cookie seen in a header too is counted once; a different name adds one", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, SHOP);
  sessions.addCookies(1, SHOP, ["sid=1; Path=/"]);                              // header
  sessions.addInpage(1, 0, SHOP, inpage({ cookies: ["sid"] }));                  // script, same host and name
  sessions.addInpage(1, 0, SHOP, inpage({ cookies: ["sid", "theme"] }));         // sid again, theme is new
  await sessions.finalize(1);
  assert.deepEqual(PageSessions.toSignals(finished[0]).cookies, { first_party: 2, third_party: 0, by_trackers: 0 });
});

test("the frame's host comes from sender.url, never from the message", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, SHOP);
  // The page claims to be evil.example and also to be a tracker; both claims are ignored.
  sessions.addInpage(1, 0, SHOP, inpage({ cookies: ["a"], host: "evil.example", domain: "ads.test", url: "https://ads.test/" }));
  await sessions.finalize(1);
  assert.deepEqual(PageSessions.toSignals(finished[0]).cookies, { first_party: 1, third_party: 0, by_trackers: 0 });
  const keys = Object.keys(finished[0].cookies.first);
  assert.deepEqual(keys, [cookieKey("www.shop.example", "a")]);
});

test("a script cookie from another site's frame is third party, and a tracker's frame counts as a tracker", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, SHOP);
  sessions.addInpage(1, 3, "https://px.ads.test/frame.html", inpage({ cookies: ["uid"], canvas: 1 }));
  sessions.addInpage(1, 4, "https://other.example/embed", inpage({ cookies: ["o"] }));
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.deepEqual(signals.cookies, { first_party: 0, third_party: 2, by_trackers: 1 });
  assert.equal(signals.fingerprinting.canvas, 1);
});

test("frames with no trustworthy host (about:blank, srcdoc, data:) still count calls but their cookies are dropped", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, SHOP);
  for (const url of ["about:blank", "about:srcdoc", "data:text/html,x", "", undefined, 42, "http://127.0.0.1:8000/app/"]) {
    sessions.addInpage(1, 2, url, inpage({ canvas: 1, cookies: ["sneaky"] }));
  }
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.equal(signals.fingerprinting.canvas, 7);
  assert.deepEqual(signals.cookies, { first_party: 0, third_party: 0, by_trackers: 0 });
});

test("a late message from the page the tab just left is dropped; a subframe's is not", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, SHOP);
  sessions.addInpage(1, 0, "https://old.example/", inpage({ canvas: 5 }));        // top frame of another page
  sessions.addInpage(1, 7, "https://old.example/embed", inpage({ canvas: 2 }));   // a subframe may be anyone
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[0]).fingerprinting.canvas, 2);
});

test("messages that arrive just before the page starts are kept, old ones are not", async () => {
  const { sessions, finished, clock } = setup();
  sessions.addInpage(1, 0, SHOP, inpage({ canvas: 2, cookies: ["early"] }));
  clock.t += 4_000; // older than the 3 s window
  sessions.addInpage(1, 0, SHOP, inpage({ canvas: 1 }));
  clock.t += 400;
  await sessions.start(1, SHOP);
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.equal(signals.fingerprinting.canvas, 1); // only the fresh one
  assert.equal(signals.cookies.first_party, 0);   // the stale one carried the cookie
});

test("early page-world messages for a page that never starts are forgotten when the tab closes", async () => {
  const { sessions } = setup();
  sessions.addInpage(5, 0, SHOP, inpage({ canvas: 2, cookies: ["x"] }));
  assert.equal(sessions.pending.size, 1);
  await sessions.closeTab(5);
  assert.equal(sessions.pending.size, 0);
});

test("cookie names are hashed on arrival: they are never held, stored or sent", async () => {
  const { sessions, finished, stored } = setup();
  sessions.addInpage(1, 0, SHOP, inpage({ cookies: ["unique_pending_name"] }));      // held before the page starts
  assert.ok(!JSON.stringify([...sessions.pending.values()]).includes("unique_pending_name"), "name held in the pending buffer");
  await sessions.start(1, SHOP);
  sessions.addInpage(1, 0, SHOP, inpage({ cookies: ["unique_live_name"], canvas: 1 }));
  await sessions.flush();
  assert.ok(!JSON.stringify(stored.value).includes("unique_"), "name reached session storage");
  await sessions.finalize(1);
  const everything = JSON.stringify(finished) + JSON.stringify(PageSessions.toSignals(finished[0]));
  assert.ok(!everything.includes("unique_"), "name reached the page record or the summary");
});

test("garbage from the page changes nothing", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, SHOP);
  const junk = [null, undefined, 7, "x", [], {}, inpage({ canvas: -3, webgl: "9", audio: 0.5 }), { type: "other", v: 1, canvas: 9 }, inpage({ v: 9, canvas: 9 })];
  for (const raw of junk) sessions.addInpage(1, 0, SHOP, raw);
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.deepEqual(signals.fingerprinting, { canvas: 0, webgl: 0, audio: 0, font: 0 });
  assert.equal(signals.geolocation_calls, 0);
});

test("a flood of messages and cookie names stays inside every cap", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, SHOP);
  for (let i = 0; i < 4_000; i++) {
    const cookies = Array.from({ length: 100 }, (_, k) => `flood_${i}_${k}`);
    sessions.addInpage(1, 0, SHOP, inpage({ canvas: 5000, webgl: 5000, audio: 5000, font: 5000, geo: 5000, cookies }));
  }
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  for (const n of Object.values(signals.fingerprinting)) assert.ok(n <= 100_000);
  assert.ok(signals.geolocation_calls <= 100_000);
  assert.ok(signals.cookies.first_party <= 2_000);
});

test("a page saved by an older version (no page-world fields) still loads and finishes", async () => {
  const { sessions, finished, stored } = setup();
  stored.value = { 3: { seq: 1, host: "old.example", https: true, site: "old.example", startedAt: 1_000_000, thirdParty: 0, trackers: {}, cookies: { first: {}, third: {}, tracker: {} }, referrer: null } };
  await sessions.load();
  await sessions.finalize(3);
  const signals = PageSessions.toSignals(finished[0]);
  assert.deepEqual(signals.fingerprinting, { canvas: 0, webgl: 0, audio: 0, font: 0 });
  assert.equal(signals.geolocation_calls, 0);
});

// ---- the previous page is still being sent when the next one starts -----------------

test("requests, cookies and page-script reports that arrive while the previous page is still being sent reach the new page", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const finished = [];
  let first = true;
  const { sessions } = setup({
    onFinalize: async (page) => {
      if (first) { first = false; await gate; } // the old page's summary is slow to send
      finished.push(page);
    },
  });

  await sessions.start(1, "https://old.example/");
  const starting = sessions.start(1, SHOP); // the tab navigates; the old page is still being handed over
  await Promise.resolve();
  await Promise.resolve();

  sessions.addRequest(1, "https://px.ads.test/t.gif");
  sessions.addCookies(1, SHOP, ["sid=1"]);
  sessions.addInpage(1, 0, SHOP, inpage({ canvas: 4, geo: 2, cookies: ["theme"] }));

  release();
  await starting;
  await sessions.finalize(1);

  const page = finished.find((p) => p.host === "www.shop.example");
  const signals = PageSessions.toSignals(page);
  assert.equal(signals.third_party_requests, 1);
  assert.equal(signals.trackers.length, 1);
  assert.equal(signals.fingerprinting.canvas, 4);
  assert.equal(signals.geolocation_calls, 2);
  assert.equal(signals.cookies.first_party, 2); // sid from the header, theme from a script
  assert.equal(finished.find((p) => p.host === "old.example").fp.canvas, 0); // none of it landed on the old page
});

test("a held report from another site's top frame is not given to the page that starts next", async () => {
  const { sessions, finished } = setup();
  sessions.addInpage(1, 0, "https://old.example/", inpage({ canvas: 5 }));       // the page we just left
  sessions.addInpage(1, 9, "https://embed.example/", inpage({ canvas: 2 }));     // some subframe: kept
  await sessions.start(1, SHOP);
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[0]).fingerprinting.canvas, 2);
});

// ---- timers: Chrome only accepts setTimeout/clearTimeout called as plain functions -----

test("timers are called as plain functions, never as methods of the session object", async () => {
  const calls = [];
  const strict = (name) => function (...args) {
    // `this` is undefined for a plain call; a method call would make it the PageSessions object
    if (this !== undefined) throw new TypeError("Illegal invocation");
    calls.push(name);
    return calls.length;
  };
  const { sessions } = setup({ schedule: strict("schedule"), cancel: strict("cancel") });
  await sessions.start(1, SHOP);                         // arms the settle timer and the save timer
  sessions.addRequest(1, "https://other.example/x.js");  // asks for a save
  await sessions.flush();                                // cancels the save timer
  await sessions.start(1, "https://www.other.example/"); // ends the first page: cancels its settle timer
  assert.ok(calls.includes("schedule"));
  assert.ok(calls.includes("cancel"));
});

test("a page saved before the worker restarted can be loaded again and keeps its page-script counts", async () => {
  const strictSchedule = function (fn, ms) { if (this !== undefined) throw new TypeError("Illegal invocation"); return 1; };
  const { sessions, stored, finished } = setup({ schedule: strictSchedule });
  stored.value = { 4: { seq: 2, host: "kept.example", https: true, site: "kept.example", startedAt: 1_000_000, thirdParty: 1, trackers: {}, cookies: { first: {}, third: {}, tracker: {} }, referrer: null, fp: { canvas: 6, webgl: 0, audio: 0, font: 0 }, geo: 1 } };
  await sessions.load();
  sessions.addInpage(4, 0, "https://kept.example/", inpage({ canvas: 1 }));
  await sessions.finalize(4);
  assert.equal(PageSessions.toSignals(finished[0]).fingerprinting.canvas, 7);
});
