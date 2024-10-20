import { Commenter, SUMMARIZE_TAG } from "../commenter";
import { printWithColor } from "../utils";
import { context as github_context } from "@actions/github";

/**
 * Updates the summary comment with an in-progress status message.
 *
 * @param existingSummarizeCmtBody - The existing comment body.
 * @param statusMsg - The status message to update the comment with.
 * @param commenter - The Commenter instance used to interact with comments.
 */
export async function updateSummarizeCmtWithInProgressStatusMsg(existingSummarizeCmtBody: string, statusMsg: string, commenter: Commenter): Promise<void> {
  const context = github_context;

  // printWithColor("existingSummarizeCmtBody", existingSummarizeCmtBody);
  const inProgressSummarizeCmt = commenter.addInProgressStatus(existingSummarizeCmtBody, statusMsg);
  printWithColor("[Important] inProgressSummarizeCmt = statusMsg + existingSummarizeCmtBody)", inProgressSummarizeCmt);

  // replace the current SummarizeCmt with inProgress statusMsg
  await commenter.comment(`${inProgressSummarizeCmt}`, SUMMARIZE_TAG, "replace");
}

/* inProgressSummarizeCmt has the following structure: (ref: doc/InProgressSummarizeComment.md)

  <!-- This is an auto-generated comment: summarize review in progress by AI reviewer -->

      Currently reviewing new changes in this PR...

  <!-- end of auto-generated comment: summarize review in progress by AI reviewer -->

## Walkthrough

## Changes

  <!-- This is an auto-generated comment: raw summary by AI reviewer -->

      <!--
          <changeSet>
          </changeSet>
      -->

  <!-- end of auto-generated comment: raw summary by AI reviewer -->
  <!-- This is an auto-generated comment: short summary by AI reviewer -->

      <!--
          Here is a concise summary of the changes in this pull request:
          <summary>
          </summary>
      -->

  <!-- end of auto-generated comment: short summary by AI reviewer -->

  <!-- commit_ids_reviewed_start -->

      <!-- 325957a573f9005704076cea034395f970c67548 -->
      <!-- d2161820d9724e5d7427019ba26f6e657e1d1d73 -->

  <!-- commit_ids_reviewed_end -->

  <!-- This is an auto-generated comment: summarize by AI reviewer -->
  */
