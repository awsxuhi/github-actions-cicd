import { printWithColor } from "./printWithColor";
import { context } from "@actions/github";

export function printContextPayloadKeyItems(): void {
  const payload = context.payload;

  printWithColor("context.payload", {
    action: payload.action,
    before: payload.before, // this is commit B instead of the base commit A
    after: payload.after, // this is commit C
    number: payload.number,
    repository: {
      name: payload.repository?.name,
      owner: {
        login: payload.repository?.owner?.login,
        type: payload.repository?.owner?.type,
      },
    },
    sender: {
      login: payload.sender?.login,
    },
    pull_request: payload.pull_request
      ? {
          base: {
            label: payload.pull_request.base?.label,
            ref: payload.pull_request.base?.ref,
            sha: payload.pull_request.base?.sha,
            repo: {
              owner: {
                login: payload.pull_request.base?.repo?.owner?.login,
                type: payload.pull_request.base?.repo?.owner?.type,
              },
              name: payload.pull_request.base?.repo?.name,
            },
          },
          head: {
            label: payload.pull_request.head?.label,
            ref: payload.pull_request.head?.ref,
            sha: payload.pull_request.head?.sha,
          },
          title: payload.pull_request.title,
          body: payload.pull_request.body, // This is the PR Description
          number: payload.pull_request.number,
          diff_url: payload.pull_request.diff_url,
          patch_url: payload.pull_request.patch_url,
          review_comments: payload.pull_request.review_comments,
          review_comments_url: payload.pull_request.review_comments_url,
          comments: payload.pull_request.comments,
          comments_url: payload.pull_request.comments_url,
          commits: payload.pull_request.commits,
          commits_url: payload.pull_request.commits_url,
          before: payload.pull_request.before,
          _links: payload.pull_request._links,
        }
      : undefined,
  });
}

/**

    const eventData = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));

    // The following 2 lines has the same output. That is, eventData===context.payload
    printWithColor("eventData", eventData); 
    printWithColor("context.payload", context.payload);

 */

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

*/

/*
`comments` 和 `review_comments` 的区别：
- `comments` 是指 Pull Request 整体下的讨论，用户可以在 Pull Request 中发表评论，这些评论是和具体的代码无关的讨论。
- `review_comments` 则是代码审查者在审查代码时对特定代码行或文件作出的评论。它是基于代码的反馈和讨论，而不是整个 Pull Request。

总结来说，`comments` 更加广泛地适用于整个 Pull Request，而 `review_comments` 是精确到代码行的讨论。
*/
