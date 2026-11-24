---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

`correctness/amiga-custom-register-access` also checks the ECS and AGA registers whose direction is documented: reading one that can only be written, such as BPLCON3, BPLCON4, FMODE, BEAMCON0, DIWHIGH, the programmable sync registers or the UHRES registers, and writing DENISEID or HHPOSR, which can only be read. `correctness/amiga-dma-outside-chip-ram` also checks AGA's bitplane 7 and 8 pointers.
