import { Run, OctokitGitHub, GitHub } from "./github";
import { Input, parseInput } from "./input";
import { setOutput } from "@actions/core";

export interface Wait {
  wait(secondsSoFar?: number): Promise<number>;
}

export class Waiter implements Wait {
  private readonly info: (msg: string) => void;
  private input: Input;
  private githubClient: GitHub;
  private workflowId: any;
  private attempt: number;

  constructor(
    workflowId: any,
    githubClient: GitHub,
    input: Input,
    info: (msg: string) => void
  ) {
    this.workflowId = workflowId;
    this.input = input;
    this.githubClient = githubClient;
    this.info = info;
    this.attempt = 0;
  }

  wait = async (secondsSoFar?: number) => {
    let pollingInterval = this.input.pollIntervalSeconds;

    if (
      this.input.continueAfterSeconds &&
      (secondsSoFar || 0) >= this.input.continueAfterSeconds
    ) {
      this.info(`🤙Exceeded wait seconds. Continuing...`);
      setOutput("force_continued", "1");
      return secondsSoFar || 0;
    }

    if (
      this.input.abortAfterSeconds &&
      (secondsSoFar || 0) >= this.input.abortAfterSeconds
    ) {
      this.info(`🛑Exceeded wait seconds. Aborting...`);
      setOutput("force_continued", "");
      throw new Error(`Aborted after waiting ${secondsSoFar} seconds`);
    }

    const runs = await this.githubClient.runs(
      this.input.owner,
      this.input.repo,
      this.input.sameBranchOnly ? this.input.branch : undefined,
      this.workflowId
    );
    const previousRuns = runs
      .filter((run) => ["in_progress", "queued"].includes(run.status))
      .filter((run) => run.id < this.input.runId)
      .sort((a, b) => b.id - a.id);
    if (!previousRuns || !previousRuns.length) {
      setOutput("force_continued", "");
      return;
    }

    const previousRun = previousRuns[0];
    this.info(`✋Awaiting run ${previousRun.html_url} ...`);

    if (this.input.exponentialBackoffRetries) {
      pollingInterval =
        this.input.pollIntervalSeconds * (2 * this.attempt || 1);
      this.info(
        `🔁 Attempt ${
          this.attempt + 1
        }, next will be in ${pollingInterval} seconds`
      );
      this.attempt++;
    }

    await new Promise((resolve) => setTimeout(resolve, pollingInterval * 1000));
    return this.wait((secondsSoFar || 0) + pollingInterval);
  };
}
