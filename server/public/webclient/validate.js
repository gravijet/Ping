/* validate.js — small, dependency-free input guards for the few places the web
   client trusts *external* input: deep-link parameters (?chat=, ?u=) and other
   id-shaped values that get interpolated into request paths. Keeping the rules
   here — pure, exported, unit-tested — means they are written once and can't
   drift across call sites.

   The client builds URLs like `/api/users/${id}`; a crafted id could otherwise
   smuggle path segments or a query string. Ping ids are server-generated
   UUID/hex tokens, so a conservative charset + length cap rejects anything that
   isn't plausibly one of ours before it ever reaches fetch(). */

// Accept letters, digits, underscore and dash only (covers UUIDs + hex ids),
// 1..64 chars. No slashes, dots, %, whitespace, query characters.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** True if [id] is a well-formed Ping id. */
export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

/** Return [id] if valid, otherwise null — convenient for `const x = safeId(...)`. */
export function safeId(id) {
  return isValidId(id) ? id : null;
}
