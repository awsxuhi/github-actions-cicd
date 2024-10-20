import { components } from "@octokit/openapi-types";
import { info, warning } from "@actions/core";
import { printWithColor, areFilesArrayEqual } from "../utils";
import { getDiffBetweenCommits } from "../lib";

type FileDiff = components["schemas"]["diff-entry"];
type Commit = components["schemas"]["commit"];

/**
 * Fetches the diff between commits and filters the files that require a code review, along with the commits between the highest reviewed commit and the latest commit.
 *
 * @param repoOwner - The owner of the repository.
 * @param repoName - The name of the repository.
 * @param highestReviewedCommitId - The ID of the highest reviewed commit.
 * @param pullRequestBaseSha - The base commit SHA of the pull request.
 * @param pullRequestHeadSha - The latest commit SHA of the pull request.
 * @returns An object containing a list of files that need to be reviewed and the list of commits.
 */
export async function getFilesForReviewAfterTheHighestReviewedCommitId(
  repoOwner: string,
  repoName: string,
  highestReviewedCommitId: string,
  pullRequestBaseSha: string,
  pullRequestHeadSha: string
): Promise<{ files: FileDiff[]; commits: Commit[] }> {
  // Fetch the diff between the highest REVIEWED commit and the latest commit of the PR branch
  const incrementalDiff = await getDiffBetweenCommits(repoOwner, repoName, highestReviewedCommitId, pullRequestHeadSha);
  printWithColor("Incremental diff since last review (incrementalDiff.data.files):", incrementalDiff.data.files?.slice(0, 3));

  // Fetch the diff between the target branch's base commit and the latest commit of the PR branch
  const targetBranchDiff = await getDiffBetweenCommits(repoOwner, repoName, pullRequestBaseSha, pullRequestHeadSha);
  printWithColor("Target branch base diff (targetBranchDiff.data.files):", targetBranchDiff.data.files?.slice(0, 3));

  // Define GitHub file diff type
  const incrementalFiles: FileDiff[] = incrementalDiff.data.files || [];
  const targetBranchFiles: FileDiff[] = targetBranchDiff.data.files || [];
  const commits: Commit[] = incrementalDiff.data.commits || [];

  if (!incrementalFiles || !targetBranchFiles) {
    warning("Skipped: files data is missing");
    return { files: [], commits };
  }

  // Filter out any file that is changed compared to the incremental changes
  const files = targetBranchFiles.filter((targetBranchFile) =>
    incrementalFiles.some((incrementalFile) => incrementalFile.filename === targetBranchFile.filename)
  );

  // Check if files are equal to incrementalFiles for debugging purposes ONLY, below 2 lines can be removed later
  const isEqual = areFilesArrayEqual(files, incrementalFiles);
  info(`Comparison result: ${isEqual ? "Files are equal to incrementalFiles." : "Files are NOT equal to incrementalFiles."}`);

  // If no new files to review
  if (files.length === 0) {
    info("No new files to review since the last commit.");
    return { files: [], commits };
  }

  return { files, commits };
}
