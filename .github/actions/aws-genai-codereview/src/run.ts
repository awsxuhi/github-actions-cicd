import { getBooleanInput, getInput, getMultilineInput, setFailed, warning } from "@actions/core";
import { Bot } from "./bot";
import { BedrockOptions, Options } from "./options";
import { Prompts } from "./prompts";
import { codeReview } from "./review";
import { handleReviewComment } from "./review-comment";
import { isCollaborator } from "./permission";

async function run(): Promise<void> {
  const options: Options = new Options(
    getBooleanInput("debug"),
    getBooleanInput("disable_review"),
    getBooleanInput("disable_release_notes"),
    getBooleanInput("only_allow_collaborator"),
    getInput("max_files"),
    getBooleanInput("review_simple_changes"),
    getBooleanInput("review_comment_lgtm"),
    getMultilineInput("path_filters"),
    getInput("system_message"),
    getInput("review_file_diff"),
    getInput("bedrock_light_model"),
    getInput("bedrock_heavy_model"),
    getInput("bedrock_model_temperature"),
    getInput("bedrock_retries"),
    getInput("bedrock_timeout_ms"),
    getInput("bedrock_concurrency_limit"),
    getInput("github_concurrency_limit"),
    getInput("language")
  );

  /**
   * Print options. This will display all the parameter values passed into the action through the `with` section of the GitHub workflow file.
   */
  options.print();

  const prompts: Prompts = new Prompts(getInput("summarize"), getInput("summarize_release_notes"));

  // Create two bots, one for summary and one for review

  let lightBot: Bot | null = null;
  try {
    lightBot = new Bot(options, new BedrockOptions(options.bedrockLightModel, options.lightTokenLimits));
  } catch (e: any) {
    warning(`Skipped: failed to create summary bot, please check your bedrock_api_key: ${e}, backtrace: ${e.stack}`);
    return;
  }

  let heavyBot: Bot | null = null;
  try {
    heavyBot = new Bot(options, new BedrockOptions(options.bedrockHeavyModel, options.heavyTokenLimits));
  } catch (e: any) {
    warning(`Skipped: failed to create review bot, please check your bedrock_api_key: ${e}, backtrace: ${e.stack}`);
    return;
  }

  try {
    if (process.env.GITHUB_ACTOR === undefined || process.env.GITHUB_REPOSITORY === undefined) {
      warning("Skipped: required environment variables not found.");
      return;
    }
    if (options.onlyAllowCollaborator && !(await isCollaborator(process.env.GITHUB_ACTOR, process.env.GITHUB_REPOSITORY))) {
      warning(`Skipped: The user ${process.env.GITHUB_ACTOR} does not have collaborator access for the repository ${process.env.GITHUB_REPOSITORY}.`);
      return;
    }
    // check if the event is pull_request
    if (process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.GITHUB_EVENT_NAME === "pull_request_target") {
      await codeReview(lightBot, heavyBot, options, prompts);
    } else if (process.env.GITHUB_EVENT_NAME === "pull_request_review_comment") {
      await handleReviewComment(heavyBot, options, prompts);
    } else {
      warning("Skipped: this action only works on push events or pull_request");
    }
  } catch (e: any) {
    if (e instanceof Error) {
      /**
       * setFailed 是 GitHub Actions 中 @actions/core 模块的一个方法，主要用于将当前 GitHub Action 的状态标记为失败。
       * 一旦 setFailed 被调用，GitHub Action 会立即停止并将该步骤的状态标记为失败。这对于处理错误、异常情况或确保工作流失败时不继续执行后续步骤非常重要。
       * 通常在 try...catch 语句中捕获到异常后调用，用于提供失败的原因。
       */
      setFailed(`Failed to run: ${e.message}, backtrace: ${e.stack}`);
    } else {
      setFailed(`Failed to run: ${e}, backtrace: ${e.stack}`);
    }
  }
}

process
  .on("unhandledRejection", (reason, p) => {
    // 当一个 Promise 被拒绝（即 .reject()），但没有相应的 .catch() 处理时，这个事件会被触发。它会捕获未处理的 Promise 拒绝并记录警告。
    warning(`Unhandled Rejection at Promise: ${reason}, promise is ${p}`);
  })
  .on("uncaughtException", (e: any) => {
    // 当程序抛出异常但没有捕获（即没有 try...catch）时，这个事件会被触发，防止程序崩溃并记录错误信息。
    warning(`Uncaught Exception thrown: ${e}, backtrace: ${e.stack}`);
  });

await run();

/**
 * 
1. pull_request 事件
触发场景：当与拉取请求（Pull Request）相关的操作发生时触发。常见的触发操作包括：
创建（opened）
关闭（closed）
合并（merged）
更新（synchronize）等
使用场景：当你需要在提交拉取请求或对其进行修改时执行某些自动化操作，比如代码检查、CI/CD 流程触发等。

2. pull_request_target 事件
触发场景：类似于 pull_request 事件，但用于特殊场景。pull_request_target 在目标仓库中触发，而不是拉取请求的源仓库中。它用于在拉取请求的目标分支中执行工作流。
使用场景：通常用于有外部贡献者提交拉取请求的情况。因为外部贡献者的分支可能没有足够的权限，GitHub 会限制其工作流的执行。这时可以使用 pull_request_target 来在目标仓库中安全地执行工作流，避免权限问题。

3. pull_request_review_comment 事件
触发场景：当有人在拉取请求的代码评审过程中添加、编辑或删除评论时触发。
使用场景：常用于处理代码评审中的自动化操作，例如对代码评审中的特定评论做出响应，自动生成反馈或更新。

 */
