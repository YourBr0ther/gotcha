import canonicalize from "canonicalize";

/**
 * RFC 8785 canonical JSON. Sorted keys, no whitespace, ES6 number
 * formatting. Signatures are computed over this so two installs agree on the
 * bytes without agreeing on key order.
 */
export function canonical(value: unknown): string {
  const text = canonicalize(value);
  if (text === undefined) {
    throw new TypeError("value has no canonical JSON form (undefined, function or symbol)");
  }
  return text;
}
