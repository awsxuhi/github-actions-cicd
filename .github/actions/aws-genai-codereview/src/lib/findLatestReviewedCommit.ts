import { context as github_context } from "@actions/github";
import { octokit } from "../octokit";
import { printWithColor } from "@/utils";

/****************************************************************************************************
 * xuhi: I eventually didn't use this function to get the highest reviewed commit id,
 * but I kept it here for reference. This function looks not a good way to find the id.
 * 
 * To invoke it in review().ts, paste below lines:
 * 
 const [hasExistingReview, highestReviewedCommitId_2ndApproach] = await findLatestReviewedCommit(
    repo.owner,
    repo.repo,
    context.payload.pull_request.number,
    `**${options.botName}**`,
    context.payload.pull_request.head.sha
  );
  printWithColor("hasExistingReview", hasExistingReview);
  printWithColor("highestReviewedCommitId_2ndApproach", highestReviewedCommitId_2ndApproach);
 ***************************************************************************************************/

type ReviewResult = [boolean, string]; // Return type as a tuple with boolean and string

interface Review {
  id: number;
  node_id: string;
  user: {
    login: string;
    id: number;
  } | null;
  body?: string;
  commit_id: string | null; // Accepting string or null based on the fetched data
  submitted_at?: string;
}

/**
 * Finds the latest reviewed commit based on a specific search string.
 *
 * @param owner - The owner of the repository
 * @param repo - The repository name
 * @param pull_number - The pull request number
 * @param searchString - The string to search for in the review comments
 * @param baseSha - The base commit SHA to return if no matching review is found
 * @returns A tuple where the first element indicates if a matching review exists, and the second element is the commit ID or base SHA
 */
export async function findLatestReviewedCommit(owner: string, repo: string, pull_number: number, searchString: string, baseSha: string): Promise<ReviewResult> {
  const context = github_context;

  // Get all reviews for the specified pull request
  const reviewsResponse = await octokit.pulls.listReviews({
    owner,
    repo,
    pull_number,
  });
  printWithColor("reviewsResponse (result from octokit.pulls.listReviews)", reviewsResponse, 2);

  // Ensure reviews exist and assign them to a strongly-typed array
  const reviews: Review[] = reviewsResponse.data as Review[];
  printWithColor("# of existing reviews: ", reviews.length);
  printWithColor("searchString: ", searchString);

  // reviews.forEach((review) => {
  //   printWithColor("All reviews:", review.body);
  // });

  // Filter reviews that include the search string at the beginning of the body
  // const filteredReviews = reviews.filter((review) => review.body && review.body.startsWith(searchString));
  const filteredReviews = reviews.filter((review) => review.body && review.body.includes(searchString));
  filteredReviews.forEach((filteredReviews) => {
    printWithColor("Filtered reviews:", filteredReviews.body);
  });

  // Check if there are any matching reviews
  if (filteredReviews.length > 0) {
    // Find the latest review based on the submission date
    const latestFilteredReview = filteredReviews.reduce((latest, current) =>
      new Date(current.submitted_at || 0) > new Date(latest.submitted_at || 0) ? current : latest
    );

    // Return a tuple indicating that a matching review was found and its commit ID
    return [true, latestFilteredReview.commit_id ?? baseSha];
  } else {
    // Return a tuple indicating no matching review was found, and provide the base SHA
    return [false, baseSha];
  }
}
