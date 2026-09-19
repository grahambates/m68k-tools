/**
 * The elements a string constant stands for when vasm is given `-esc`.
 *
 * Without `-esc` a backslash is an ordinary character. With it, the sequences
 * below are read as in C, in the way vasm's own output was seen to treat them:
 *
 * - `\n` `\r` `\t` `\b` `\e` `\f` are the control characters (10, 13, 9, 8, 27, 12)
 * - `\\` `\"` `\'` are the character itself
 * - `\` and up to three digits is a number, its digits weighted by eight, and
 *   truncated to a byte: `\101` is 65 and `\400` is 0
 * - `\x` or `\X` and up to two hex digits is a number, and 0 with no digits
 *
 * Anything else, including `\a` and `\v`, is one vasm warns about ("illegal
 * escape sequence") and assembles as it is written: the backslash stays an
 * element and so does the character after it, so the string is no shorter.
 * Letters in escapes are case-sensitive, so `\N` is not `\n`.
 */
const NAMED: Readonly<Record<string, number>> = {
  n: 10,
  r: 13,
  t: 9,
  b: 8,
  e: 27,
  f: 12,
  "\\": 92,
  '"': 34,
  "'": 39,
};

export interface EscapedString {
  /** The value of each element the string assembles to. */
  elements: number[];
  /** Each sequence vasm would call illegal, as written, such as `\a`. */
  illegal: string[];
}

/** Read a string constant's text, the content between its quotes, with escapes as vasm reads them. */
export function decodeStringEscapes(content: string): EscapedString {
  const elements: number[] = [];
  const illegal: string[] = [];

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char !== "\\" || i === content.length - 1) {
      elements.push(content.charCodeAt(i));
      continue;
    }

    const next = content[i + 1];
    if (next in NAMED) {
      elements.push(NAMED[next]);
      i += 1;
    } else if (/[0-9]/.test(next)) {
      let value = 0;
      let end = i + 1;
      while (end < content.length && end < i + 4 && /[0-9]/.test(content[end]))
        value = value * 8 + Number(content[end++]);
      elements.push(value & 0xff);
      i = end - 1;
    } else if (next === "x" || next === "X") {
      let value = 0;
      let end = i + 2;
      while (
        end < content.length &&
        end < i + 4 &&
        /[0-9a-fA-F]/.test(content[end])
      )
        value = value * 16 + parseInt(content[end++], 16);
      elements.push(value);
      i = end - 1;
    } else {
      illegal.push(`\\${next}`);
      elements.push(92, next.charCodeAt(0));
      i += 1;
    }
  }
  return { elements, illegal };
}
