import type { Assignment, RecordingDetail } from "./basecamp.ts";
import { truncateToWidth } from "./text.ts";

export type HandoffMode = "fix" | "plan";

export interface HandoffEnvironment {
  rexBinary: string;
  claudeBinary: string;
  rexSessionId: string | undefined;
  workingDirectory: string;
}

const KIND_NAMES: Record<Assignment["kind"], string> = {
  card: "card", todo: "to-do", step: "card step", other: "item",
};

export function buildHandoffPrompt(mode: HandoffMode, assignment: Assignment, detail: RecordingDetail | null): string {
  const instruction = mode === "fix"
    ? "Fix this Basecamp assignment in this repository."
    : "Plan how to solve this Basecamp assignment in this repository. Do not change any code yet.";
  const promptLines = [
    instruction,
    "",
    `Title: ${assignment.title}`,
    `Type: ${KIND_NAMES[assignment.kind]}${assignment.parentTitle ? ` in "${assignment.parentTitle}"` : ""}`,
    `Project: ${assignment.projectName}`,
  ];
  if (assignment.dueOn) promptLines.push(`Due: ${assignment.dueOn}`);
  if (assignment.appUrl) promptLines.push(`Link: ${assignment.appUrl}`);
  const openSteps = (detail?.steps ?? []).filter((step) => !step.isCompleted);
  if (openSteps.length > 0) {
    promptLines.push("", "Open steps:", ...openSteps.map((step) => `- ${step.title}`));
  }
  promptLines.push("", "Description:", detail?.descriptionText || "(none)");
  if (assignment.appUrl) {
    promptLines.push("", `Read its comments with: basecamp show ${assignment.appUrl} --comments --md`);
  }
  return promptLines.join("\n");
}

export function worktreeName(assignment: Assignment): string {
  const titleSlug = assignment.title
    .toLowerCase()
    .replace(/[æøå]/g, (letter) => ({ æ: "ae", ø: "oe", å: "aa" })[letter] ?? letter)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return titleSlug === "" ? `basecamp-${assignment.id}` : `basecamp-${assignment.id}-${titleSlug}`;
}

export function buildHandoffCommand(
  mode: HandoffMode,
  assignment: Assignment,
  prompt: string,
  environment: HandoffEnvironment,
): string[] {
  const tabLabel = `${mode}: ${truncateToWidth(assignment.title, 24)}`;
  const sessionArguments = environment.rexSessionId ? ["-s", environment.rexSessionId] : [];
  // --worktree takes an optional name, so one is always given to keep it from reading the prompt as the name.
  const claudeArguments = ["--worktree", worktreeName(assignment), ...(mode === "plan" ? ["--permission-mode", "plan"] : [])];
  return [
    environment.rexBinary, "window", "new", ...sessionArguments, tabLabel,
    "-c", environment.workingDirectory,
    "--", environment.claudeBinary, ...claudeArguments, prompt,
  ];
}

async function runQuietly(command: string[]): Promise<void> {
  let childProcess;
  try {
    childProcess = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  } catch {
    throw new Error(`cannot run ${command[0]}`);
  }
  const [errorOutput, exitCode] = await Promise.all([new Response(childProcess.stderr).text(), childProcess.exited]);
  if (exitCode !== 0) throw new Error(errorOutput.trim().split("\n")[0] || `${command[0]} exited with status ${exitCode}`);
}

export function handOffToClaude(
  mode: HandoffMode,
  assignment: Assignment,
  detail: RecordingDetail | null,
  environment: HandoffEnvironment,
): Promise<void> {
  const prompt = buildHandoffPrompt(mode, assignment, detail);
  return runQuietly(buildHandoffCommand(mode, assignment, prompt, environment));
}

export function openInBrowser(url: string): Promise<void> {
  return runQuietly([process.platform === "darwin" ? "open" : "xdg-open", url]);
}
