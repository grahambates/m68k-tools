---
"m68k-lint": minor
---

Expand macros defined in other files. The project index now carries macro definitions alongside constants, and a call to a macro the file does not define itself is expanded from the project's definition, so macros from includes are seen through like local ones. As with constants, a name is answered only where every definition of it in the project has the same body; a macro defined two ways stays opaque. The file's own definition takes precedence. This is a match by name across the project, not a walk of the include graph.
