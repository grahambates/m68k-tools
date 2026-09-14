---
"m68k-lint": patch
---

Treat subroutine calls and other unknown register effects as barriers in bit-level register analysis. Avoid reporting narrow register writes as overwritten before use when an intervening call may consume their values.
