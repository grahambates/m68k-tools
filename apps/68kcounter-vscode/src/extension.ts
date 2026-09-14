import {
  toggleCacheModel,
  resetCacheModel,
  registerCacheSession,
} from "./settings";
import { commands, type ExtensionContext, languages } from "vscode";
import AnnotateCodeLensProvider from "./AnnotateCodeLensProvider";
import AnnotateController from "./AnnotateController";
import countSelection from "./countSelection";

export function activate(context: ExtensionContext): void {
  registerCacheSession(context);
  context.subscriptions.push(
    commands.registerCommand("68kcounter.toggleCacheModel", toggleCacheModel),
    commands.registerCommand("68kcounter.resetCacheModel", resetCacheModel),
  );
  const controller = new AnnotateController();
  context.subscriptions.push(controller);

  context.subscriptions.push(
    commands.registerCommand("68kcounter.toggleCounts", () =>
      controller.toggle(),
    ),
  );

  context.subscriptions.push(
    commands.registerCommand("68kcounter.countSelection", () =>
      countSelection(),
    ),
  );

  const codeLensProvider = new AnnotateCodeLensProvider();

  context.subscriptions.push(
    languages.registerCodeLensProvider(
      { pattern: "**/*.{s,i,asm}" },
      codeLensProvider,
    ),
  );
}

export function deactivate(): void {
  //
}
