import test from "node:test";
import assert from "node:assert/strict";
import { parseSetCookie, cookieKey } from "../lib/cookies.js";

const NOW = Date.parse("2026-10-01T09:00:00Z");

test("reads the cookie name and ignores the value", () => {
  const c = parseSetCookie("session_id=abc123SECRET; Path=/; HttpOnly; Secure", NOW);
  assert.deepEqual(c, { name: "session_id", expired: false });
  assert.ok(!JSON.stringify(c).includes("SECRET"), "the value must never be returned");
});

test("values containing = or ; style characters do not confuse the name", () => {
  assert.equal(parseSetCookie("a=b=c; Path=/", NOW).name, "a");
  assert.equal(parseSetCookie("  spaced = v ; Path=/", NOW).name, "spaced");
  assert.equal(parseSetCookie("__Host-id=1; Secure; Path=/", NOW).name, "__Host-id");
});

test("things that are not cookies are rejected", () => {
  assert.equal(parseSetCookie("", NOW), null);
  assert.equal(parseSetCookie("noequals", NOW), null);
  assert.equal(parseSetCookie("=novalue-name", NOW), null);
  assert.equal(parseSetCookie(undefined, NOW), null);
});

test("Max-Age of zero or less, or a past Expires, means the cookie is being deleted", () => {
  assert.equal(parseSetCookie("a=; Max-Age=0", NOW).expired, true);
  assert.equal(parseSetCookie("a=; max-age=-1", NOW).expired, true);
  assert.equal(parseSetCookie("a=; Expires=Thu, 01 Jan 1970 00:00:00 GMT", NOW).expired, true);
});

test("future expiry and session cookies are real cookies", () => {
  assert.equal(parseSetCookie("a=1; Max-Age=3600", NOW).expired, false);
  assert.equal(parseSetCookie("a=1; Expires=Wed, 01 Jan 2031 00:00:00 GMT", NOW).expired, false);
  assert.equal(parseSetCookie("a=1", NOW).expired, false);
});

test("Max-Age wins over Expires", () => {
  assert.equal(parseSetCookie("a=1; Max-Age=3600; Expires=Thu, 01 Jan 1970 00:00:00 GMT", NOW).expired, false);
  assert.equal(parseSetCookie("a=1; Max-Age=0; Expires=Wed, 01 Jan 2031 00:00:00 GMT", NOW).expired, true);
});

test("cookieKey is stable, differs by host and name, and does not contain the name", () => {
  const k = cookieKey("example.com", "session_id");
  assert.equal(k, cookieKey("example.com", "session_id"));
  assert.notEqual(k, cookieKey("other.com", "session_id"));
  assert.notEqual(k, cookieKey("example.com", "session_id2"));
  assert.match(k, /^[0-9a-f]{8}$/);
});
