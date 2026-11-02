import { API_BASE } from "./config.js";

// Same rule as the backend contract (docs/data-contract.md): lowercase hostname labels.
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);

const BACKEND_ORIGIN = new URL(API_BASE).origin;

/**
 * Turns a page address into the smallest summary we are allowed to send.
 * Only the hostname and whether the page used HTTPS are kept. The path, query,
 * fragment, username and password are never read.
 *
 * Returns null for anything that must not be recorded.
 */
export function buildScanSummary(rawUrl, now = new Date()) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin === BACKEND_ORIGIN) return null; // never record our own dashboard

  const domain = url.hostname.toLowerCase().replace(/\.$/, "");
  if (domain.length === 0 || domain.length > 253) return null;
  if (!HOSTNAME_RE.test(domain)) return null; // also rejects IPv6 literals like [::1]

  return {
    schema_version: "1",
    observed_at: now.toISOString(),
    site: {
      domain,
      https: url.protocol === "https:",
      referrer_origin: null, // filled in from M2
    },
    signals: {}, // filled in from M2; the backend treats missing values as zero
  };
}
