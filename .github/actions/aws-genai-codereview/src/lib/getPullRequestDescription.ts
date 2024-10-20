import { context as github_context } from "@actions/github";
import { octokit } from "../octokit";
import { printWithColor } from "../utils";

export async function getPullRequestDescription(): Promise<string> {
  const context = github_context;
  if (context.payload.pull_request == null) {
    printWithColor("getPullRequestDescription(), Warning: context.payload.pull_request == null");
    return "Warning: context.payload.pull_request == null";
  }
  try {
    const pr = await octokit.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
    });

    return pr.data.body || "";
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error fetching pull request:", error.message);
      return `Error fetching pull request: ${error.message}`;
    } else {
      console.error("Error fetching pull request:", error);
      return `Error fetching pull request: ${String(error)}`;
    }
  }
}

// octokit.pulls.get 返回的是这个特定 Pull Request 的所有相关详细信息。
/*
    调用 pulls.get 时，会根据传入的 owner、repo 和 pull_number 获取指定的 Pull Request 的数据。

  返回的数据通常包括以下信息（在 pr.data 中）：

  id：Pull Request 的 ID。
  number：Pull Request 的编号。
  title：Pull Request 的标题。
  body：Pull Request 的描述内容（在 pr.data.body 中）。
  state：Pull Request 的状态（如 open、closed 等）。
  user：创建该 Pull Request 的用户信息。
  created_at：创建时间。
  commits：该 Pull Request 中的提交数。
  changed_files：更改文件的数量。
  还有其他许多属性
  */
