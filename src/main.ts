#!/usr/bin/env bun
// RexyCamp: a lazygit-style terminal app for your Basecamp assignments.
import packageManifest from "../package.json" with { type: "json" };
import { App } from "./app.ts";
import { BasecampClient, spawnBasecamp } from "./basecamp.ts";
import { handOffToClaude, openInBrowser, type HandoffEnvironment } from "./handoff.ts";
import { parseKeys } from "./keys.ts";

const ENTER_SCREEN = "\x1b[?1049h\x1b[?25l";
const LEAVE_SCREEN = "\x1b[?25h\x1b[?1049l";
const BEGIN_FRAME = "\x1b[?2026h\x1b[H";
const END_FRAME = "\x1b[?2026l";
const CLEAR_TO_END_OF_LINE = "\x1b[K";

function localDate(): string {
  const now = new Date();
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
}

function runApp(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("rexycamp needs a terminal");
    process.exit(1);
  }

  const handoffEnvironment: HandoffEnvironment = {
    rexBinary: process.env.REXYCAMP_REX_BIN || "rex",
    claudeBinary: process.env.REXYCAMP_CLAUDE_BIN || "claude",
    rexSessionId: process.env.REX_SESSION,
    workingDirectory: process.cwd(),
  };

  let isRenderQueued = false;
  const renderNow = () => {
    isRenderQueued = false;
    const frameLines = app.render(process.stdout.columns || 80, process.stdout.rows || 24);
    process.stdout.write(BEGIN_FRAME + frameLines.map((line) => line + CLEAR_TO_END_OF_LINE).join("\r\n") + END_FRAME);
  };
  const leaveScreen = () => {
    process.stdout.write(LEAVE_SCREEN);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  };

  const app = new App({
    client: new BasecampClient(spawnBasecamp(process.env.REXYCAMP_BASECAMP_BIN || "basecamp")),
    handOff: (mode, assignment, detail) => handOffToClaude(mode, assignment, detail, handoffEnvironment),
    openUrl: openInBrowser,
    requestRender: () => {
      if (isRenderQueued) return;
      isRenderQueued = true;
      queueMicrotask(renderNow);
    },
    quit: () => {
      leaveScreen();
      process.exit(0);
    },
    today: localDate,
    selectionDelayMilliseconds: 120,
  });

  process.stdout.write(ENTER_SCREEN);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    for (const key of parseKeys(chunk)) app.handleKey(key);
  });
  process.stdout.on("resize", renderNow);
  process.on("SIGTERM", () => {
    leaveScreen();
    process.exit(0);
  });
  process.on("uncaughtException", (error) => {
    leaveScreen();
    console.error(error);
    process.exit(1);
  });

  void app.refresh();
}

if (process.argv.includes("--version")) {
  console.log(`rexycamp ${packageManifest.version}`);
} else {
  runApp();
}
