#!/usr/bin/env node
// Regenerates docs/rules.md and docs/rule-examples.md from the built rule set.
//
// The README used to list rules by hand and drifted to naming 4 of what are now
// 100+ optimization rules. Run `pnpm run docs:rules` after adding or renaming a
// rule; CI checks the result is committed.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { defaultRules } = await import(join(root, "dist", "index.js"));
const { lintSource, defaultConfig } = await import(
  join(root, "dist", "index.js")
);
const { formatImpact } = await import(join(root, "dist", "cli", "format.js"));

const EXAMPLES_FILE = "rule-examples.md";

// Applied for doc purposes only: shows the rewrite a rule offers even when a
// real fix run would leave a conditional or trade-off suggestion for the user
// to accept explicitly.
const EXAMPLE_ACCEPT = ["safe", "conditional"];

/**
 * A GitHub-compatible heading anchor: lowercase, strip everything but
 * letters/digits/spaces/hyphens (inline-code backticks and the rule id's own
 * "/" included), then turn spaces into hyphens. Matches how GitHub slugs
 * rendered heading text, which is what lets `rules.md` link straight into
 * `rule-examples.md#<slug>`.
 */
function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, "-");
}

/**
 * The example block for one rule: only the lines the diagnostic actually
 * covers (its `span`) as "before", and the raw suggested replacement as
 * "after" -- not the whole example source, which often carries extra setup or
 * trailer lines (a dead-register proof, a flag-killing instruction) that are
 * not part of the change itself.
 *
 * Lints the example against this rule alone and reads the fix straight off
 * the resulting diagnostic, so an example that does not trigger the rule, or
 * a rule whose behaviour drifts from its example, fails the doc build rather
 * than silently documenting the wrong thing.
 */
function buildExample(rule) {
  const example = rule.meta.docs?.example;
  if (!example) return undefined;

  const config = { ...defaultConfig, ...example.config };
  const diagnostics = lintSource(example.source, config, [rule]);
  const diagnostic = diagnostics.find((d) => d.ruleId === rule.meta.id);
  if (!diagnostic) {
    throw new Error(
      `docs.example for ${rule.meta.id} does not trigger the rule:\n${example.source}`,
    );
  }
  const suggestion = diagnostic.suggestion;
  if (
    !suggestion ||
    suggestion.replacement === undefined ||
    !diagnostic.span ||
    !EXAMPLE_ACCEPT.includes(suggestion.applicability)
  ) {
    throw new Error(
      `docs.example for ${rule.meta.id} triggered but offers no applicable fix:\n${example.source}`,
    );
  }

  const lines = example.source
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const before = lines
    .slice(diagnostic.span.startLine - 1, diagnostic.span.endLine)
    .join("\n");
  const after = suggestion.replacement;
  if (after === before) {
    throw new Error(
      `docs.example for ${rule.meta.id} triggered but the fix does not change the matched lines:\n${example.source}`,
    );
  }

  const lines_ = [
    `## \`${rule.meta.id}\``,
    "",
    `${rule.meta.description}.`,
    "",
    "Before:",
    "",
    "```asm",
    before,
    "```",
    "",
    "After:",
    "",
    after === ""
      ? "_The matched lines are removed._"
      : ["```asm", after, "```"].join("\n"),
    "",
  ];

  const impactText = suggestion.impact
    ? formatImpact(suggestion.impact, false)
    : undefined;
  if (impactText) lines_.push(impactText.replace(/^saves: /, "Saves "), "");

  if (diagnostic.notes?.length) {
    lines_.push(
      "Notes:",
      "",
      ...diagnostic.notes.map((note) => `- ${note.message}`),
      "",
    );
  }

  while (lines_[lines_.length - 1] === "") lines_.pop();

  return { anchor: slug(rule.meta.id), markdown: lines_.join("\n") };
}

const CATEGORY_ORDER = [
  "correctness",
  "suspicious",
  "optimization",
  "portability",
  "style",
];
const CATEGORY_BLURB = {
  correctness: "Valid assembly with a provable semantic or runtime problem.",
  suspicious:
    "Valid code that may be intentional but is easy to misread or misuse.",
  optimization:
    "Smaller or faster equivalents, gated on CPU target and proven flag/register liveness.",
  portability: "Constructs that do not carry across the targeted processors.",
  style: "Subjective conventions. Opt in with the `style` preset or per rule.",
};

const escape = (text) => String(text ?? "").replace(/\|/g, "\\|");

function defaultState(rule) {
  if (rule.meta.enabledByDefault === false) {
    return rule.meta.presets?.length
      ? `preset: ${rule.meta.presets.join(", ")}`
      : "off";
  }
  return rule.meta.defaultSeverity;
}

const rulesLines = [
  "# Rules",
  "",
  "<!-- Generated by `pnpm run docs:rules`. Do not edit by hand. -->",
  "",
  `${defaultRules.length} built-in rules. \`m68k-lint --list-rules\` prints the same set.`,
  "",
  "**Default** is the severity a rule reports at when it is on, `off` when it must be",
  "enabled explicitly, or the preset that turns it on. Override any of them with",
  "`--rule <id>=<off|error|warning|suggestion|info>` or the `rules` block in project",
  "configuration.",
  "",
  "**Obfuscated** marks rules whose fixes retain the original source as comments",
  "under the default annotation mode: lost constants/expressions or opaque tricks.",
  "Multiple lines or routine idioms alone do not qualify.",
  "",
  "**Source** records historical provenance. Rule IDs are deliberately descriptive",
  "rather than source-named.",
  "",
  `A linked rule id has a worked before/after example in [${EXAMPLES_FILE}](${EXAMPLES_FILE}).`,
  "",
];
const exampleLines = [
  "# Rule examples",
  "",
  "<!-- Generated by `pnpm run docs:rules`. Do not edit by hand. -->",
  "",
  "A worked example for every rule listed in [rules.md](rules.md) that offers",
  'one. "Before" is only the lines a finding covers, and "After" is the raw',
  "suggested replacement -- not the whole example source, which sometimes needs",
  "extra setup or trailer lines (proving a register dead, killing a flag) that",
  "are not themselves part of the change.",
  "",
];

for (const category of CATEGORY_ORDER) {
  const rules = defaultRules
    .filter((rule) => rule.meta.category === category)
    .sort((a, b) => a.meta.id.localeCompare(b.meta.id));
  if (!rules.length) continue;

  rulesLines.push(
    `## ${category} (${rules.length})`,
    "",
    CATEGORY_BLURB[category],
    "",
  );
  rulesLines.push(
    "| Rule | Default | Obfuscated | Description | Source |",
    "| --- | --- | --- | --- | --- |",
  );

  const categoryExamples = [];
  for (const rule of rules) {
    const example = buildExample(rule);
    if (example) categoryExamples.push(example.markdown);

    const platforms = rule.meta.platforms?.length
      ? ` *(${rule.meta.platforms.join(", ")} only)*`
      : "";
    const idCell = example
      ? `[\`${escape(rule.meta.id)}\`](${EXAMPLES_FILE}#${example.anchor})`
      : `\`${escape(rule.meta.id)}\``;
    rulesLines.push(
      [
        "",
        idCell,
        escape(defaultState(rule)),
        rule.meta.obfuscated ? "yes" : "—",
        `${escape(rule.meta.description)}${platforms}`,
        escape(rule.meta.docs?.source ?? "—"),
        "",
      ]
        .join(" | ")
        .trim(),
    );
  }
  rulesLines.push("");

  for (const markdown of categoryExamples) exampleLines.push(markdown, "");
}

writeFileSync(join(root, "docs", "rules.md"), rulesLines.join("\n"));
writeFileSync(join(root, "docs", EXAMPLES_FILE), exampleLines.join("\n"));
console.log(
  `Wrote docs/rules.md and docs/${EXAMPLES_FILE} (${defaultRules.length} rules)`,
);
