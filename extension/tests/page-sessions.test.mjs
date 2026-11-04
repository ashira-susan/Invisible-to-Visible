import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PageSessions, MAX_TRACKERS } from "../lib/page-sessions.js";
import { PublicSuffixList } from "../lib/psl.js";
import { TrackerList } from "../lib/trackers.js";

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
