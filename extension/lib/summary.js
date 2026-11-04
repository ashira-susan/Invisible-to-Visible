import { API_BASE } from "./config.js";

// Same rule as the backend contract (docs/data-contract.md): lowercase hostname labels.
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);

const BACKEND_ORIGIN = new URL(API_BASE).origin;

/** A valid, lowercase hostname without a trailing dot, or null. */
export function cleanHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0 || host.length > 253) return null;
  return HOSTNAME_RE.test(host) ? host : null; // also rejects IPv6 literals like [::1]
}

/**
 * The smallest description of a page we are allowed to keep: its hostname and whether
 * it used HTTPS. The path, query, fragment, username and password are never read.
 * Returns null for anything that must not be recorded.
 */
export function siteFromUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin === BACKEND_ORIGIN) return null; // never record our own dashboard

  const domain = cleanHostname(url.hostname);
  if (!domain) return null;
  return { domain, https: url.protocol === "https:" };
}

/** Builds the body for POST /api/v1/scans. */
export function buildSummary(site, observedAt, signals = {}) {
  return {
    schema_version: "1",
    observed_at: observedAt.toISOString(),
    site: { domain: site.domain, https: site.https, referrer_origin: null },
    signals,
  };
}

/** M1-style helper, kept for the tests and the "site names only" case. */
export function buildScanSummary(rawUrl, now = new Date(), signals = {}) {
  const site = siteFromUrl(rawUrl);
  return site ? buildSummary(site, now, signals) : null;
}
