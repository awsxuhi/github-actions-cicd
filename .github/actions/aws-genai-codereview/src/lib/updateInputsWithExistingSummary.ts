import { Commenter, SUMMARIZE_TAG } from "../commenter";
import { Inputs } from "../inputs";
import { printWithColor } from "../utils";

/**
 * Updates the `inputs` object with summary data extracted from an existing comment that contains the SUMMARIZE_TAG.
 *
 * @param commenter - Instance of Commenter used to interact with the comments.
 * @param inputs - The Inputs object that stores data for code review and summary generation.
 * @param pullRequestNumber - The pull request number to search for the summarize comment.
 * @returns The block of commit IDs extracted from the existing summarize comment, or an empty string if not found.
 */
export async function updateInputsWithExistingSummary(
  commenter: Commenter,
  inputs: Inputs,
  pullRequestNumber: number
): Promise<{ existingSummarizeCmtBody: string; existingCommitIdsBlock: string }> {
  // get SUMMARIZE_TAG message
  const existingSummarizeCmt = await commenter.findCommentWithTag(SUMMARIZE_TAG, pullRequestNumber);
  let existingCommitIdsBlock = "";
  let existingSummarizeCmtBody = "";

  if (existingSummarizeCmt != null) {
    existingSummarizeCmtBody = existingSummarizeCmt.body;
    printWithColor(
      "existingSummarizeCmtBody = existingSummarizeCmt.body (like allComments[0].body, but it's the comment having SUMMARIZE_TAG)",
      existingSummarizeCmtBody
    );
    inputs.rawSummary = commenter.getRawSummary(existingSummarizeCmtBody);
    inputs.shortSummary = commenter.getShortSummary(existingSummarizeCmtBody);
    existingCommitIdsBlock = commenter.getReviewedCommitIdsBlock(existingSummarizeCmtBody);
  }

  return { existingSummarizeCmtBody, existingCommitIdsBlock };
}
