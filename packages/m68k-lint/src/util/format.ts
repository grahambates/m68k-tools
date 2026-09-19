/**
 * A number as an assembler hex literal, `$` first.
 *
 * Read as an unsigned 32-bit value, since that is what an address or a mask is.
 * Diagnostics conventionally spell hex in capitals; code written into a fix
 * takes `uppercase: false`, matching the lowercase the generated source uses.
 *
 * @param digits pad with zeros to at least this many digits
 */
export function hex(
  value: number,
  digits = 0,
  { uppercase = true }: { uppercase?: boolean } = {},
): string {
  const text = (value >>> 0).toString(16).padStart(digits, "0");
  return `$${uppercase ? text.toUpperCase() : text}`;
}
