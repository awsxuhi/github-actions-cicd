import { context as github_context } from "@actions/github";
import { warning } from "@actions/core";
import pLimit from "p-limit";
import type { FilteredFile, FilesResultFromCompareCommits } from "../lib";
import { octokit } from "../octokit";
import { type Options } from "../options";
// import { printWithColor } from "../utils";

/**
 * Fetches file contents and diffs, and returns filtered file changes.
 *
 * @param repo - An object containing the owner and repository name.
 * @param filterSelectedFiles - Array of selected files to be processed.
 * @param context - The GitHub context containing pull request information.
 * @returns A filtered array of files with their changes.
 */
export async function getFilesWithHunksArray(filterSelectedFiles: Array<FilesResultFromCompareCommits>, options: Options): Promise<FilteredFile[]> {
  const githubConcurrencyLimit = pLimit(options.githubConcurrencyLimit);
  const context = github_context;
  /* githubConcurrencyLimit(async () => {...}) 的用法意味着每次调用这个函数时，最多只会有 options.githubConcurrencyLimit 个异步任务同时执行。多余的任务将排队等待。这种机制常用于防止超过 API 请求限制，避免引发 429 "Too Many Requests" 错误。
   
  filteredFiles 代码块的目的是从一组文件（filterSelectedFiles）中获取每个文件的内容和差异信息（patch）。这段代码结合 Promise.all 和 githubConcurrencyLimit 并发限制函数，在不超过 GitHub API 速率限制的前提下逐个处理文件内容，并将包含有效差异信息的文件保存到 filteredFiles 数组中。
  */
  const filteredFiles: Array<FilteredFile | null> = await Promise.all(
    filterSelectedFiles.map((file) =>
      githubConcurrencyLimit(async () => {
        // 1. Retrieve file contents from Target (base) by using octokit.repos.getContent
        let fileContent = "";
        if (!context.payload.pull_request) {
          warning("Skipped: context.payload.pull_request is null");
          return null;
        }
        try {
          const contents = await octokit.repos.getContent({
            owner: context.repo.owner,
            repo: context.repo.repo,
            path: file.filename,
            ref: context.payload.pull_request.base.sha, // base is the initial commit of the PR, i.e., Target
          });
          if (contents.data && !Array.isArray(contents.data) && contents.data.type === "file" && contents.data.content) {
            fileContent = Buffer.from(contents.data.content, "base64").toString();
          }
        } catch (e) {
          warning(`Failed to get file contents: ${e}. This is OK if it's a new file.`);
        }

        // 2. Get diff from file.patch
        let fileDiff = file.patch || "";

        // 3. Get hunks from file.patch
        const patches: Array<[number, number, string]> = [];
        for (const patch of splitPatch(file.patch)) {
          const patchLines = patchStartEndLine(patch); // Get start and end lines
          if (!patchLines) continue;
          const hunks = parsePatch(patch);
          if (!hunks) continue;

          const hunksStr = `
<new_hunk>
\`\`\`
${hunks.newHunk}
\`\`\`
</new_hunk>

<old_hunk>
\`\`\`
${hunks.oldHunk}
\`\`\`
</old_hunk>
`;
          patches.push([patchLines.newHunk.startLine, patchLines.newHunk.endLine, hunksStr]);
        }

        if (patches.length > 0) {
          return [file.filename, fileContent, fileDiff, patches] as FilteredFile;
        } else {
          return null;
        }
      })
    )
  );

  // Filter out any null results
  return filteredFiles.filter((file): file is FilteredFile => file !== null);
}

/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
// splitPatch 函数的目的是解析和分割 diff 文件中的 patch 字符串部分。它将 patch 字符串分割成多个部分，每个部分表示文件的一段修改（hunk）。
// 输出：一个数组，数组中的每个元素是 patch 中的一段差异（hunk）。
const splitPatch = (patch: string | null | undefined): string[] => {
  if (patch == null) {
    return [];
  }

  /**
   * /gm 的含义：
   * /g：全局匹配 (global match)，表示正则表达式在输入字符串中查找所有匹配，而不是找到第一个匹配后停止。
   * /m：多行模式 (multiline mode)，表示 ^ 和 $ 不仅仅匹配字符串的开头和结尾，还匹配每一行的开头和结尾。
   */
  const pattern = /(^@@ -(\d+),(\d+) \+(\d+),(\d+) @@).*$/gm;

  const result: string[] = [];
  let last = -1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(patch)) !== null) {
    if (last === -1) {
      last = match.index;
    } else {
      result.push(patch.substring(last, match.index));
      last = match.index;
    }
  }
  if (last !== -1) {
    result.push(patch.substring(last));
  }
  return result;
};

/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
const patchStartEndLine = (
  patch: string // patch = a hunk in a diff file
): {
  oldHunk: { startLine: number; endLine: number };
  newHunk: { startLine: number; endLine: number };
} | null => {
  // 这个正则表达式用于匹配 diff 文件中的 hunk 标记行，格式类似于 @@ -10,5 +10,6 @@
  const pattern = /(^@@ -(\d+),(\d+) \+(\d+),(\d+) @@)/gm;

  // match[0]：表示正则表达式匹配到的整个字符串，即正则表达式完全匹配的部分。
  // match[1]：匹配的捕获组，按照正则表达式的分组是 @@ -10,5 +10,6 @@，但括号匹配的组实际从 match[2] 开始。
  const match = pattern.exec(patch);
  if (match != null) {
    const oldBegin = parseInt(match[2]);
    const oldDiff = parseInt(match[3]);
    const newBegin = parseInt(match[4]);
    const newDiff = parseInt(match[5]);
    return {
      oldHunk: {
        startLine: oldBegin, //e.g., 10
        endLine: oldBegin + oldDiff - 1, //e.g., 14
      },
      newHunk: {
        startLine: newBegin, //e.g., 10
        endLine: newBegin + newDiff - 1, //e.g., 15
      },
    };
  } else {
    return null;
  }
};

/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
const parsePatch = (patch: string): { oldHunk: string; newHunk: string } | null => {
  const hunkInfo = patchStartEndLine(patch);
  if (hunkInfo == null) {
    return null;
  }

  const oldHunkLines: string[] = [];
  const newHunkLines: string[] = [];

  let newLine = hunkInfo.newHunk.startLine;

  const lines = patch.split("\n").slice(1); // Skip the @@ line

  // Remove the last line if it's empty
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  // Skip annotations for the first 3 and last 3 lines
  /**
   * 在 GitHub 的 diff 格式中，上下文行是用于帮助开发人员理解代码变化的背景。在显示文件的修改部分时，GitHub 通常会在代码块中显示修改前后的 3 行上下文，以便评审者能够更好地理解修改内容。这个做法是标准的，因为它能为审查者提供足够的上下文，帮助他们理解修改的代码逻辑。

设置 skipStart = 3 和 skipEnd = 3，就是为了跳过前 3 行和后 3 行的行号显示，但仍然保留它们的内容，确保上下文完整呈现。这样做的目的是简化变更的显示，避免在上下文行上添加额外的行号，使重点集中在实际的代码变动上。
   */
  const skipStart = 3;
  const skipEnd = 3;

  let currentLine = 0;

  const removalOnly = !lines.some((line) => line.startsWith("+"));

  for (const line of lines) {
    currentLine++;
    if (line.startsWith("-")) {
      oldHunkLines.push(`${line.substring(1)}`);
    } else if (line.startsWith("+")) {
      newHunkLines.push(`${newLine}: ${line.substring(1)}`);
      newLine++;
    } else {
      // context line
      oldHunkLines.push(`${line}`);
      if (removalOnly || (currentLine > skipStart && currentLine <= lines.length - skipEnd)) {
        newHunkLines.push(`${newLine}: ${line}`);
      } else {
        newHunkLines.push(`${line}`);
      }
      newLine++;
    }
  }

  return {
    oldHunk: oldHunkLines.join("\n"),
    newHunk: newHunkLines.join("\n"),
  };
};
