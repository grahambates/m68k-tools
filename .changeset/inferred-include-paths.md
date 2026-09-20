---
"m68k-lsp-server": minor
---

Guess where an include is when vasm would not find it. If a file in the project ends in the same path (`lib/defs.i` for `include "lib/defs.i"`), the directory in front of it is added as an include path, so the error goes away and the rest of the file is checked. Which includes vasm would not find is worked out from the source and where vasm looks (its run directory, the main source's directory, `-I` and `incdir`, and not beside the including file), so the first run already has the directory and the note shows even with vasm turned off; if vasm still fails to open an include, it is run again with a guess. An information diagnostic on the include says where it was found, with quick fixes to add the directory to `includePaths` or set `sourceRoot` in `.m68krc.json`, creating the file if there is none. A path that matches files in more than one place is left alone. `inferIncludePaths: false` (`m68k.inferIncludePaths` in editor settings) turns it off.
