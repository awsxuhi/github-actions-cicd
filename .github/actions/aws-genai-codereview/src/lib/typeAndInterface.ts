import { components } from "@octokit/openapi-types";

export type FileDiff = components["schemas"]["diff-entry"];

export type Commit = components["schemas"]["commit"];

export type FilteredFile = [string, string, string, Array<[number, number, string]>];

export interface Review {
  startLine: number;
  endLine: number;
  comment: string;
}
