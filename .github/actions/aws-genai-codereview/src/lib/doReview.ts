import { error, info, warning } from "@actions/core";
import { context as github_context } from "@actions/github";
import { printWithColor } from "../utils";
import { getTokenCount } from "../tokenizer";
import { type Options } from "../options";
import { type Prompts } from "../prompts";
import { type Bot } from "../bot";
import { Inputs } from "../inputs";
import { type Review } from "../lib";
import { Commenter, COMMENT_REPLY_TAG } from "../commenter";

export interface ReviewContext {
  inputs: Inputs;
  prompts: Prompts;
  options: Options;
  commenter: Commenter;
  heavyBot: Bot;
  lgtmCount: number;
  reviewCount: number;
  reviewsFailed: string[];
  reviewsSkipped: string[];
}

/***********************************
 * Function: doReview()
 ***********************************/
export const doReview = async (
  filename: string,
  fileContent: string,
  patches: Array<[number, number, string]>,
  reviewContext: ReviewContext
): Promise<void> => {
  const { inputs, prompts, options, commenter, heavyBot } = reviewContext;
  const context = github_context;

  console.log(`\n\x1b[36m%s\x1b[0m`, `Start summarizing: ${filename} <doSummary.ts>`);

  // make a copy of inputs
  const ins: Inputs = inputs.clone();
  ins.filename = filename;

  // calculate tokens based on inputs so far
  let tokens = getTokenCount(prompts.renderReviewFileDiff(ins));

  // loop to calculate total patch tokens ($token), and # ($patchesToPack) of patches can be packed into this LLM request
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
      const [response] = await heavyBot.chat(prompts.renderReviewFileDiff(ins), "{");
      if (response === "") {
        info("review: nothing obtained from bedrock");
        reviewContext.reviewsFailed.push(`${filename} (no response)`);
        return;
      }

      const reviews = parseReview(response, patches);
      printWithColor("response (from LLM)", response);
      console.log(`\n\x1b[36m%s\x1b[0m`, `reviews (parsed from LLM response) for ${filename}: \n`);
      console.log(reviews);

      for (const review of reviews) {
        if (!options.reviewCommentLGTM && (review.comment.includes("LGTM") || review.comment.includes("looks good to me"))) {
          reviewContext.lgtmCount += 1;
          continue;
        }
        if (context.payload.pull_request == null) {
          warning("No pull request found, skipping.");
          continue;
        }

        try {
          reviewContext.reviewCount += 1;
          await commenter.bufferReviewComment(filename, review.startLine, review.endLine, `${review.comment}`);
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
};

/***********************************
 * Helper function: parseReview()
 ***********************************/
function parseReview(response: string, patches: Array<[number, number, string]>): Review[] {
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