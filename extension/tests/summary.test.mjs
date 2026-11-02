// Run with:  node --test extension/tests      (needs Node 20 or newer; optional)
import test from "node:test";
import assert from "node:assert/strict";
import { buildScanSummary } from "../lib/summary.js";

const NOW = new Date("2026-10-01T09:15:00Z");

test("keeps only the hostname and the HTTPS flag", () => {
  const s = buildScanSummary("https://user:secret@Mail.Example.com:8443/inbox/42?token=abc#frag", NOW);
  assert.deepEqual(s.site, { domain: "mail.example.com", https: true, referrer_origin: null });
  const serialised = JSON.stringify(s);
  for (const leak of ["secret", "token", "inbox", "frag", "8443", "user"]) {
    assert.ok(!serialised.includes(leak), `summary leaked "${leak}"`);
  }
});

test("marks plain http pages", () => {
  assert.equal(buildScanSummary("http://example.com/", NOW).site.https, false);
});

test("strips a trailing dot", () => {
  assert.equal(buildScanSummary("https://example.com./", NOW).site.domain, "example.com");
});

test("uses the supplied clock and the v1 schema", () => {
  const s = buildScanSummary("https://example.com/", NOW);
  assert.equal(s.schema_version, "1");
  assert.equal(s.observed_at, "2026-10-01T09:15:00.000Z");
  assert.deepEqual(s.signals, {});
});

test("ignores pages that must never be recorded", () => {
  for (const url of [
    "chrome://extensions",
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html",
    "file:///C:/Users/me/secret.txt",
    "about:blank",
    "data:text/html,hello",
    "http://127.0.0.1:8000/app/", // our own dashboard
    "http://[::1]/",              // IPv6 literal, not supported in v1
    "not a url",
  ]) {
    assert.equal(buildScanSummary(url, NOW), null, url);
  }
});

test("other local sites are still recorded", () => {
  assert.equal(buildScanSummary("http://localhost:3000/", NOW).site.domain, "localhost");
});
