import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const scratch = await mkdtemp(join(tmpdir(), "m68k-extension-test-"));
try {
  const workspace = join(scratch, "workspace");
  await mkdir(join(workspace, ".vscode"), { recursive: true });
  await writeFile(
    join(workspace, ".vscode", "settings.json"),
    JSON.stringify({ "m68k.vasm.provideDiagnostics": false }),
  );
  await writeFile(join(workspace, "values.i"), "FEATURE = 1\n");
  await writeFile(
    join(workspace, "main.asm"),
    [
      ' include "values.i"',
      "Demo macro",
      " moveq #\\1,d0",
      " endm",
      " ifne FEATURE",
      " nop",
      " else",
      " illegal",
      " endc",
      " move.w #FEATURE*2,d0",
      " Demo 3",
      "",
    ].join("\n"),
  );
  const vscodeExecutablePath = process.env.VSCODE_TEST_EXECUTABLE_PATH;
  await runTests({
    ...(vscodeExecutablePath
      ? { vscodeExecutablePath }
      : { version: process.env.VSCODE_TEST_VERSION || "1.101.0" }),
    extensionDevelopmentPath: fileURLToPath(new URL("../", import.meta.url)),
    extensionTestsPath: fileURLToPath(new URL("./smoke.cjs", import.meta.url)),
    launchArgs: [
      workspace,
      "--user-data-dir",
      join(scratch, "user"),
      "--extensions-dir",
      join(scratch, "extensions"),
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
    ],
  });
} finally {
  await rm(scratch, { recursive: true, force: true });
}
