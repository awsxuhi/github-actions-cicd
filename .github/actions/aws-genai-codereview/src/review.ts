import { error, info, warning } from "@actions/core";
// eslint-disable-next-line camelcase
import { context as github_context } from "@actions/github";
import { components } from "@octokit/openapi-types"; // 导入 GitHub API 的类型定义
import pLimit from "p-limit";
import { type Bot } from "./bot";
import {
  Commenter,
  COMMENT_REPLY_TAG,
  RAW_SUMMARY_END_TAG,
  RAW_SUMMARY_START_TAG,
  SHORT_SUMMARY_END_TAG,
  SHORT_SUMMARY_START_TAG,
  SUMMARIZE_TAG,
} from "./commenter";
import { Inputs } from "./inputs";
import { octokit } from "./octokit";
import { type Options } from "./options";
import { type Prompts } from "./prompts";
import { getTokenCount } from "./tokenizer";
import { printWithColor } from "./utils";

// eslint-disable-next-line camelcase
const context = github_context;
const repo = context.repo;

const ignoreKeyword = "/reviewbot: ignore";

/*+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
export const codeReview = async (lightBot: Bot, heavyBot: Bot, options: Options, prompts: Prompts): Promise<void> => {
  const commenter: Commenter = new Commenter();

  const bedrockConcurrencyLimit = pLimit(options.bedrockConcurrencyLimit);
  const githubConcurrencyLimit = pLimit(options.githubConcurrencyLimit);

  if (context.eventName !== "pull_request" && context.eventName !== "pull_request_target") {
    warning(`Skipped: current event is ${context.eventName}, only support pull_request event`);
    return;
  }

  // 虽然 pull_request 和 pull_request_target 是不同的事件类型，但它们的结构相同，GitHub 会在 context.payload.pull_request 中存储拉取请求的数据。因此，context.payload.pull_request 适用于两种事件类型。
  if (context.payload.pull_request == null) {
    warning("Skipped: context.payload.pull_request is null");
    return;
  }

  // printWithColor("context.payload.pull_request", context.payload.pull_request);
  /*
这段代码中的变量都来源于 `context.payload.pull_request`，它们表示一个 Pull Request 的相关信息。每个字段都对应 Pull Request 不同的属性和内容，以下是具体解释：

1. **`title`**：  
   表示 Pull Request 的标题，即用户在创建 Pull Request 时输入的简短描述。通常用来概括 Pull Request 的主要变更或目的。

2. **`number`**：  
   表示 Pull Request 的编号。这是一个 GitHub 仓库中唯一的数字，用来标识这个 Pull Request。在该仓库中每个新的 Pull Request 会自动分配一个递增的编号。

3. **`diff_url`**：  
   表示一个 URL，链接到 Pull Request 的 `diff` 文件。这个文件展示了 Pull Request 中的代码差异，采用 `diff` 格式显示修改内容。

4. **`patch_url`**：  
   表示一个 URL，链接到 Pull Request 的 `patch` 文件。这个文件包含的是 Pull Request 的补丁信息，可以直接应用到代码仓库中，用来将 Pull Request 中的修改合并到本地仓库。

5. **`review_comments`**：  
   表示 Pull Request 中代码审查评论的数量。代码审查评论是针对具体的代码行或代码块进行的评论，通常是由代码审查者提出的。

6. **`review_comments_url`**：  
   表示一个 URL，链接到 Pull Request 的代码审查评论的 API 端点。通过这个 URL 可以获取或操作与代码审查相关的评论。

7. **`comments`**：  
   表示 Pull Request 的常规评论数量。这些评论通常与代码无关，而是对 Pull Request 进行的整体讨论或反馈。

8. **`comments_url`**：  
   表示一个 URL，链接到 Pull Request 的评论 API 端点。通过这个 URL 可以获取或操作 Pull Request 的常规评论。

9. **`commits`**：  
   表示 Pull Request 中包含的提交（commit）数量。一个 Pull Request 可以包含多个代码提交。

10. **`commits_url`**：  
    表示一个 URL，链接到 Pull Request 的提交 API 端点。通过这个 URL 可以获取该 Pull Request 中的所有提交信息。

11. **`body`**：  
    表示 Pull Request 的正文内容，通常是用户在创建 Pull Request 时写的描述性文字。这个字段确实是特指 Pull Request 创建时的第一条帖子内容，通常包含更详细的解释或上下文，说明 Pull Request 的目的、改动的细节、需要注意的问题等。

---

**`comments` 和 `review_comments` 的区别：**
- **`comments`** 是指 Pull Request 整体下的讨论，用户可以在 Pull Request 中发表评论，这些评论是和具体的代码无关的讨论。
- **`review_comments`** 则是代码审查者在审查代码时对特定代码行或文件作出的评论。它是基于代码的反馈和讨论，而不是整个 Pull Request。

总结来说，`comments` 更加广泛地适用于整个 Pull Request，而 `review_comments` 是精确到代码行的讨论。q
  */
  printWithColor("context.payload", {
    action: context.payload.action,
    before: context.payload.before,
    after: context.payload.after,
    number: context.payload.number,
    repository: {
      name: context.payload.repository?.name,
      owner: {
        login: context.payload.repository?.owner.login,
        type: context.payload.repository?.owner.type,
      },
    },
    sender: {
      login: context.payload.sender?.login,
    },
    pull_request: {
      _links: context.payload.pull_request._links,
      base: {
        label: context.payload.pull_request.base.label,
        ref: context.payload.pull_request.base.ref,
        sha: context.payload.pull_request.base.sha,
        repo: {
          owner: {
            login: context.payload.pull_request.base.repo.owner.login,
            type: context.payload.pull_request.base.repo.owner.type,
          },
          name: context.payload.pull_request.base.repo.name,
        },
      },
      head: {
        label: context.payload.pull_request.head.label,
        ref: context.payload.pull_request.head.ref,
        sha: context.payload.pull_request.head.sha,
      },
      title: context.payload.pull_request.title,
      number: context.payload.pull_request.number,
      diff_url: context.payload.pull_request.diff_url,
      patch_url: context.payload.pull_request.patch_url,
      review_comments: context.payload.pull_request.review_comments,
      review_comments_url: context.payload.pull_request.review_comments_url,
      comments: context.payload.pull_request.comments,
      comments_url: context.payload.pull_request.comments_url,
      commits: context.payload.pull_request.commits,
      commits_url: context.payload.pull_request.commits_url,
      before: context.payload.pull_request.before,
    },
  });

  printWithColor("context.payload", context.payload);

  // xuhi: added this to get the diff of the PR
  // getDiffString的值是一个字符串，就是diff_url链接的网页显示的内容
  // octokit.pulls.get 方法可以用于获取 Pull Request 的差异数据，其返回的 diff 内容与 compareCommits 方法的 diff 数据基本一致。
  /**
    如果base是A，执行一个pull request后，head是B，再次执行一次pull request后，head变成C，那么此时通过octokit.pulls.get得到的diff是A和C的差异，不是B和C的差异
  */
  const { data: getDiffString } = await octokit.pulls.get({
    owner: context.payload.pull_request.base.repo.owner.login,
    repo: context.payload.pull_request.base.repo.name,
    pull_number: context.payload.pull_request.number,
    mediaType: { format: "diff" },
  });
  printWithColor("getDiff: Base(A) vs. Head(C)", getDiffString);

  /*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/

  const inputs: Inputs = new Inputs();
  inputs.title = context.payload.pull_request.title;
  if (context.payload.pull_request.body != null) {
    inputs.description = commenter.getDescription(context.payload.pull_request.body);
  }

  // if the description contains ignore_keyword, skip
  if (inputs.description.includes(ignoreKeyword)) {
    info("Skipped: description contains ignore_keyword");
    return;
  }

  inputs.systemMessage = options.systemMessage;
  inputs.reviewFileDiff = options.reviewFileDiff;

  // get SUMMARIZE_TAG message
  const existingSummarizeCmt = await commenter.findCommentWithTag(SUMMARIZE_TAG, context.payload.pull_request.number);
  let existingCommitIdsBlock = "";
  let existingSummarizeCmtBody = "";
  if (existingSummarizeCmt != null) {
    existingSummarizeCmtBody = existingSummarizeCmt.body;
    printWithColor("existingSummarizeCmtBody = existingSummarizeCmt.body", existingSummarizeCmtBody);
    inputs.rawSummary = commenter.getRawSummary(existingSummarizeCmtBody);
    inputs.shortSummary = commenter.getShortSummary(existingSummarizeCmtBody);
    existingCommitIdsBlock = commenter.getReviewedCommitIdsBlock(existingSummarizeCmtBody);
  }

  const allCommitIds = await commenter.getAllCommitIds();
  // find highest reviewed commit id
  let highestReviewedCommitId = "";
  if (existingCommitIdsBlock !== "") {
    highestReviewedCommitId = commenter.getHighestReviewedCommitId(allCommitIds, commenter.getReviewedCommitIds(existingCommitIdsBlock));
  }

  if (highestReviewedCommitId === "" || highestReviewedCommitId === context.payload.pull_request.head.sha) {
    info(`Will review from the base commit: ${context.payload.pull_request.base.sha as string}`);
    highestReviewedCommitId = context.payload.pull_request.base.sha;
  } else {
    info(`Will review from commit: ${highestReviewedCommitId}`);
  }

  /************************************************************************************************
  这段代码通过 GitHub API 的 compareCommits 方法，分别获取两个 diff（差异）：
  1. incrementalDiff：从 highestReviewedCommitId（上次审查的最后一次提交）到 PR 最新提交（context.payload.pull_request.head.sha）的增量差异。
  2. targetBranchDiff：从目标分支的基准提交（context.payload.pull_request.base.sha）到 PR 最新提交的完整差异。
   ***********************************************************************************************/

  /**
   * xuhi: Let me use another way to get the previousCommit
   */

  const allCommits = await octokit.pulls.listCommits({
    owner: context.payload.pull_request.base.repo.owner.login,
    repo: context.payload.pull_request.base.repo.name,
    pull_number: context.payload.pull_request.number,
  });
  const previousHeadSha = allCommits.data[allCommits.data.length - 2].sha;
  const newHeadSha = allCommits.data[allCommits.data.length - 1].sha;

  const responseFromCompareCommits = await octokit.repos.compareCommits({
    owner: context.payload.pull_request.base.repo.owner.login,
    repo: context.payload.pull_request.base.repo.name,
    base: previousHeadSha, // `B` 的 SHA
    head: newHeadSha, // `C` 的 SHA
    headers: {
      accept: "application/vnd.github.v3.diff",
    },
  });
  const incrementalDiff_xuhi = String(responseFromCompareCommits.data);
  printWithColor("responseFromCompareCommits.data.files", responseFromCompareCommits.data.files?.slice(0, 3));
  printWithColor("incrementalDiff_xuhi", incrementalDiff_xuhi);
  printWithColor("previousHeadSha", previousHeadSha);
  printWithColor("newHeadSha", newHeadSha);
  printWithColor("highestReviewedCommitId", highestReviewedCommitId);
  printWithColor("context.payload.pull_request.head.sha", context.payload.pull_request.head.sha);

  // Fetch the diff between the highest reviewed commit and the latest commit of the PR branch
  const incrementalDiff = await octokit.repos.compareCommits({
    owner: repo.owner,
    repo: repo.repo,
    base: highestReviewedCommitId,
    head: context.payload.pull_request.head.sha,
  });
  printWithColor("incrementalDiff.data.files", incrementalDiff.data.files?.slice(0, 3));

  // Fetch the diff between the target branch's base commit and the latest commit of the PR branch
  const targetBranchDiff = await octokit.repos.compareCommits({
    owner: repo.owner,
    repo: repo.repo,
    base: context.payload.pull_request.base.sha,
    head: context.payload.pull_request.head.sha,
  });
  // printWithColor("targetBranchDiff.data.files", targetBranchDiff.data.files?.slice(0, 3));

  // 定义 GitHub 文件差异的类型
  type FileDiff = components["schemas"]["diff-entry"];
  const incrementalFiles: FileDiff[] = incrementalDiff.data.files || [];
  const targetBranchFiles: FileDiff[] = targetBranchDiff.data.files || [];

  if (incrementalFiles == null || targetBranchFiles == null) {
    warning("Skipped: files data is missing");
    return;
  }

  // Filter out any file that is changed compared to the incremental changes
  // 这一行代码的目的是过滤出仅在增量修改中（从 highestReviewedCommitId 到 PR 最新提交）存在的文件。通过 filter 方法，targetBranchFiles 中的文件会被过滤，只保留那些同时在 incrementalFiles 中出现的文件。这确保了我们只对增量修改的文件进行审查，而不是对整个 PR 的所有文件进行重复审查。
  // filter() 是保留那些 targetBranchFiles 中的文件，前提是该文件的 filename 出现在 incrementalFiles 中。也就是说，只有在增量提交中也发生了更改的文件会被保留。
  const files = targetBranchFiles.filter((targetBranchFile) =>
    incrementalFiles.some((incrementalFile) => incrementalFile.filename === targetBranchFile.filename)
  );

  // 如果 files.length === 0，说明从上次审查的提交到最新提交之间没有任何文件发生过变化
  if (files.length === 0) {
    info("No new files to review since the last commit.");
    return;
  }

  // skip files if they are filtered out (minimatched)
  const filterSelectedFiles = [];
  const filterIgnoredFiles = []; // 这是通过 options.pathFilters.check() 方法过滤掉 excluded paths
  for (const file of files) {
    if (!options.checkPath(file.filename)) {
      info(`skip for excluded path: ${file.filename}`);
      filterIgnoredFiles.push(file);
    } else {
      filterSelectedFiles.push(file);
    }
  }

  if (filterSelectedFiles.length === 0) {
    warning("Skipped: filterSelectedFiles is null");
    return;
  }

  const commits = incrementalDiff.data.commits;
  printWithColor("incrementalDiff.data.commits (highestReviewedCommitId vs. context.payload.pull_request.head.sha)", incrementalDiff.data.commits);

  if (commits.length === 0) {
    warning("Skipped: commits is null");
    return;
  }

  // find hunks to review
  // githubConcurrencyLimit(async () => {...}) 的用法意味着每次调用这个函数时，最多只会有 options.githubConcurrencyLimit 个异步任务同时执行。多余的任务将排队等待。这种机制常用于防止超过 API 请求限制，避免引发 429 "Too Many Requests" 错误。
  const filteredFiles: Array<[string, string, string, Array<[number, number, string]>] | null> = await Promise.all(
    filterSelectedFiles.map((file) =>
      githubConcurrencyLimit(async () => {
        // retrieve file contents
        let fileContent = "";
        if (context.payload.pull_request == null) {
          warning("Skipped: context.payload.pull_request is null");
          return null;
        }
        try {
          const contents = await octokit.repos.getContent({
            owner: repo.owner,
            repo: repo.repo,
            path: file.filename,
            ref: context.payload.pull_request.base.sha,
          });
          if (contents.data != null) {
            if (!Array.isArray(contents.data)) {
              if (contents.data.type === "file" && contents.data.content != null) {
                fileContent = Buffer.from(contents.data.content, "base64").toString();
              }
            }
          }
        } catch (e: any) {
          warning(`Failed to get file contents: ${e as string}. This is OK if it's a new file.`);
        }

        let fileDiff = "";
        if (file.patch != null) {
          fileDiff = file.patch;
        }

        const patches: Array<[number, number, string]> = [];
        for (const patch of splitPatch(file.patch)) {
          const patchLines = patchStartEndLine(patch); // patch ==> a hunk
          if (patchLines == null) {
            continue;
          }
          const hunks = parsePatch(patch);
          if (hunks == null) {
            continue;
          }
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
          return [file.filename, fileContent, fileDiff, patches] as [string, string, string, Array<[number, number, string]>];
        } else {
          return null;
        }
      })
    )
  );

  // Filter out any null results
  const filesAndChanges = filteredFiles.filter((file) => file !== null) as Array<[string, string, string, Array<[number, number, string]>]>;

  if (filesAndChanges.length === 0) {
    error("Skipped: no files to review");
    return;
  }

  let statusMsg = `<details>
<summary>Commits</summary>
Files that changed from the base of the PR and between ${highestReviewedCommitId} and ${
    context.payload.pull_request.head.sha
  } commits. (Focusing on incremental changes)
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

  // update the existing comment with in progress status
  printWithColor("existingSummarizeCmtBody", existingSummarizeCmtBody);
  const inProgressSummarizeCmt = commenter.addInProgressStatus(existingSummarizeCmtBody, statusMsg);
  printWithColor("inProgressSummarizeCmt = commenter.addInProgressStatus(existingSummarizeCmtBody, statusMsg)", inProgressSummarizeCmt);

  // add in progress status to the summarize comment
  await commenter.comment(`${inProgressSummarizeCmt}`, SUMMARIZE_TAG, "replace");

  const summariesFailed: string[] = [];

  // doSummary 是一个异步函数，用于对文件差异（fileDiff）进行总结，判断文件是否需要进一步的审查，并返回总结的结果。如果出现问题或某些条件不满足，会提前返回 null。
  const doSummary = async (filename: string, fileContent: string, fileDiff: string): Promise<[string, string, boolean] | null> => {
    info(`summarize: ${filename}`);
    const ins = inputs.clone();
    if (fileDiff.length === 0) {
      warning(`summarize: file_diff is empty, skip ${filename}`);
      summariesFailed.push(`${filename} (empty diff)`);
      return null;
    }

    ins.filename = filename;
    ins.fileDiff = fileDiff;

    // render prompt based on inputs so far
    const summarizePrompt = prompts.renderSummarizeFileDiff(ins, options.reviewSimpleChanges);
    const tokens = getTokenCount(summarizePrompt);

    if (tokens > options.lightTokenLimits.requestTokens) {
      info(`summarize: diff tokens exceeds limit, skip ${filename}`);
      summariesFailed.push(`${filename} (diff tokens exceeds limit)`);
      return null;
    }

    // summarize content
    try {
      const [summarizeResp] = await lightBot.chat(summarizePrompt);

      if (summarizeResp === "") {
        info("summarize: nothing obtained from bedrock");
        summariesFailed.push(`${filename} (nothing obtained from bedrock)`);
        return null;
      } else {
        if (options.reviewSimpleChanges === false) {
          // parse the comment to look for triage classification
          // Format is : [TRIAGE]: <NEEDS_REVIEW or APPROVED>
          // if the change needs review return true, else false
          const triageRegex = /\[TRIAGE\]:\s*(NEEDS_REVIEW|APPROVED)/;
          const triageMatch = summarizeResp.match(triageRegex);

          if (triageMatch != null) {
            const triage = triageMatch[1];
            const needsReview = triage === "NEEDS_REVIEW";

            // remove this line from the comment
            const summary = summarizeResp.replace(triageRegex, "").trim();
            info(`filename: ${filename}, triage: ${triage}`);
            return [filename, summary, needsReview];
          }
        }
        return [filename, summarizeResp, true];
      }
    } catch (e: any) {
      warning(`summarize: error from bedrock: ${e as string}`);
      summariesFailed.push(`${filename} (error from bedrock: ${e as string})})`);
      return null;
    }
  };

  const summaryPromises = [];
  const skippedFiles = [];
  for (const [filename, fileContent, fileDiff] of filesAndChanges) {
    printWithColor("filename", filename);
    printWithColor("fileContent", fileContent);
    printWithColor("fileDiff", fileDiff);
    if (options.maxFiles <= 0 || summaryPromises.length < options.maxFiles) {
      summaryPromises.push(bedrockConcurrencyLimit(async () => await doSummary(filename, fileContent, fileDiff)));
    } else {
      skippedFiles.push(filename);
    }
  }

  const summaries = (await Promise.all(summaryPromises)).filter((summary) => summary !== null) as Array<[string, string, boolean]>;

  if (summaries.length > 0) {
    const batchSize = 10;
    // join summaries into one in the batches of batchSize
    // and ask the bot to summarize the summaries
    for (let i = 0; i < summaries.length; i += batchSize) {
      const summariesBatch = summaries.slice(i, i + batchSize);
      for (const [filename, summary] of summariesBatch) {
        inputs.rawSummary += `---
${filename}: ${summary}
`;
      }
      // ask Bedrock to summarize the summaries
      const [summarizeResp] = await heavyBot.chat(prompts.renderSummarizeChangesets(inputs));
      if (summarizeResp === "") {
        warning("summarize: nothing obtained from bedrock");
      } else {
        inputs.rawSummary = summarizeResp;
      }
    }
  }

  // final summary
  const [summarizeFinalResponse] = await heavyBot.chat(prompts.renderSummarize(inputs));
  if (summarizeFinalResponse === "") {
    info("summarize: nothing obtained from bedrock");
  }

  if (options.disableReleaseNotes === false) {
    // final release notes
    const [releaseNotesResponse] = await heavyBot.chat(prompts.renderSummarizeReleaseNotes(inputs));
    if (releaseNotesResponse === "") {
      info("release notes: nothing obtained from bedrock");
    } else {
      let message = "### Summary (generated)\n\n";
      message += releaseNotesResponse;
      try {
        await commenter.updateDescription(context.payload.pull_request.number, message);
      } catch (e: any) {
        warning(`release notes: error from github: ${e.message as string}`);
      }
    }
  }

  // generate a short summary as well
  const [summarizeShortResponse] = await heavyBot.chat(prompts.renderSummarizeShort(inputs));
  inputs.shortSummary = summarizeShortResponse;

  let summarizeComment = `${summarizeFinalResponse}
${RAW_SUMMARY_START_TAG}
${inputs.rawSummary}
${RAW_SUMMARY_END_TAG}
${SHORT_SUMMARY_START_TAG}
${inputs.shortSummary}
${SHORT_SUMMARY_END_TAG}
`;

  statusMsg += `
${
  skippedFiles.length > 0
    ? `
<details>
<summary>Files not processed due to max files limit (${skippedFiles.length})</summary>

* ${skippedFiles.join("\n* ")}

</details>
`
    : ""
}
${
  summariesFailed.length > 0
    ? `
<details>
<summary>Files not summarized due to errors (${summariesFailed.length})</summary>

* ${summariesFailed.join("\n* ")}

</details>
`
    : ""
}
`;

  if (!options.disableReview) {
    const filesAndChangesReview = filesAndChanges.filter(([filename]) => {
      const needsReview = summaries.find(([summaryFilename]) => summaryFilename === filename)?.[2] ?? true;
      return needsReview;
    });

    const reviewsSkipped = filesAndChanges
      .filter(([filename]) => !filesAndChangesReview.some(([reviewFilename]) => reviewFilename === filename))
      .map(([filename]) => filename);

    // failed reviews array
    const reviewsFailed: string[] = [];
    let lgtmCount = 0;
    let reviewCount = 0;
    const doReview = async (filename: string, fileContent: string, patches: Array<[number, number, string]>): Promise<void> => {
      info(`reviewing ${filename}`);
      // make a copy of inputs
      const ins: Inputs = inputs.clone();
      ins.filename = filename;

      // calculate tokens based on inputs so far
      let tokens = getTokenCount(prompts.renderReviewFileDiff(ins));
      // loop to calculate total patch tokens
      let patchesToPack = 0;
      for (const [, , patch] of patches) {
        const patchTokens = getTokenCount(patch);
        if (tokens + patchTokens > options.heavyTokenLimits.requestTokens) {
          info(`only packing ${patchesToPack} / ${patches.length} patches, tokens: ${tokens} / ${options.heavyTokenLimits.requestTokens}`);
          break;
        }
        tokens += patchTokens;
        patchesToPack += 1;
      }

      let patchesPacked = 0;
      for (const [startLine, endLine, patch] of patches) {
        if (context.payload.pull_request == null) {
          warning("No pull request found, skipping.");
          continue;
        }
        // see if we can pack more patches into this request
        if (patchesPacked >= patchesToPack) {
          info(`unable to pack more patches into this request, packed: ${patchesPacked}, total patches: ${patches.length}, skipping.`);
          if (options.debug) {
            info(`prompt so far: ${prompts.renderReviewFileDiff(ins)}`);
          }
          break;
        }
        patchesPacked += 1;

        let commentChain = "";
        try {
          const allChains = await commenter.getCommentChainsWithinRange(context.payload.pull_request.number, filename, startLine, endLine, COMMENT_REPLY_TAG);

          if (allChains.length > 0) {
            info(`Found comment chains: ${allChains} for ${filename}`);
            commentChain = allChains;
          }
        } catch (e: any) {
          warning(`Failed to get comments: ${e as string}, skipping. backtrace: ${e.stack as string}`);
        }
        // try packing comment_chain into this request
        const commentChainTokens = getTokenCount(commentChain);
        if (tokens + commentChainTokens > options.heavyTokenLimits.requestTokens) {
          commentChain = "";
        } else {
          tokens += commentChainTokens;
        }

        ins.patches += `
${patch}
`;
        if (commentChain !== "") {
          ins.patches += `
<comment_chains>
\`\`\`
${commentChain}
\`\`\`
</comment_chains>
`;
        }
      }

      if (patchesPacked > 0) {
        // perform review
        try {
          const [response] = await heavyBot.chat(prompts.renderReviewFileDiff(ins), "{");
          if (response === "") {
            info("review: nothing obtained from bedrock");
            reviewsFailed.push(`${filename} (no response)`);
            return;
          }
          // parse review
          const reviews = parseReview(response, patches);
          for (const review of reviews) {
            // check for LGTM
            if (!options.reviewCommentLGTM && (review.comment.includes("LGTM") || review.comment.includes("looks good to me"))) {
              lgtmCount += 1;
              continue;
            }
            if (context.payload.pull_request == null) {
              warning("No pull request found, skipping.");
              continue;
            }

            try {
              reviewCount += 1;
              await commenter.bufferReviewComment(filename, review.startLine, review.endLine, `${review.comment}`);
            } catch (e: any) {
              reviewsFailed.push(`${filename} comment failed (${e as string})`);
            }
          }
        } catch (e: any) {
          warning(`Failed to review: ${e as string}, skipping. backtrace: ${e.stack as string}`);
          reviewsFailed.push(`${filename} (${e as string})`);
        }
      } else {
        reviewsSkipped.push(`${filename} (diff too large)`);
      }
    };

    const reviewPromises = [];
    for (const [filename, fileContent, , patches] of filesAndChangesReview) {
      if (options.maxFiles <= 0 || reviewPromises.length < options.maxFiles) {
        reviewPromises.push(
          bedrockConcurrencyLimit(async () => {
            await doReview(filename, fileContent, patches);
          })
        );
      } else {
        skippedFiles.push(filename);
      }
    }

    await Promise.all(reviewPromises);

    statusMsg += `
${
  reviewsFailed.length > 0
    ? `<details>
<summary>Files not reviewed due to errors (${reviewsFailed.length})</summary>

* ${reviewsFailed.join("\n* ")}

</details>
`
    : ""
}
${
  reviewsSkipped.length > 0
    ? `<details>
<summary>Files skipped from review due to trivial changes (${reviewsSkipped.length})</summary>

* ${reviewsSkipped.join("\n* ")}

</details>
`
    : ""
}
<details>
<summary>Review comments generated (${reviewCount + lgtmCount})</summary>

* Review: ${reviewCount}
* LGTM: ${lgtmCount}

</details>

---

<details>
<summary>Tips</summary>

### Chat with AI reviewer (\`/reviewbot\`)
- Reply on review comments left by this bot to ask follow-up questions. A review comment is a comment on a diff or a file.
- Invite the bot into a review comment chain by tagging \`/reviewbot\` in a reply.

### Code suggestions
- The bot may make code suggestions, but please review them carefully before committing since the line number ranges may be misaligned. 
- You can edit the comment made by the bot and manually tweak the suggestion if it is slightly off.

### Pausing incremental reviews
- Add \`/reviewbot: ignore\` anywhere in the PR description to pause further reviews from the bot.

</details>
`;
    // add existing_comment_ids_block with latest head sha
    summarizeComment += `\n${commenter.addReviewedCommitId(existingCommitIdsBlock, context.payload.pull_request.head.sha)}`;

    // post the review
    await commenter.submitReview(context.payload.pull_request.number, commits[commits.length - 1].sha, statusMsg);
  }

  // post the final summary comment
  await commenter.comment(`${summarizeComment}`, SUMMARIZE_TAG, "replace");
};

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

interface Review {
  startLine: number;
  endLine: number;
  comment: string;
}

function parseReview(
  response: string,
  // eslint-disable-next-line no-unused-vars
  patches: Array<[number, number, string]>
): Review[] {
  const reviews: Review[] = [];

  try {
    const rawReviews = JSON.parse(response).reviews;
    for (const r of rawReviews) {
      if (r.comment) {
        reviews.push({
          startLine: r.line_start ?? 0,
          endLine: r.line_end ?? 0,
          comment: r.comment,
        });
      }
    }
  } catch (e: any) {
    error(e.message);
    return [];
  }

  return reviews;
}
