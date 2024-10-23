import { info, warning } from "@actions/core";
import { context as github_context } from "@actions/github";
import pLimit from "p-limit";
import { type Bot } from "./bot";
import { Commenter, RAW_SUMMARY_END_TAG, RAW_SUMMARY_START_TAG, SHORT_SUMMARY_END_TAG, SHORT_SUMMARY_START_TAG, SUMMARIZE_TAG } from "./commenter";
import { Inputs } from "./inputs";
import { type Options } from "./options";
import { type Prompts } from "./prompts";
import { printWithColor, debugPrintCommitSha } from "./utils";
import {
  type ReviewContext,
  getPullRequestDescription,
  updateInputsWithExistingSummary,
  getTheHighestReviewedCommitId,
  getFilesForReviewAfterTheHighestReviewedCommitId,
  filterFilesForReview,
  findLatestReviewedCommit,
  getFilesWithHunksArray,
  updateSummarizeCmtWithInProgressStatusMsg,
  generateStatusMsg,
  doSummary,
  doReview,
  updateStatusMsg,
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

  const [hasExistingReview, highestReviewedCommitId_2ndApproach] = await findLatestReviewedCommit(
    repo.owner,
    repo.repo,
    context.payload.pull_request.number,
    `**${options.botName}**`,
    context.payload.pull_request.head.sha
  );
  printWithColor("hasExistingReview", hasExistingReview);
  printWithColor("highestReviewedCommitId_2ndApproach", highestReviewedCommitId_2ndApproach);

  await debugPrintCommitSha(
    context.payload.pull_request.base.sha,
    context.payload.pull_request.head.sha,
    highestReviewedCommitId,
    context.payload.before,
    context.payload.after // It's undefined when it's the first time the pull request was created
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
    printWithColor("commits (=incrementalDiff.data.commits):", commits);
    console.log(
      `\n\x1b[36m%s\x1b[0m`,
      `List all elements of commits Array (total ${commits.length} elements since last review, usually=context.payload.pull_request.head.sha):`
    );
    commits.forEach((commit) => {
      console.log(`${commit.sha}\n`);
    });
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
    printWithColor("filesAndChanges has only one element:", [filesAndChanges[0][0], filesAndChanges[0][3]], 2);
  } else {
    printWithColor("The 1st element of filesAndChanges:", [filesAndChanges[0][0], filesAndChanges[0][3]], 2);
    printWithColor("The 2nd element of filesAndChanges:", [filesAndChanges[1][0], filesAndChanges[1][3]], 2);
  }

  /********************************************************************************************************************
  5. Update the in progress statsMsg to the beginning of the summarize comment (usually the first comment after the PR description).
  ********************************************************************************************************************/

  let statusMsg = generateStatusMsg(highestReviewedCommitId, filesAndChanges, filterIgnoredFiles, options);
  await updateSummarizeCmtWithInProgressStatusMsg(existingSummarizeCmtBody, statusMsg, commenter);

  /********************************************************************************************************************
  6. Generate the summary for each file, final summary, final releaseNotes, short summary, and update summarizeComment
  ********************************************************************************************************************/

  const summariesFailed: string[] = [];

  const summaryPromises = [];
  const skippedFiles = [];
  for (const [filename, fileContent, fileDiff] of filesAndChanges) {
    if (options.maxFiles <= 0 || summaryPromises.length < options.maxFiles) {
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
  printWithColor("[Important] summaries Array for all files (Array<[filename, summary, needsReview=true/false]>)", summaries, 2);
  /*
  经过过滤后，summaries 将变为：
      [
        ["file1.js", "Summary of file1", true],
        ["file2.js", "Summary of file2", false],
        ["file3.js", "Summary of file3", true]
      ]
  */

  printWithColor("inputs.rawSummary (1. initial value):", inputs.rawSummary);
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
      printWithColor("inputs.rawSummary (2. new value)", inputs.rawSummary);
      console.log(`\n\x1b[36m%s\x1b[0m`, `++++++ end of inputs.rawSummary (new value) ++++++`);
      // ask Bedrock to summarize the summaries
      const [summarizeResp] = await heavyBot.chat(prompts.renderSummarizeChangesets(inputs));
      if (summarizeResp === "") {
        warning("summarize: nothing obtained from bedrock");
      } else {
        inputs.rawSummary = summarizeResp;
        printWithColor("inputs.rawSummary (3. final value with response from Bedrock)", inputs.rawSummary);
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

  // update summarize comment with more TAG components
  let summarizeComment = `${summarizeFinalResponse}
${RAW_SUMMARY_START_TAG}
${inputs.rawSummary}
${RAW_SUMMARY_END_TAG}
${SHORT_SUMMARY_START_TAG}
${inputs.shortSummary}
${SHORT_SUMMARY_END_TAG}
`;

  /********************************************************************************************************************
  7. Do codereview for each hunk of each file, and update the status message, then post the reviews
  ********************************************************************************************************************/

  if (!options.disableReview) {
    // Step 1: Use the filter method to select the files that need to be reviewed from filesAndChanges.
    /* This is done by searching for matching entries in summaries based on the filename. You then check the third item ([2]) of the matching entry to decide whether a review is required. If no matching entry is found, it is assumed that the file needs review (true by default).
     */
    const filesAndChangesReview = filesAndChanges.filter(([filename]) => {
      const needsReview = summaries.find(([summaryFilename]) => summaryFilename === filename)?.[2] ?? true;
      return needsReview;
    });

    // Step 2: Generate a list of files that were skipped from review.
    /* Use the filter method to select files that are not included in filesAndChangesReview, and return their filenames.
     */
    const reviewsSkipped = filesAndChanges
      .filter(([filename]) => !filesAndChangesReview.some(([reviewFilename]) => reviewFilename === filename))
      .map(([filename]) => filename);

    // Step 3: Initialize an array for files that fail the review, which will store the files that fail during the large language model's code review process. Begin executing the code review.
    /* Use lgtmCount and reviewCount to track the number of files that have passed the review and the total number of files reviewed, respectively. The total number of successfully reviewed files is calculated as lgtmCount + reviewCount.
     */
    const reviewsFailed: string[] = [];
    let lgtmCount = 0;
    let reviewCount = 0;

    const reviewContext: ReviewContext = {
      inputs,
      prompts,
      options,
      commenter,
      heavyBot,
      lgtmCount,
      reviewCount,
      reviewsFailed,
      reviewsSkipped,
    };
    const reviewPromises = [];
    for (const [filename, fileContent, , patches] of filesAndChangesReview) {
      if (options.maxFiles <= 0 || reviewPromises.length < options.maxFiles) {
        reviewPromises.push(
          bedrockConcurrencyLimit(async () => {
            await doReview(filename, fileContent, patches, reviewContext);
          })
        );
      } else {
        skippedFiles.push(filename);
      }
    }

    await Promise.all(reviewPromises);

    // update the status message which will be posted later on.
    statusMsg = updateStatusMsg(
      statusMsg, // the initial value of statusMsg
      skippedFiles, // 全局变量，包含被跳过的文件列表
      summariesFailed, // 全局变量，包含摘要失败的文件列表
      reviewsFailed, // 全局变量，包含审查失败的文件列表
      reviewsSkipped, // 全局变量，包含被跳过的文件列表（因微小变动）
      reviewCount, // 全局变量，包含已生成的审查评论数量
      lgtmCount // 全局变量，包含 LGTM 数量
    );
    // add existing_comment_ids_block with latest head sha
    summarizeComment += `\n${commenter.addReviewedCommitId(existingCommitIdsBlock, context.payload.pull_request.head.sha)}`;

    // post the review - createReview() at commit level
    await commenter.submitReview(context.payload.pull_request.number, commits[commits.length - 1].sha, statusMsg);

    // for debugging purpose
    console.log(
      `\n\x1b[36m%s\x1b[0m`,
      `I believe context.payload.pull_request.head.sha ${context.payload.pull_request.head.sha} equals to commits[commits.length - 1].sha ${
        commits[commits.length - 1].sha
      }`
    );
  }

  /********************************************************************************************************************
  8. Replace the summarizeComment with the commitIds appended and post it to the pull request
  ********************************************************************************************************************/
  // post the final summary comment
  await commenter.comment(`${summarizeComment}`, SUMMARIZE_TAG, "replace");
};
