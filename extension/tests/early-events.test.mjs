// Regression tests for the "early event" leak found while reading the M2c code (M3a).
//
// Before a page starts, requests, cookies and page-script reports for a tab are held for
// up to 3 seconds and replayed into the next page. That is needed for the real race where
// the worker sees a new page's first requests before webNavigation.onCommitted. But the
// buffer was also filled whenever the tab had no page, and a tab has no page after the
// previous page SETTLES (about 10 s after load). So a late beacon, cookie or page-script
// report from the page the user was just on could be counted for the NEXT page.
//
// These tests describe the correct behaviour: nothing that happens while no navigation is
// in progress may ever be attributed to a page that starts later. They fail on the M2c code.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PageSessions } from "../lib/page-sessions.js";
import { PublicSuffixList } from "../lib/psl.js";
import { TrackerList } from "../lib/trackers.js";

const psl = new PublicSuffixList(readFileSync(new URL("../data/public_suffix_list.dat", import.meta.url), "utf8"));
const trackers = new TrackerList({
  domains: {
    "ads.test": ["advertising", "AdCo", 1],
    "stats.test": ["analytics", "StatCo", 0],
  },
});

function setup() {
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
  });
  return { sessions, clock, finished, stored };
}

const inpage = (extra = {}) => ({ type: "itv-inpage", v: 1, ...extra });
const PAGE_A = "https://first.example/";
const PAGE_B = "https://second.example/";

// Page A is open and settles (as it does ~10 s after load); then something late arrives
// for the tab; then, within the 3 s window, the user opens page B.
async function settledThenLate(arrive) {
  const { sessions, clock, finished } = setup();
  await sessions.start(1, PAGE_A);
  await sessions.finalize(1); // A settled: the tab now has no page
  assert.equal(finished.length, 1);
  clock.t += 1_000;
  arrive(sessions);
  clock.t += 1_000;
  await sessions.start(1, PAGE_B);
  await sessions.finalize(1);
  assert.equal(finished.length, 2);
  return PageSessions.toSignals(finished[1]);
}

test("a late request from a settled page is not counted for the next page", async () => {
  const signals = await settledThenLate((s) => s.addRequest(1, "https://px.ads.test/beacon"));
  assert.equal(signals.third_party_requests, 0);
  assert.deepEqual(signals.trackers, []);
});

test("a late Set-Cookie from a settled page is not counted for the next page", async () => {
  const signals = await settledThenLate((s) => s.addCookies(1, "https://px.ads.test/pixel", ["uid=1; Path=/"]));
  assert.deepEqual(signals.cookies, { first_party: 0, third_party: 0, by_trackers: 0 });
});

test("a late page-script report from a settled page's sub-frame is not counted for the next page", async () => {
  const signals = await settledThenLate((s) =>
    s.addInpage(1, 7, "https://px.ads.test/frame", inpage({ canvas: 3, geo: 2, cookies: ["late_name"] })),
  );
  assert.deepEqual(signals.fingerprinting, { canvas: 0, webgl: 0, audio: 0, font: 0 });
  assert.equal(signals.geolocation_calls, 0);
  assert.deepEqual(signals.cookies, { first_party: 0, third_party: 0, by_trackers: 0 });
});

test("late events from a settled page are not even held", async () => {
  const { sessions } = setup();
  await sessions.start(1, PAGE_A);
  await sessions.finalize(1);
  sessions.addRequest(1, "https://px.ads.test/beacon");
  sessions.addCookies(1, "https://px.ads.test/pixel", ["uid=1"]);
  sessions.addInpage(1, 7, "https://px.ads.test/frame", inpage({ canvas: 1 }));
  assert.equal([...sessions.pending.values()].flat().length, 0, "something was kept for a later page");
});

// ---- while a navigation IS in progress: attribution must be certain, or the event is dropped ----

const nav = (sessions, tabId, url, requestId = "r1") => sessions.noteMainRequest(tabId, requestId, url);
const NONE = { first_party: 0, third_party: 0, by_trackers: 0 };

test("during a navigation, only events from the new document are given to the new page", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, PAGE_A, "doc-A");
  await sessions.finalize(1);
  nav(sessions, 1, PAGE_B);
  sessions.addRequest(1, "https://px.ads.test/from-A", { documentId: "doc-A", frameId: 0 });   // the page we left
  sessions.addRequest(1, "https://px.ads.test/no-id", { frameId: 0 });                          // no document id: cannot tell
  sessions.addRequest(1, "https://px.ads.test/frame", { documentId: "doc-F", frameId: 4 });     // a sub-frame: cannot tell
  sessions.addRequest(1, "https://px.stats.test/from-B", { documentId: "doc-B", frameId: 0 });  // the new page itself
  await sessions.start(1, PAGE_B, "doc-B");
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[1]).third_party_requests, 1);
});

test("a held event with no committed document id is never given to the new page", async () => {
  const { sessions, finished } = setup();
  nav(sessions, 1, PAGE_B);
  sessions.addRequest(1, "https://px.ads.test/x", { documentId: "doc-B", frameId: 0 });
  await sessions.start(1, PAGE_B); // Chrome gave no documentId for the commit
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[0]).third_party_requests, 0);
});

test("rapid navigations: a new navigation drops what was held for the one before", async () => {
  const { sessions, finished } = setup();
  nav(sessions, 1, "https://one.example/", "r1");
  sessions.addRequest(1, "https://px.ads.test/for-one", { documentId: "doc-1", frameId: 0 });
  sessions.addCookies(1, "https://one.example/", ["a=1"], { mainFrame: true, requestId: "r1" });
  sessions.setReferrer(1, "https://from.example/", "r1");
  nav(sessions, 1, PAGE_B, "r2"); // the user clicked again before the first page committed
  assert.equal(sessions.pending.get(1)?.length ?? 0, 0);
  await sessions.start(1, PAGE_B, "doc-B");
  await sessions.finalize(1);
  const page = finished[0];
  assert.equal(page.referrer, null);
  assert.deepEqual(PageSessions.toSignals(page).cookies, NONE);
  assert.equal(PageSessions.toSignals(page).third_party_requests, 0);
});

test("a straggler from the first of two navigations is not given to the second", async () => {
  const { sessions, finished } = setup();
  nav(sessions, 1, "https://one.example/", "r1");
  nav(sessions, 1, PAGE_B, "r2");
  sessions.addCookies(1, "https://one.example/", ["late=1"], { mainFrame: true, requestId: "r1" }); // r1's response, arriving late
  sessions.setReferrer(1, "https://from-one.example/", "r1");
  await sessions.start(1, PAGE_B, "doc-B");
  await sessions.finalize(1);
  assert.deepEqual(PageSessions.toSignals(finished[0]).cookies, NONE);
  assert.equal(finished[0].referrer, null);
});

test("redirect hops share one navigation: their cookies and referrer count, once", async () => {
  const { sessions, finished } = setup();
  nav(sessions, 1, "http://short.example/", "r1");
  sessions.setReferrer(1, "https://www.google.example/", "r1");
  sessions.addCookies(1, "http://short.example/", ["hop=1"], { mainFrame: true, requestId: "r1" });
  nav(sessions, 1, "https://www.final.example/", "r1"); // the redirect target: same request id
  sessions.setReferrer(1, "https://elsewhere.example/", "r1"); // a later hop: the first referrer stays
  await sessions.start(1, "https://www.final.example/", "doc-B");
  await sessions.finalize(1);
  assert.equal(finished[0].referrer, "https://www.google.example");
  assert.equal(PageSessions.toSignals(finished[0]).cookies.third_party, 1); // set by short.example, not the final site
});

test("a navigation that never commits cannot lend its events to a different page", async () => {
  const { sessions, finished } = setup();
  nav(sessions, 1, "https://never.example/", "r1");
  sessions.addCookies(1, "https://never.example/", ["n=1"], { mainFrame: true, requestId: "r1" });
  sessions.setReferrer(1, "https://from.example/", "r1");
  // e.g. a back/forward restore commits a different page while that request is still pending
  await sessions.start(1, "https://different.example/", "doc-D");
  await sessions.finalize(1);
  assert.deepEqual(PageSessions.toSignals(finished[0]).cookies, NONE);
  assert.equal(finished[0].referrer, null);
});

test("a navigation that has gone stale is forgotten", async () => {
  const { sessions, finished, clock } = setup();
  nav(sessions, 1, PAGE_B);
  clock.t += 31_000;
  sessions.addRequest(1, "https://px.ads.test/x", { documentId: "doc-B", frameId: 0 });
  assert.equal(sessions.pending.size, 0);
  await sessions.start(1, PAGE_B, "doc-B");
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[0]).third_party_requests, 0);
});

test("the new page's own response cookies are not counted on the page that is still on screen", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, PAGE_A, "doc-A");
  nav(sessions, 1, PAGE_B);
  sessions.addCookies(1, PAGE_B, ["sid=1"], { mainFrame: true, requestId: "r1" }); // B's response while A is still open
  await sessions.start(1, PAGE_B, "doc-B");
  await sessions.finalize(1);
  assert.deepEqual(PageSessions.toSignals(finished[0]).cookies, NONE);                // A: nothing
  assert.equal(PageSessions.toSignals(finished[1]).cookies.first_party, 1);           // B: its own cookie
});

test("a top-level response with no matching navigation is dropped", async () => {
  const { sessions } = setup();
  sessions.addCookies(1, PAGE_B, ["sid=1"], { mainFrame: true, requestId: "r9" });      // no navigation noted
  nav(sessions, 1, PAGE_B, "r1");
  sessions.addCookies(1, PAGE_B, ["sid=1"], { mainFrame: true, requestId: "r9" });      // another request's id
  sessions.addCookies(1, PAGE_B, ["sid=1"], { mainFrame: true });                        // no id at all
  assert.equal(sessions.pending.size, 0);
});

test("the tab being closed forgets its navigation", async () => {
  const { sessions } = setup();
  nav(sessions, 1, PAGE_B);
  await sessions.closeTab(1);
  assert.equal(sessions.navs.size, 0);
});

test("held events keep no page address: only a hash of it, in memory", async () => {
  const { sessions } = setup();
  nav(sessions, 1, "https://private.example/inbox/42?token=secret#frag");
  sessions.addRequest(1, "https://px.ads.test/uid=999", { documentId: "doc-B", frameId: 0 });
  const text = JSON.stringify([...sessions.navs.values()]) + JSON.stringify([...sessions.pending.values()]);
  for (const leak of ["inbox", "secret", "token", "frag", "uid=999", "private.example"]) assert.ok(!text.includes(leak), `kept "${leak}"`);
});

// ---- inpage_checked: "nothing observed" versus "the page scripts never ran" ----

const beat = { type: "itv-inpage", v: 1, hb: 1 };

test("without a heartbeat the page is not marked checked, even with zero counts", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, PAGE_B, "doc-B");
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.equal(signals.inpage_checked, false);
  assert.equal(signals.trackers_checked, true);
});

test("a top-frame heartbeat from the page's own document marks it checked", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, PAGE_B, "doc-B");
  sessions.addInpage(1, 0, PAGE_B, beat, "doc-B");
  await sessions.finalize(1);
  const signals = PageSessions.toSignals(finished[0]);
  assert.equal(signals.inpage_checked, true);
  assert.deepEqual(signals.fingerprinting, { canvas: 0, webgl: 0, audio: 0, font: 0 }); // a heartbeat carries no counts
});

test("a heartbeat does not count unless it comes from the top frame of this very document", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, PAGE_B, "doc-B");
  sessions.addInpage(1, 3, "https://second.example/embed", beat, "doc-B");   // a sub-frame
  sessions.addInpage(1, 0, PAGE_B, beat, "doc-A");                           // another document (the page we left)
  sessions.addInpage(1, 0, PAGE_B, beat, null);                              // no document id
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[0]).inpage_checked, false);
});

test("a heartbeat that arrives just before the page commits is kept only for its own document", async () => {
  const { sessions, finished } = setup();
  nav(sessions, 1, PAGE_B);
  sessions.addInpage(1, 0, PAGE_B, beat, "doc-B");
  await sessions.start(1, PAGE_B, "doc-B");
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[0]).inpage_checked, true);

  const other = setup();
  nav(other.sessions, 1, PAGE_B);
  other.sessions.addInpage(1, 0, PAGE_B, beat, "doc-A"); // from the page we left
  await other.sessions.start(1, PAGE_B, "doc-B");
  await other.sessions.finalize(1);
  assert.equal(PageSessions.toSignals(other.finished[0]).inpage_checked, false);
});

test("the heartbeat flag survives a worker restart; pages saved by an older version load as not checked", async () => {
  const { sessions, stored } = setup();
  await sessions.start(1, PAGE_B, "doc-B");
  sessions.addInpage(1, 0, PAGE_B, beat, "doc-B");
  await sessions.flush();
  const again = setup();
  again.stored.value = stored.value;
  await again.sessions.load();
  assert.equal(again.sessions.pages.get(1).inpage, true);
  assert.equal(again.sessions.pages.get(1).documentId, "doc-B");

  const old = setup();
  old.stored.value = { 3: { seq: 1, host: "old.example", https: true, site: "old.example", startedAt: 1_000_000, thirdParty: 0, trackers: {} } };
  await old.sessions.load();
  await old.sessions.finalize(3);
  assert.equal(PageSessions.toSignals(old.finished[0]).inpage_checked, false);
});

// ---- the page you just left, still alive in Chrome's back/forward cache (seen in real Chrome) ----
// After wikipedia.org committed, ~30 requests to googlesyndication.com / dotmetrics.net arrived from
// the BBC page's documents, all marked documentLifecycle "cached", and were counted for Wikipedia.

const CACHED = (extra) => ({ documentLifecycle: "cached", ...extra });

async function bbcThenWikipedia(arrive) {
  const { sessions, finished } = setup();
  await sessions.start(1, "https://www.bbc.com/", "doc-BBC");
  sessions.addRequest(1, "https://pagead2.googlesyndication.com/ads.js", { documentId: "doc-BBC", frameId: 0, documentLifecycle: "active" });
  await sessions.start(1, "https://www.wikipedia.org/", "doc-WIKI");
  arrive(sessions);
  await sessions.finalize(1);
  return { bbc: PageSessions.toSignals(finished[0]), wiki: PageSessions.toSignals(finished[1]) };
}

test("requests from the previous page's cached documents are not counted for the new page", async () => {
  const { bbc, wiki } = await bbcThenWikipedia((s) => {
    s.addRequest(1, "https://pagead2.googlesyndication.com/a", CACHED({ documentId: "doc-BBC", frameId: 445 }));                       // the old top document
    s.addRequest(1, "https://tpc.googlesyndication.com/b", CACHED({ documentId: "doc-AD", parentDocumentId: "doc-BBC", frameId: 456 })); // one of its ad frames
    s.addRequest(1, "https://uk-script.dotmetrics.net/c", CACHED({ documentId: "doc-BBC", frameId: 445 }));
    s.addRequest(1, "https://x.googlesyndication.com/safeframe", CACHED({ parentDocumentId: "doc-BBC", frameId: 455 }));              // a frame with no id of its own
  });
  assert.equal(bbc.third_party_requests, 1);
  assert.equal(wiki.third_party_requests, 0);
  assert.deepEqual(wiki.trackers ?? [], []);
});

test("cached documents' response cookies are not counted for the new page either", async () => {
  const { wiki } = await bbcThenWikipedia((s) =>
    s.addCookies(1, "https://pagead2.googlesyndication.com/p", ["uid=1"], CACHED({ documentId: "doc-BBC", frameId: 445 })));
  assert.deepEqual(wiki.cookies, NONE);
});

test("any lifecycle other than active is dropped; a missing lifecycle is given the benefit of the doubt", async () => {
  const { wiki } = await bbcThenWikipedia((s) => {
    for (const documentLifecycle of ["pending_deletion", "prerender", "cached"]) s.addRequest(1, "https://px.ads.test/x", { documentLifecycle });
    s.addRequest(1, "https://px.stats.test/no-lifecycle", {}); // Chrome gave no lifecycle: counted, as before
  });
  assert.equal(wiki.third_party_requests, 1);
});

test("a late top-level request from another document is dropped, because its id is not the committed page's", async () => {
  const { wiki } = await bbcThenWikipedia((s) =>
    s.addRequest(1, "https://px.ads.test/late", { documentId: "doc-BBC", frameId: 0, documentLifecycle: "active" }));
  assert.equal(wiki.third_party_requests, 0);
});

test("the new page's own requests, top-frame and sub-frame, are still counted", async () => {
  const { wiki } = await bbcThenWikipedia((s) => {
    s.addRequest(1, "https://px.ads.test/own-top", { documentId: "doc-WIKI", frameId: 0, documentLifecycle: "active" });
    s.addRequest(1, "https://px.stats.test/own-frame", { documentId: "doc-F", parentDocumentId: "doc-WIKI", frameId: 3, documentLifecycle: "active" });
    s.addRequest(1, "https://px.ads.test/frame-navigation", { parentDocumentId: "doc-WIKI", frameId: 3, documentLifecycle: "active" });
    s.addRequest(1, "https://px.stats.test/deeper", { documentId: "doc-G", parentDocumentId: "doc-F", frameId: 4, documentLifecycle: "active" }); // a grandchild: cannot be disproved, kept
  });
  assert.equal(wiki.third_party_requests, 4);
});

test("a page with no document id (older saved state, or Chrome gave none) is not filtered by id", async () => {
  const { sessions, finished } = setup();
  await sessions.start(1, "https://www.wikipedia.org/"); // no documentId
  sessions.addRequest(1, "https://px.ads.test/x", { documentId: "doc-ANY", frameId: 0, documentLifecycle: "active" });
  sessions.addRequest(1, "https://px.stats.test/y", { documentLifecycle: "cached" }); // still dropped: lifecycle needs no page id
  await sessions.finalize(1);
  assert.equal(PageSessions.toSignals(finished[0]).third_party_requests, 1);
});
