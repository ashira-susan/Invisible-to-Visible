import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TrackerList } from "../lib/trackers.js";

const small = new TrackerList({
  domains: {
    "tracker.test": ["advertising", "Acme", 0],
    "sub.cdn.test": ["analytics", "Specific", 1],
    "cdn.test": ["content", "Generic", 0],
  },
});

test("exact and subdomain matches report the listed domain", () => {
  assert.deepEqual(small.classify("tracker.test"), { domain: "tracker.test", category: "advertising", company: "Acme", knownFingerprinter: false });
  assert.equal(small.classify("a.b.tracker.test").domain, "tracker.test");
});

test("the most specific entry wins", () => {
  assert.equal(small.classify("x.sub.cdn.test").category, "analytics");
  assert.equal(small.classify("x.sub.cdn.test").knownFingerprinter, true);
  assert.equal(small.classify("other.cdn.test").category, "content");
});

test("unknown hosts and lookalikes are not matched", () => {
  assert.equal(small.classify("example.com"), null);
  assert.equal(small.classify("nottracker.test"), null); // must be a label boundary
  assert.equal(small.classify("test"), null);
});

test("bundled list classifies well-known trackers", () => {
  const data = JSON.parse(readFileSync(new URL("../data/trackers.json", import.meta.url), "utf8"));
  const list = new TrackerList(data);
  assert.equal(list.classify("securepubads.g.doubleclick.net").category, "advertising");
  assert.equal(list.classify("www.google-analytics.com").category, "analytics");
  assert.equal(list.classify("www.wikipedia.org"), null);
  assert.ok(Object.keys(data.domains).length > 3000);
});
