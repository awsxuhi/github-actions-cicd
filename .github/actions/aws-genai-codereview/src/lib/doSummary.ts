import { info, warning } from "@actions/core";
import { printWithColor } from "../utils";
import { getTokenCount } from "../tokenizer";
import { type Options } from "../options";
import { type Prompts } from "../prompts";
import { type Bot } from "../bot";
import { Inputs } from "../inputs";

export async function doSummary(
  filename: string,
  fileContent: string,
  fileDiff: string,
  inputs: Inputs,
  prompts: Prompts,
  options: Options,
  lightBot: Bot,
  summariesFailed: string[]
): Promise<[string, string, boolean] | null> {
  info(`summarize: ${filename}`);
  const ins = inputs.clone();

  if (fileDiff.length === 0) {
    warning(`summarize: file_diff is empty, skip ${filename}`);
    summariesFailed.push(`${filename} (empty diff)`);
    return null;
  }

  ins.filename = filename;
  ins.fileDiff = fileDiff;

  // render prompt based on inputs so far
  const summarizePrompt = prompts.renderSummarizeFileDiff(ins, options.reviewSimpleChanges);
  const tokens = getTokenCount(summarizePrompt);

  if (tokens > options.lightTokenLimits.requestTokens) {
    info(`summarize: diff tokens exceeds limit, skip ${filename}`);
    summariesFailed.push(`${filename} (diff tokens exceeds limit)`);
    return null;
  }

  // summarize content
  try {
    const [summarizeResp] = await lightBot.chat(summarizePrompt);
    printWithColor("summarizePrompt", summarizePrompt);
    printWithColor("summarizeResp", summarizeResp);

    if (summarizeResp === "") {
      info("summarize: nothing obtained from bedrock");
      summariesFailed.push(`${filename} (nothing obtained from bedrock)`);
      return null;
    } else {
      if (!options.reviewSimpleChanges) {
        // parse the comment to look for triage classification
        // Format is : [TRIAGE]: <NEEDS_REVIEW or APPROVED>
        // if the change needs review return true, else false
        const triageRegex = /\[TRIAGE\]:\s*(NEEDS_REVIEW|APPROVED)/;
        const triageMatch = summarizeResp.match(triageRegex);

        if (triageMatch != null) {
          const triage = triageMatch[1];
          const needsReview = triage === "NEEDS_REVIEW";

          // remove this line from the comment
          const summary = summarizeResp.replace(triageRegex, "").trim();
          printWithColor("summary (triage removed)", summary);
          info(`filename: ${filename}, triage: ${triage}`);
          return [filename, summary, needsReview];
        }
      }
      return [filename, summarizeResp, true];
    }
  } catch (e: any) {
    warning(`summarize: error from bedrock: ${e as string}`);
    summariesFailed.push(`${filename} (error from bedrock: ${e as string})})`);
    return null;
  }
}
