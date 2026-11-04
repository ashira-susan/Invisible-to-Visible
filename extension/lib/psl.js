// Public Suffix List lookup: "which part of a hostname is the site?"
// bbc.co.uk and news.bbc.co.uk are the same site; example.co.uk and other.co.uk are not.
// List format and algorithm: https://publicsuffix.org/list/

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function toAsciiHost(rule) {
  if (!/[^\x00-\x7f]/.test(rule)) return rule;
  try {
    return new URL(`http://${rule}`).hostname; // converts to punycode (xn--...)
  } catch {
    return null;
  }
}

export class PublicSuffixList {
  constructor(text) {
    this.rules = new Set();      // "co.uk"
    this.wildcards = new Set();  // "*.ck"  is stored as "ck"
    this.exceptions = new Set(); // "!www.ck" is stored as "www.ck"

    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim().split(/\s/)[0];
      if (!line || line.startsWith("//")) continue;

      if (line.startsWith("!")) {
        const rule = toAsciiHost(line.slice(1).toLowerCase());
        if (rule) this.exceptions.add(rule);
      } else if (line.startsWith("*.")) {
        const rule = toAsciiHost(line.slice(2).toLowerCase());
        if (rule) this.wildcards.add(rule);
      } else {
        const rule = toAsciiHost(line.toLowerCase());
        if (rule) this.rules.add(rule);
      }
    }
  }

  /**
   * The registrable domain ("site") of a lowercase hostname, for example
   * "news.bbc.co.uk" -> "bbc.co.uk". IP addresses, single labels and hostnames that
   * are themselves a public suffix are returned unchanged.
   */
  registrableDomain(host) {
    if (!host || IPV4.test(host) || host.includes(":")) return host;

    const labels = host.split(".");
    if (labels.length < 2) return host;

    // From the longest candidate suffix to the shortest: the first rule that matches wins.
    for (let i = 0; i < labels.length; i++) {
      const candidate = labels.slice(i).join(".");
      const parent = labels.slice(i + 1).join(".");

      if (this.exceptions.has(candidate)) {
        return candidate; // an exception rule makes this name itself registrable
      }
      if (this.rules.has(candidate) || (parent && this.wildcards.has(parent))) {
        // `candidate` is a public suffix; the site is one label further left.
        return i === 0 ? host : labels.slice(i - 1).join(".");
      }
    }
    // Default rule: the last label is the public suffix.
    return labels.slice(-2).join(".");
  }
}
