import { join } from "node:path";
import { ProcessExecution, Task, TaskScope, tasks, workspace } from "vscode";

export function registerVasmTasks(extensionPath: string) {
  return tasks.registerTaskProvider("vasm", {
    provideTasks: () => [],
    resolveTask(task) {
      const { args, assembler = "wasm", binPath } = task.definition;
      if (
        !Array.isArray(args) ||
        args.length === 0 ||
        args.some((arg) => typeof arg !== "string")
      ) {
        return undefined;
      }

      let execution: ProcessExecution;
      if (assembler === "wasm") {
        // The extension host executable can run the bundled Emscripten
        // launcher as Node, including on desktop installations without Node.
        const launcher = join(extensionPath, "wasm", "vasmm68k_mot");
        execution = new ProcessExecution(
          process.execPath,
          [launcher, ...args],
          {
            env: { ELECTRON_RUN_AS_NODE: "1" },
          },
        );
      } else if (assembler === "native") {
        const folderUri =
          typeof task.scope === "object" ? task.scope.uri : undefined;
        const executable =
          binPath ??
          workspace
            .getConfiguration("m68k.vasm", folderUri)
            .get<string>("binPath") ??
          "vasmm68k_mot";
        if (typeof executable !== "string" || !executable.trim()) {
          return undefined;
        }
        execution = new ProcessExecution(executable, args);
      } else {
        return undefined;
      }

      return new Task(
        task.definition,
        task.scope ?? TaskScope.Workspace,
        task.name,
        "vasm",
        execution,
        "$vasm",
      );
    },
  });
}
