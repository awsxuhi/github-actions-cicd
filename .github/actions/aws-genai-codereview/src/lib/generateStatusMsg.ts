import { context as github_context } from "@actions/github";
import { type Options } from "../options";
import type { FilteredFile, FilesResultFromCompareCommits } from "../lib";

/**
 * Generates the status message for the summary comment.
 *
 * @param highestReviewedCommitId - The highest reviewed commit ID.
 * @param filesAndChanges - Array of files and their changes.
 * @param filterIgnoredFiles - Array of files that were ignored due to filters.
 * @param options - The options object.
 * @returns The generated status message string.
 */
export function generateStatusMsg(
  highestReviewedCommitId: string,
  filesAndChanges: Array<FilteredFile>,
  filterIgnoredFiles: Array<FilesResultFromCompareCommits>,
  options: Options
): string {
  const context = github_context;

  // construct the status message
  return `
**${options.botName}** ${options.botIcon}

<details>
<summary>Commits</summary>
Files that changed from the base of the PR and between ${highestReviewedCommitId} and ${context.payload.pull_request?.head.sha} commits. 
</details>
${
  filesAndChanges.length > 0
    ? `
<details>
<summary>Files selected (${filesAndChanges.length})</summary>

* ${filesAndChanges.map(([filename, , , patches]) => `${filename} (${patches.length})`).join("\n* ")}
</details>
`
    : ""
}
${
  filterIgnoredFiles.length > 0
    ? `
<details>
<summary>Files ignored due to filter (${filterIgnoredFiles.length})</summary>

* ${filterIgnoredFiles.map((file) => file.filename).join("\n* ")}

</details>
`
    : ""
}
`;
}
