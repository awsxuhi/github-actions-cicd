import { octokit } from "../octokit";

/**
 * Get the diff between two specified commits in a repository.
 * @param owner Repository owner
 * @param repo Repository name
 * @param base Commit SHA to start the diff (e.g., last reviewed commit or base branch)
 * @param head Commit SHA to end the diff (e.g., latest commit in PR)
 * @returns The diff data between the specified commits
 */
export async function getDiffBetweenCommits(owner: string, repo: string, base: string, head: string): Promise<any> {
  const diffResponse = await octokit.repos.compareCommits({
    owner,
    repo,
    base,
    head,
  });

  return diffResponse;
}

/**
 * Get the diff between the two latest commits in a pull request.
 * @param owner Repository owner
 * @param repo Repository name
 * @param pullNumber Pull request number
 */
export async function getLatestCommitsDiff(owner: string, repo: string, pullNumber: number): Promise<string> {
  const allCommits = await octokit.pulls.listCommits({
    owner,
    repo,
    pull_number: pullNumber,
  });

  const previousHeadSha = allCommits.data[allCommits.data.length - 2].sha;
  const newHeadSha = allCommits.data[allCommits.data.length - 1].sha;

  const responseFromCompareCommits = await octokit.repos.compareCommits({
    owner,
    repo,
    base: previousHeadSha,
    head: newHeadSha,
    headers: {
      accept: "application/vnd.github.v3.diff",
    },
  });

  return String(responseFromCompareCommits.data);
}
