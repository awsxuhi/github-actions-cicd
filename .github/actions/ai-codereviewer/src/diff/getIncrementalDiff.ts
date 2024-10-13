import { printWithColor } from "@/utils";

export async function getIncrementalDiff(
  prDetails: { owner: string; repo: string; pull_number: number },
  newBaseSha: string,
  newHeadSha: string,
  octokit: any
): Promise<string> {
  printWithColor(`getIncrementalDiff on 'synchronize' action: Base(B) vs. Head(C), comparing commits: ${newBaseSha.slice(0, 7)} -> ${newHeadSha.slice(0, 7)}`);

  const response = await octokit.repos.compareCommits({
    headers: {
      accept: "application/vnd.github.v3.diff",
    },
    owner: prDetails.owner,
    repo: prDetails.repo,
    base: newBaseSha,
    head: newHeadSha,
  });

  return String(response.data);
}
