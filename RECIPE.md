# Quiet

A calm, near-monochrome take on Herdr's main layout. The window stays black (or near-white in light mode) with hairline borders and one indigo accent; the only other color on screen comes from agents that need you and from your pull requests. Each space in the sidebar gets two lines: its agent status and name, then its branch, pull request and diff.

![Quiet](preview.png)

## What you see

Left to right, the same regions as Herdr (main):

- **Sidebar, 268px**, on `chrome` (`#0a0a0a` dark, `#fafafa` light):
  - the shipped brand bar (46px) on top;
  - **Spaces** (`quiet-spaces`), grouped under one header per machine once a remote machine is known. Sizes follow the shipped `spaces` mod. Each space with git is a 46px row of two lines, 3px apart:
    - line 1: Herdr's 18px colored letter (radius 5, 10.5px bold white; a worktree shows the 13px branch mark instead, indented 22px), 9px gap, the space name (13px, `foreground` when active, `muted` otherwise), then on the right the repo name when the space name doesn't say it and `↑n ↓n` (11.5px), a 13px bot icon with the number of live sub-agents (only when there are some), and last the 16px status cell;
    - line 2, 11.5px, starting under the name, a 13px icon before each value, 10px between groups: branch icon + branch (`muted`, truncated at the row's width), then the task chip and the gate shield when they are on;
    - line 3, only when the branch has a pull request or uncommitted changes, same style: PR icon + `#124` + the PR word in the PR's color + `→ base` (110px at most) + reviewer verdicts, diff icon + `+n` (`done`) `−n` (`ansi1`). One kind of information per line, so a long branch never hides the PR. The row has the same 10px padding on all four sides and 4px between lines; its height follows from its lines;
    - a space without git is a single 30px line;
  - **Agents** (`quiet-agents`): a fork of Herdr's `agents` list with the same status glyphs as the spaces rows, a model chip per agent, the spaces list's header and group heights, one selection style, an 18px icon cell, and pin and age in one 28px slot;
  - the shipped footer (69px).
- **Work area**: the shipped tab bar (42px), then the panes with 8px gaps, an 8px radius, a 1px `border` frame and a 1px `accent` frame on the focused pane; terminal padding 14×12px. The Files/Changes side panel is the shipped one.
- **Status bar** (`quiet-status`, 28px): the shipped bar (machine, branch, agents, needs you, palette hint), then after a 1px `border` divider one gauge per agent with a known limit: its program icon (13px), then each window as `5h` in `dim` and its percent in `muted`. A percent is `blocked` (amber) at 15 points ahead of the clock or 75% used, and semibold at 35 points or 90%. A reading whose window has reset shows `–`; a Claude reading older than 30 minutes shows in `dim`. The hover card (280px) gives, per window: used, resets in, pace, how long it lasts at this speed; then the plan, the last session's tokens (Codex) and the reading's age.
  - **Several accounts** (needs terminal-tools' [`agent-account`](https://github.com/athosmartinez/terminal-tools) on the bar's machine): when an agent has more than one account, the active account's label (`muted`; the id when it has no label, never the word `default` when a label is set) comes between the icon and the windows, and the card (340px) ends with an **Accounts** section. Each account is a row with a 14px check slot (`check.svg` in `foreground` on the active one), the label (12px medium, at most 140px), the tag as a 16px chip (10.5px `muted` on `selected`), the email (11.5px `muted`, truncated, left out when it equals the label), its windows in the bar's colors, and under it an 11px `dim` note: `updated 3m ago`, `no reading yet`, or `not logged in · <command>` (`agent-account login <agent> <id>`; `agent-account add cursor <id>` for Cursor, whose other accounts use an API key). A row of another logged-in account takes `hover` on rest; a click runs `agent-account use <agent> <id>` on that machine, posts a `notify` toast ("new sessions use it; running sessions keep their account"), and reads again. A not-logged-in row doesn't react. The section ends with a **Manage accounts…** row (an agent with one account and a gauge gets an Accounts section with only this row; `providerState` sets `managed` when `agent-account` listed the agent) (`settings.svg` in the check slot, 12px `muted`, `hover` on rest) that opens the accounts panel for the bar's machine. Cursor is a third agent with accounts and no gauges: it saves no usage limits, so it appears only when it has more than one account (icon and label in the bar, the card titled `Cursor accounts`).

- **Accounts panel** (`quiet-accounts`): a Herdr window (`openOverlay` with `kind: "window"`, key `quiet-accounts`), 600×640px, centered, dragged by any press outside its controls, on `popover` with 12px text. A 42px header with a 1px `border` bottom: `Accounts` (semibold), the machine (`server.svg` or `monitor.svg`, 11.5px `muted`), then a **Refresh** button and a 22px `x.svg` close button. Below it a scroll area with two sections, split by a 1px `border` line, titled like the card's sections (11.5px medium `muted`):
  - **Agent accounts**: per agent, its name (medium) and account count (11.5px `dim`), then one row per account as in the status card: the 14px check slot, the label (medium, at most 140px; `muted` when not logged in), the tag chip, the email (11.5px `muted`). On the right, 22px buttons (11.5px `muted`, 1px `border`, radius 5, `hover` on rest): **Use** (another account that is not logged out), **Log in** (a logged-out one), **Edit**. A logged-out account has an 11px `dim` note under it: `not logged in · agent-account login <agent> <id>`. **Add account** sits on the agent's line.
  - **GitHub accounts in gh on <machine>**: each `gh` login with the check on the active one, its host (11.5px `muted`) and `active` (11px `dim`), or `login failed` in `blocked`. Then **Owner → gh account**: one row per `gh_accounts` pair, `owner → login`, with `not logged in to gh` in `blocked` when that login is not in the list above, and **Edit** and **Unmap**. **Map an owner** sits on the title line.
  - A form opens in place, under its row: 26px inputs (radius 6, 1px `input`, `accent` while focused, on `background`), a **Save** or **Create** button in `solid` / `solid_foreground` (the one accent), **Cancel**, and an 11px line: the hint in `dim`, or the error in `blocked`. The owner form adds the logged-in logins as 18px chips (`selected`, 11px `muted`) that fill the account field. One form is open at a time; Esc closes it, and a second Esc closes the panel.

Palette (`themes/quiet-dark.json`, `themes/quiet-light.json`), dark / light:

| Role | Dark | Light |
|---|---|---|
| canvas | `#000000` | `#fcfcfc` |
| chrome | `#0a0a0a` | `#fafafa` |
| terminal background | `#050505` | `#ffffff` |
| surface / popover / raised | `#111111` / `#141414` / `#171717` | `#ffffff` |
| hover / selected | `#1d1d1d` / `#242424` | `#f4f4f5` / `#ececef` |
| border / input | `#1e1e1e` / `#252525` | `#e4e4e7` / `#d4d4d8` |
| foreground / muted / dim | `#f5f5f5` / `#a3a3a3` / `#737373` | `#18181b` / `#52525b` / `#71717a` |
| accent (= solid) | `#346bf1` | `#1b4ed8` |
| selection / cursor | `#13244c` / `#b4cbff` | `#dbe4ff` / `#3f3f46` |
| working / blocked / done / idle | `#6cb5d8` / `#e9c348` / `#64d1a6` / `#666666` | `#0369a1` / `#b45309` / `#047857` / `#8a8a93` |

The 16 ANSI colors are Tailwind 400/300 shades in dark and 600/700 in light, each at least 4.8:1 on the terminal background.

## How it behaves

Space status (the most urgent agent in the space), drawn in the 16px cell at the right of line 1:

- **working**: a spinner arc in `working`, turning every 900ms;
- **blocked**: a `?` on a 14px round chip of `blocked` at 15% opacity, pulsing between 55% and 100% opacity every 1.6s;
- **done** (finished while you weren't looking): a check in `done`;
- **idle**: a 7px ring in `idle`;
- no agents: an empty cell, so names stay aligned.

The accent is never a status color, so focus never reads as an agent.

The pull request on line 3 comes from `gh pr view` on the space's machine, for the branch the space's first terminal is on:

| PR | Word | Color |
|---|---|---|
| merged | `merged` | accent |
| closed | `closed` | dim |
| draft | `draft` | dim |
| approved | `approved` | done |
| changes requested | `changes` | blocked |
| review required | `review` | muted |
| other open | `open` | muted |

The diff is the branch against `origin/<PR base>` while the PR is open. Without an open PR the base is unknown, so the diff counts only uncommitted changes. Nothing is shown when there is nothing to count.

The PR is looked up again when the branch changes, when the space becomes the active one, and otherwise at most every 2 minutes. Branch and diff follow the shipped `spaces` rules: when a command or an agent turn ends, when the repo's refs change, and every 60s for spaces in view while the window is in front.

Clicks, right-click menu, drag to reorder, machine headers, worktrees nested under their checkout and the narrow rail (under 160px: numbers with the status cell) behave as in the shipped `spaces` mod.

Hover cards (`cards.js`): resting 600ms on a part opens a 320px card below it (`popover` background, 1px `border`, radius 8, 12px text); it closes 300ms after the pointer leaves both. Clicks inside a card stop there, so the row under it doesn't select or drag. Long agent lists scroll inside the card past 280px.

| Part | Card | Actions |
|---|---|---|
| PR | `#n title`, state, `head → base`, author and last update, checks (✓ pass, ✗ fail, ◌ pending), latest reviews, requested reviewers, conflicts | Open on GitHub, Copy URL |
| Branch (420px card) | the branch tree from `git log --graph -n6`: the graph in JetBrains Mono (`●` commits in `accent`, merges drawn as branches), then short hash, subject, up to 2 refs and age per commit; last author, upstream with ↑↓, uncommitted file count | Copy branch; click a hash: copies the full SHA (tooltip shows it), and the hash reads `copied` in `done` for 1.5s |
| Diff | file count, the 5 files that changed most with `+/−`, what it is compared against | Open Changes (after a space switch it waits 300ms for the `tabs` mod to restore that space's panel, then opens Changes) |
| Bot count | each live sub-agent: program icon, name, status word and age, what it reports | click a line: `agent.focus` |
| Status | the space's agents, most urgent first, same lines | click a line: `agent.focus` |
| Space name | folder, machine, tabs, agents, last change | Copy folder |
| Machine header | connection, spaces, agents | — |

Sub-agent names, statuses and the tree follow the shipped `agents` mod (`clean`, `kidStatus`, `parent` links), so a card says what that list says.

## Built from

- `themes/quiet-dark.json`, `themes/quiet-light.json`: the palette above, with the panel colors in `colors`.
- `layouts/quiet.json`: a copy of Herdr's `main` layout with `"theme": {"light": "quiet-light", "dark": "quiet-dark"}` on the root, the `spaces`, `agents` and `status` blocks' mods set to `quiet-spaces`, `quiet-agents` and `quiet-status`, and pane radius 8. No `font`: the person's settings decide.
- `mods/quiet-spaces/`: a fork of the shipped `spaces` mod. Changes: the status cell at the right (`statusGlyph`), the sub-agent count (`subAgents`: each live terminal with a `parent` is walked up to the first ancestor that is an agent in a space), lines 2 and 3 with icons (`detail`, `rowHeight`), and the `pr`/`prAt` cache, `lookPr`, `ghAccount` and `diff`. Its icons are Lucide (ISC) in `mods/quiet-spaces/icons/`. It uses `spaces()`, `panes()`, `machines()`, `agents()`, `terminals()`, `theme()`, `readTextFile`, `appHome`, `exec`, `hc`, `watchFolder`, `run("space.select" | "space.move" | "space.new")`, and the shipped `mods/workspace-chrome/spinner.svg` and `check.svg`.
- Shipped mods used as they are: `workspace-chrome`, `tabs`, `pane`, `files`, `changes`, `menu`.
- `mods/quiet-status/`: a fork of the shipped `workspace-status` mod. Once a minute, and when the active space's machine changes, one `sh -c` on that machine (`READ` in `usage.js`) prints `agent-account list --json` when `command -v agent-account` finds it, every `~/.cache/claude-usage/<account>.json` (written by the Claude statusline snippet in the README), and, for the 20 newest `~/.codex/sessions/*/*/*/rollout-*.jsonl`, the `creator_account_id` of the first line with the last `"rate_limits":{` line with a `used_percent` in the tail (400 KB); the JS keeps the newest event per account id. `usage.js` parses this into one state per agent (`providerState`): the active account's reading, its label when there are several, and every account (`id`, `label` falling back to the id, `tag`) with its own reading (never a reading of another owner), Codex ids mapped to accounts through the list; Cursor accounts never have a reading. It is plain JS without Herdr imports, tested by `test/quiet-status.test.mjs`. The mod uses `exec` (also for `agent-account use`), `notify`, `knownAgents` (for the icons), `spaces()`, `agents()`, `keys()` and `run("app.palette")`.
- `mods/quiet-accounts/`: the accounts panel, new in Quiet. `accounts.js` parses `agent-account list --json` into one group per agent (always all three, so an agent with only its normal home can get a new account), `gh auth status --json hosts` (and the plain text of an older gh) into logins without any token, and the `gh_accounts` map of `quiet.json`; it builds the `use`, `set`, `add` and `login` arguments and checks ids with `agent-account`'s rule. `editGhAccounts` makes one change to `gh_accounts` (remove the edited owner, set the new pair with the owner in lowercase, drop keys that differ from it only in case) and keeps every other key and pair as written; it throws on a broken file, so the panel never writes over it. `ghStatusFromText` tells "not logged in" (an empty list) from a failed query (gh's error). `addedExisting` reads `agent-account add` saying the id exists: the panel reads the list again before an add (`accountIds`; no add when that list can't be read) and reports that case instead of "created". Plain JS without Herdr imports, tested by `test/quiet-accounts.test.mjs` (the command tests run the real `agent-account` against a temporary `AGENT_ACCOUNTS_HOME`). `main.js` runs `agent-account` and `gh` with `exec` on the panel's machine (no shell: each value is one argument), opens the login in a new tab with `run("tab.new", { space, argv: ["agent-account", "login", <agent>, <id>] })` in a space on that machine, and writes `quiet.json` (always this computer's) with `writeTextFile(path, text, <the text it read>)`. Its `init()` returns before any process when `checking()`. It also uses `spaces()`, `notify`, `readTextFile`, `appHome`, `props` and `closeOverlay`.
- Programs run: `git` (`rev-parse`, `symbolic-ref`, `rev-list`, `diff --shortstat`) and `gh pr view --json number,state,isDraft,reviewDecision,baseRefName,headRefName`, on the space's own machine; the accounts panel runs `agent-account` and `gh auth status --json hosts --no-refresh` on the panel's machine (an older gh: `gh auth status --no-refresh`, and plain `gh auth status` only when it rejects that flag). Nothing else reaches the network.

## Watch out

- Copy `themes/` too (`quiet-dark.json`, `quiet-light.json`); without it the layout falls back to Herdr's default theme.
- `gh` must be installed and logged in **on each machine** whose spaces should show PRs, with an account that can read the repo. Any failure (missing, logged out, wrong account, no PR) silently shows no PR. It is never an error.
- Several GitHub accounts: an optional `quiet.json` in the Herdr home, `{ "gh_accounts": { "<owner>": "<gh login>" } }`, picks the account by the owner in the `origin` remote. The lookup then runs `sh -c 'GH_TOKEN="$(gh auth token --user "$1")" … exec gh pr view …'`, so the token lives only in that child process. The file is read at most once a minute.
- `gh pr view` can answer with a PR whose head is another branch of the same name; the mod keeps it only when `headRefName` equals the local branch.
- Run the diff with `git --no-optional-locks`: a plain `git diff` may rewrite `.git/index`, which the repo watch reports as a change, and the mod then looks again in a loop.
- Never default the diff base to `main`: many people pick the base per task.
- Theme files take only `#rrggbb`, so every translucent value from the reference look (8% white borders, 11% hovers) is pre-mixed per theme. The layout's `colors` would apply to both appearances, so the palette lives only in the two theme files.
- The narrow rail (sidebar under 160px) puts the 16px status cell in the top-right corner of a 32×26px cell, over the space number. It is not tuned yet.
- The accounts panel has no command palette entry: the palette lists app commands, and a mod can't add one. `mod.open` from the palette asks for the mod's name; a `keys.json` binding `"mod.open:quiet-accounts"` opens it at once.
- The panel never runs `agent-account login` in the background: a login asks for a browser, a code or a hidden API key, so it gets a tab the person sees. It never offers `agent-account remove`.
- `quiet.json` is written only when it still holds the text the panel read (`writeTextFile` with `expected`); after a change by hand the save fails, the panel shows Herdr's reason, reads the file again and asks to save once more. A file that can't be read (permission, over 1 MiB) or is not valid JSON is shown as an error and left alone.
- Herdr has four statuses. `done` already means "finished, unseen", so there is no separate unread marker.

## Done when

- `herdr-app check mods/quiet-spaces`, `mods/quiet-status` and `mods/quiet-accounts` pass, and `node --test test/` passes.
- `layout.switch {name: "quiet"}` shows the layout, and `herdr-app status` lists no errors.
- A space on a branch with an open draft PR shows `#<n> draft → <base>` and `+a −d` equal to `git diff --shortstat origin/<base>...HEAD`.
- A space whose agent is working shows the turning arc; one waiting for you shows the pulsing `?`; a finished, unseen one shows the check.
- Switching the system between light and dark changes between `quiet-light` and `quiet-dark`.
- A space on a machine without `gh` still shows its branch and uncommitted diff.
