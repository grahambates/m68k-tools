/**
 * What is known about a source file that only its file system can say.
 *
 * Rules read only the text they are given, so anything that depends on the
 * files around it is found out beforehand by the caller, which has the file
 * system, and handed over here. Every part is optional: a rule that needs one
 * stays silent when it was not supplied, as when linting text with no file.
 */
export interface FileFacts {
  /**
   * For each include the source names, what the path is called on disk, where
   * that differs from how it is written. Keyed by the path as written.
   */
  includeCase?: ReadonlyMap<string, string>;
  /**
   * Whether another file in the project includes this one. Known only where a
   * project index was built; an included file continues in its includer, so a
   * rule treating the end of the file as the end of the program needs `false`.
   */
  includedByProject?: boolean;
}
