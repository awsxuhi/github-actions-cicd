import { error, info, warning } from "@actions/core";
import { context as github_context } from "@actions/github";
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
import { printWithColor, debugPrintCommitSha } from "./utils";
import {
  type FileDiff,
  type Commit,
  type FilteredFile,
  type Review,
  getPullRequestDescription,
  updateInputsWithExistingSummary,
  getTheHighestReviewedCommitId,
  getFilesForReviewAfterTheHighestReviewedCommitId,
  filterFilesForReview,
  getFilesWithHunksArray,
  updateSummarizeCmtWithInProgressStatusMsg,
  generateStatusMsg,
  doSummary,
} from "./lib";

const context = github_context;
const repo = context.repo;

const ignoreKeyword = "/reviewbot: ignore";

export const codeReview = async (lightBot: Bot, heavyBot: Bot, options: Options, prompts: Prompts): Promise<void> => {
  const commenter: Commenter = new Commenter();

  const bedrockConcurrencyLimit = pLimit(options.bedrockConcurrencyLimit);

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

  /********************************************************************************************************************
  1. Get the pull request description (i.e., the first post created when a pull request is created)
  ********************************************************************************************************************/
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

  /********************************************************************************************************************
  2. Get the SUMMARIZE_TAG message (usually, it's the first post right after the pull request description)
  ********************************************************************************************************************/
  /*
  By searching through all comments, we identify the comment that contains the SUMMARIZE_TAG (i.e., "<!-- This is an auto-generated comment: summarize by AI reviewer -->"). This comment is referred to as `existingSummarizeCmt`. Each time a code review is executed, the SUMMARIZE_TAG message needs to be retrieved, updated, and then re-published.
  */
  const { existingSummarizeCmtBody, existingCommitIdsBlock } = await updateInputsWithExistingSummary(commenter, inputs, context.payload.pull_request.number);

  const highestReviewedCommitId = await getTheHighestReviewedCommitId(
    commenter,
    existingCommitIdsBlock,
    context.payload.pull_request.base.sha,
    context.payload.pull_request.head.sha
  );
  printWithColor("inputs", inputs, 2);

  await debugPrintCommitSha(
    context.payload.pull_request.base.sha,
    context.payload.pull_request.head.sha,
    highestReviewedCommitId,
    context.payload.before,
    context.payload.after
  );

  /********************************************************************************************************************
  3. Get the filtered files list for review, based on the highestReviewedCommitId and the current PR branch
  ********************************************************************************************************************/
  const { files, commits } = await getFilesForReviewAfterTheHighestReviewedCommitId(
    repo.owner,
    repo.repo,
    highestReviewedCommitId,
    context.payload.pull_request.base.sha,
    context.payload.pull_request.head.sha
  );

  // files.length === 0 means there is no changes since last reviewed commit.
  if (files.length === 0) {
    info("No new files to review since the last commit.");
    return;
  }

  if (commits.length === 0) {
    warning("Skipped: commits is null");
    return;
  } else {
    printWithColor("commits (since highestReviewedCommitId):", commits);
  }

  /**
   * skip files if they are filtered out (minimatched)
   * files = filterSelectedFiles + filterIgnoredFiles
   */
  const { filterSelectedFiles, filterIgnoredFiles } = filterFilesForReview(files, options);

  if (filterSelectedFiles.length === 0) {
    warning("Skipped: No files selected for review after filtering.");
    return;
  }

  /********************************************************************************************************************
  4. Generate hunks array for each file
  ********************************************************************************************************************/
  const filesAndChanges = await getFilesWithHunksArray(filterSelectedFiles, options);

  // Print the first 2 elements for debug purpose ONLY, you can remove below lines
  // filesAndChanges: [filename, fileContent, fileDiff, patches: array<[number, number, string]>] []
  if (filesAndChanges.length === 0) {
    printWithColor("Skipped: no files to review.");
    return;
  } else if (filesAndChanges.length === 1) {
    printWithColor("filesAndChanges has only one element:", [filesAndChanges[0][0], filesAndChanges[0][3]]);
  } else {
    printWithColor("The 1st element of filesAndChanges:", [filesAndChanges[0][0], filesAndChanges[0][3]]);
    printWithColor("The 2nd element of filesAndChanges:", [filesAndChanges[1][0], filesAndChanges[1][3]]);
  }

  /********************************************************************************************************************
  5. Update the in progress statsMsg to the beginning of the summarize comment (usually the first comment after the PR description).
  ********************************************************************************************************************/

  let statusMsg = generateStatusMsg(highestReviewedCommitId, filesAndChanges, filterIgnoredFiles);
  await updateSummarizeCmtWithInProgressStatusMsg(existingSummarizeCmtBody, statusMsg, commenter);

  /********************************************************************************************************************
  6. 
  ********************************************************************************************************************/

  const summariesFailed: string[] = [];

  const summaryPromises = [];
  const skippedFiles = [];
  for (const [filename, fileContent, fileDiff] of filesAndChanges) {
    if (options.maxFiles <= 0 || summaryPromises.length < options.maxFiles) {
      // 这行代码的主要作用是将一个异步总结操作添加到 summaryPromises 数组中，同时通过 bedrockConcurrencyLimit 函数来限制并发执行的数量。
      summaryPromises.push(
        bedrockConcurrencyLimit(async () => await doSummary(filename, fileContent, fileDiff, inputs, prompts, options, lightBot, summariesFailed))
      );
    } else {
      skippedFiles.push(filename);
    }
  }

  // 这行代码的主要作用是等待所有的总结操作完成，并将成功的总结结果收集到 summaries 数组中，同时过滤掉那些返回 null 的结果（即总结失败或被跳过的文件）。
  // 得到的结果是一个数组，包含每个 doSummary 调用的返回值（[string, string, boolean] 或 null）。
  // 过滤掉数组中所有 null 值，只保留有效的总结结果。
  printWithColor("summaryPromises", summaryPromises);
  const summaries = (await Promise.all(summaryPromises)).filter((summary) => summary !== null) as Array<[string, string, boolean]>;
  printWithColor("summaries (at the end of all Promise)", summaries);
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
