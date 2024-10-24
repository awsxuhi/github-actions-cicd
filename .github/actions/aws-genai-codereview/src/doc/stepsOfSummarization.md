## Step 1: generate the summary for each file (based on its changes)

Right after doSummary()
printWithColor("inputs.rawSummary (1. initial value):", inputs.rawSummary);

result:

## Step 2: generate the summary for all files (based on their changes)

The obtained summaries are concatenated into a longer string according to batchsize, and the large language model is further summarized to form a summary of all summaries.

## Step 3: generate final summary (the content of summarizeCmt = ## Walkthrough + ## Changes)

## Step 4: generate final release notes = PR Description

## Step 5: generate a short summary as well
