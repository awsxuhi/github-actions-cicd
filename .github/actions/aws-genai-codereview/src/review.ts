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
import { printWithColor, debugPrintCommitSha, areFilesArrayEqual } from "./utils";
import {
  getPullRequestDescription,
  updateInputsWithExistingSummary,
  getTheHighestReviewedCommitId,
  getDiffBetweenCommits,
  getFilesForReviewAfterTheHighestReviewedCommitId,
  filterFilesForReview,
} from "./lib";

const context = github_context;
const repo = context.repo;

const ignoreKeyword = "/reviewbot: ignore";

export const codeReview = async (lightBot: Bot, heavyBot: Bot, options: Options, prompts: Prompts): Promise<void> => {
  const commenter: Commenter = new Commenter();

  const bedrockConcurrencyLimit = pLimit(options.bedrockConcurrencyLimit);
  const githubConcurrencyLimit = pLimit(options.githubConcurrencyLimit);

  if (context.eventName !== "pull_request" && context.eventName !== "pull_request_target") {
    warning(`Skipped: current event is ${context.eventName}, only support pull_request event`);
    return;
  }

  /*
  Although pull_request and pull_request_target are different event types, they share the same structure. GitHub stores the pull request data in context.payload.pull_request for both event types. Therefore, context.payload.pull_request can be used to check for any new changes that need to be reviewed in both cases.
  */
  if (context.payload.pull_request == null) {
    warning("Skipped: context.payload.pull_request is null");
    return;
  }

  /* 
  The `pullRequestDescription` refers to the content of the first post created when a pull request is created. This description is displayed at the top of the pull request. Subsequent comments, including the first comment made on the pull request, are stored separately. In the context of the code, this first comment is represented by allComments[0].
  */
  const pullRequestDescription = await getPullRequestDescription();
  printWithColor("getPullRequestDescription()", pullRequestDescription);

  /*
  The `input` is an instance of the Input class, which is used to store relevant data. This data is then passed to a large language model to summarize code changes, and perform a detailed review of specific code hunks.
  */
  const inputs: Inputs = new Inputs();
  inputs.title = context.payload.pull_request.title;
  if (context.payload.pull_request.body != null) {
    /*
    Worth Noting: The commenter.getDescription(context.payload.pull_request.body) method extracts the bot-generated portion from the pullRequestDescription based on a TAG and removes this bot-generated content, leaving only the manually entered parts. This allows for the subsequent addition of new bot-generated content, which can then be combined to create an updated Description.
    */
    inputs.description = commenter.getDescription(context.payload.pull_request.body);
    printWithColor("inputs.description", inputs.description);
  }

  // if the description contains ignore_keyword, skip `"/reviewbot: ignore"`
  if (inputs.description.includes(ignoreKeyword)) {
    info("Skipped: description contains ignore_keyword");
    return;
  }

  inputs.systemMessage = options.systemMessage;
  inputs.reviewFileDiff = options.reviewFileDiff;

  /*
  By searching through all comments, we identify the comment that contains the SUMMARIZE_TAG (i.e., "<!-- This is an auto-generated comment: summarize by AI reviewer -->"). This comment is referred to as `existingSummarizeCmt`. Each time a code review is executed, the SUMMARIZE_TAG message needs to be retrieved, updated, and then re-published.
  */
  // get SUMMARIZE_TAG message
  const { existingSummarizeCmtBody, existingCommitIdsBlock } = await updateInputsWithExistingSummary(commenter, inputs, context.payload.pull_request.number);

  const highestReviewedCommitId = await getTheHighestReviewedCommitId(
    commenter,
    existingCommitIdsBlock,
    context.payload.pull_request.base.sha,
    context.payload.pull_request.head.sha
  );
  printWithColor("inputs", inputs);

  // const existingSummarizeCmt = await commenter.findCommentWithTag(SUMMARIZE_TAG, context.payload.pull_request.number);
  // let existingCommitIdsBlock = "";
  // let existingSummarizeCmtBody = "";
  // if (existingSummarizeCmt != null) {
  //   existingSummarizeCmtBody = existingSummarizeCmt.body;
  //   printWithColor(
  //     "existingSummarizeCmtBody = existingSummarizeCmt.body (like allComments[0].body, but it's the comment having SUMMARIZE_TAG)",
  //     existingSummarizeCmtBody
  //   );
  //   inputs.rawSummary = commenter.getRawSummary(existingSummarizeCmtBody);
  //   inputs.shortSummary = commenter.getShortSummary(existingSummarizeCmtBody);
  //   existingCommitIdsBlock = commenter.getReviewedCommitIdsBlock(existingSummarizeCmtBody);
  // }

  // const allCommitIds = await commenter.getAllCommitIds();
  // printWithColor("allCommitIds", allCommitIds);
  // // find the highest reviewed commit id
  // let highestReviewedCommitId = "";
  // if (existingCommitIdsBlock !== "") {
  //   highestReviewedCommitId = commenter.getHighestReviewedCommitId(allCommitIds, commenter.getReviewedCommitIds(existingCommitIdsBlock));
  // }

  // /************************************************************************************************
  // 条件 highestReviewedCommitId === context.payload.pull_request.head.sha 的情况实际上是非常少见的，通常只会出现在以下特殊情况之一：

  // 当前最新 commit 已经被审查过：这种情况会发生在 上一次审查的 commit 刚好就是最新的 head commit 时。例如，如果上次审查记录的 commit 就是当前 PR 的最新 commit，那么 highestReviewedCommitId 和 head.sha 会相等。这种情况下，意味着没有新的变更需要审查，因为最新的提交已经审查过了。

  // 所有 commit 已被逐一审查完：如果团队每次推送新的 commit 后都会立即审查，那么最后一次审查记录会跟 head commit 保持一致。这种情况也会触发 highestReviewedCommitId === context.payload.pull_request.head.sha 条件，表示 PR 中所有代码都已经被审查，当前没有待审查的新增代码。
  //  ***********************************************************************************************/
  // if (highestReviewedCommitId === "" || highestReviewedCommitId === context.payload.pull_request.head.sha) {
  //   info(`Will review from the base commit: ${context.payload.pull_request.base.sha as string}`);
  //   highestReviewedCommitId = context.payload.pull_request.base.sha;
  // } else {
  //   info(`Will review from commit: ${highestReviewedCommitId}`);
  // }

  /************************************************************************************************
  这段代码通过 GitHub API 的 compareCommits 方法，分别获取两个 diff（差异）：
  1. incrementalDiff：从 highestReviewedCommitId（上次审查的最后一次提交，这是已经审查过的）到 PR 最新提交（context.payload.pull_request.head.sha）的增量差异。
  2. targetBranchDiff：从目标分支的基准提交（context.payload.pull_request.base.sha）到 PR 最新提交的完整差异。
   ***********************************************************************************************/

  await debugPrintCommitSha(
    context.payload.pull_request.base.sha,
    context.payload.pull_request.head.sha,
    highestReviewedCommitId,
    context.payload.before,
    context.payload.after
  );

  const { files, commits } = await getFilesForReviewAfterTheHighestReviewedCommitId(
    repo.owner,
    repo.repo,
    highestReviewedCommitId,
    context.payload.pull_request.base.sha,
    context.payload.pull_request.head.sha
  );

  // // Fetch the diff between the highest REVIEWED commit and the latest commit of the PR branch
  // const incrementalDiff = await getDiffBetweenCommits(repo.owner, repo.repo, highestReviewedCommitId, context.payload.pull_request.head.sha);
  // printWithColor("Incremental diff since last review (incrementalDiff.data.files):", incrementalDiff.data.files?.slice(0, 3));

  // // Fetch the diff between the target branch's base commit and the latest commit of the PR branch
  // const targetBranchDiff = await getDiffBetweenCommits(repo.owner, repo.repo, context.payload.pull_request.base.sha, context.payload.pull_request.head.sha);
  // printWithColor("Target branch base diff (targetBranchDiff.data.files):", targetBranchDiff.data.files?.slice(0, 3));

  // 定义 GitHub 文件差异的类型
  // type FileDiff = components["schemas"]["diff-entry"];
  // const incrementalFiles: FileDiff[] = incrementalDiff.data.files || [];
  // const targetBranchFiles: FileDiff[] = targetBranchDiff.data.files || [];

  // if (incrementalFiles == null || targetBranchFiles == null) {
  //   warning("Skipped: files data is missing");
  //   return;
  // }

  // // Filter out any file that is changed compared to the incremental changes
  // /*
  // 这一行代码的目的是过滤出仅在增量修改中（从 highestReviewedCommitId 到 PR 最新提交）存在的文件。通过 filter 方法，targetBranchFiles 中的文件会被过滤，只保留那些同时在 incrementalFiles 中出现的文件。这确保了我们只对增量修改的文件进行审查，而不是对整个 PR 的所有文件进行重复审查。
  // filter() 是保留那些 targetBranchFiles 中的文件，前提是该文件的 filename 出现在 incrementalFiles 中。也就是说，只有在增量提交中也发生了更改的文件会被保留。
  // incrementalFiles 可能存在于增量差异中，但不出现在 targetBranchFiles 中，即incrementalFiles未必总是targetBranchFiles的子集（具体参考doc下的文章）。这就是为什么要执行下面几行代码的原因。
  // */
  // const files = targetBranchFiles.filter((targetBranchFile) =>
  //   incrementalFiles.some((incrementalFile) => incrementalFile.filename === targetBranchFile.filename)
  // );

  // // 下面这个代码是用来检测是不是files===incrementalFiles，因为看上去前面的代码是多余的。结果确实显示结果是一样的。
  // const isEqual = areFilesArrayEqual(files, incrementalFiles);
  // info(`Comparison result: ${isEqual ? "Files are equal to incrementalFiles." : "Files are NOT equal to incrementalFiles."}`);

  // 如果 files.length === 0，说明从上次审查的提交到最新提交之间没有任何文件发生过变化
  if (files.length === 0) {
    info("No new files to review since the last commit.");
    return;
  }

  if (commits.length === 0) {
    warning("Skipped: commits is null");
    return;
  }

  const { filterSelectedFiles, filterIgnoredFiles } = filterFilesForReview(files, options);

  // skip files if they are filtered out (minimatched)
  // files = filterSelectedFiles + filterIgnoredFiles
  // filterIgnoredFiles 是通过 options.pathFilters.check() 方法过滤掉 excluded paths
  // const filterSelectedFiles = [];
  // const filterIgnoredFiles = [];
  // for (const file of files) {
  //   if (!options.checkPath(file.filename)) {
  //     info(`skip for excluded path: ${file.filename}`);
  //     filterIgnoredFiles.push(file);
  //   } else {
  //     filterSelectedFiles.push(file);
  //   }
  // }

  // if (filterSelectedFiles.length === 0) {
  //   warning("Skipped: filterSelectedFiles is null");
  //   return;
  // }

  if (filterSelectedFiles.length === 0) {
    warning("Skipped: No files selected for review after filtering.");
    return;
  }

  // const commits = incrementalDiff.data.commits;
  // printWithColor("incrementalDiff.data.commits (highestReviewedCommitId vs. context.payload.pull_request.head.sha)", incrementalDiff.data.commits);

  // find hunks to review
  // githubConcurrencyLimit(async () => {...}) 的用法意味着每次调用这个函数时，最多只会有 options.githubConcurrencyLimit 个异步任务同时执行。多余的任务将排队等待。这种机制常用于防止超过 API 请求限制，避免引发 429 "Too Many Requests" 错误。
  /**
   filteredFiles 代码块的目的是从一组文件（filterSelectedFiles）中获取每个文件的内容和差异信息（patch）。这段代码结合 Promise.all 和 githubConcurrencyLimit 并发限制函数，在不超过 GitHub API 速率限制的前提下逐个处理文件内容，并将包含有效差异信息的文件保存到 filteredFiles 数组中。
   */
  type FilteredFile = [string, string, string, Array<[number, number, string]>];

  const filteredFiles: Array<FilteredFile | null> = await Promise.all(
    filterSelectedFiles.map((file) =>
      githubConcurrencyLimit(async () => {
        // 1. retrieve file contents from Target (base) by using octokit.repos.getContent
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
            ref: context.payload.pull_request.base.sha, // base is the initial commit of the PR, i.e., Target
          });
          if (contents.data != null) {
            if (!Array.isArray(contents.data)) {
              if (contents.data.type === "file" && contents.data.content != null) {
                fileContent = Buffer.from(contents.data.content, "base64").toString();
                // printWithColor(`fileContent of file: ${file.filename}(full content of that file)`, fileContent);
              }
            }
          }
        } catch (e: any) {
          warning(`Failed to get file contents: ${e as string}. This is OK if it's a new file.`);
        }

        // 2. get diff from file.patch. No need to invoke extra API.
        let fileDiff = "";
        if (file.patch != null) {
          fileDiff = file.patch;
        }
        printWithColor("file.patch", file.patch);

        // 3. get hunks from file.patch
        const patches: Array<[number, number, string]> = [];
        for (const patch of splitPatch(file.patch)) {
          printWithColor("patch", patch);
          // 针对每个 hunk，获取其起始行和结束行号
          const patchLines = patchStartEndLine(patch); // patch ==> a hunk
          printWithColor("patchLines", patchLines);
          if (patchLines == null) {
            continue;
          }
          const hunks = parsePatch(patch);
          // printWithColor("hunks=parsePatch(patch)", hunks);
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
          // printWithColor("patchLines.newHunk.startLine, patchLines.newHunk.endLine, hunksStr]", patches[patches.length - 1]);
        }
        if (patches.length > 0) {
          // 返回的结果包含：文件名，旧文件的完整内容，文件差异部分，和Patches（就是包含各个hunk的array）
          console.log([file.filename, fileContent, fileDiff, patches]);
          return [file.filename, fileContent, fileDiff, patches] as [string, string, string, Array<[number, number, string]>];
        } else {
          return null;
        }
      })
    )
  );

  /* xuhi: Debuging purpose, optional ****************************************/
  // Print the first 2 elements for debug purpose
  if (filteredFiles.length === 0) {
    printWithColor("filteredFiles is empty.");
  } else if (filteredFiles.length === 1) {
    printWithColor("filteredFiles has only one element:", filteredFiles[0]);
  } else {
    printWithColor("The 1st element of filteredFiles:", filteredFiles[0]);
    printWithColor("The 2nd element of filteredFiles:", filteredFiles[1]);
  }
  /* xuhi: End of Debuging purpose, optional *********************************/

  // Filter out any null results
  // const filesAndChanges = filteredFiles.filter((file) => file !== null) as Array<[string, string, string, Array<[number, number, string]>]>;
  const filesAndChanges = filteredFiles.filter((file): file is FilteredFile => file !== null);

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
      printWithColor("summarizeResp", summarizeResp);

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
            printWithColor("summary (triage removed)", summary);
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
      // 这行代码的主要作用是将一个异步总结操作添加到 summaryPromises 数组中，同时通过 bedrockConcurrencyLimit 函数来限制并发执行的数量。
      summaryPromises.push(bedrockConcurrencyLimit(async () => await doSummary(filename, fileContent, fileDiff)));
    } else {
      skippedFiles.push(filename);
    }
  }
  /*
  假设summaryPromises包含一下结果：
      [
        ["file1.js", "Summary of file1", true],
        null,
        ["file2.js", "Summary of file2", false],
        null,
        ["file3.js", "Summary of file3", true]
      ]

  */

  // 这行代码的主要作用是等待所有的总结操作完成，并将成功的总结结果收集到 summaries 数组中，同时过滤掉那些返回 null 的结果（即总结失败或被跳过的文件）。
  // 得到的结果是一个数组，包含每个 doSummary 调用的返回值（[string, string, boolean] 或 null）。
  // 过滤掉数组中所有 null 值，只保留有效的总结结果。
  printWithColor("summaryPromises", summaryPromises);
  const summaries = (await Promise.all(summaryPromises)).filter((summary) => summary !== null) as Array<[string, string, boolean]>;
  printWithColor("summaries", summaries);
  /*
  经过过滤后，summaries 将变为：
      [
        ["file1.js", "Summary of file1", true],
        ["file2.js", "Summary of file2", false],
        ["file3.js", "Summary of file3", true]
      ]
  */

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
      printWithColor("inputs.rawSummary", inputs.rawSummary);
      // ask Bedrock to summarize the summaries
      const [summarizeResp] = await heavyBot.chat(prompts.renderSummarizeChangesets(inputs));
      if (summarizeResp === "") {
        warning("summarize: nothing obtained from bedrock");
      } else {
        inputs.rawSummary = summarizeResp;
        printWithColor("inputs.rawSummary=summarizeResp", inputs.rawSummary);
      }
    }
  }

  // final summary
  const [summarizeFinalResponse] = await heavyBot.chat(prompts.renderSummarize(inputs));
  if (summarizeFinalResponse === "") {
    info("summarize: nothing obtained from bedrock");
  }
  printWithColor("summarizeFinalResponse", summarizeFinalResponse);

  if (options.disableReleaseNotes === false) {
    // final release notes
    const [releaseNotesResponse] = await heavyBot.chat(prompts.renderSummarizeReleaseNotes(inputs));
    if (releaseNotesResponse === "") {
      info("release notes: nothing obtained from bedrock");
    } else {
      printWithColor("releaseNotesResponse", releaseNotesResponse);
      let message = "### Summary (Auto-generated by AWS CodeReview Bot)\n\n";
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
  printWithColor("summarizeShortResponse", inputs.shortSummary);

  let summarizeComment = `${summarizeFinalResponse}
${RAW_SUMMARY_START_TAG}
${inputs.rawSummary}
${RAW_SUMMARY_END_TAG}
${SHORT_SUMMARY_START_TAG}
${inputs.shortSummary}
${SHORT_SUMMARY_END_TAG}
`;
  printWithColor("==> summarizeComment", summarizeComment);

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
  printWithColor("==> statusMsg", statusMsg);

  if (!options.disableReview) {
    // 使用 filter 方法从 filesAndChanges 中筛选出需要审查的文件
    // 通过查找 summaries 中与 filename 相匹配的条目并读取其第三项（[2]）来决定是否需要审查。如果没有找到匹配条目，默认认为需要审查（true）。
    const filesAndChangesReview = filesAndChanges.filter(([filename]) => {
      const needsReview = summaries.find(([summaryFilename]) => summaryFilename === filename)?.[2] ?? true;
      return needsReview;
    });

    // 这段代码通过检查哪些文件没有包含在 filesAndChangesReview 中，从而生成被跳过审查的文件列表。
    // 使用 filter 方法筛选出未包含在 filesAndChangesReview 中的文件，并返回这些文件的 filename。
    const reviewsSkipped = filesAndChanges
      .filter(([filename]) => !filesAndChangesReview.some(([reviewFilename]) => reviewFilename === filename))
      .map(([filename]) => filename);

    // failed reviews array
    // reviewsFailed：用于存储审查失败的文件。
    // lgtmCount 和 reviewCount 分别用于跟踪已通过审查的数量和总审查数。
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
        // this.requestTokens = this.maxTokens - this.responseTokens - 200; by default, it's 195800. This is input token limit.
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

    // post the review - createReview() at commit level
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
