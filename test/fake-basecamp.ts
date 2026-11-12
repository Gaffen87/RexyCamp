#!/usr/bin/env bun
// Stands in for the basecamp CLI in tests: point REXYCAMP_BASECAMP_BIN at this file.
import { appendFileSync } from "node:fs";

const commandArguments = process.argv.slice(2).filter((argument) => argument !== "--json");
const commandName = commandArguments.slice(0, 2).join(" ");
if (process.env.FAKE_BASECAMP_LOG) appendFileSync(process.env.FAKE_BASECAMP_LOG, commandArguments.join(" ") + "\n");

const project = { id: 100, name: "Acme Web" };
const otherProject = { id: 200, name: "Infrastructure" };

const assignments = {
  priorities: [
    {
      id: 1, type: "Kanban::Card", content: "Login redirect loops on expired sessions", due_on: "2026-11-10",
      comments_count: 4, app_url: "https://3.basecamp.com/1/buckets/100/card_tables/cards/1",
      bucket: project, parent: { id: 11, title: "In progress" },
    },
  ],
  non_priorities: [
    {
      id: 2, type: "Todo", content: "Rotate the staging database credentials", due_on: "2026-11-12",
      app_url: "https://3.basecamp.com/1/buckets/200/todos/2",
      bucket: otherProject, parent: { id: 21, title: "Ops chores" },
    },
    {
      id: 3, type: "Kanban::Card", content: "Søgefeltet viser forkerte resultater for æøå 日本語",
      app_url: "https://3.basecamp.com/1/buckets/100/card_tables/cards/3",
      bucket: project, parent: { id: 10, title: "Triage" },
    },
    {
      id: 4, type: "Todo", content: "Write release notes for 4.2", due_on: "2026-12-01",
      app_url: "https://3.basecamp.com/1/buckets/100/todos/4",
      bucket: project, parent: { id: 22, title: "Release 4.2" },
    },
  ],
};

const columns = [
  { id: 10, title: "Triage" }, { id: 11, title: "In progress" },
  { id: 12, title: "Review" }, { id: 13, title: "Done" },
];

const recordings: Record<string, unknown> = {
  "1": {
    title: "Login redirect loops on expired sessions",
    content: "<div>When a session expires the user is sent to <strong>/login</strong> and back again.<br>Seen in production twice.</div><ul><li>Reproduce with a 1 minute session</li><li>Check the &quot;return_to&quot; param</li></ul>",
    steps: [{ title: "Reproduce", completed: true }, { title: "Write a failing test", completed: false }],
  },
  "2": { content: "Rotate the staging database credentials", description: "<div>Ask ops for the vault path first.</div>" },
};

function respond(payload: unknown): void {
  console.log(JSON.stringify(payload));
}

switch (commandName) {
  case "auth status": respond({ ok: true, data: { authenticated: process.env.FAKE_BASECAMP_SIGNED_OUT !== "1" } }); break;
  case "assignments list":
    if (process.env.FAKE_BASECAMP_SIGNED_OUT === "1") respond({ ok: false, error: "--account is required", code: "usage" });
    else respond({ ok: true, data: assignments });
    break;
  case "cards column": respond({ ok: true, data: { id: Number(commandArguments[3]), parent: { id: 900 } } }); break;
  case "cards columns": respond({ ok: true, data: columns }); break;
  case "cards move": respond({ ok: true, data: { id: Number(commandArguments[2]) } }); break;
  default:
    if (commandArguments[0] === "show") {
      const recordingId = commandArguments[1]?.split("/").pop() ?? "";
      respond({ ok: true, data: recordings[recordingId] ?? { content: "" } });
    } else {
      respond({ ok: false, error: `unknown command ${commandName}`, code: "usage" });
    }
}
