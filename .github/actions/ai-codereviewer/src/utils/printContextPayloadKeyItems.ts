import { printWithColor } from "./printWithColor";
import { context } from "@actions/github";

export function printContextPayloadKeyItems(): void {
  const payload = context.payload;

  printWithColor("context.payload", {
    action: payload.action,
    before: payload.before,
    after: payload.after,
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
          _links: payload.pull_request._links,
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
