import { info, warning } from "@actions/core";
// eslint-disable-next-line camelcase
import { context as github_context } from "@actions/github";
import { octokit } from "./octokit";
import { printWithColor } from "@/utils";

// eslint-disable-next-line camelcase
const context = github_context;
const repo = context.repo;

export const COMMENT_GREETING = ""; //`${getInput('bot_icon')}`

export const COMMENT_TAG = "<!-- This is an auto-generated comment by AI reviewer -->";

export const COMMENT_REPLY_TAG = "<!-- This is an auto-generated reply by AI reviewer -->";

export const SUMMARIZE_TAG = "<!-- This is an auto-generated comment: summarize by AI reviewer -->";

export const IN_PROGRESS_START_TAG = "<!-- This is an auto-generated comment: summarize review in progress by AI reviewer -->";
export const IN_PROGRESS_END_TAG = "<!-- end of auto-generated comment: summarize review in progress by AI reviewer -->";

export const DESCRIPTION_START_TAG = "<!-- This is an auto-generated comment: release notes by AI reviewer -->";
export const DESCRIPTION_END_TAG = "<!-- end of auto-generated comment: release notes by AI reviewer -->";

export const RAW_SUMMARY_START_TAG = `<!-- This is an auto-generated comment: raw summary by AI reviewer -->
<!--
`;
export const RAW_SUMMARY_END_TAG = `-->
<!-- end of auto-generated comment: raw summary by AI reviewer -->`;

export const SHORT_SUMMARY_START_TAG = `<!-- This is an auto-generated comment: short summary by AI reviewer -->
<!--
`;

export const SHORT_SUMMARY_END_TAG = `-->
<!-- end of auto-generated comment: short summary by AI reviewer -->`;

export const COMMIT_ID_START_TAG = "<!-- commit_ids_reviewed_start -->";
export const COMMIT_ID_END_TAG = "<!-- commit_ids_reviewed_end -->";

const SELF_LOGIN = "github-actions[bot]";

export class Commenter {
  /**
   * @param mode - Can be "create", "replace". Default is "replace".
   */
  async comment(message: string, tag: string, mode: string) {
    let target: number;
    if (context.payload.pull_request != null) {
      target = context.payload.pull_request.number;
    } else if (context.payload.issue != null) {
      target = context.payload.issue.number;
    } else {
      warning("Skipped: context.payload.pull_request and context.payload.issue are both null");
      return;
    }
    printWithColor("target (Pull request number OR Issue number", target);

    if (!tag) {
      tag = COMMENT_TAG;
    }
    printWithColor("tag", tag);

    const body = `${COMMENT_GREETING}

${message}

${tag}`;

    if (mode === "create") {
      await this.create(body, target);
    } else if (mode === "replace") {
      await this.replace(body, tag, target);
    } else {
      warning(`Unknown mode: ${mode}, use "replace" instead`);
      await this.replace(body, tag, target);
    }
  }

  getContentWithinTags(content: string, startTag: string, endTag: string) {
    const start = content.indexOf(startTag);
    const end = content.indexOf(endTag);
    if (start >= 0 && end >= 0) {
      return content.slice(start + startTag.length, end);
    }
    return "";
  }

  removeContentWithinTags(content: string, startTag: string, endTag: string) {
    const start = content.indexOf(startTag);
    const end = content.lastIndexOf(endTag);
    if (start >= 0 && end >= 0) {
      return content.slice(0, start) + content.slice(end + endTag.length);
    }
    return content;
  }

  getRawSummary(summary: string) {
    return this.getContentWithinTags(summary, RAW_SUMMARY_START_TAG, RAW_SUMMARY_END_TAG);
  }

  getShortSummary(summary: string) {
    return this.getContentWithinTags(summary, SHORT_SUMMARY_START_TAG, SHORT_SUMMARY_END_TAG);
  }

  getDescription(description: string) {
    return this.removeContentWithinTags(description, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG);
  }

  getReleaseNotes(description: string) {
    const releaseNotes = this.getContentWithinTags(description, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG);
    return releaseNotes.replace(/(^|\n)> .*/g, "");
    /**
这段代码的作用是从 releaseNotes 字符串中删除所有以 > 开头的行。具体地解释正则表达式 的含义：

^：表示行的开头。
\n：表示换行符。
(^|\n)：匹配行的开头或者换行符（即可以匹配字符串的开头或任何一行的开头）。
>：匹配 > 字符，通常用于引用块（例如在 Markdown 中，> 表示引用）。
.*：匹配任意数量的字符，表示引用块之后的所有内容。
/g：全局匹配标志，表示替换字符串中所有符合该正则表达式的部分，而不是仅替换第一个。
因此，这个正则表达式会匹配所有以 > 开头的行（包括引用标记 > 后的内容），并将这些行替换为空字符串 ""，即删除它们。换句话说，这段代码的作用是删除 releaseNotes 中所有的引用块行。
     */
  }

  async updateDescription(pullNumber: number, message: string) {
    // add this response to the description field of the PR as release notes by looking
    // for the tag (marker)
    try {
      // get latest description from PR
      const pr = await octokit.pulls.get({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber,
      });
      let body = "";
      if (pr.data.body) {
        body = pr.data.body;
      }
      const description = this.getDescription(body);

      const messageClean = this.removeContentWithinTags(message, DESCRIPTION_START_TAG, DESCRIPTION_END_TAG);
      const newDescription = `${description}\n${DESCRIPTION_START_TAG}\n${messageClean}\n${DESCRIPTION_END_TAG}`;
      await octokit.pulls.update({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber,
        body: newDescription,
      });
    } catch (e) {
      warning(`Failed to get PR: ${e}, skipping adding release notes to description.`);
    }
  }

  private readonly reviewCommentsBuffer: Array<{
    path: string;
    startLine: number;
    endLine: number;
    message: string;
  }> = [];

  async bufferReviewComment(path: string, startLine: number, endLine: number, message: string) {
    message = `${COMMENT_GREETING}

${message}

${COMMENT_TAG}`;
    this.reviewCommentsBuffer.push({
      path,
      startLine,
      endLine,
      message,
    });
  }

  async deletePendingReview(pullNumber: number) {
    try {
      const reviews = await octokit.pulls.listReviews({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber,
      });

      /*
      在 GitHub 的 Pull Request API 中，review 的 state 可以是以下几种状态之一：

      COMMENTED：表示 review 已提交，其中包含评论，但没有任何正式的“批准”或“变更请求”。
      APPROVED：表示 review 已提交，并且审阅者批准了 Pull Request。
      CHANGES_REQUESTED：表示 review 已提交，并且审阅者请求进行更改。
      PENDING：表示 review 尚未提交，审阅者可能正在编写评论或修改 review，但尚未提交完成。
      在什么情况下 state 为 PENDING？

      PENDING 状态通常在以下情况下出现：

      当审阅者开始创建一个 review，但尚未提交时，GitHub 会将该 review 标记为 PENDING。这通常意味着审阅者可能在创建评论时选择了“保存但不提交”。
      例如，您可以在 GitHub 的 UI 中开始撰写 review 评论，但在完成之前选择离开或切换到其他页面，这时 review 会保持为 PENDING 状态。
      因此，不是所有有 diff 的 review 都是 PENDING 的。PENDING 状态的 review 仅在审阅者创建了评论但还未提交 review 时出现。
      */
      const pendingReview = reviews.data.find((review: { state: string }) => review.state === "PENDING");

      if (pendingReview) {
        info(`Deleting pending review for PR #${pullNumber} id: ${pendingReview.id}`);
        try {
          await octokit.pulls.deletePendingReview({
            owner: repo.owner,
            repo: repo.repo,
            // eslint-disable-next-line camelcase
            pull_number: pullNumber,
            // eslint-disable-next-line camelcase
            review_id: pendingReview.id,
          });
        } catch (e) {
          warning(`Failed to delete pending review: ${e}`);
        }
      }
    } catch (e) {
      warning(`Failed to list reviews: ${e}`);
    }
  }

  async submitReview(pullNumber: number, commitId: string, statusMsg: string) {
    const body = `${COMMENT_GREETING}

${statusMsg}
`;

    if (this.reviewCommentsBuffer.length === 0) {
      // Submit empty review with statusMsg
      // 如果原来没有comment，就直接新创建一个comment
      info(`Submitting empty review for PR #${pullNumber}`);
      try {
        await octokit.pulls.createReview({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          pull_number: pullNumber,
          // eslint-disable-next-line camelcase
          commit_id: commitId,
          event: "COMMENT",
          body,
        });
      } catch (e) {
        warning(`Failed to submit empty review: ${e}`);
      }
      return;
    }
    // 否则，原来针对同一个代码片段有comment，就需要先删除原来的comment，再增加一个新的
    // 这个for循环先删除老的comment
    /*
async getCommentsAtRange 的返回值是否总是单个元素的数组？ 是的，在实际情况下，返回值应该只有一个元素的数组，因为同一文件、相同的 startLine 和 endLine 不太可能有多个不同的评论。但为了保持代码的灵活性并避免潜在的 API 不一致（即意外的重复评论），这里还是使用了 for 循环去遍历所有匹配的评论。这种写法有助于处理极少数情况下的重复情况（例如，API 返回的数据中有重复项），确保每一个符合条件的评论都被处理。

每个 comment(就是下面代码中的c) 的结构通常包括：

id: 评论的唯一标识符
body: 评论内容
path: 文件路径
line: 单行评论时的行号
start_line（可选）: 多行评论的起始行号
in_reply_to_id（可选）: 若为回复评论，表示上层评论的 id
user: 用户信息对象，通常包含 login（用户登录名）等属性
    */
    for (const comment of this.reviewCommentsBuffer) {
      const comments = await this.getCommentsAtRange(pullNumber, comment.path, comment.startLine, comment.endLine);
      for (const c of comments) {
        if (c.body.includes(COMMENT_TAG)) {
          info(`Deleting review comment for ${comment.path}:${comment.startLine}-${comment.endLine}: ${comment.message}`);
          try {
            await octokit.pulls.deleteReviewComment({
              owner: repo.owner,
              repo: repo.repo,
              // eslint-disable-next-line camelcase
              comment_id: c.id,
            });
          } catch (e) {
            warning(`Failed to delete review comment: ${e}`);
          }
        }
      }
    }

    // submitReview 中执行 await this.deletePendingReview(pullNumber); 的目的是什么？ deletePendingReview 用来清除当前处于 PENDING 状态的审查。这种状态通常是因为上次审查时，用户保存了评论但未提交。提交新审查之前删除这些 PENDING 状态的审查，以避免出现未提交的旧评论。
    await this.deletePendingReview(pullNumber);

    // 接下来生成新的comment
    const generateCommentData = (comment: any) => {
      const commentData: any = {
        path: comment.path,
        body: comment.message,
        line: comment.endLine,
      };

      // comment.startLine === comment.endLine: 表示此评论仅针对一行代码，即单行评论而非多行评论。start_line 可选: 单行评论不需要 start_line 属性
      if (comment.startLine !== comment.endLine) {
        // eslint-disable-next-line camelcase
        commentData.start_line = comment.startLine;
        // eslint-disable-next-line camelcase
        commentData.start_side = "RIGHT"; // start_side = "RIGHT": 表示评论的侧边（即 diff 视图的右侧），表示评论针对合并后的代码变更。
      }

      return commentData;
    };

    try {
      /*
在 GitHub 的审查 API 中，createReview 和 submitReview 的确是两个不同的操作。

createReview: 创建一个新的审查请求对象并附带批量的评论数据，但这个操作只是将审查标记为 "待提交" (PENDING) 状态。这个操作等于在 GitHub 上保存了审查草稿，允许您在 PENDING 状态下进一步编辑评论，甚至添加更多评论，而不将审查立即公开到 PR 页面中。

submitReview: 将 PENDING 状态的审查真正提交到 PR 页面，使其正式生效并变成可见。只有在调用 submitReview 之后，GitHub 才会将整个审查视为已提交，并展示所有的批量评论给 PR 的参与者。

这样设计的原因是，GitHub 支持在审查正式提交之前进行多次评论的编辑和调整。最终的审查只有在调用 submitReview 后才会被完全公开。这就像在 GitHub UI 中开始一个审查、添加评论，然后选择“提交审查”的动作。

在代码中，createReview 是直接提交评论的关键操作。在 GitHub 的 API 中，当 createReview 被调用并设置 event 参数为 "COMMENT" 或 "APPROVE" 时，它会将所有评论发布到 PR 页面上，而不需要调用 submitReview。因此，在这里调用 createReview 后，评论已经提交，submitReview 不再必要。

原因可以总结如下：

createReview 的 event 参数：在调用 createReview 时，指定的 event 参数（例如 "COMMENT" 或 "APPROVE"）会决定评论是否立刻发布。使用 "COMMENT" 表示将评论作为一般反馈提交，而 "APPROVE" 则表示将评论作为批准审查的一部分提交。

直接发布评论：在这种情况下，createReview 已经将所有评论一次性提交并发布到 PR 页面。submitReview 通常只在需要将 PENDING 状态的审查转换为公开状态时才使用。在这段代码中，设置了 event，所以 GitHub API 已经将审查从 PENDING 状态发布到页面。

因此，如果 createReview 的 event 被指定为非 PENDING，该方法就会直接发布所有评论，不再需要调用 submitReview。
*/
      const review = await octokit.pulls.createReview({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber,
        // eslint-disable-next-line camelcase
        commit_id: commitId,
        comments: this.reviewCommentsBuffer.map((comment) => generateCommentData(comment)),
      });

      info(`Submitting review for PR #${pullNumber}, total comments: ${this.reviewCommentsBuffer.length}, review id: ${review.data.id}`);

      await octokit.pulls.submitReview({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber,
        // eslint-disable-next-line camelcase
        review_id: review.data.id,
        event: "COMMENT",
        body,
      });
    } catch (e) {
      warning(`Failed to create review: ${e}. Falling back to individual comments.`);
      await this.deletePendingReview(pullNumber);
      let commentCounter = 0;
      for (const comment of this.reviewCommentsBuffer) {
        info(`Creating new review comment for ${comment.path}:${comment.startLine}-${comment.endLine}: ${comment.message}`);
        const commentData: any = {
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          pull_number: pullNumber,
          // eslint-disable-next-line camelcase
          commit_id: commitId,
          ...generateCommentData(comment),
        };

        // createReviewComment(commentData) 是作为 createReview 的失败备选方案调用的。当 octokit.pulls.createReview 方法失败时（例如，网络错误或 API 速率限制），代码会执行 catch 中的逻辑，以防止整个审查流程中断。这样，即使无法批量创建评论（createReview），代码仍然会尝试逐条创建单独的评论，确保审查内容尽可能被添加。总体流程：首先尝试通过 createReview 批量创建一个审查以及所有评论。若失败，则进入 catch 块，逐条添加评论。
        /*createReview 和 createReviewComment 的区别
        createReview: 创建一个新的审查流程，用于在代码审查的整体框架内发布多个评论。可在审查的某个 commit_id 下附带多条评论，并最终将审查（review）整体提交。
        createReviewComment: 直接在特定的 PR 或文件中发布单条评论，而不需要将所有评论作为一个审查整体进行批量提交。这是 createReview 失败后的退路。
        */
        try {
          await octokit.pulls.createReviewComment(commentData);
        } catch (ee) {
          warning(`Failed to create review comment: ${ee}`);
        }

        commentCounter++;
        info(`Comment ${commentCounter}/${this.reviewCommentsBuffer.length} posted`);
      }
    }
  }

  async reviewCommentReply(pullNumber: number, topLevelComment: any, message: string) {
    const reply = `${COMMENT_GREETING}

${message}

${COMMENT_REPLY_TAG}
`;

    /*
在 reviewCommentReply 函数中，topLevelComment 指的是对代码块的最初评论，即该评论链的第一个评论。这个 topLevelComment 是该讨论的起点，它可能是某个用户（或自动化工具）针对代码块添加的评论，后续的所有回复都会链接到这个评论，以构成一个评论链。
*/
    try {
      // Post the reply to the user comment
      await octokit.pulls.createReplyForReviewComment({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        pull_number: pullNumber,
        body: reply,
        // eslint-disable-next-line camelcase
        comment_id: topLevelComment.id,
      });
    } catch (error) {
      warning(`Failed to reply to the top-level comment ${error}`);
      try {
        await octokit.pulls.createReplyForReviewComment({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          pull_number: pullNumber,
          body: `Could not post the reply to the top-level comment due to the following error: ${error}`,
          // eslint-disable-next-line camelcase
          comment_id: topLevelComment.id,
        });
      } catch (e) {
        warning(`Failed to reply to the top-level comment ${e}`);
      }
    }

    try {
      if (topLevelComment.body.includes(COMMENT_TAG)) {
        // replace COMMENT_TAG with COMMENT_REPLY_TAG in topLevelComment
        const newBody = topLevelComment.body.replace(COMMENT_TAG, COMMENT_REPLY_TAG);
        await octokit.pulls.updateReviewComment({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          comment_id: topLevelComment.id,
          body: newBody,
        });
      }
    } catch (error) {
      warning(`Failed to update the top-level comment ${error}`);
    }
  }

  async getCommentsWithinRange(pullNumber: number, path: string, startLine: number, endLine: number) {
    const comments = await this.listReviewComments(pullNumber);
    return comments.filter(
      (comment: any) =>
        comment.path === path &&
        comment.body !== "" &&
        ((comment.start_line !== undefined && comment.start_line >= startLine && comment.line <= endLine) ||
          (startLine === endLine && comment.line === endLine))
    );
  }

  async getCommentsAtRange(pullNumber: number, path: string, startLine: number, endLine: number) {
    const comments = await this.listReviewComments(pullNumber);
    return comments.filter(
      (comment: any) =>
        comment.path === path &&
        comment.body !== "" &&
        ((comment.start_line !== undefined && comment.start_line === startLine && comment.line === endLine) ||
          (startLine === endLine && comment.line === endLine))
    );
  }

  async getCommentChainsWithinRange(pullNumber: number, path: string, startLine: number, endLine: number, tag = "") {
    /**
     * GitHub 的 API 和 Octokit SDK 提供了一些获取评论的方法，例如：

listReviewComments: 获取 PR 的所有评论。
listComments: 获取 issue 或 PR 的所有非审查评论。
不过，GitHub API 没有直接支持获取特定代码行范围内的评论链的功能，尤其是无法直接按 path 和 line 范围检索或构建完整的评论链。为了实现类似的功能，需要：

使用 listReviewComments 或 listComments 获取 PR 中的所有评论。
自行筛选符合条件的评论（按 path 和 line 等属性）。
遍历评论链并构建对话结构。
     */
    const existingComments = await this.getCommentsWithinRange(pullNumber, path, startLine, endLine);
    // find all top most comments
    const topLevelComments = [];
    for (const comment of existingComments) {
      if (!comment.in_reply_to_id) {
        topLevelComments.push(comment);
      }
    }

    let allChains = "";
    let chainNum = 0;
    for (const topLevelComment of topLevelComments) {
      // get conversation chain
      const chain = await this.composeCommentChain(existingComments, topLevelComment);
      if (chain && chain.includes(tag)) {
        chainNum += 1;
        allChains += `Conversation Chain ${chainNum}:
${chain}
---
`;
      }
    }
    return allChains;
  }

  getRole(login: string) {
    if (login === SELF_LOGIN) return "\nA (You): ";
    return `\nH (@${login}):`;
  }

  async composeCommentChain(reviewComments: any[], topLevelComment: any) {
    const conversationChain = reviewComments
      .filter((cmt: any) => cmt.in_reply_to_id === topLevelComment.id)
      .map((cmt: any) => `${this.getRole(cmt.user.login)} ${cmt.body}`);

    conversationChain.unshift(`${this.getRole(topLevelComment.user.login)} ${topLevelComment.body}`);

    return `${conversationChain.join("\n")}`;
  }

  async getCommentChain(pullNumber: number, comment: any) {
    try {
      const reviewComments = await this.listReviewComments(pullNumber);
      const topLevelComment = await this.getTopLevelComment(reviewComments, comment);
      const chain = await this.composeCommentChain(reviewComments, topLevelComment);
      return { chain, topLevelComment };
    } catch (e) {
      warning(`Failed to get conversation chain: ${e}`);
      return {
        chain: "",
        topLevelComment: null,
      };
    }
  }

  async getTopLevelComment(reviewComments: any[], comment: any) {
    let topLevelComment = comment;

    while (topLevelComment.in_reply_to_id) {
      const parentComment = reviewComments.find((cmt: any) => cmt.id === topLevelComment.in_reply_to_id);

      if (parentComment) {
        topLevelComment = parentComment;
      } else {
        break;
      }
    }

    return topLevelComment;
  }

  private reviewCommentsCache: Record<number, any[]> = {};

  async listReviewComments(target: number) {
    if (this.reviewCommentsCache[target]) {
      return this.reviewCommentsCache[target];
    }

    const allComments: any[] = [];
    let page = 1;
    try {
      for (;;) {
        const { data: comments } = await octokit.pulls.listReviewComments({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          pull_number: target,
          page,
          // eslint-disable-next-line camelcase
          per_page: 100,
        });
        allComments.push(...comments);
        page++;
        if (!comments || comments.length < 100) {
          break;
        }
      }

      this.reviewCommentsCache[target] = allComments;
      return allComments;
    } catch (e) {
      warning(`Failed to list review comments: ${e}`);
      return allComments;
    }
  }

  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // octokit.issues.createComment
  // 作用：在一个 issue 或 pull request 上创建评论。
  // 适用范围：可以在普通的 issue 和 pull request 的主线程中添加评论。
  // 限制：它不会针对特定的代码行或文件，仅仅是在主讨论区域发布评论。
  // 场景：适合对整个 pull request 提出总体性建议，或者在 pull request 的整体讨论中发布一些通用信息。

  // octokit.pulls.createReviewComment
  // 作用：在 pull request 的代码行级别创建评论。
  // 适用范围：只能用于 pull request，且评论会显示在代码的 diff 视图中，附加到特定的文件和行上。
  // 限制：无法用于普通 issue，它是专门为代码审查设计的，只能在 PR 的代码中使用。
  // 场景：适合在代码审查时对特定代码行提出具体反馈。
  async create(body: string, target: number) {
    try {
      // get comment ID from the response
      const response = await octokit.issues.createComment({
        owner: repo.owner,
        repo: repo.repo,
        // eslint-disable-next-line camelcase
        issue_number: target, // pull request number is passed as issue_number
        body,
      });
      // add comment to issueCommentsCache
      if (this.issueCommentsCache[target]) {
        this.issueCommentsCache[target].push(response.data);
      } else {
        this.issueCommentsCache[target] = [response.data];
      }
    } catch (e) {
      warning(`Failed to create comment: ${e}`);
    }
  }

  async replace(body: string, tag: string, target: number) {
    try {
      const cmt = await this.findCommentWithTag(tag, target);
      if (cmt) {
        printWithColor("cmt", cmt);
        await octokit.issues.updateComment({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          comment_id: cmt.id,
          body,
        });
      } else {
        await this.create(body, target);
      }
    } catch (e) {
      warning(`Failed to replace comment: ${e}`);
    }
  }

  // 查找某个 GitHub issue（或 pull request）的评论中，包含特定标签 (tag) 的评论。如果找到包含该标签的评论，则返回该评论；如果未找到或出现错误，则返回 null。
  async findCommentWithTag(tag: string, target: number) {
    try {
      const comments = await this.listComments(target);
      for (const cmt of comments) {
        if (cmt.body && cmt.body.includes(tag)) {
          return cmt;
        }
      }

      return null;
    } catch (e: unknown) {
      warning(`Failed to find comment with tag: ${e}`);
      return null;
    }
  }

  private issueCommentsCache: Record<number, any[]> = {};

  // 从 GitHub 获取指定 issue 的所有评论，并缓存结果，以便后续请求不需要再次调用 API。
  async listComments(target: number) {
    if (this.issueCommentsCache[target]) {
      return this.issueCommentsCache[target];
    }

    const allComments: any[] = [];
    let page = 1;
    try {
      // 循环获取：使用无限循环 for (;;)，不断通过 GitHub API 获取 issue 的评论，每次获取最多 100 条评论。

      for (;;) {
        // 分页处理：通过 page 参数控制当前获取的页码，调用 octokit.issues.listComments 获取评论。
        const { data: comments } = await octokit.issues.listComments({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          issue_number: target,
          page,
          // eslint-disable-next-line camelcase
          per_page: 100,
        });
        allComments.push(...comments);
        page++;

        //  如果获取到的评论数量少于 100，说明已经是最后一页，终止循环。否则，将评论添加到 allComments 中，并继续请求下一页。
        if (!comments || comments.length < 100) {
          break;
        }
      }

      // 将获取到的评论缓存到 this.issueCommentsCache 中，下次请求时可以直接使用缓存。
      this.issueCommentsCache[target] = allComments;
      if (allComments[0]) {
        printWithColor("allComments[0]", allComments[0], 1);
      } // for debug purpose
      if (allComments[1]) {
        printWithColor("allComments[1].body", allComments[1].body, 1);
      } // for debug purpose
      return allComments;
    } catch (e: any) {
      warning(`Failed to list comments: ${e}`);
      return allComments;
    }
  }

  // function that takes a comment body and returns the list of commit ids that have been reviewed
  // commit ids are comments between the commit_ids_reviewed_start and commit_ids_reviewed_end markers
  // <!-- [commit_id] -->
  // from <!-- 22c58c3c379401b52641c7d75b008325a4471d3e --> to 22c58c3c379401b52641c7d75b008325a4471d3e
  getReviewedCommitIds(commentBody: string): string[] {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG);
    const end = commentBody.indexOf(COMMIT_ID_END_TAG);
    if (start === -1 || end === -1) {
      return [];
    }
    const ids = commentBody.substring(start + COMMIT_ID_START_TAG.length, end);
    // remove the <!-- and --> markers from each id and extract the id and remove empty strings
    return ids
      .split("<!--")
      .map((id) => id.replace("-->", "").trim())
      .filter((id) => id !== "");
  }

  // get review commit ids comment block from the body as a string
  // including markers
  getReviewedCommitIdsBlock(commentBody: string): string {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG);
    const end = commentBody.indexOf(COMMIT_ID_END_TAG);
    if (start === -1 || end === -1) {
      return "";
    }
    return commentBody.substring(start, end + COMMIT_ID_END_TAG.length);
  }

  // add a commit id to the list of reviewed commit ids
  // if the marker doesn't exist, add it
  /*
假设初始 commentBody 为：
  "This is a PR review comment.
  <!-- commit_ids_reviewed_start -->
  <!-- abc123 -->
  <!-- commit_ids_reviewed_end -->"

调用addReviewedCommitId(commentBody, "def456"); 后结果为：
  "This is a PR review comment.
  <!-- commit_ids_reviewed_start -->
  <!-- abc123 -->
  <!-- def456 -->
  <!-- commit_ids_reviewed_end -->"


 */
  addReviewedCommitId(commentBody: string, commitId: string): string {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG);
    const end = commentBody.indexOf(COMMIT_ID_END_TAG);
    if (start === -1 || end === -1) {
      return `${commentBody}\n${COMMIT_ID_START_TAG}\n<!-- ${commitId} -->\n${COMMIT_ID_END_TAG}`;
    }
    const ids = commentBody.substring(start + COMMIT_ID_START_TAG.length, end);
    return `${commentBody.substring(0, start + COMMIT_ID_START_TAG.length)}${ids}<!-- ${commitId} -->\n${commentBody.substring(end)}`;
  }

  // given a list of commit ids provide the highest commit id that has been reviewed
  /*
在 GitHub Actions 中，context.payload.pull_request.before 确实可以提供一个参考点，但并不能完全替代 getHighestReviewedCommitId 的功能。这两个值在实际用途上有一些区别：

context.payload.pull_request.before：

这个字段是 GitHub 在 pull_request 事件的 synchronize 操作中提供的，用于标识 PR 中代码更新的上一个基准 commit，即推送更新前的最新 commit。
它用于表示当前推送（push）事件的前一个 commit，而不是根据已审查的 commit 历史记录得出的“最高”或最新审查 commit。
getHighestReviewedCommitId：

这个函数的目标是根据审查历史，找到最近一次已审查的 commit。它遍历 commitIds 数组，返回在 reviewedCommitIds 中的最后一个匹配 commit，即最近一次的审查进度。
如果您希望得到最近审查过的 commit 而不仅仅是上一个推送前的 commit，就需要这个函数。
  */
  /*
getHighestReviewedCommitId 方法的作用
您理解正确，getHighestReviewedCommitId 方法的确是为了找到最近一次已审查的 commit，以便在下次代码审查时：

略过自上次审查以来的多个 commit，聚焦于从最新的已审查 commit 到当前 commit 的更改。
优化审查效率：这样可以避免重复审查已审过的内容，仅关注自上次审查后的新代码更改。
增量审查：通过计算上次审查过的 commit 和当前最新 commit 的 diff，可实现增量审查，即每次仅查看未审查过的更改，而不是整个 diff。
这种逻辑在进行增量代码审查时非常有用，特别是在大型项目中频繁提交的情况下，能有效减少重复工作。
 */
  getHighestReviewedCommitId(commitIds: string[], reviewedCommitIds: string[]): string {
    for (let i = commitIds.length - 1; i >= 0; i--) {
      if (reviewedCommitIds.includes(commitIds[i])) {
        return commitIds[i];
      }
    }
    return "";
  }

  // allCommits 数组获取的是与某个具体的 Pull Request (PR) 相关的提交记录，而不是仓库中所有的提交。最终生成的 allCommits 数组中，最早的提交在前，最新的提交在最后。
  /*
GitHub API 的 listCommits（以及其他类似的 API）默认会将结果分页返回，每页只包含最多 30 条记录。如果 Pull Request 涉及的提交记录很多（比如超过 30 个），你需要手动处理分页来获取所有的提交。

per_page：表示每一页返回的记录数。默认是 30 条，最大可以设置为 100 条。代码中设置 per_page: 100 是为了每次请求尽可能多地获取数据，减少分页请求的次数。
page：表示当前获取的是第几页的数据。通过不断增加 page 的值，可以获取下一页的记录。
  */
  async getAllCommitIds(): Promise<string[]> {
    const allCommits = [];
    let page = 1;
    let commits;
    if (context && context.payload && context.payload.pull_request != null) {
      do {
        commits = await octokit.pulls.listCommits({
          owner: repo.owner,
          repo: repo.repo,
          // eslint-disable-next-line camelcase
          pull_number: context.payload.pull_request.number,
          // eslint-disable-next-line camelcase
          per_page: 100,
          page,
        });

        allCommits.push(...commits.data.map((commit: { sha: string }) => commit.sha)); // 为 commit 指定类型
        page++;
      } while (commits.data.length > 0);
    }

    return allCommits;
  }

  // add in-progress status to the comment body
  addInProgressStatus(commentBody: string, statusMsg: string): string {
    const start = commentBody.indexOf(IN_PROGRESS_START_TAG);
    const end = commentBody.indexOf(IN_PROGRESS_END_TAG);
    // add to the beginning of the comment body if the marker doesn't exist
    // otherwise do nothing
    if (start === -1 || end === -1) {
      return `${IN_PROGRESS_START_TAG}

Currently reviewing new changes in this PR...

${statusMsg}

${IN_PROGRESS_END_TAG}

---

${commentBody}`;
    }
    return commentBody;
  }

  // remove in-progress status from the comment body
  removeInProgressStatus(commentBody: string): string {
    const start = commentBody.indexOf(IN_PROGRESS_START_TAG);
    const end = commentBody.indexOf(IN_PROGRESS_END_TAG);
    // remove the in-progress status if the marker exists
    // otherwise do nothing
    if (start !== -1 && end !== -1) {
      return commentBody.substring(0, start) + commentBody.substring(end + IN_PROGRESS_END_TAG.length);
    }
    return commentBody;
  }
}
