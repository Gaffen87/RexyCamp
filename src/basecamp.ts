import { htmlToText } from "./text.ts";

export type AssignmentKind = "card" | "todo" | "step" | "other";

export interface Assignment {
  id: number;
  kind: AssignmentKind;
  title: string;
  projectId: number;
  projectName: string;
  parentId: number | null;
  parentTitle: string;
  dueOn: string | null;
  appUrl: string;
  commentsCount: number;
  isUpNext: boolean;
}

export interface CardColumn {
  id: number;
  title: string;
}

export interface RecordingDetail {
  descriptionText: string;
  steps: { title: string; isCompleted: boolean }[];
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (commandArguments: string[]) => Promise<CommandResult>;

export class BasecampError extends Error {
  constructor(message: string, readonly code: string = "unknown") {
    super(message);
  }
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function kindOfType(recordingType: string): AssignmentKind {
  const normalizedType = recordingType.toLowerCase();
  if (normalizedType.includes("step")) return "step";
  if (normalizedType.includes("card")) return "card";
  if (normalizedType.includes("todo")) return "todo";
  return "other";
}

function parseAssignment(rawAssignment: unknown, isUpNext: boolean): Assignment | null {
  const record = asRecord(rawAssignment);
  const id = asNumber(record.id);
  if (id === null) return null;
  const bucket = asRecord(record.bucket);
  const parent = asRecord(record.parent);
  return {
    id,
    kind: kindOfType(asString(record.type)),
    title: asString(record.content) || asString(record.title) || `#${id}`,
    projectId: asNumber(bucket.id) ?? 0,
    projectName: asString(bucket.name) || "No project",
    parentId: asNumber(parent.id),
    parentTitle: asString(parent.title),
    dueOn: asString(record.due_on) || null,
    appUrl: asString(record.app_url),
    commentsCount: asNumber(record.comments_count) ?? 0,
    isUpNext,
  };
}

export function parseAssignments(data: unknown): Assignment[] {
  const result = asRecord(data);
  const parsedAssignments = [
    ...asArray(result.priorities).map((rawAssignment) => parseAssignment(rawAssignment, true)),
    ...asArray(result.non_priorities).map((rawAssignment) => parseAssignment(rawAssignment, false)),
  ];
  return parsedAssignments.filter((assignment): assignment is Assignment => assignment !== null);
}

export function parseColumns(data: unknown): CardColumn[] {
  return asArray(data).flatMap((rawColumn) => {
    const record = asRecord(rawColumn);
    const id = asNumber(record.id);
    return id === null ? [] : [{ id, title: asString(record.title) || `#${id}` }];
  });
}

export function parseRecordingDetail(data: unknown, kind: AssignmentKind): RecordingDetail {
  const record = asRecord(data);
  const descriptionHtml = kind === "todo"
    ? asString(record.description)
    : asString(record.content) || asString(record.description);
  return {
    descriptionText: htmlToText(descriptionHtml),
    steps: asArray(record.steps).map((rawStep) => {
      const step = asRecord(rawStep);
      return { title: asString(step.title), isCompleted: step.completed === true };
    }),
  };
}

export function parseEnvelope(commandResult: CommandResult): unknown {
  const output = commandResult.stdout.trim() || commandResult.stderr.trim();
  let envelope: JsonRecord;
  try {
    envelope = asRecord(JSON.parse(output));
  } catch {
    throw new BasecampError(output.split("\n")[0] || `basecamp exited with status ${commandResult.exitCode}`);
  }
  if (envelope.ok !== true) {
    throw new BasecampError(asString(envelope.error) || "basecamp reported an error", asString(envelope.code) || "unknown");
  }
  return envelope.data;
}

export function spawnBasecamp(binaryPath: string): CommandRunner {
  return async (commandArguments) => {
    let childProcess;
    try {
      childProcess = Bun.spawn([binaryPath, ...commandArguments], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: process.env });
    } catch {
      throw new BasecampError(`cannot run ${binaryPath}; install the Basecamp CLI or set REXYCAMP_BASECAMP_BIN`, "not_installed");
    }
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(childProcess.stdout).text(),
      new Response(childProcess.stderr).text(),
      childProcess.exited,
    ]);
    return { exitCode, stdout, stderr };
  };
}

export class BasecampClient {
  private cardTableIdByColumnId = new Map<number, number>();
  private columnsByCardTableId = new Map<number, CardColumn[]>();

  constructor(private readonly runCommand: CommandRunner) {}

  private async request(commandArguments: string[]): Promise<unknown> {
    return parseEnvelope(await this.runCommand([...commandArguments, "--json"]));
  }

  async isSignedIn(): Promise<boolean> {
    return asRecord(await this.request(["auth", "status"])).authenticated === true;
  }

  async listAssignments(): Promise<Assignment[]> {
    return parseAssignments(await this.request(["assignments", "list"]));
  }

  async describeRecording(assignment: Assignment): Promise<RecordingDetail> {
    const data = await this.request(["show", assignment.appUrl || String(assignment.id), "--no-comments"]);
    return parseRecordingDetail(data, assignment.kind);
  }

  // The assignment only names the card's column, so the card table comes from that column.
  async listColumns(card: Assignment): Promise<CardColumn[]> {
    if (card.parentId === null) throw new BasecampError("this card has no column");
    const projectId = String(card.projectId);
    let cardTableId = this.cardTableIdByColumnId.get(card.parentId);
    if (cardTableId === undefined) {
      const column = asRecord(await this.request(["cards", "column", "show", String(card.parentId), "--in", projectId]));
      const foundCardTableId = asNumber(asRecord(column.parent).id);
      if (foundCardTableId === null) throw new BasecampError("cannot find the card table of this card");
      cardTableId = foundCardTableId;
    }
    let columns = this.columnsByCardTableId.get(cardTableId);
    if (columns === undefined) {
      columns = parseColumns(await this.request(["cards", "columns", "--in", projectId, "--card-table", String(cardTableId)]));
      this.columnsByCardTableId.set(cardTableId, columns);
    }
    for (const column of columns) this.cardTableIdByColumnId.set(column.id, cardTableId);
    return columns;
  }

  async moveCard(card: Assignment, targetColumn: CardColumn): Promise<void> {
    await this.request(["cards", "move", String(card.id), "--to", String(targetColumn.id), "--in", String(card.projectId)]);
  }
}
