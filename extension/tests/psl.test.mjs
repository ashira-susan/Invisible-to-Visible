import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicSuffixList } from "../lib/psl.js";

const text = readFileSync(new URL("../data/public_suffix_list.dat", import.meta.url), "utf8");
const psl = new PublicSuffixList(text);

const CASES = [
  ["example.com", "example.com"],
  ["www.example.com", "example.com"],
  ["a.b.c.example.com", "example.com"],
  ["news.bbc.co.uk", "bbc.co.uk"],
  ["bbc.co.uk", "bbc.co.uk"],
  ["example.co.uk", "example.co.uk"],
  ["www.example.com.au", "example.com.au"],
  ["foo.github.io", "foo.github.io"],          // private suffix: each user is a separate site
  ["a.foo.github.io", "foo.github.io"],
  ["doubleclick.net", "doubleclick.net"],
  ["ad.doubleclick.net", "doubleclick.net"],
  ["xn--bcher-kva.example", "xn--bcher-kva.example"],
];

for (const [host, expected] of CASES) {
  test(`registrableDomain(${host}) = ${expected}`, () => {
    assert.equal(psl.registrableDomain(host), expected);
  });
}

test("a public suffix on its own, single labels and IP addresses are returned unchanged", () => {
  assert.equal(psl.registrableDomain("co.uk"), "co.uk");
  assert.equal(psl.registrableDomain("com"), "com");
  assert.equal(psl.registrableDomain("localhost"), "localhost");
  assert.equal(psl.registrableDomain("192.168.1.5"), "192.168.1.5");
  assert.equal(psl.registrableDomain("[::1]"), "[::1]");
});

test("wildcard and exception rules (*.ck, !www.ck)", () => {
  assert.equal(psl.registrableDomain("foo.ck"), "foo.ck");        // *.ck makes foo.ck a suffix
  assert.equal(psl.registrableDomain("bar.foo.ck"), "bar.foo.ck");
  assert.equal(psl.registrableDomain("www.ck"), "www.ck");        // !www.ck exception
  assert.equal(psl.registrableDomain("sub.www.ck"), "www.ck");
});

test("the parsed list is plausibly complete", () => {
  assert.ok(psl.rules.size > 5000, `only ${psl.rules.size} rules`);
});

test("internationalised suffixes (cases from the official list tests, as punycode)", () => {
  const ascii = (h) => new URL(`http://${h}`).hostname;
  assert.equal(psl.registrableDomain(ascii("www.食狮.公司.cn")), ascii("食狮.公司.cn"));
  assert.equal(psl.registrableDomain(ascii("shishi.公司.cn")), ascii("shishi.公司.cn"));
  assert.equal(psl.registrableDomain(ascii("www.食狮.com.cn")), ascii("食狮.com.cn"));
});
