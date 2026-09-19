/**
 * Editing a project config file as text.
 *
 * A config is strict JSON that people write by hand, so an edit changes as
 * little as it can: an entry goes in beside the ones already there, in the same
 * style, and nothing else is reflowed. Anything this cannot place with
 * confidence falls back to rewriting the whole file, which loses no data (there
 * are no comments to lose) but does lose the author's layout.
 */

interface Member {
  key: string;
  keyStart: number;
  valueStart: number;
  valueEnd: number;
}

interface Scan {
  members: Member[];
  /** Index of the `{` and of the matching `}` of the top-level object. */
  open: number;
  close: number;
}

const isSpace = (char: string | undefined) =>
  char === " " || char === "\t" || char === "\n" || char === "\r";

/** The end (exclusive) of the string starting at `i`, or undefined if it never closes. */
function stringEnd(text: string, i: number): number | undefined {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === '"') return j + 1;
  }
  return undefined;
}

/** The end (exclusive) of the JSON value starting at `i`. */
function valueEnd(text: string, i: number): number | undefined {
  if (text[i] === '"') return stringEnd(text, i);
  if (text[i] === "{" || text[i] === "[") {
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      const char = text[j];
      if (char === '"') {
        const end = stringEnd(text, j);
        if (end === undefined) return undefined;
        j = end - 1;
      } else if (char === "{" || char === "[") depth++;
      else if (char === "}" || char === "]") {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    return undefined;
  }
  let j = i;
  while (j < text.length && !",}]".includes(text[j]) && !isSpace(text[j])) j++;
  return j > i ? j : undefined;
}

/** The members of the top-level object, with where each sits in the text. */
function scan(text: string): Scan | undefined {
  let i = 0;
  while (isSpace(text[i])) i++;
  if (text[i] !== "{") return undefined;
  const open = i++;
  const members: Member[] = [];

  for (;;) {
    while (isSpace(text[i])) i++;
    if (text[i] === "}") return { members, open, close: i };
    if (text[i] !== '"') return undefined;
    const keyEnd = stringEnd(text, i);
    if (keyEnd === undefined) return undefined;
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    const keyStart = i;
    i = keyEnd;
    while (isSpace(text[i])) i++;
    if (text[i] !== ":") return undefined;
    i++;
    while (isSpace(text[i])) i++;
    const start = i;
    const end = valueEnd(text, i);
    if (end === undefined) return undefined;
    members.push({ key, keyStart, valueStart: start, valueEnd: end });
    i = end;
    while (isSpace(text[i])) i++;
    if (text[i] === ",") i++;
    else if (text[i] !== "}") return undefined;
  }
}

/** The whitespace at the start of the line containing `index`. */
function indentAt(text: string, index: number): string {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
}

const ALIASES = ["ignores", "ignorePatterns"] as const;

/**
 * The text of a config with `entry` added to its ignore list, creating the list
 * if there is none. Returns undefined if the text is not a config object or its
 * ignore list is not an array, so a caller can decline rather than clobber it.
 * Unchanged if the entry is already listed.
 */
export function addIgnoreToConfigText(
  text: string,
  entry: string,
): string | undefined {
  const scanned = scan(text);
  if (!scanned) return undefined;
  const quoted = JSON.stringify(entry);

  const existing = scanned.members.find((m) =>
    ALIASES.includes(m.key as never),
  );
  let result: string;

  if (existing) {
    if (text[existing.valueStart] !== "[") return undefined;
    let items: unknown;
    try {
      items = JSON.parse(text.slice(existing.valueStart, existing.valueEnd));
    } catch {
      return undefined;
    }
    if (!Array.isArray(items)) return undefined;
    if (items.includes(entry)) return text;

    const inner = text.slice(existing.valueStart + 1, existing.valueEnd - 1);
    if (inner.trim() === "") {
      result =
        text.slice(0, existing.valueStart) +
        `[${quoted}]` +
        text.slice(existing.valueEnd);
    } else {
      // After the last element, in the layout the list already has.
      let last = existing.valueEnd - 2;
      while (isSpace(text[last])) last--;
      const multiline = inner.includes("\n");
      const separator = multiline ? `,\n${indentAt(text, last)}` : ", ";
      result =
        text.slice(0, last + 1) + separator + quoted + text.slice(last + 1);
    }
  } else if (scanned.members.length === 0) {
    result =
      text.slice(0, scanned.open) +
      `{\n  "ignores": [${quoted}]\n}` +
      text.slice(scanned.close + 1);
  } else {
    const last = scanned.members[scanned.members.length - 1];
    const multiline = text.slice(scanned.open, last.keyStart).includes("\n");
    const separator = multiline ? `,\n${indentAt(text, last.keyStart)}` : ", ";
    result =
      text.slice(0, last.valueEnd) +
      `${separator}"ignores": [${quoted}]` +
      text.slice(last.valueEnd);
  }

  // A targeted edit that did not come out as a config with the entry in it is
  // worse than a rewrite, so check, and rewrite if it did not.
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const list = ALIASES.map((key) => parsed[key]).find(Array.isArray);
    if (Array.isArray(list) && list.includes(entry)) return result;
  } catch {
    // fall through
  }
  return rewritten(text, entry);
}

function rewritten(text: string, entry: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const key =
      ALIASES.find((alias) => Array.isArray(parsed[alias])) ?? "ignores";
    const list = Array.isArray(parsed[key]) ? (parsed[key] as unknown[]) : [];
    if (!Array.isArray(parsed[key]) && parsed[key] !== undefined)
      return undefined;
    parsed[key] = [...list, entry];
    const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
    return JSON.stringify(parsed, null, indent) + "\n";
  } catch {
    return undefined;
  }
}

/** The text of a new config that ignores `entry` and nothing else. */
export function newConfigText(entry: string): string {
  return `{\n  "ignores": [${JSON.stringify(entry)}]\n}\n`;
}
