# Quiet

A calm, near-monochrome take on Herdr's main layout. The window stays black (or near-white in light mode) with hairline borders and one indigo accent; the only other color on screen comes from agents that need you and from your pull requests. Each space in the sidebar gets two lines: its agent status and name, then its branch, pull request and diff.

![Quiet](preview.png)

## What you see

Left to right, the same regions as Herdr (main):

- **Sidebar, 268px**, on `chrome` (`#0a0a0a` dark, `#fafafa` light):
  - the shipped brand bar (46px) on top;
  - **Spaces** (`quiet-spaces`), grouped under one header per machine once a remote machine is known. Sizes follow the shipped `spaces` mod. Each space with git is a 46px row of two lines, 3px apart:
    - line 1: Herdr's 18px colored letter (radius 5, 10.5px bold white; a worktree shows the 13px branch mark instead, indented 22px), 9px gap, the space name (13px, `foreground` when active, `muted` otherwise), then on the right the repo name when the space name doesn't say it and `↑n ↓n` (11.5px), a 13px bot icon with the number of live sub-agents (only when there are some), and last the 16px status cell;
    - line 2, 11.5px, starting under the name, a 13px icon before each value, 10px between groups: branch icon + branch (`muted`, gives way first), PR icon + `#124` + the PR word in the PR's color + `→ base`, diff icon + `+n` (`done`) `−n` (`ansi1`);
    - a space without git is a single 30px line;
  - **Agents** (`quiet-agents`): a fork of Herdr's `agents` list with the same status glyphs as the spaces rows, a model chip per agent, the spaces list's header and group heights, one selection style, an 18px icon cell, and pin and age in one 28px slot;
  - the shipped footer (69px).
- **Work area**: the shipped tab bar (42px), then the panes with 8px gaps, an 8px radius, a 1px `border` frame and a 1px `accent` frame on the focused pane; terminal padding 14×12px. The Files/Changes side panel and the 28px status bar are the shipped ones.

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

The pull request on line 2 comes from `gh pr view` on the space's machine, for the branch the space's first terminal is on:

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
- `layouts/quiet.json`: a copy of Herdr's `main` layout with `"theme": {"light": "quiet-light", "dark": "quiet-dark"}` on the root, the `spaces` block's mod set to `quiet-spaces`, and pane radius 8. No `font`: the person's settings decide.
- `mods/quiet-spaces/`: a fork of the shipped `spaces` mod. Changes: the status cell at the right (`statusGlyph`), the sub-agent count (`subAgents`: each live terminal with a `parent` is walked up to the first ancestor that is an agent in a space), line 2 with icons (`detail`), and the `pr`/`prAt` cache, `lookPr`, `ghAccount` and `diff`. Its icons are Lucide (ISC) in `mods/quiet-spaces/icons/`. It uses `spaces()`, `panes()`, `machines()`, `agents()`, `terminals()`, `theme()`, `readTextFile`, `appHome`, `exec`, `hc`, `watchFolder`, `run("space.select" | "space.move" | "space.new")`, and the shipped `mods/workspace-chrome/spinner.svg` and `check.svg`.
- Shipped mods used as they are: `workspace-chrome`, `agents`, `tabs`, `pane`, `files`, `changes`, `workspace-status`, `menu`.
- Programs run: `git` (`rev-parse`, `symbolic-ref`, `rev-list`, `diff --shortstat`) and `gh pr view --json number,state,isDraft,reviewDecision,baseRefName,headRefName`, on the space's own machine. Nothing else reaches the network.

## Watch out

- Copy `themes/` too (`quiet-dark.json`, `quiet-light.json`); without it the layout falls back to Herdr's default theme.
- `gh` must be installed and logged in **on each machine** whose spaces should show PRs, with an account that can read the repo. Any failure (missing, logged out, wrong account, no PR) silently shows no PR. It is never an error.
- Several GitHub accounts: an optional `quiet.json` in the Herdr home, `{ "gh_accounts": { "<owner>": "<gh login>" } }`, picks the account by the owner in the `origin` remote. The lookup then runs `sh -c 'GH_TOKEN="$(gh auth token --user "$1")" … exec gh pr view …'`, so the token lives only in that child process. The file is read at most once a minute.
- `gh pr view` can answer with a PR whose head is another branch of the same name; the mod keeps it only when `headRefName` equals the local branch.
- Run the diff with `git --no-optional-locks`: a plain `git diff` may rewrite `.git/index`, which the repo watch reports as a change, and the mod then looks again in a loop.
- Never default the diff base to `main`: many people pick the base per task.
- Theme files take only `#rrggbb`, so every translucent value from the reference look (8% white borders, 11% hovers) is pre-mixed per theme. The layout's `colors` would apply to both appearances, so the palette lives only in the two theme files.
- The narrow rail (sidebar under 160px) puts the 16px status cell in the top-right corner of a 32×26px cell, over the space number. It is not tuned yet.
- Herdr has four statuses. `done` already means "finished, unseen", so there is no separate unread marker.

## Done when

- `herdr-app check mods/quiet-spaces` passes.
- `layout.switch {name: "quiet"}` shows the layout, and `herdr-app status` lists no errors.
- A space on a branch with an open draft PR shows `#<n> draft → <base>` and `+a −d` equal to `git diff --shortstat origin/<base>...HEAD`.
- A space whose agent is working shows the turning arc; one waiting for you shows the pulsing `?`; a finished, unseen one shows the check.
- Switching the system between light and dark changes between `quiet-light` and `quiet-dark`.
- A space on a machine without `gh` still shows its branch and uncommitted diff.
