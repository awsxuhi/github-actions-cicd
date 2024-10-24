import { info } from "@actions/core";
import { Options } from "../options";
import { type FileDiff } from "../lib";
import { printWithColor } from "@/utils";

/**
 * Filters files based on exclusion rules and returns selected and ignored files.
 *
 * @param files - The list of files to be filtered.
 * @param options - The options containing the exclusion rules (e.g., checkPath).
 * @returns An object with two arrays: `filterSelectedFiles` and `filterIgnoredFiles`.
 */
export function filterFilesForReview(files: FileDiff[], options: Options): { filterSelectedFiles: FileDiff[]; filterIgnoredFiles: FileDiff[] } {
  const filterSelectedFiles: FileDiff[] = [];
  const filterIgnoredFiles: FileDiff[] = [];

  info(`\n`);
  printWithColor("Filters files based on exclusion rules and returns selected and ignored files.");
  for (const file of files) {
    if (!options.checkPath(file.filename)) {
      filterIgnoredFiles.push(file);
    } else {
      filterSelectedFiles.push(file);
    }
  }

  return { filterSelectedFiles, filterIgnoredFiles };
}
