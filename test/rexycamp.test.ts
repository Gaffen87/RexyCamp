import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App, formatDue, orderAssignments, relevantColumns } from "../src/app.ts";
import { BasecampClient, BasecampError, parseAssignments, parseEnvelope, spawnBasecamp, type Assignment } from "../src/basecamp.ts";
import { buildHandoffCommand, buildHandoffPrompt, worktreeName, type HandoffMode } from "../src/handoff.ts";
import { parseKeys } from "../src/keys.ts";
import { displayWidth, fitToWidth, htmlToText, truncateToWidth, wrapText } from "../src/text.ts";

const fakeBasecampPath = join(import.meta.dir, "fake-basecamp.ts");
const stripStyles = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

describe("text", () => {
  test("truncates by display width, counting wide characters as two", () => {
    expect(truncateToWidth("日本語のタイトル", 7)).toBe("日本語…");
    expect(displayWidth(fitToWidth("日本語", 10))).toBe(10);
    expect(fitToWidth("abcdef", 4)).toBe("abc…");
  });

  test("wraps words and breaks words longer than the line", () => {
    expect(wrapText("one two three", 7)).toEqual(["one two", "three"]);
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("first\n\nsecond", 20)).toEqual(["first", "", "second"]);
  });

  test("turns Basecamp HTML into plain text", () => {
    const html = '<div>Hello <strong>world</strong> &amp; co<br>next</div><ul><li>one</li><li>two</li></ul><a href="https://x.dk">site</a>';
    expect(htmlToText(html)).toBe("Hello world & co\nnext\n\n  • one\n  • two\n\nsite (https://x.dk)");
  });
});

describe("keys", () => {
  test("reads arrows, control keys and several keys in one chunk", () => {
    expect(parseKeys("\x1b[A\x1b[B")).toEqual(["up", "down"]);
    expect(parseKeys("\x1b")).toEqual(["escape"]);
    expect(parseKeys("j\r\t\x1b[Z\x03")).toEqual(["j", "enter", "tab", "shift+tab", "ctrl+c"]);
    expect(parseKeys("\x1b[5~\x1bOF")).toEqual(["pageup", "end"]);
  });
});

describe("basecamp", () => {
  test("reads the envelope and reports its error", () => {
    expect(parseEnvelope({ exitCode: 0, stdout: '{"ok":true,"data":[1]}', stderr: "" })).toEqual([1]);
    expect(() => parseEnvelope({ exitCode: 1, stdout: '{"ok":false,"error":"nope","code":"usage"}', stderr: "" }))
      .toThrow(new BasecampError("nope", "usage"));
    expect(() => parseEnvelope({ exitCode: 127, stdout: "", stderr: "command not found" })).toThrow("command not found");
  });

  test("reads priorities before the other assignments and names their kind", () => {
    const assignments = parseAssignments({
      priorities: [{ id: 1, type: "Kanban::Card", content: "Card", bucket: { id: 5, name: "P" }, parent: { id: 9, title: "Doing" } }],
      non_priorities: [{ id: 2, type: "Todo", content: "Todo" }, { content: "no id" }],
    });
    expect(assignments.map((assignment) => [assignment.id, assignment.kind, assignment.isUpNext]))
      .toEqual([[1, "card", true], [2, "todo", false]]);
    expect(assignments[0]?.parentTitle).toBe("Doing");
  });
});

describe("hand-off", () => {
  const assignment: Assignment = {
    id: 7, kind: "card", title: "Fix the login loop", projectId: 100, projectName: "Web", parentId: 11,
    parentTitle: "In progress", dueOn: null, appUrl: "https://3.basecamp.com/1/buckets/100/card_tables/cards/7",
    commentsCount: 0, isUpNext: false,
  };

  test("opens Claude Code in a new Rex tab of the same session and directory", () => {
    const environment = { rexBinary: "/bin/rex", claudeBinary: "/bin/claude", rexSessionId: "session:1", workingDirectory: "/repo" };
    expect(buildHandoffCommand("plan", assignment, "PROMPT", environment)).toEqual([
      "/bin/rex", "window", "new", "-s", "session:1", "plan: Fix the login loop", "-c", "/repo",
      "--", "/bin/claude", "--worktree", "basecamp-7-fix-the-login-loop", "--permission-mode", "plan", "PROMPT",
    ]);
    expect(buildHandoffCommand("fix", assignment, "PROMPT", environment).slice(-4))
      .toEqual(["/bin/claude", "--worktree", "basecamp-7-fix-the-login-loop", "PROMPT"]);
    expect(worktreeName({ ...assignment, title: "'Søgning' æøå!" })).toBe("basecamp-7-soegning-aeoeaa");
    expect(worktreeName({ ...assignment, title: "日本語" })).toBe("basecamp-7");
  });

  test("puts the title, link, open steps and description in the prompt", () => {
    const prompt = buildHandoffPrompt("fix", assignment, {
      descriptionText: "It loops.",
      steps: [{ title: "Done step", isCompleted: true }, { title: "Open step", isCompleted: false }],
    });
    expect(prompt).toContain("Fix this Basecamp assignment");
    expect(prompt).toContain('Type: card in "In progress"');
    expect(prompt).toContain("- Open step");
    expect(prompt).not.toContain("Done step");
    expect(prompt).toContain("It loops.");
  });
});

describe("app", () => {
  test("lists Up Next first, then projects by name and due date", () => {
    const makeAssignment = (id: number, projectName: string, dueOn: string | null, isUpNext = false): Assignment => ({
      id, kind: "todo", title: `t${id}`, projectId: 1, projectName, parentId: null, parentTitle: "", dueOn, appUrl: "",
      commentsCount: 0, isUpNext,
    });
    const ordered = orderAssignments([
      makeAssignment(1, "Zeta", null), makeAssignment(2, "Alpha", null), makeAssignment(3, "Alpha", "2026-01-01"),
      makeAssignment(4, "Zeta", null, true),
    ]);
    expect(ordered.map((assignment) => assignment.id)).toEqual([4, 3, 2, 1]);
  });

  test("labels due dates relative to today", () => {
    expect(formatDue("2026-11-12", "2026-11-12")?.text).toBe("today");
    expect(formatDue("2026-11-10", "2026-11-12")?.text).toBe("Nov 10");
    expect(formatDue("2027-01-05", "2026-11-12")?.text).toBe("Jan 5 2027");
    expect(formatDue(null, "2026-11-12")).toBeNull();
  });

  function startApp(environment: Record<string, string> = {}) {
    Object.assign(process.env, { FAKE_BASECAMP_SIGNED_OUT: "0" }, environment);
    const handoffs: { mode: HandoffMode; title: string; description: string }[] = [];
    const openedUrls: string[] = [];
    const app = new App({
      client: new BasecampClient(spawnBasecamp(fakeBasecampPath)),
      handOff: async (mode, assignment, detail) => {
        handoffs.push({ mode, title: assignment.title, description: detail?.descriptionText ?? "" });
      },
      openUrl: async (url) => { openedUrls.push(url); },
      requestRender: () => {},
      quit: () => {},
      today: () => "2026-11-12",
      relevantColumnTitles: [],
      selectionDelayMilliseconds: 0,
    });
    const screen = () => app.render(100, 24).map(stripStyles);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
    return { app, handoffs, openedUrls, screen, settle };
  }

  test("draws every line exactly as wide as the terminal", async () => {
    const { app, screen } = startApp();
    await app.refresh();
    for (const [width, height] of [[100, 24], [60, 12], [200, 50]] as const) {
      const frameLines = app.render(width, height).map(stripStyles);
      expect(frameLines.length).toBe(height);
      expect(frameLines.map(displayWidth)).toEqual(Array(height).fill(width));
    }
    const text = screen().join("\n");
    expect(text).toContain("Up Next");
    expect(text).toContain("■ Login redirect loops");
    expect(text).toContain("● In progress");
    expect(text).toContain("○ Write a failing test");
  });

  test("moves the selected card to the chosen column", async () => {
    const { app, screen, settle } = startApp();
    await app.refresh();
    for (const key of ["m", "j", "j", "enter"]) app.handleKey(key);
    await settle();
    const text = screen().join("\n");
    expect(text).toContain('Moved "Login redirect loops on expired sessions" to Done');
    expect(text).toContain("● Done");
  });

  test("refuses to move a to-do and hands a card to Claude Code with its description", async () => {
    const { app, handoffs, openedUrls, screen, settle } = startApp();
    await app.refresh();
    app.handleKey("p");
    app.handleKey("o");
    await settle();
    expect(handoffs).toEqual([{
      mode: "plan",
      title: "Login redirect loops on expired sessions",
      description: expect.stringContaining("Reproduce with a 1 minute session"),
    }]);
    expect(openedUrls).toEqual(["https://3.basecamp.com/1/buckets/100/card_tables/cards/1"]);

    app.handleKey("j");
    await settle();
    app.handleKey("m");
    expect(screen().at(-1)).toContain("Only cards can be moved");
  });

  test("says how to sign in when the CLI is signed out", async () => {
    const { app, screen } = startApp({ FAKE_BASECAMP_SIGNED_OUT: "1" });
    await app.refresh();
    expect(screen().join("\n")).toContain("basecamp auth login");
  });
});

test("names an attachment by its caption, else its file name", () => {
  expect(htmlToText('<bc-attachment caption="" filename="shot.png"><figure></figure></bc-attachment>')).toBe("[shot.png]");
  expect(htmlToText('<bc-attachment caption="Before" filename="shot.png"></bc-attachment>')).toBe("[Before]");
  expect(htmlToText("<bc-attachment sgid=\"x\"></bc-attachment>")).toBe("[attachment]");
});

test("offers only the chosen columns, plus the card's current one", () => {
  const columns = [{ id: 1, title: "Triage" }, { id: 2, title: "Ideas" }, { id: 3, title: "In progress" }, { id: 4, title: "Done" }];
  expect(relevantColumns(columns, [], 2)).toEqual(columns);
  expect(relevantColumns(columns, ["done", " In Progress "], 2).map((column) => column.title)).toEqual(["Ideas", "In progress", "Done"]);
});
