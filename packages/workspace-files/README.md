# @m68k-lsp/workspace-files

Private, shared workspace file discovery for the assembly and linter language servers: recursively finding assembly source under a directory and matching exclude patterns, so both servers walk a workspace the same way instead of each maintaining their own copy. Built and checked through the root workspace commands.

Deliberately narrow in scope: this is about finding files, not about indexing what is in them. Each server keeps its own symbol/reference model on top.

[MIT licensed](LICENSE.md).
