export const updateStatusMsg = (
  statusMsg: string,
  skippedFiles: string[],
  summariesFailed: string[],
  reviewsFailed: string[],
  reviewsSkipped: string[],
  reviewCount: number,
  lgtmCount: number
): string => {
  return (
    statusMsg +
    `
${
  skippedFiles.length > 0
    ? `
<details>
<summary>Files not processed due to max files limit (${skippedFiles.length})</summary>

* ${skippedFiles.join("\n* ")}

</details>
`
    : ""
}
${
  summariesFailed.length > 0
    ? `
<details>
<summary>Files not summarized due to errors (${summariesFailed.length})</summary>

* ${summariesFailed.join("\n* ")}

</details>
`
    : ""
}
${
  reviewsFailed.length > 0
    ? `<details>
<summary>Files not reviewed due to errors (${reviewsFailed.length})</summary>

* ${reviewsFailed.join("\n* ")}

</details>
`
    : ""
}
${
  reviewsSkipped.length > 0
    ? `<details>
<summary>Files skipped from review due to trivial changes (${reviewsSkipped.length})</summary>

* ${reviewsSkipped.join("\n* ")}

</details>
`
    : ""
}
<details>
<summary>Review comments generated (${reviewCount + lgtmCount})</summary>

* Review: ${reviewCount}
* LGTM: ${lgtmCount}

</details>

---

<details>
<summary>Tips</summary>

### Chat with AI reviewer (\`/reviewbot\`)
- Reply on review comments left by this bot to ask follow-up questions. A review comment is a comment on a diff or a file.
- Invite the bot into a review comment chain by tagging \`/reviewbot\` in a reply.

### Code suggestions
- The bot may make code suggestions, but please review them carefully before committing since the line number ranges may be misaligned. 
- You can edit the comment made by the bot and manually tweak the suggestion if it is slightly off.

### Pausing incremental reviews
- Add \`/reviewbot: ignore\` anywhere in the PR description to pause further reviews from the bot.

</details>
`
  );
};
