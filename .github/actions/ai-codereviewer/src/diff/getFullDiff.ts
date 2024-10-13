import { printWithColor } from "@/utils";

/*
  repository.owner.login 在这段代码中指的是 Pull Request 事件的 base 仓库的所有者。这是因为 GitHub 事件 JSON 文件中的 repository 字段通常表示 Pull Request 目标分支所在的仓库（即 base 仓库），而不是 Pull Request 的源分支（即 head 仓库）。

  因此，repository.owner.login 实际上等于 context.payload.pull_request.base.repo.owner.login，它指向目标仓库的所有者信息（也就是 base 仓库的所有者）。
*/

export async function getFullDiff(action: string, owner: string, repo: string, pull_number: number, octokit: any): Promise<string | null> {
  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: { format: "diff" },
  });
  printWithColor(`getFullDiff on '${action}' action`);

  // 提取 base 和 head commit 的 SHA
  const baseSha = response.data.base?.sha.slice(0, 7) || "unknown";
  const headSha = response.data.head?.sha.slice(0, 7) || "unknown";

  // 打印包含 base 和 head commit SHA 的信息
  if (action === "open") {
    printWithColor(`getFullDiff on '${action}' action - Base(A) vs. Head(C), comparing commits: ${baseSha} -> ${headSha}`);
  } else {
    printWithColor(`getFullDiff on '${action}' action with no existingReview - Base(A) vs. Head(C), comparing commits: ${baseSha} -> ${headSha}`);
  }

  return response.data;
}
