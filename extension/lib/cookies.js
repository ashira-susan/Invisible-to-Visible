// Reads just enough of a Set-Cookie header to count cookies. Cookie VALUES are never
// kept. Names are used only on this device, hashed, to avoid counting the same cookie
// twice; the hashes are never sent anywhere.

/**
 * Returns { name, expired } for a Set-Cookie header value, or null if it isn't a cookie.
 * `expired` is true when the header deletes the cookie instead of setting it.
 * Per RFC 6265, Max-Age wins over Expires when both are present.
 */
export function parseSetCookie(header, nowMs = Date.now()) {
  if (typeof header !== "string") return null;
  const parts = header.split(";");
  const eq = parts[0].indexOf("=");
  if (eq <= 0) return null;
  const name = parts[0].slice(0, eq).trim();
  if (!name) return null;

  let maxAge = null;
  let expiresMs = null;
  for (const attr of parts.slice(1)) {
    const at = attr.indexOf("=");
    const key = (at === -1 ? attr : attr.slice(0, at)).trim().toLowerCase();
    const value = at === -1 ? "" : attr.slice(at + 1).trim();
    if (key === "max-age") {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) maxAge = n;
    } else if (key === "expires") {
      const t = Date.parse(value);
      if (!Number.isNaN(t)) expiresMs = t;
    }
  }
  const expired = maxAge !== null ? maxAge <= 0 : expiresMs !== null && expiresMs <= nowMs;
  return { name, expired };
}

/** A short, one-way fingerprint of "which host set which cookie name" (FNV-1a, 32 bit). */
export function cookieKey(host, name) {
  const text = `${host}\u0000${name}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
