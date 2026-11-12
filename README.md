# RexyCamp

Your [Basecamp](https://basecamp.com) assignments in a [Rex](https://www.superlogical.com/rex) pane, in the style of [lazygit](https://github.com/jesseduffield/lazygit). A sibling of [RexyGit](https://github.com/Gaffen87/RexyGit).

Press <kbd>Cmd</kbd>+<kbd>B</kbd> to open RexyCamp in a floating pane. Press it again to close it.

```
╭─[1]─Assignments──────────────────────╮╭─[3]─Detail─────────────────────────────╮
│Up Next                               ││ Login redirect loops on expired        │
│  ■ Login redirect loops on e… Nov 10 ││ sessions                               │
│Infrastructure                        ││                                        │
│  □ Rotate the staging databas… today ││ Project  Acme Web                     │
│Acme Web                             ││ Card in  In progress                   │
│  □ Write release notes for 4.2 Dec 1 ││ Due      Nov 10                        │
╰───────────────────────────────1 of 3─╯│                                        │
╭─[2]─Columns──────────────────────────╮│ ✓ Reproduce                            │
│   Triage                             ││ ○ Write a failing test                 │
│ ● In progress                        ││                                        │
│   Done                               ││ When a session expires the user is     │
╰──────────────────────────────────────╯╰────────────────────────────────────────╯
 f fix │ p plan │ m move │ o open │ r refresh │ j/k select │ tab panel │ q quit
```

## Keys

| Key | Action |
| --- | --- |
| <kbd>f</kbd> | Fix: hand the assignment to Claude Code in a new Rex tab |
| <kbd>p</kbd> | Plan: the same, with Claude Code in plan mode |
| <kbd>m</kbd> | Move the card: choose a column with <kbd>j</kbd>/<kbd>k</kbd>, <kbd>Enter</kbd> to move, <kbd>Esc</kbd> to cancel |
| <kbd>o</kbd> | Open the assignment in Basecamp |
| <kbd>r</kbd> | Refresh |
| <kbd>j</kbd>/<kbd>k</kbd>, arrows | Select an assignment, or scroll the detail panel |
| <kbd>Tab</kbd>, <kbd>h</kbd>/<kbd>l</kbd>, <kbd>1</kbd>–<kbd>3</kbd> | Change panel |
| <kbd>q</kbd> | Quit |

Fix and plan start Claude Code in the directory of the pane you opened RexyCamp from, so open it from the repository the assignment is about. Claude Code gets the title, link, open steps and description as its prompt.

## Install

RexyCamp reads and writes Basecamp through the official [Basecamp CLI](https://github.com/basecamp/basecamp-cli). It needs [Bun](https://bun.sh) to build and [Claude Code](https://claude.com/claude-code) for fix and plan.

```sh
brew install --cask basecamp/tap/basecamp-cli
basecamp auth login
./install.sh
```

The installer builds `dist/rexycamp`, copies two Lua files into Rex's config directory (`~/.config/rex` by default), adds `require("rexycamp")` to `init.lua`, and reloads Rex. Run it again after you pull an update, or after you move this folder or one of the `basecamp`, `rex` or `claude` binaries.

To remove everything: `./uninstall.sh`.

## Settings

Edit `~/.config/rex/rexycamp.lua`, then run `rex config reload`.

| Setting | Default | Values |
| --- | --- | --- |
| `key` | `"cmd+b"` | Any Rex key, or `false` for no key |
| `placement` | `"overlay"` | `overlay` (floating), `split`, `zoomed`, `tab` |
| `direction` | `"right"` | `right`, `down` (for `split` and `zoomed`) |
| `ratio` | `0.5` | The share of the split that RexyCamp gets, between 0 and 1 |
| `columns` | all | The titles of the columns to show and move to, such as `{ "Triage", "In progress", "Done" }`. A card's current column always shows |

The action is also in the command palette as **Toggle RexyCamp**, and takes a one-off placement:

```sh
rex do rexycamp_toggle placement=split
```

## How it works

- `src/` is a Bun + TypeScript terminal app with no dependencies. It runs `basecamp … --json` for everything: `assignments list`, `show`, `cards columns` and `cards move`.
- `rexycamp.lua` holds your settings. The installer never overwrites it.
- `rexycamp_toggle.lua` holds the action. The installer rewrites it on every run, with the paths of the binaries at the top.
- The toggle looks in the focused tab for a pane labelled `rexycamp`. If it finds one, it closes it. Otherwise it opens a new one.

## Develop

```sh
bun install
bun test
REXYCAMP_BASECAMP_BIN=test/fake-basecamp.ts bun start   # sample data, no Basecamp account
```

## License

[MIT](LICENSE)
