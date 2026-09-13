/**
 * Utility functions for handling macro parameters
 */

import { type Location, type MacroParameterNode } from "./types.js";

/**
 * Parse a macro parameter and return a MacroParameterNode
 * Handles all macro parameter types: \1-\9, \a-\z, \@, \<name>, \?n, \., \+, \-, \@!, \@?, \@@
 *
 * @param text - The text to parse (should start with \)
 * @param loc - Location in source
 * @returns MacroParameterNode or null if not a macro parameter
 */
export function parseMacroParameter(
  text: string,
  loc: Location,
): MacroParameterNode | null {
  const match =
    /^\\(\d+|[a-z]|@!|@\?|@@|@|<([^>]+)>|\?(\d+|[a-z])|[.+-])$/.exec(text);
  if (!match) return null;

  const param = match[1];
  let paramType:
    | "numeric"
    | "letter"
    | "special"
    | "named"
    | "query"
    | "carg"
    | "unique-push"
    | "unique-push-below"
    | "unique-pull";
  let paramValue: string;

  if (/^\d+$/.test(param)) {
    paramType = "numeric";
    paramValue = param;
  } else if (/^[a-z]$/.test(param)) {
    paramType = "letter";
    paramValue = param;
  } else if (param === "@!") {
    paramType = "unique-push";
    paramValue = "@!";
  } else if (param === "@?") {
    paramType = "unique-push-below";
    paramValue = "@?";
  } else if (param === "@@") {
    paramType = "unique-pull";
    paramValue = "@@";
  } else if (param === "@") {
    paramType = "special";
    paramValue = "@";
  } else if (param.startsWith("?")) {
    paramType = "query";
    paramValue = match[3]; // captured group after ?
  } else if (param === "." || param === "+" || param === "-") {
    paramType = "carg";
    paramValue = param;
  } else {
    paramType = "named";
    paramValue = param;
  }

  return {
    type: "macro-parameter",
    loc,
    paramType,
    param: paramValue,
  };
}
