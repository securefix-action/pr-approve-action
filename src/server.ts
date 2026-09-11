import * as core from "@actions/core";
import * as github from "@actions/github";
import * as githubAppToken from "@suzuki-shunsuke/github-app-token";
import { validate } from "./validate";
import { newAppOctokit } from "./app_octokit";

const parseLabelDescription = (
  description: string,
): { owner: string; repo: string; prNumber: number } => {
  // Format: "owner/repo/pr_number"
  const parts = description.split("/");
  if (parts.length !== 3) {
    throw new Error(
      `Invalid label description format: ${description}. Expected format: owner/repo/pr_number`,
    );
  }
  return {
    owner: parts[0],
    repo: parts[1],
    prNumber: Number(parts[2]),
  };
};

export const action = async () => {
  const labelDescription = github.context.payload.label?.description;
  if (!labelDescription) {
    throw new Error("Label description is not found in the event payload");
  }

  const { owner, repo, prNumber } = parseLabelDescription(labelDescription);

  // Create GitHub App token for validation (pull_requests:read, contents:read)
  const permissions: githubAppToken.Permissions = {
    pull_requests: "read",
    contents: "read",
  };
  core.info(
    `creating a GitHub App token for validation: ${JSON.stringify({
      owner: owner,
      repositories: [repo],
      permissions: permissions,
    })}`,
  );
  const token = await githubAppToken.create({
    octokit: newAppOctokit(),
    owner: owner,
    repositories: [repo],
    permissions: permissions,
  });
  core.setSecret(token.token);
  core.saveState("token", token.token);
  core.saveState("expires_at", token.expiresAt);

  const octokit = github.getOctokit(token.token);

  // Validate PR
  const allowedCommittersInput = core.getInput("allowed_committers").trim();
  const allowedCommitters = allowedCommittersInput
    ? allowedCommittersInput
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : ["renovate[bot]", "dependabot[bot]"];

  const result = await validate({
    octokit,
    owner,
    repo,
    pullRequestNumber: prNumber,
    allowedCommitters,
  });

  if (!result.approved) {
    core.info("PR validation failed, skipping approval");
    return;
  }

  // Approve the PR using the github_token input
  const githubToken = core.getInput("github_token", { required: true });
  const approvalOctokit = github.getOctokit(githubToken);

  try {
    core.notice(
      `Approving PR: ${process.env.GITHUB_SERVER_URL}/${owner}/${repo}/pull/${prNumber}`,
    );
    await approvalOctokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: result.lastSha,
      event: "APPROVE",
    });
  } catch (error) {
    // Post error comment to PR
    const workflowUrl = `${process.env.GITHUB_SERVER_URL}/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/${github.context.runId}`;
    await approvalOctokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `## :x: Failed to approve this pull request\n\n[Workflow](${workflowUrl})`,
    });
    throw error;
  }
};
