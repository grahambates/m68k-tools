# Checks against the real vasm

These compare what our tools believe with what the assembler does. They are not part of `pnpm check`: they need a vasm binary, and skip themselves without one.

```sh
pnpm build
VASM=/path/to/vasmm68k_mot pnpm check:vasm
```

`VASM` can be left out if `vasmm68k_mot` is on the `PATH`. They read the built packages, so build first. Everything is assembled without optimisation (`-no-opt`), so vasm assembles the instruction as written and not a better one it found itself.

| Check               | What it compares                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-sizes`       | The size 68kcounter gives each instruction of its timing corpus, against the length vasm assembles. Forms vasm rejects are listed separately (`--rejected`).                                                                 |
| `check-suggestions` | Every optimisation rule's suggestion, on its impact-audit case and on some 30,000 generated and corpus lines: it must assemble, without a warning the original did not give, and change the size by what the linter reports. |
| `check-syntax`      | Where operands end, what a comment is, and how labels, sizes and directives may be spelled, against 68kcounter and the parser. Known differences are listed in the script with their reasons; a new one fails the check.     |

Results are for the vasm build used, at the time of writing 1.9 with the Motorola syntax module 3.15d. A difference is a question, not a verdict: the assembler is the authority on what assembles and how big it is, and says nothing about timing or what an instruction does when it runs.

When a check turns up something worth keeping, put the case in a normal test with a comment saying it was verified with vasm, so the fact stays checked without a binary.
