import { readFileSync } from "fs";
import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";
import parseDiff, { Chunk, File } from "parse-diff";
import { minimatch } from "minimatch";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { context } from "@actions/github";
import { printWithColor } from "./utils";

const GITHUB_TOKEN: string = core.getInput("GITHUB_TOKEN");
const REVIEW_MAX_COMMENTS: string = core.getInput("REVIEW_MAX_COMMENTS");
const REVIEW_PROJECT_CONTEXT: string = core.getInput("REVIEW_PROJECT_CONTEXT");
const APPROVE_REVIEWS: boolean = core.getInput("APPROVE_REVIEWS") === "true";

const RESPONSE_TOKENS = 4000;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const AWS_REGION: string = core.getInput("AWS_REGION");
const BEDROCK_MODEL_ID: string = core.getInput("BEDROCK_MODEL_ID");
const bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });

// ********************************** 1. Interface **********************************

interface PRDetails {
  owner: string;
  repo: string;
  pull_number: number;
  title: string;
  description: string;
}

interface AICommentResponse {
  file: string;
  lineNumber: string;
  reviewComment: string;
}

interface GithubComment {
  body: string;
  path: string;
  line: number;
}

// ********************************** 2. Function **********************************

async function getPRDetails(): Promise<PRDetails> {
  core.info("Fetching PR details...");

  const { repository, number } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8"));

  const prResponse = await octokit.pulls.get({
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
  });

  core.info(`PR details fetched for PR #${number}`);

  return {
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
    title: prResponse.data.title ?? "",
    description: prResponse.data.body ?? "",
  };
}

/*
    repository.owner.login 在这段代码中指的是 Pull Request 事件的 base 仓库的所有者。这是因为 GitHub 事件 JSON 文件中的 repository 字段通常表示 Pull Request 目标分支所在的仓库（即 base 仓库），而不是 Pull Request 的源分支（即 head 仓库）。

    因此，repository.owner.login 实际上等于 context.payload.pull_request.base.repo.owner.login，它指向目标仓库的所有者信息（也就是 base 仓库的所有者）。
   */

async function getDiff(owner: string, repo: string, pull_number: number): Promise<string | null> {
  core.info(`Fetching diff for PR #${pull_number}...`);

  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: { format: "diff" },
  });
  printWithColor("getDiff: Base(A) vs. Head(C)", response.data);
  // @ts-expect-error - response.data is a string
  return response.data;
}

async function analyzeCode(changedFiles: File[], prDetails: PRDetails): Promise<Array<GithubComment>> {
  core.info("Analyzing code...");

  const prompt = createPrompt(changedFiles, prDetails);
  const aiResponse = await getAIResponse(prompt);
  core.info(JSON.stringify(aiResponse, null, 2));
  console.log(JSON.stringify(aiResponse, null, 2));

  const comments: Array<GithubComment> = [];

  if (aiResponse) {
    const newComments = createComments(changedFiles, aiResponse);

    if (newComments) {
      comments.push(...newComments);
    }
  }

  core.info(`Analysis complete. Generated ${comments.length} comments.`);
  return comments;
}

function createPrompt(changedFiles: File[], prDetails: PRDetails): string {
  core.info("Creating prompt for AI...");
  const problemOutline = `Human: Your task is to review pull requests (PR). Instructions:
- Provide the response in following JSON format:  {"comments": [{"file": <file name>,  "lineNumber":  <line_number>, "reviewComment": "<review comment>"}]}
- DO NOT give positive comments or compliments.
- DO NOT give advice on renaming variable names or writing more descriptive variables.
- Provide comments and suggestions ONLY if there is something to improve, otherwise return an empty array.
- Provide at most ${REVIEW_MAX_COMMENTS} comments. It's up to you how to decide which comments to include.
- Write the comment in GitHub Markdown format.
- Use the given description only for the overall context and only comment the code.
${REVIEW_PROJECT_CONTEXT ? `- Additional context regarding this PR's project: ${REVIEW_PROJECT_CONTEXT}` : ""}
- IMPORTANT: NEVER suggest adding comments to the code.
- IMPORTANT: Evaluate the entire diff in the PR before adding any comments.

Pull request title: ${prDetails.title}
Pull request description:

---
${prDetails.description}
---

TAKE A DEEP BREATH AND WORK ON THIS PROBLEM STEP-BY-STEP.
`;

  const diffChunksPrompt = new Array();

  for (const file of changedFiles) {
    if (file.to === "/dev/null") continue; // Ignore deleted files
    for (const chunk of file.chunks) {
      diffChunksPrompt.push(createPromptForDiffChunk(file, chunk));
    }
  }

  core.info("Prompt created successfully.");
  return `${problemOutline}\n ${diffChunksPrompt.join("\n")}`;
}

function createPromptForDiffChunk(file: File, chunk: Chunk): string {
  return `\n
  Review the following code diff in the file "${file.to}". Git diff to review:

  \`\`\`diff
  ${chunk.content}
  ${chunk.changes
    // @ts-expect-error - ln and ln2 exists where needed
    .map((c) => `${c.ln ? c.ln : c.ln2} ${c.content}`)
    .join("\n")}
  \`\`\`
  
  Assistant:`;
}

async function getAIResponse(prompt: string): Promise<Array<AICommentResponse>> {
  core.info("Sending request to Bedrock/Claude API...");

  try {
    // const params = {
    //   modelId: BEDROCK_MODEL_ID,
    //   body: JSON.stringify({
    //     prompt: prompt,
    //     max_tokens_to_sample: RESPONSE_TOKENS,
    //     temperature: 0.2,
    //     stop_sequences: ["\n\nHuman:"],
    //   }),
    //   contentType: "application/json",
    //   accept: "application/json",
    // };

    const payload = {
      anthropic_version: "bedrock-2023-05-31", // Claude 版本
      max_tokens: RESPONSE_TOKENS, // 使用 max_tokens 而不是 max_tokens_to_sample
      temperature: 0.2, // temperature 放在顶层
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt, // prompt 作为 messages 的 text 内容
            },
          ],
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID, // 使用您定义的 Claude 模型 ID
      contentType: "application/json",
      body: JSON.stringify(payload),
    });

    const response = await bedrockClient.send(command);

    let responseData: string;

    if (response.body) {
      // 确保 response.body 存在
      // 检查response.body的类型
      if (response.body instanceof Uint8Array || Buffer.isBuffer(response.body)) {
        // 如果是Uint8Array或Buffer，直接解码
        responseData = new TextDecoder("utf-8").decode(response.body);
        core.info("========> Response body is a Uint8Array or Buffer");
      } else if (typeof response.body === "string") {
        // 如果已经是字符串，直接使用
        responseData = response.body;
      } else if (response.body && typeof (response.body as ReadableStream).getReader === "function") {
        // 如果是ReadableStream，转换为字符串
        responseData = await streamToString(response.body as ReadableStream);
      } else {
        throw new Error("Unsupported response body type");
      }
    } else {
      throw new Error("Response body is undefined");
    }

    const responseBody = JSON.parse(responseData);
    const completionText = responseBody.completion.trim();
    const res = completionText || "{}";

    // 移除Markdown代码块并确保有效的JSON
    const jsonString = res.replace(/^```json\s*|\s*```$/g, "").trim();

    try {
      let data = JSON.parse(jsonString);
      if (!Array.isArray(data?.comments)) {
        throw new Error("Invalid response from OpenAI API");
      }
      return data.comments;
    } catch (parseError) {
      core.error(`Failed to parse JSON: ${jsonString}`);
      core.error(`Parse error: ${parseError}`);
      throw parseError;
    }
  } catch (error: any) {
    core.error("Error Message:", error?.message || error);

    if (error?.response) {
      core.error("Response Data:", error.response.data);
      core.error("Response Status:", error.response.status);
      core.error("Response Headers:", error.response.headers);
    }

    if (error?.config) {
      core.error("Config:", error.config);
    }

    core.setFailed(`Bedrock API request failed: ${error.message}`);
    throw error;
  }
}

async function streamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  let result = "";
  let done = false;
  let value: Uint8Array;

  while (!done) {
    const readResult = await reader.read();
    done = readResult.done;
    value = readResult.value;
    if (value) {
      result += new TextDecoder("utf-8").decode(value);
    }
  }

  return result;
}

// 如果在Node.js环境中，处理Node.js的Readable流
async function nodeStreamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

function createComments(changedFiles: File[], aiResponses: Array<AICommentResponse>): Array<GithubComment> {
  core.info("Creating GitHub comments from AI responses...");

  return aiResponses
    .flatMap((aiResponse) => {
      const file = changedFiles.find((file) => file.to === aiResponse.file);

      return {
        body: aiResponse.reviewComment,
        path: file?.to ?? "",
        line: Number(aiResponse.lineNumber),
      };
    })
    .filter((comments) => comments.path !== "");
}

async function createReviewComment(owner: string, repo: string, pull_number: number, comments: Array<GithubComment>): Promise<void> {
  core.info(`Creating review comment for PR #${pull_number}...`);

  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number,
    comments,
    event: APPROVE_REVIEWS ? "APPROVE" : "COMMENT",
  });

  core.info(`Review ${APPROVE_REVIEWS ? "approved" : "commented"} successfully.`);
}

async function hasExistingReview(owner: string, repo: string, pull_number: number): Promise<boolean> {
  const reviews = await octokit.pulls.listReviews({
    owner,
    repo,
    pull_number,
  });
  printWithColor("reviews", reviews);
  return reviews.data.length > 0;
}

// ********************************** 3. Run **********************************
async function run() {
  try {
    core.info("Starting AI code review process...");

    const prDetails = await getPRDetails();
    let diff: string | null;
    const eventData = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
    printWithColor("prDetails", prDetails);
    printWithColor("eventData", eventData); // the same with context.payload

    if (context.eventName !== "pull_request" && context.eventName !== "pull_request_target") {
      core.warning(`Skipped: current event is ${context.eventName}, only support pull_request event`);
      return;
    }

    // 虽然 pull_request 和 pull_request_target 是不同的事件类型，但它们的结构相同，GitHub 会在 context.payload.pull_request 中存储拉取请求的数据。因此，context.payload.pull_request 适用于两种事件类型。
    if (context.payload.pull_request == null) {
      core.warning("Skipped: context.payload.pull_request is null");
      return;
    }
    printWithColor("context.payload", {
      action: context.payload.action,
      before: context.payload.before,
      after: context.payload.after,
      number: context.payload.number,
      repository: {
        name: context.payload.repository?.name,
        owner: {
          login: context.payload.repository?.owner.login,
          type: context.payload.repository?.owner.type,
        },
      },
      sender: {
        login: context.payload.sender?.login,
      },
      pull_request: {
        _links: context.payload.pull_request._links,
        base: {
          label: context.payload.pull_request.base.label,
          ref: context.payload.pull_request.base.ref,
          sha: context.payload.pull_request.base.sha,
          repo: {
            owner: {
              login: context.payload.pull_request.base.repo.owner.login,
              type: context.payload.pull_request.base.repo.owner.type,
            },
            name: context.payload.pull_request.base.repo.name,
          },
        },
        head: {
          label: context.payload.pull_request.head.label,
          ref: context.payload.pull_request.head.ref,
          sha: context.payload.pull_request.head.sha,
        },
        title: context.payload.pull_request.title,
        number: context.payload.pull_request.number,
        diff_url: context.payload.pull_request.diff_url,
        patch_url: context.payload.pull_request.patch_url,
        review_comments: context.payload.pull_request.review_comments,
        review_comments_url: context.payload.pull_request.review_comments_url,
        comments: context.payload.pull_request.comments,
        comments_url: context.payload.pull_request.comments_url,
        commits: context.payload.pull_request.commits,
        commits_url: context.payload.pull_request.commits_url,
        before: context.payload.pull_request.before,
      },
    });

    core.info(`Processing ${eventData.action} event...`);
    const existingReview = await hasExistingReview(prDetails.owner, prDetails.repo, prDetails.pull_number);

    if (eventData.action === "opened" || (eventData.action === "synchronize" && !existingReview)) {
      diff = await getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number);
    } else if (eventData.action === "synchronize" && existingReview) {
      const newBaseSha = eventData.before;
      const newHeadSha = eventData.after;

      core.info(`Comparing commits: ${newBaseSha} -> ${newHeadSha}`);
      const response = await octokit.repos.compareCommits({
        headers: {
          accept: "application/vnd.github.v3.diff",
        },
        owner: prDetails.owner,
        repo: prDetails.repo,
        base: newBaseSha,
        head: newHeadSha,
      });
      printWithColor("response.data", response.data);
      diff = String(response.data);
    } else {
      core.info(`Unsupported event: ${process.env.GITHUB_EVENT_NAME}`);
      return;
    }

    if (!diff) {
      core.info("No diff found");
      return;
    }

    const changedFiles = parseDiff(diff);
    core.info(`Found ${changedFiles.length} changed files.`);
    printWithColor("changedFiles", changedFiles);

    const excludePatterns = core
      .getInput("exclude")
      .split(",")
      .map((s) => s.trim());

    const filteredDiff = changedFiles.filter((file) => {
      return !excludePatterns.some((pattern) => minimatch(file.to ?? "", pattern));
    });
    core.info(`After filtering, ${filteredDiff.length} files remain.`);

    const comments = await analyzeCode(filteredDiff, prDetails);
    if (APPROVE_REVIEWS || comments.length > 0) {
      await createReviewComment(prDetails.owner, prDetails.repo, prDetails.pull_number, comments);
    } else {
      core.info("No comments to post.");
    }
    core.info("AI code review process completed successfully.");
  } catch (error: any) {
    core.error("Error:", error);
    core.setFailed(`Action failed: ${error.message}`);
    process.exit(1); // This line ensures the GitHub action fails
  }
}

core.info("Starting AI code review action...");
run().catch((error) => {
  core.error("Unhandled error in run():", error);
  core.setFailed(`Unhandled error in run(): ${(error as Error).message}`);
  process.exit(1);
});
