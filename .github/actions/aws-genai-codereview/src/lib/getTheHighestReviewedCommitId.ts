import { info } from "@actions/core";
import { Commenter } from "../commenter";
import { printWithColor } from "../utils";

/**
 * Finds and returns the highest reviewed commit ID. If none found, it defaults to the base commit of the pull request.
 *
 * @param commenter - Instance of Commenter used to interact with the comments and commits.
 * @param existingCommitIdsBlock - The block of commit IDs that have already been reviewed, extracted from the summarize comment.
 * @param pullRequestBaseSha - The base commit SHA of the pull request.
 * @param pullRequestHeadSha - The head commit SHA of the pull request.
 * @returns The highest reviewed commit ID, or the base commit SHA if no reviewed commit is found.
 */
export async function getTheHighestReviewedCommitId(
  commenter: Commenter,
  existingCommitIdsBlock: string,
  pullRequestBaseSha: string,
  pullRequestHeadSha: string
): Promise<string> {
  const allCommitIds = await commenter.getAllCommitIds();
  printWithColor("allCommitIds", allCommitIds);

  let highestReviewedCommitId = "";

  if (existingCommitIdsBlock !== "") {
    highestReviewedCommitId = commenter.getHighestReviewedCommitId(allCommitIds, commenter.getReviewedCommitIds(existingCommitIdsBlock));
  }

  /*
  条件 highestReviewedCommitId === context.payload.pull_request.head.sha 的情况实际上是非常少见的，通常只会出现在以下特殊情况之一：

  当前最新 commit 已经被审查过：这种情况会发生在 上一次审查的 commit 刚好就是最新的 head commit 时。例如，如果上次审查记录的 commit 就是当前 PR 的最新 commit，那么 highestReviewedCommitId 和 head.sha 会相等。这种情况下，意味着没有新的变更需要审查，因为最新的提交已经审查过了。

  所有 commit 已被逐一审查完：如果团队每次推送新的 commit 后都会立即审查，那么最后一次审查记录会跟 head commit 保持一致。这种情况也会触发 highestReviewedCommitId === context.payload.pull_request.head.sha 条件，表示 PR 中所有代码都已经被审查，当前没有待审查的新增代码。
  */

  if (highestReviewedCommitId === "" || highestReviewedCommitId === pullRequestHeadSha) {
    info(`Will review from the base commit: ${pullRequestBaseSha}`);
    return pullRequestBaseSha;
  } else {
    info(`Will review from commit: ${highestReviewedCommitId}`);
    return highestReviewedCommitId;
  }
}
