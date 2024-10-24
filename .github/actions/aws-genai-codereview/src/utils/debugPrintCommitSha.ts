import { octokit } from "../octokit";
import { printWithColor } from "./printWithColor";

/**
 * Get and print the SHA of the previous and latest commits in a pull request.
 * If `before` and `after` are available in the context, use them to simplify the code.
 * @param targetBase Base commit SHA of the target branch
 * @param currentHead The latest commit SHA in the PR branch
 * @param highestReviewedCommitId The last reviewed commit SHA
 */
export async function debugPrintCommitSha(
  targetBase: string,
  currentHead: string,
  highestReviewedCommitId: string,
  previousCommitSha: string, // Equivalent to context.payload.before
  newCommitSha: string // Equivalent to context.payload.after
): Promise<void> {
  const previousHeadSha = previousCommitSha || targetBase || "unknown";
  const newHeadSha = newCommitSha || "unknown";

  printWithColor("previousHeadSha (the last commit)", previousHeadSha);
  printWithColor("newHeadSha (the current commit=context.payload.after)", newHeadSha);
  printWithColor("context.payload.pull_request.head.sha (the current commit)", currentHead);
  printWithColor("context.payload.pull_request.base.sha (the target base)", targetBase);
  printWithColor("highestReviewedCommitId", highestReviewedCommitId);
}

/**
 * Get the SHA of the previous and latest commits in a pull request.
 * If the PR has only one commit, the previous commit SHA will be the base commit SHA of the PR.
 * @param owner Repository owner
 * @param repo Repository name
 * @param pullNumber Pull request number
 */
export async function debugPrintCommitShaUsingListcommits(
  owner: string,
  repo: string,
  pullNumber: number,
  targetBase: string,
  currentHead: string,
  highestReviewedCommitId: string
): Promise<void> {
  const allCommits = await octokit.pulls.listCommits({
    owner,
    repo,
    pull_number: pullNumber,
  });

  const newHeadSha = allCommits.data[allCommits.data.length - 1]?.sha || "unknown";
  const previousHeadSha = allCommits.data.length < 2 ? targetBase || "unknown" : allCommits.data[allCommits.data.length - 2].sha || "unknown";

  /* 
  Actually, we don't need to use listCommits, because newHeadSha==context.payload.after, previousHeadSha==context.payload.before
  So we can use debugPrintCommitSha() instead of debugPrintCommitShaUsingListcommits()
  */
  printWithColor("previousHeadSha (the last commit)", previousHeadSha);
  printWithColor("newHeadSha (the current commit)", newHeadSha);
  printWithColor("context.payload.pull_request.head.sha (the current commit)", currentHead);
  printWithColor("context.payload.pull_request.base.sha (the target base)", targetBase);
  printWithColor("highestReviewedCommitId", highestReviewedCommitId);
}
