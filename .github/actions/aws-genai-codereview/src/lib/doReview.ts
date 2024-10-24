import { error, info, warning } from "@actions/core";
import { context as github_context } from "@actions/github";
import { printWithColor, sanitizeJsonString } from "../utils";
import { getTokenCount } from "../tokenizer";
import { type Options } from "../options";
import { type Prompts } from "../prompts";
import { type Bot } from "../bot";
import { Inputs } from "../inputs";
import { Commenter, COMMENT_REPLY_TAG } from "../commenter";

export interface ReviewContext {
  inputs: Inputs;
  prompts: Prompts;
  options: Options;
  commenter: Commenter;
  heavyBot: Bot;
  lgtmCount: { value: number };
  reviewCount: { value: number };
  reviewsFailed: string[];
  reviewsSkipped: string[];
}

export interface Review {
  startLine: number;
  endLine: number;
  comment: string;
  lgtm?: boolean;
}

/***********************************
 * Function: doReview()
 ***********************************/
export const doReview = async (
  filename: string,
  fileContent: string,
  patches: Array<[number, number, string, string]>,
  reviewContext: ReviewContext
): Promise<void> => {
  const { inputs, prompts, options, commenter, heavyBot } = reviewContext;
  const context = github_context;

  printWithColor("Do code review on hunks for each file...");
  console.log(`\n\x1b[36m%s\x1b[0m`, `Start reviewing: ${filename} <doSummary.ts>`);

  // make a copy of inputs
  const ins: Inputs = inputs.clone();
  ins.filename = filename;
  ins.fileContent = fileContent;

  if (options.fileDiffFormatInPrompt !== "hunk_pairs") {
    if (options.fileDiffFormatInPrompt !== "standard_diff_block") {
      warning(`Unknown fileDiffFormatInPrompt: ${options.fileDiffFormatInPrompt}, using standard_diff_block instead.`);
    }

    // calculate tokens based on inputs so far
    let tokens = getTokenCount(prompts.renderReviewFileDiffUsingStandardDiffBlock(ins));

    // loop to calculate total patch tokens ($token), and # ($patchesToPack) of patches CAN be packed into this LLM request
    let patchesToPack = 0; // the number of patches being packed into this LLM request
    for (const [, , , standardDiffFormat] of patches) {
      const patchTokens = getTokenCount(standardDiffFormat);
      if (tokens + patchTokens > options.heavyTokenLimits.requestTokens) {
        info(`only packing ${patchesToPack} / ${patches.length} patches, tokens: ${tokens} / ${options.heavyTokenLimits.requestTokens}`);
        break;
      }
      tokens += patchTokens;
      patchesToPack += 1;
    }

    let patchesPacked = 0;
    for (const [startLine, endLine, hunksStr, standardDiffFormat] of patches) {
      if (context.payload.pull_request == null) {
        warning("No pull request found, skipping.");
        continue;
      }

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
        warning(`Failed to get comments: ${e}, skipping. backtrace: ${e.stack}`);
      }

      const commentChainTokens = getTokenCount(commentChain);
      if (tokens + commentChainTokens > options.heavyTokenLimits.requestTokens) {
        commentChain = "";
      } else {
        tokens += commentChainTokens;
      }

      if (commentChain !== "") {
        ins.patches += `\n
Review the following code diff in the file "${filename}". Git diff to review:

  ${standardDiffFormat}

  <comment_chains>
\`\`\`
${commentChain}
\`\`\`
</comment_chains>`;
      } else {
        ins.patches += `\n
Review the following code diff in the file "${filename}". Git diff to review:

  ${standardDiffFormat}`;
      }
    }

    /* patchesPacked > 0 means you have fileDiff to review */
    if (patchesPacked > 0) {
      try {
        /**
       The prefix being `{` serves as a prompt for the large language model to start its response with this character. It indicates to the model that the generated content should follow a JSON structure.
        */
        const promptOfRenderReviewFileDiff = prompts.renderReviewFileDiffUsingStandardDiffBlock(ins);
        printWithColor("prompt of renderReviewFileDiff", promptOfRenderReviewFileDiff);
        const [response] = await heavyBot.chat(promptOfRenderReviewFileDiff, "{");
        if (response === "") {
          info("review: nothing obtained from bedrock");
          reviewContext.reviewsFailed.push(`${filename} (no response)`);
          return;
        }

        console.log(`\n\x1b[36m%s\x1b[0m`, `response (from LLM) for ${filename}: \n`);
        console.log(response);
        const reviews = parseReview(response, patches);
        console.log(`\n\x1b[36m%s\x1b[0m`, `reviews (parsed from LLM response) for ${filename}: \n`);
        console.log(reviews);

        // 如果 reviews 数组为空，那么 for...of 循环将不会执行
        for (const review of reviews) {
          console.log("options.reviewCommentLGTM:", options.reviewCommentLGTM);
          // if (!options.reviewCommentLGTM && (review.comment.includes("LGTM") || review.comment.includes("looks good to me"))) {
          if (!options.reviewCommentLGTM && Boolean(review.lgtm) === true) {
            reviewContext.lgtmCount.value += 1;
            console.log(`\n\x1b[36m%s\x1b[0m`, `lgtm Count for ${filename}: ${reviewContext.lgtmCount.value}\n`);
            continue;
          }
          if (context.payload.pull_request == null) {
            warning("No pull request found, skipping.");
            continue;
          }

          try {
            reviewContext.reviewCount.value += 1;
            await commenter.bufferReviewComment(filename, review.startLine, review.endLine, `**${options.botName}** ${options.botIcon}: ${review.comment}`);
          } catch (e: any) {
            reviewContext.reviewsFailed.push(`${filename} comment failed (${e})`);
          }
        }
      } catch (e: any) {
        warning(`Failed to review: ${e}, skipping. backtrace: ${e.stack}`);
        reviewContext.reviewsFailed.push(`${filename} (${e})`);
      }
    } else {
      reviewContext.reviewsSkipped.push(`${filename} (diff too large)`);
    }
  } else {
    // calculate tokens based on inputs so far
    let tokens = getTokenCount(prompts.renderReviewFileDiff(ins));

    // loop to calculate total patch tokens ($token), and # ($patchesToPack) of patches CAN be packed into this LLM request
    let patchesToPack = 0; // the number of patches being packed into this LLM request
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
        warning(`Failed to get comments: ${e}, skipping. backtrace: ${e.stack}`);
      }

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

    /* patchesPacked > 0 means you have fileDiff to review */
    if (patchesPacked > 0) {
      try {
        /**
       The prefix being `{` serves as a prompt for the large language model to start its response with this character. It indicates to the model that the generated content should follow a JSON structure.
        */
        const promptOfRenderReviewFileDiff = prompts.renderReviewFileDiff(ins);
        printWithColor("prompt of renderReviewFileDiff", promptOfRenderReviewFileDiff);
        const [response] = await heavyBot.chat(promptOfRenderReviewFileDiff, "{");
        if (response === "") {
          info("review: nothing obtained from bedrock");
          reviewContext.reviewsFailed.push(`${filename} (no response)`);
          return;
        }

        console.log(`\n\x1b[36m%s\x1b[0m`, `response (from LLM) for ${filename}: \n`);
        console.log(response);
        const reviews = parseReview(response, patches);
        console.log(`\n\x1b[36m%s\x1b[0m`, `reviews (parsed from LLM response) for ${filename}: \n`);
        console.log(reviews);

        // 如果 reviews 数组为空，那么 for...of 循环将不会执行
        for (const review of reviews) {
          console.log("options.reviewCommentLGTM:", options.reviewCommentLGTM);
          // if (!options.reviewCommentLGTM && (review.comment.includes("LGTM") || review.comment.includes("looks good to me"))) {
          if (!options.reviewCommentLGTM && Boolean(review.lgtm) === true) {
            reviewContext.lgtmCount.value += 1;
            console.log(`\n\x1b[36m%s\x1b[0m`, `lgtm Count for ${filename}: ${reviewContext.lgtmCount.value}\n`);
            continue;
          }
          if (context.payload.pull_request == null) {
            warning("No pull request found, skipping.");
            continue;
          }

          try {
            reviewContext.reviewCount.value += 1;
            await commenter.bufferReviewComment(filename, review.startLine, review.endLine, `**${options.botName}** ${options.botIcon}: ${review.comment}`);
          } catch (e: any) {
            reviewContext.reviewsFailed.push(`${filename} comment failed (${e})`);
          }
        }
      } catch (e: any) {
        warning(`Failed to review: ${e}, skipping. backtrace: ${e.stack}`);
        reviewContext.reviewsFailed.push(`${filename} (${e})`);
      }
    } else {
      reviewContext.reviewsSkipped.push(`${filename} (diff too large)`);
    }
  }
};

/***********************************
 * Helper function: parseReview()
 ***********************************/
function parseReview(response: string, patches: Array<[number, number, string, string]>): Review[] {
  const reviews: Review[] = [];

  try {
    const res = sanitizeJsonString(response);
    const parsedResponse = JSON.parse(res);
    const rawReviews = parsedResponse.reviews;
    for (const r of rawReviews) {
      // 判断条件：如果 r.lgtm 为 false 且 r.comment 是空字符串/null/undefined，则跳过
      console.log(r);
      if (Boolean(r.lgtm) === false && !r.comment) {
        continue;
      }
      reviews.push({
        startLine: r.line_start ?? 0,
        endLine: r.line_end ?? 0,
        comment: r.comment || "", // 确保 comment 至少是空字符串
        lgtm: r.lgtm ?? false, // 确保 lgtm 字段存在
      });
    }
  } catch (e: any) {
    error(e.message);
    return [];
  }

  return reviews;
}
