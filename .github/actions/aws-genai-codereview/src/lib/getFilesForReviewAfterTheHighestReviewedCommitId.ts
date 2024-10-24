import { info, warning } from "@actions/core";
import { printWithColor, areFilesArrayEqual } from "../utils";
import { getDiffBetweenCommits } from "../lib";
import { type FileDiff, type Commit } from "../lib";

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
  const [incrementalDiffJson, incrementalDiffString] = await getDiffBetweenCommits(repoOwner, repoName, highestReviewedCommitId, pullRequestHeadSha);
  printWithColor("incremental-diff vs. the_last_reviewed_commit_id:", incrementalDiffJson.data.files?.slice(0, 2));

  // Fetch the diff between the target branch's base commit and the latest commit of the PR branch
  const [targetBranchDiffJson, targetBranchDiffString] = await getDiffBetweenCommits(repoOwner, repoName, pullRequestBaseSha, pullRequestHeadSha);
  // printWithColor("full-diff vs. target.base:", targetBranchDiff.data.files?.slice(0, 2));

  // Define GitHub file diff type
  const incrementalFiles: FileDiff[] = incrementalDiffJson.data.files || [];
  const targetBranchFiles: FileDiff[] = targetBranchDiffJson.data.files || [];
  const commits: Commit[] = incrementalDiffJson.data.commits || [];

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
  info(
    `Comparison result: ${
      isEqual
        ? "Files filtered from TargetBranchFiles are equal to incrementalFiles."
        : "Files filtered from TargetBranchFiles are NOT equal to incrementalFiles."
    }`
  );

  // If no new files to review
  if (files.length === 0) {
    info("No new files to review since the last commit.");
    return { files: [], commits };
  }

  return { files, commits };
}

/************************************************************************************************
  这段代码通过 GitHub API 的 compareCommits 方法，分别获取两个 diff（差异）：
  1. incrementalDiff：从 highestReviewedCommitId（上次审查的最后一次提交，这是已经审查过的）到 PR 最新提交（context.payload.pull_request.head.sha）的增量差异。
  2. targetBranchDiff：从目标分支的基准提交（context.payload.pull_request.base.sha）到 PR 最新提交的完整差异。
   ***********************************************************************************************/
