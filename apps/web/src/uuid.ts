// A v4-UUID generator that works in insecure contexts (e.g. a phone hitting the
// dev server over http://<LAN-IP>). `crypto.randomUUID` is secure-context-only, so
// on plain-http LAN origins it's undefined. `crypto.getRandomValues`, however, is
// available in insecure contexts too — we prefer it, and only fall back to
// Math.random() when there's no Web Crypto at all.
export function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    // Non-null: a Uint8Array(16) always has indices 6 and 8; the assertions only
    // satisfy noUncheckedIndexedAccess.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
      .slice(6, 8)
      .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
