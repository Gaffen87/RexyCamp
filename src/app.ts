import type { Assignment, BasecampClient, CardColumn, RecordingDetail } from "./basecamp.ts";
import type { HandoffMode } from "./handoff.ts";
import { displayWidth, fitToWidth, wrapText } from "./text.ts";
import { drawKeyHints, drawPanel, drawStatus, innerSize, scrollToShow, SGR, styled, type KeyHint } from "./view.ts";

export type PanelName = "assignments" | "columns" | "detail";
const PANEL_ORDER: PanelName[] = ["assignments", "columns", "detail"];

const KIND_ICONS: Record<Assignment["kind"], string> = { card: "■", todo: "□", step: "◆", other: "•" };
const KIND_LABELS: Record<Assignment["kind"], string> = { card: "Card in", todo: "To-do in", step: "Step of", other: "In" };
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const UP_NEXT_HEADING = "Up Next";

export interface AppDependencies {
  client: Pick<BasecampClient, "isSignedIn" | "listAssignments" | "describeRecording" | "listColumns" | "moveCard">;
  handOff(mode: HandoffMode, assignment: Assignment, detail: RecordingDetail | null): Promise<void>;
  openUrl(url: string): Promise<void>;
  requestRender(): void;
  quit(): void;
  today(): string;
  selectionDelayMilliseconds: number;
}

type ListRow =
  | { type: "heading"; text: string }
  | { type: "assignment"; assignment: Assignment; assignmentIndex: number };

interface DueLabel {
  text: string;
  colorCodes: string[];
}

export function orderAssignments(assignments: Assignment[]): Assignment[] {
  const upNext = assignments.filter((assignment) => assignment.isUpNext);
  const others = assignments
    .filter((assignment) => !assignment.isUpNext)
    .sort((first, second) =>
      first.projectName.localeCompare(second.projectName)
      || (first.dueOn ?? "9999").localeCompare(second.dueOn ?? "9999")
      || first.title.localeCompare(second.title));
  return [...upNext, ...others];
}

export function formatDue(dueOn: string | null, today: string): DueLabel | null {
  if (!dueOn) return null;
  if (dueOn === today) return { text: "today", colorCodes: [SGR.yellow] };
  const [year, month, day] = dueOn.split("-").map(Number);
  const monthName = MONTH_NAMES[(month ?? 1) - 1] ?? "";
  const dateText = `${monthName} ${day}${String(year) === today.slice(0, 4) ? "" : ` ${year}`}`;
  return { text: dateText, colorCodes: dueOn < today ? [SGR.red] : [SGR.dim] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class App {
  private assignments: Assignment[] = [];
  private selectedIndex = 0;
  private listScrollTop = 0;
  private focusedPanel: PanelName = "assignments";

  private columns: CardColumn[] | null = null;
  private columnsNote = "";
  private columnCursor = 0;
  private columnScrollTop = 0;

  private detailById = new Map<number, RecordingDetail>();
  private detailRequestById = new Map<number, Promise<RecordingDetail>>();
  private detailErrorById = new Map<number, string>();
  private detailScroll = 0;

  private isLoadingAssignments = false;
  private loadError: string | null = null;
  private status: { text: string; isError: boolean } | null = null;
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly dependencies: AppDependencies) {}

  async refresh(): Promise<void> {
    const previouslySelectedId = this.selected()?.id;
    this.isLoadingAssignments = true;
    this.loadError = null;
    this.dependencies.requestRender();
    try {
      this.assignments = orderAssignments(await this.dependencies.client.listAssignments());
      this.detailById.clear();
      this.detailRequestById.clear();
      this.detailErrorById.clear();
      const keptIndex = this.assignments.findIndex((assignment) => assignment.id === previouslySelectedId);
      this.selectedIndex = keptIndex >= 0 ? keptIndex : Math.min(this.selectedIndex, Math.max(0, this.assignments.length - 1));
    } catch (error) {
      this.assignments = [];
      this.loadError = await this.describeLoadError(error);
    }
    this.isLoadingAssignments = false;
    this.columns = null;
    this.dependencies.requestRender();
    await this.loadSelectionExtras();
  }

  private async describeLoadError(error: unknown): Promise<string> {
    const isSignedIn = await this.dependencies.client.isSignedIn().catch(() => true);
    if (!isSignedIn) return "You are not signed in to Basecamp.\n\nRun this in a shell, then press r here:\n\n  basecamp auth login";
    return errorMessage(error);
  }

  private selected(): Assignment | undefined {
    return this.assignments[this.selectedIndex];
  }

  private setStatus(text: string, isError = false): void {
    this.status = { text, isError };
    this.dependencies.requestRender();
  }

  private select(index: number): void {
    const clampedIndex = Math.max(0, Math.min(index, this.assignments.length - 1));
    if (clampedIndex === this.selectedIndex) return;
    this.selectedIndex = clampedIndex;
    this.detailScroll = 0;
    this.columns = null;
    this.columnsNote = "";
    // Holding j must not start one basecamp process per row passed.
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => void this.loadSelectionExtras(), this.dependencies.selectionDelayMilliseconds);
  }

  private detailFor(assignment: Assignment): Promise<RecordingDetail> {
    const pendingRequest = this.detailRequestById.get(assignment.id);
    if (pendingRequest) return pendingRequest;
    const request = this.dependencies.client.describeRecording(assignment).then(
      (detail) => {
        this.detailById.set(assignment.id, detail);
        return detail;
      },
      (error) => {
        this.detailRequestById.delete(assignment.id);
        this.detailErrorById.set(assignment.id, errorMessage(error));
        throw error;
      },
    );
    this.detailRequestById.set(assignment.id, request);
    return request;
  }

  private async loadColumns(assignment: Assignment): Promise<void> {
    if (assignment.kind !== "card") {
      this.columnsNote = "Only cards have columns";
      return;
    }
    this.columnsNote = "Loading columns…";
    try {
      const columns = await this.dependencies.client.listColumns(assignment);
      if (this.selected()?.id !== assignment.id) return;
      this.columns = columns;
      this.columnCursor = Math.max(0, columns.findIndex((column) => column.id === assignment.parentId));
    } catch (error) {
      if (this.selected()?.id === assignment.id) this.columnsNote = errorMessage(error);
    }
  }

  private async loadSelectionExtras(): Promise<void> {
    const assignment = this.selected();
    if (!assignment) return;
    this.dependencies.requestRender();
    await Promise.all([
      this.detailFor(assignment).catch(() => null).then(() => this.dependencies.requestRender()),
      this.loadColumns(assignment).then(() => this.dependencies.requestRender()),
    ]);
  }

  handleKey(key: string): void {
    this.status = null;
    if (key === "q" || key === "ctrl+c") return this.dependencies.quit();
    if (!this.handleGlobalKey(key)) {
      if (this.focusedPanel === "assignments") this.handleAssignmentsKey(key);
      else if (this.focusedPanel === "columns") this.handleColumnsKey(key);
      else this.handleDetailKey(key);
    }
    this.dependencies.requestRender();
  }

  private handleGlobalKey(key: string): boolean {
    const focusedPanelIndex = PANEL_ORDER.indexOf(this.focusedPanel);
    switch (key) {
      case "tab": case "l": case "right":
        this.focusedPanel = PANEL_ORDER[(focusedPanelIndex + 1) % PANEL_ORDER.length]!;
        return true;
      case "shift+tab": case "h": case "left":
        this.focusedPanel = PANEL_ORDER[(focusedPanelIndex + PANEL_ORDER.length - 1) % PANEL_ORDER.length]!;
        return true;
      case "1": case "2": case "3":
        this.focusedPanel = PANEL_ORDER[Number(key) - 1]!;
        return true;
      case "r": void this.refresh(); return true;
      case "f": void this.handOffSelected("fix"); return true;
      case "p": void this.handOffSelected("plan"); return true;
      case "o": void this.openSelected(); return true;
      case "m": this.startMove(); return true;
      default: return false;
    }
  }

  private handleAssignmentsKey(key: string): void {
    const pageSize = 10;
    switch (key) {
      case "j": case "down": return this.select(this.selectedIndex + 1);
      case "k": case "up": return this.select(this.selectedIndex - 1);
      case "g": case "home": return this.select(0);
      case "G": case "end": return this.select(this.assignments.length - 1);
      case "pagedown": case "ctrl+d": return this.select(this.selectedIndex + pageSize);
      case "pageup": case "ctrl+u": return this.select(this.selectedIndex - pageSize);
      case "enter": this.focusedPanel = "detail"; return;
    }
  }

  private handleColumnsKey(key: string): void {
    const lastColumnIndex = Math.max(0, (this.columns?.length ?? 1) - 1);
    switch (key) {
      case "j": case "down": this.columnCursor = Math.min(lastColumnIndex, this.columnCursor + 1); return;
      case "k": case "up": this.columnCursor = Math.max(0, this.columnCursor - 1); return;
      case "enter": void this.moveSelectedCard(); return;
      case "escape": this.focusedPanel = "assignments"; return;
    }
  }

  private handleDetailKey(key: string): void {
    const pageSize = 10;
    switch (key) {
      case "j": case "down": this.detailScroll += 1; return;
      case "k": case "up": this.detailScroll -= 1; return;
      case "pagedown": case "ctrl+d": this.detailScroll += pageSize; return;
      case "pageup": case "ctrl+u": this.detailScroll -= pageSize; return;
      case "g": case "home": this.detailScroll = 0; return;
      case "escape": this.focusedPanel = "assignments"; return;
    }
  }

  private startMove(): void {
    const assignment = this.selected();
    if (!assignment) return;
    if (assignment.kind !== "card") return this.setStatus("Only cards can be moved");
    if (!this.columns) return this.setStatus(this.columnsNote || "Columns are still loading");
    this.columnCursor = Math.max(0, this.columns.findIndex((column) => column.id === assignment.parentId));
    this.focusedPanel = "columns";
  }

  private async moveSelectedCard(): Promise<void> {
    const card = this.selected();
    const targetColumn = this.columns?.[this.columnCursor];
    if (!card || card.kind !== "card" || !targetColumn) return;
    if (targetColumn.id === card.parentId) return this.setStatus(`Already in ${targetColumn.title}`);
    this.setStatus(`Moving to ${targetColumn.title}…`);
    try {
      await this.dependencies.client.moveCard(card, targetColumn);
      card.parentId = targetColumn.id;
      card.parentTitle = targetColumn.title;
      this.focusedPanel = "assignments";
      this.setStatus(`Moved "${card.title}" to ${targetColumn.title}`);
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  private async handOffSelected(mode: HandoffMode): Promise<void> {
    const assignment = this.selected();
    if (!assignment) return;
    this.setStatus(`Starting Claude Code to ${mode} "${assignment.title}"…`);
    try {
      const detail = await this.detailFor(assignment).catch(() => null);
      await this.dependencies.handOff(mode, assignment, detail);
      this.setStatus(`Claude Code is ${mode === "fix" ? "fixing" : "planning"} "${assignment.title}" in a new tab`);
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  private async openSelected(): Promise<void> {
    const assignment = this.selected();
    if (!assignment) return;
    if (!assignment.appUrl) return this.setStatus("This assignment has no link", true);
    try {
      await this.dependencies.openUrl(assignment.appUrl);
      this.setStatus(`Opened "${assignment.title}" in Basecamp`);
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  private listRows(): ListRow[] {
    const rows: ListRow[] = [];
    let currentHeading: string | null = null;
    this.assignments.forEach((assignment, assignmentIndex) => {
      const heading = assignment.isUpNext ? UP_NEXT_HEADING : assignment.projectName;
      if (heading !== currentHeading) {
        rows.push({ type: "heading", text: heading });
        currentHeading = heading;
      }
      rows.push({ type: "assignment", assignment, assignmentIndex });
    });
    return rows;
  }

  private messageLines(message: string, width: number, ...codes: string[]): string[] {
    return ["", ...wrapText(message, width - 2)].map((line) => styled(fitToWidth(` ${line}`, width), ...codes));
  }

  private assignmentLines(width: number, height: number): string[] {
    if (this.isLoadingAssignments && this.assignments.length === 0) {
      return this.messageLines("Loading your assignments…", width, SGR.dim);
    }
    if (this.loadError) return this.messageLines(this.loadError, width, SGR.red);
    if (this.assignments.length === 0) return this.messageLines("Nothing is assigned to you.", width, SGR.dim);

    const rows = this.listRows();
    const selectedRowIndex = rows.findIndex((row) => row.type === "assignment" && row.assignmentIndex === this.selectedIndex);
    const showsHeadingAbove = rows[selectedRowIndex - 1]?.type === "heading";
    const topRowToShow = showsHeadingAbove ? selectedRowIndex - 1 : selectedRowIndex;
    this.listScrollTop = scrollToShow(topRowToShow, this.listScrollTop, height, rows.length);
    this.listScrollTop = scrollToShow(selectedRowIndex, this.listScrollTop, height, rows.length);

    const today = this.dependencies.today();
    return rows.slice(this.listScrollTop, this.listScrollTop + height).map((row) => {
      if (row.type === "heading") {
        return styled(fitToWidth(row.text, width), SGR.bold, row.text === UP_NEXT_HEADING ? SGR.yellow : SGR.cyan);
      }
      const due = formatDue(row.assignment.dueOn, today);
      const dueWidth = due ? displayWidth(due.text) + 2 : 0;
      const titleText = fitToWidth(`  ${KIND_ICONS[row.assignment.kind]} ${row.assignment.title}`, width - dueWidth);
      const dueText = due ? ` ${due.text} ` : "";
      if (row.assignmentIndex !== this.selectedIndex) return titleText + styled(dueText, ...(due?.colorCodes ?? []));
      return this.focusedPanel === "assignments"
        ? styled(titleText + dueText, SGR.selected)
        : styled(titleText, SGR.bold) + styled(dueText, ...(due?.colorCodes ?? []));
    });
  }

  private columnLines(width: number, height: number): string[] {
    const card = this.selected();
    if (!this.columns || !card) return [styled(fitToWidth(` ${this.columnsNote}`, width), SGR.dim)];
    this.columnScrollTop = scrollToShow(this.columnCursor, this.columnScrollTop, height, this.columns.length);
    return this.columns.slice(this.columnScrollTop, this.columnScrollTop + height).map((column, visibleIndex) => {
      const isCurrentColumn = column.id === card.parentId;
      const lineText = fitToWidth(` ${isCurrentColumn ? "●" : " "} ${column.title}`, width);
      const isUnderCursor = this.columnScrollTop + visibleIndex === this.columnCursor;
      if (isUnderCursor && this.focusedPanel === "columns") return styled(lineText, SGR.selected);
      return isCurrentColumn ? styled(lineText, SGR.bold, SGR.green) : lineText;
    });
  }

  private detailLines(width: number, height: number): string[] {
    const assignment = this.selected();
    if (!assignment) return [];
    const textWidth = width - 2;
    const lines: string[] = [];
    const addLines = (text: string, ...codes: string[]) => {
      for (const line of wrapText(text, textWidth)) lines.push(styled(fitToWidth(` ${line}`, width), ...codes));
    };
    const addField = (label: string, value: string, ...valueCodes: string[]) => {
      const labelText = ` ${label.padEnd(9)}`;
      lines.push(styled(labelText, SGR.dim) + styled(fitToWidth(value, width - displayWidth(labelText)), ...valueCodes));
    };

    addLines(assignment.title, SGR.bold);
    addLines("");
    addField("Project", assignment.projectName);
    if (assignment.parentTitle) addField(KIND_LABELS[assignment.kind], assignment.parentTitle);
    const due = formatDue(assignment.dueOn, this.dependencies.today());
    if (due) addField("Due", due.text, ...due.colorCodes.filter((code) => code !== SGR.dim));
    if (assignment.isUpNext) addField("Priority", UP_NEXT_HEADING, SGR.yellow);
    if (assignment.commentsCount > 0) addField("Comments", String(assignment.commentsCount));
    if (assignment.appUrl) addField("Link", assignment.appUrl, SGR.dim);
    addLines("");

    const detail = this.detailById.get(assignment.id);
    const detailError = this.detailErrorById.get(assignment.id);
    if (detail) {
      for (const step of detail.steps) addLines(`${step.isCompleted ? "✓" : "○"} ${step.title}`, ...(step.isCompleted ? [SGR.dim] : []));
      if (detail.steps.length > 0) addLines("");
      if (detail.descriptionText) addLines(detail.descriptionText);
      else addLines("No description.", SGR.dim);
    } else if (detailError) {
      addLines(detailError, SGR.red);
    } else {
      addLines("Loading…", SGR.dim);
    }

    this.detailScroll = Math.max(0, Math.min(this.detailScroll, Math.max(0, lines.length - height)));
    return lines.slice(this.detailScroll, this.detailScroll + height);
  }

  private keyHints(): KeyHint[] {
    if (this.focusedPanel === "columns") {
      return [
        { key: "enter", action: "move here" }, { key: "j/k", action: "choose" },
        { key: "esc", action: "cancel" }, { key: "q", action: "quit" },
      ];
    }
    const selectedKind = this.selected()?.kind;
    return [
      { key: "f", action: "fix" }, { key: "p", action: "plan" },
      ...(selectedKind === "card" ? [{ key: "m", action: "move" }] : []),
      { key: "o", action: "open" }, { key: "r", action: "refresh" },
      { key: "j/k", action: this.focusedPanel === "detail" ? "scroll" : "select" },
      { key: "tab", action: "panel" }, { key: "q", action: "quit" },
    ];
  }

  render(width: number, height: number): string[] {
    const bodyHeight = Math.max(6, height - 1);
    const leftWidth = Math.max(24, Math.min(60, Math.floor(width * 0.4)));
    const rightWidth = Math.max(10, width - leftWidth);
    const columnsPanelHeight = Math.min(Math.max(3, (this.columns?.length ?? 1) + 2), Math.max(3, Math.floor(bodyHeight * 0.4)));
    const assignmentsPanelHeight = bodyHeight - columnsPanelHeight;

    const assignmentsInner = innerSize(leftWidth, assignmentsPanelHeight);
    const columnsInner = innerSize(leftWidth, columnsPanelHeight);
    const detailInner = innerSize(rightWidth, bodyHeight);

    const leftLines = [
      ...drawPanel({
        number: 1,
        title: "Assignments",
        lines: this.assignmentLines(assignmentsInner.width, assignmentsInner.height),
        isFocused: this.focusedPanel === "assignments",
        footer: this.assignments.length > 0 ? `${this.selectedIndex + 1} of ${this.assignments.length}` : "",
      }, leftWidth, assignmentsPanelHeight),
      ...drawPanel({
        number: 2,
        title: "Columns",
        lines: this.columnLines(columnsInner.width, columnsInner.height),
        isFocused: this.focusedPanel === "columns",
      }, leftWidth, columnsPanelHeight),
    ];
    const rightLines = drawPanel({
      number: 3,
      title: "Detail",
      lines: this.detailLines(detailInner.width, detailInner.height),
      isFocused: this.focusedPanel === "detail",
    }, rightWidth, bodyHeight);

    const bottomLine = this.status
      ? drawStatus(this.status.text, this.status.isError, width)
      : drawKeyHints(this.keyHints(), width);
    return [...leftLines.map((leftLine, lineIndex) => leftLine + (rightLines[lineIndex] ?? "")), bottomLine];
  }
}
