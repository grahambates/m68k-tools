---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Available registers report how long they stay free: register usage results include `availableUntilOverwritten` and `availabilityRanges`, every run of lines in the scope where the register is free or its availability is unknown, with free runs marked if they stay free only until a later write. The remapping panel shows registers free after the cursor only until a later overwrite in orange, and unknown availability in grey italic in place of the `availability unknown` label. Hovering a row marks all of the register's runs in green, orange or grey; each run starts and ends on code, leaving out labels at its edges. A documented output is now available when every path overwrites it before returning.
