---
"m68k-formatter": minor
---

Publish a JSON schema for `.m68k-format.json` as `m68k-format.schema.json`, and accept a `$schema` key in the file, which used to be rejected. The VS Code extension bundles the schema; elsewhere reference `https://cdn.jsdelivr.net/npm/m68k-formatter@0/m68k-format.schema.json`.
