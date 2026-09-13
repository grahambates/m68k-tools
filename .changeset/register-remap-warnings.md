---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Preview register-remapping warnings for newly invalid operand forms, such as address registers in MOVEQ or byte instructions and data registers used as indirect address bases. Display warnings alongside mapping conflicts while keeping Apply available. Valid address/data substitutions and index registers remain supported. Validation matches complete documented operand alternatives and addressing-mode tables, with explicit checks for address bases and byte operations. Unknown documentation notation is left unchecked; this is not a full assembly of the program.

Cover base-68000 operand notation, branch targets, absolute addresses, arithmetic operand-pair restrictions and special-register MOVE forms. Preserve all EORI forms when generating instruction documentation.

Continue validating explicit instructions when macro analysis is incomplete or references cannot safely be edited, preserving concrete warnings alongside a partial-validation notice.
