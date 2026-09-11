import * as core from "@actions/core";
import * as github from "@actions/github";
import * as label from "@csm-actions/label";
import { validate } from "./validate";
import { newAppOctokit } from "./app_octokit";

export const action = async () => {
  const serverRepositoryName = core.getInput("server_repository_name", {
    required: true,
  });
  const serverRepositoryOwner =
    core.getInput("server_repository_owner") || github.context.repo.owner;
  const owner = core.getInput("repository_owner") || github.context.repo.owner;
  const repo = core.getInput("repository_name") || github.context.repo.repo;
  const pullRequestNumber = Number(
    core.getInput("pull_request_number", { required: true }),
  );
  const githubToken = core.getInput("github_token", { required: true });

  const allowedCommittersInput = core.getInput("allowed_committers").trim();
  const allowedCommitters = allowedCommittersInput
    ? allowedCommittersInput
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : ["renovate[bot]", "dependabot[bot]"];

  // Validate PR using the provided github_token
  const octokit = github.getOctokit(githubToken);
  const result = await validate({
    octokit,
    owner,
    repo,
    pullRequestNumber,
    allowedCommitters,
  });

  if (!result.approved) {
    core.info("PR validation failed, skipping label creation");
    return;
  }

  // Create label in server repository to trigger server workflow
  const labelName = label.newName("approve-pr-");
  const description = `${owner}/${repo}/${pullRequestNumber}`;

  core.info(
    `creating a label: ${JSON.stringify({
      owner: serverRepositoryOwner,
      repo: serverRepositoryName,
      label: {
        name: labelName,
        description: description,
      },
    })}`,
  );

  await label.create({
    appOctokit: newAppOctokit(),
    owner: serverRepositoryOwner,
    repo: serverRepositoryName,
    name: labelName,
    description: description,
  });

  core.notice(
    `PR will be approved. Please check the server workflow: ${github.context.serverUrl}/${serverRepositoryOwner}/${serverRepositoryName}/actions`,
  );
};
