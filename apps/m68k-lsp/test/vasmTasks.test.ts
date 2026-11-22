import { join } from "node:path";
import { type Task, type TaskProvider, tasks, workspace } from "vscode";
import { registerVasmTasks } from "../src/vasmTasks";

vi.mock(
  "vscode",
  () => ({
    Task: class {
      readonly problemMatchers: string[];

      constructor(
        readonly definition: Task["definition"],
        readonly scope: Task["scope"],
        readonly name: string,
        readonly source: string,
        readonly execution: Task["execution"],
        matcher: string,
      ) {
        this.problemMatchers = [matcher];
      }
    },
    TaskScope: { Workspace: 2 },
    ProcessExecution: class {
      constructor(
        readonly process: string,
        readonly args: string[],
        readonly options?: unknown,
      ) {}
    },
    tasks: { registerTaskProvider: vi.fn() },
    workspace: {
      getConfiguration: vi.fn(() => ({ get: () => "native-vasm" })),
    },
  }),
  { virtual: true },
);

const extensionPath = join("extensions", "m68k lsp");
const args = ["-Fbin", "-o", "out file.bin", "${workspaceFolder}/main file.s"];

function resolveTask(definition: Task["definition"]) {
  registerVasmTasks(extensionPath);
  const provider = vi.mocked(tasks.registerTaskProvider).mock
    .lastCall?.[1] as TaskProvider;
  return provider.resolveTask({ definition } as Task, {} as never);
}

it("passes each argument unchanged to the bundled assembler by default", async () => {
  const definition = { type: "vasm", args };
  const task = await resolveTask(definition);
  expect(task?.definition).toBe(definition);
  expect(task?.problemMatchers).toEqual(["$vasm"]);
  expect(task?.execution).toMatchObject({
    process: process.execPath,
    args: [join(extensionPath, "wasm", "vasmm68k_mot"), ...args],
    options: { env: { ELECTRON_RUN_AS_NODE: "1" } },
  });
});

it("uses the task binary path or the configured native assembler", async () => {
  const definition = { type: "vasm", assembler: "native", args };
  expect((await resolveTask(definition))?.execution).toMatchObject({
    process: "native-vasm",
    args,
  });
  expect(workspace.getConfiguration).toHaveBeenCalledWith(
    "m68k.vasm",
    undefined,
  );
  expect(
    (await resolveTask({ ...definition, binPath: "/tools/my vasm" }))
      ?.execution,
  ).toMatchObject({
    process: "/tools/my vasm",
    args,
  });
});

it("rejects a task without an argument list", async () => {
  expect(await resolveTask({ type: "vasm" })).toBeUndefined();
});
