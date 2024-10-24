import { type Inputs } from "./inputs";

export class Prompts {
  summarize: string;
  summarizeReleaseNotes: string;

  summarizeFileDiff = `
I would like you to succinctly summarize the Pull Request within 100 words.
The Pull Request is described with <title>, <description>, and <diff> tags.
If applicable, your summary should include a note about alterations to the signatures of exported functions, global data structures and variables, and any changes that might affect the external interface or behavior of the code.

<pull_request_title>
$title 
</pull_request_title>

<pull_request_description>
$description
</pull_request_description>

<pull_request_diff>
$file_diff
</pull_request_diff>
`;
  triageFileDiff = `
Below the summary, I would also like you to triage the diff as \`NEEDS_REVIEW\` or \`APPROVED\` based on the following criteria:

- If the diff involves any modifications to the logic or functionality, even if they seem minor, triage it as \`NEEDS_REVIEW\`. This includes changes to control structures, function calls, or variable assignments that might impact the behavior of the code.
- If the diff only contains very minor changes that don't affect the code logic, such as fixing typos, formatting, or renaming variables for clarity, triage it as \`APPROVED\`.

Please evaluate the diff thoroughly and take into account factors such as the number of lines changed, the potential impact on the overall system, and the likelihood of introducing new bugs or security vulnerabilities. 
When in doubt, always err on the side of caution and triage the diff as \`NEEDS_REVIEW\`.

You must strictly follow the format below for triaging the diff:
[TRIAGE]: <NEEDS_REVIEW or APPROVED>

Important:
- In your summary do not mention that the file needs a thorough review or caution about potential issues.
- Do not provide any reasoning why you triaged the diff as \`NEEDS_REVIEW\` or \`APPROVED\`.
- Do not mention that these changes affect the logic or functionality of the code in the summary. You must only use the triage status format above to indicate that.
`;
  summarizeChangesets = `
Provided below (<changeSet> tag) are changesets in this pull request.
Changesets are in chronlogical order and new changesets are appended to the end of the list. The format consists of filename(s) and the summary of changes for those files. There is a separator between each changeset.
Your task is to deduplicate and group together files with related/similar changes into a single changeset. Respond with the updated changesets using the same format as the input. 

<changeSet>
$raw_summary
</changeSet>
`;

  summarizePrefix = `
Below <summary> tag is the summary of changes you have generated for files:
<summary>
$raw_summary
</summary>

`;

  summarizeShort = `
Your task is to provide a concise summary of the changes.
This summary will be used as a prompt while reviewing each file and must be very clear for the AI bot to understand. 

Instructions:

- Focus on summarizing only the changes in the PR and stick to the facts.
- Do not provide any instructions to the bot on how to perform the review.
- Do not mention that files need a thorough review or caution about potential issues.
- Do not mention that these changes affect the logic or functionality of the code.
- The summary should not exceed a 500-word limit.
`;

  reviewFileDiff = `
$system_message

<pull_request_title>
$title 
</pull_request_title>

<pull_request_description>
$description
</pull_request_description>

<summary_of_changes>
$short_summary
</summary_of_changes>

## IMPORTANT Instructions

Input: New hunks annotated with line numbers and old hunks (replaced code). Hunks represent incomplete code fragments. Example input is in <example_input> tag below.
Additional Context: <pull_request_title>, <pull_request_description>, <summary_of_changes> and <comment_chains>. 
Task: Review new hunks for substantive issues using provided context and respond with comments if necessary.
Output: Review comments in markdown with exact line number ranges in new hunks. Start and end line numbers must be within the same hunk. For single-line comments, start=end line number. Must use JSON output format in <example_output> tag below.
Use fenced code blocks using the relevant language identifier where applicable.
Don't annotate code snippets with line numbers. Format and indent code correctly.
Do not use \`suggestion\` code blocks.
For fixes, use \`diff\` code blocks, marking changes with \`+\` or \`-\`. The line number range for comments with fix snippets must exactly match the range to replace in the new hunk.

$review_file_diff

For each line range, if no issues are found, include a response with "lgtm": true in the output JSON. If issues are identified, include detailed comments and set "lgtm": false. Always output a complete and correctly formatted JSON response that can be parsed successfully. Do not leave the JSON unfinished or incomplete.

<example_input>
<new_hunk>
\`\`\`
  z = x / y
    return z

20: def add(x, y):
21:     z = x + y
22:     retrn z
23: 
24: 
24: def multiply(x, y):
25:     return x * y

def subtract(x, y):
  z = x - y
\`\`\`
</new_hunk>
  
<old_hunk>
\`\`\`
z = x / y
    return z

def add(x, y):
    return x + y

def subtract(x, y):
    z = x - y
\`\`\`
</old_hunk>

<comment_chains>
\`\`\`
Please review this change.
\`\`\`
</comment_chains>
</example_input>

<example_output>
{
  "reviews": [
    {
      "line_start": 22,
      "line_end": 22,
      "comment": "There's a syntax error in the add function.\\n  -    retrn z\\n  +    return z",
      "lgtm": false
    },
    {
      "line_start": 24,
      "line_end": 25,
      "comment": "",
      "lgtm": true
    },
  ],
  
}
</example_output>

## Changes made to \`$filename\` for your review

$patches
`;

  reviewFileDiffUsingStandardDiffBlock = `
Human: Your task is to review pull requests (PR). Instructions:
- Provide the response in the following JSON format: 
  {"reviews": [{"line_start": <line_start_number>, "line_end": <line_end_number>, "comment": "<review_comment>", "lgtm": <true_or_false>}]}
- For each hunk (diff code block), if no issues are found, include a response with "lgtm": true in the output JSON. If issues are identified, include detailed comments and set "lgtm": false.
- Always output a complete and correctly formatted JSON response that can be parsed successfully. Do not leave the JSON unfinished or incomplete. If no comments are needed for the entire PR, output \`{"reviews": []}\`.
- \`lgtm\` stands for "Looks Good to Me". Set \`lgtm\` to true when no issues are found and false when issues are present.
- You can refer to a specific example in the <example_response> tag below for the correct JSON format.
- DO NOT give positive comments or compliments.
- DO NOT give advice on renaming variable names or writing more descriptive variable names.
- Provide comments and suggestions ONLY if there is something to improve, otherwise return an empty "reviews" array.
- Provide at most 20 comments per PR. It's up to you to decide which comments to include.
- Write each comment in GitHub Markdown format.
- Use the given description only for the overall context and only comment on the code changes.
- IMPORTANT: NEVER suggest adding comments to the code.
- IMPORTANT: Evaluate the entire diff in the PR before adding any comments.

<pull_request_title>
$title 
</pull_request_title>

<pull_request_description>
$description
</pull_request_description>

<summary_of_changes>
$short_summary
</summary_of_changes>

TAKE A DEEP BREATH AND WORK ON THIS PROBLEM STEP-BY-STEP.

<example_response>
{
  "reviews": [
    {
      "line_start": 22,
      "line_end": 22,
      "comment": "There's a syntax error in the add function.\\n  -    retrn z\\n  +    return z",
      "lgtm": false
    },
    {
      "line_start": 24,
      "line_end": 25,
      "comment": "This is an added comment, and removing it will not affect the code.",
      "lgtm": true
    },
    {
      "line_start": 127,
      "line_end": 135,
      "comment": "Instead of returning an empty array and string, consider throwing an error or returning a more descriptive object to indicate the reason for failure.",
      "lgtm": false
    }
  ]
}
</example_response>

If no issues are found across all hunks, the response should be:
<example_response>
{
  "reviews": []
}
</example_response>

The content in the <file_content> tag is the complete file content of \`$filename\` before modification. When you review the modified code snippets (i.e., hunks), you can refer to the entire file content at the same time.
<file_content>
$fileContent
</file_content>

Changes made to \`$filename\` for your review:

$patches

Assistant:`;

  comment = `
$system_message

A comment was made on a GitHub PR review for a diff hunk on a file - \`$filename\`. I would like you to follow the instructions in that comment. 

<pull_request_title>
$title 
</pull_request_title>

<pull_request_description>
$description
</pull_request_description>

<short_summary>
$short_summary
</short_summary>

<entire_diff>
$file_diff
</entire_diff>

Here is the diff that is now comment on.

<partial_diff>
$diff
<partial_diff>

## Instructions

Please reply directly to the new comment (instead of suggesting a reply) and your reply will be posted as-is.

If the comment contains instructions/requests for you, please comply. 
For example, if the comment is asking you to generate documentation comments on the code, in your reply please generate the required code.

In your reply, please make sure to begin the reply by tagging the user with "@user".

<example>
@username You are right. Thanks for the explanation!
</example>

Here is the comment history YOU and the users had. Note that H=human and A=you(assistant).

<history>
$comment_chain
</history>

This is the comment/request that you need to directly reply to
<comment>
$comment
</comment>
`;

  constructor(summarize = "", summarizeReleaseNotes = "") {
    this.summarize = summarize;
    this.summarizeReleaseNotes = summarizeReleaseNotes;
  }

  renderSummarizeFileDiff(inputs: Inputs, reviewSimpleChanges: boolean): string {
    let prompt = this.summarizeFileDiff;
    if (reviewSimpleChanges === false) {
      prompt += this.triageFileDiff;
    }
    return inputs.render(prompt);
  }

  renderSummarizeChangesets(inputs: Inputs): string {
    return inputs.render(this.summarizeChangesets);
  }

  renderSummarize(inputs: Inputs): string {
    const prompt = this.summarizePrefix + this.summarize;
    return inputs.render(prompt);
  }

  renderSummarizeShort(inputs: Inputs): string {
    const prompt = this.summarizePrefix + this.summarizeShort;
    return inputs.render(prompt);
  }

  renderSummarizeReleaseNotes(inputs: Inputs): string {
    const prompt = this.summarizePrefix + this.summarizeReleaseNotes;
    return inputs.render(prompt);
  }

  renderComment(inputs: Inputs): string {
    return inputs.render(this.comment);
  }

  renderReviewFileDiff(inputs: Inputs): string {
    return inputs.render(this.reviewFileDiff);
  }

  renderReviewFileDiffUsingStandardDiffBlock(inputs: Inputs): string {
    return inputs.render(this.reviewFileDiffUsingStandardDiffBlock);
  }
}
