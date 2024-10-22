import { components } from "@octokit/openapi-types";

export type FileDiff = components["schemas"]["diff-entry"];

export type Commit = components["schemas"]["commit"];

export type FilteredFile = [string, string, string, Array<[number, number, string]>];

export interface FilesResultFromCompareCommits {
  sha: string;
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  patch?: string | null | undefined;
  previous_filename?: string | undefined;
}
