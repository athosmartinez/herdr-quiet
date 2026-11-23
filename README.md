# Quiet for Herdr

A calm layout for [Herdr](https://herdr.dev): black or near-white, hairline borders, one indigo accent. Color appears only where something needs you. Each space in the sidebar shows its agent status and name, then its branch, pull request (number, state, review, base) and diff.

Unlike [Herdr T3](https://github.com/JinJieBeWater/herdr-t3), Quiet keeps Herdr's own main layout and adds git and pull request state to each space.

See [RECIPE.md](RECIPE.md) for what it does and how it is built.

## Install

Ask your Herdr agent to add `github.com/athosmartinez/herdr-quiet`, or copy by hand:

```sh
cp layouts/quiet.json ~/.config/herdr-app/layouts/
cp themes/quiet-*.json ~/.config/herdr-app/themes/
cp -R mods/quiet-spaces mods/quiet-agents mods/quiet-status mods/quiet-accounts ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/quiet-spaces
herdr-app do layout.switch --name quiet
```

PRs in the sidebar need [`gh`](https://cli.github.com) logged in on each machine. Without it, Quiet shows only the branch and the uncommitted diff.

### Several GitHub accounts

`gh` answers with its active account. If some repos need another logged-in account, map their GitHub owner to it in `~/.config/herdr-app/quiet.json`:

```json
{
  "gh_accounts": {
    "my-company": "my-work-login"
  }
}
```

For a repo whose `origin` is under `my-company`, Quiet runs that one `gh pr view` with `gh auth token --user my-work-login`. The token stays in that command's environment and is never written anywhere.

The [accounts panel](#the-accounts-panel) edits this map for you and lists the accounts that `gh` has logged in.

### Other options in `quiet.json`

All are optional and off unless set. The file is read at start and every minute.

```json
{
  "stall_minutes": 20,
  "gate": true,
  "trackers": {
    "my-company": { "pattern": "abc-\\d+", "url": "https://tracker.example.com/browse/{KEY}" },
    "*": { "pattern": "gh-\\d+", "url": "https://example.com/{KEY}", "command": ["my-tracker-cli", "view", "{KEY}", "--json"] }
  }
}
```

- `stall_minutes`: an agent working longer than this shows its time in amber in the cards (default 20).
- `gate`: shows a shield next to the branch when a PR gate script left a stamp at `<git common dir>/agent-pr-gate/<HEAD sha>.json` with `"pass": true`. Green only when HEAD is also pushed.
- `trackers`: by the repo's GitHub owner (or `"*"`), a task key found in the branch name with `pattern`, shown as a chip that opens `url`. The optional `command` (no shell, `{KEY}` replaced) prints `{"title": "...", "status": "..."}` for the card; it runs on the window's own machine and is cached for 5 minutes.

### Usage limits in the status bar

The status bar shows how much of each agent's usage limit is spent, for the machine it names: `5h 12%  7d 78%` after the Claude icon, `7d 5%` after the Codex icon. A value turns amber when it is spent faster than its window passes (15 points ahead of the clock, or 75% used), and semibold at 35 points ahead or 90%. Rest on it for the reset time, the pace and how long the limit lasts at this speed.

- **Codex** needs nothing: Quiet reads the last rate-limit event in the newest files of `~/.codex/sessions`.
- **Claude Code** gives its limits only to its statusline command. Add these lines to that script to save them where Quiet reads them (it needs `jq`):

  ```sh
  # $input is the JSON that Claude Code sends to the statusline on stdin.
  # One file per account: "default", or the folder name of CLAUDE_CONFIG_DIR.
  d="${XDG_CACHE_HOME:-$HOME/.cache}/claude-usage"
  a=default
  case "${CLAUDE_CONFIG_DIR:-}" in
    "" | "$HOME/.claude" | "$HOME/.claude/") ;;
    *) a=$(basename "$CLAUDE_CONFIG_DIR" | tr -c 'A-Za-z0-9._\n-' '_') ;;
  esac
  if echo "$input" | jq -e '.rate_limits' >/dev/null 2>&1 && mkdir -p "$d"; then
    echo "$input" | jq -c '{captured_at: now|floor, rate_limits}' > "$d/$a.json.$$" && mv "$d/$a.json.$$" "$d/$a.json"
  fi
  ```

  A Claude reading older than 30 minutes shows dim, because only a running session updates it. The first version of this snippet wrote `rate-limits.json`; rename it or run the new snippet once.

  Known limits: a Codex session resumed under another account still counts for the account that started it, because a session file names only its creator. Two local Codex logins in the same ChatGPT workspace share one account id, so they show the same reading.

Without either file, the status bar looks like Herdr's own.

### Several agent accounts

With [`agent-account`](https://github.com/athosmartinez/terminal-tools) from terminal-tools installed on the bar's machine, Quiet shows every Claude Code, Codex and Cursor account and lets you pick the one that new sessions use, for example when one account runs low on its limit.

- Each account has an id (`default`, or the name given to `agent-account add`), an optional label and an optional tag (`agent-account set <agent> <id> --label <text> --tag <text>`). Quiet shows the label, or the id when there is no label.
- The bar shows the active account's label before its gauges when an agent has more than one account: `alex  5h 12%  7d 78%`.
- Rest on the gauge: the card lists each account with its label, its tag as a small chip, its email, its last `5h` and `7d` readings and their age (`no reading yet` when it has none). A check marks the active one.
- Click another account to run `agent-account use <agent> <id>` on that machine. A notification confirms it: new sessions use that account, and running sessions keep theirs.
- An account that is not logged in shows `not logged in` and the command to run in your terminal: `agent-account login <agent> <id>`, or for Cursor `agent-account add cursor <id>`, which prints how to save its API key. It can't be picked.
- Cursor saves no usage limits, so it has no gauges. With more than one Cursor account, the bar shows the Cursor icon and the active label, and the card lists the accounts to switch.

An idle account shows its last saved reading: Claude saves one per account through the statusline snippet above, and Codex sessions say which ChatGPT account wrote them. Without `agent-account`, the bar shows one reading per agent, as above.

### The accounts panel

A window to manage the accounts, for the machine that the status bar names. Open it with **Manage accounts…** at the end of the Accounts section of an agent's card (with one account, the section has only that row), or with the `mod.open` command and the name `quiet-accounts`. Mods can't add their own entry to the command palette, so bind a key to it in `keys.json` if you want one:

```json
{ "global": { "<your key>": "mod.open:quiet-accounts" } }
```

- **Agent accounts** (needs `agent-account`): each Claude, Codex and Cursor account with its label, tag and email, and a check on the active one.
  - **Use** runs `agent-account use <agent> <id>`: new sessions use that account, and running sessions keep theirs.
  - **Edit** changes the label and the tag (`agent-account set`). An empty field clears it.
  - **Add account** creates one (`agent-account add <agent> <id>`, then `agent-account set` for the label and tag, only when the add made a new account). The id takes lowercase letters, digits, `.`, `_` and `-`.
  - An account that is not logged in shows `agent-account login <agent> <id>` and a **Log in** button. The button opens a new tab that runs that command, because the login asks you for a browser, a code or an API key. Nothing logs in out of your sight.
  - The panel can't remove an account. Run `agent-account remove` in a terminal for that.
- **GitHub accounts**: the accounts logged in to `gh` on that machine (`gh auth status`, read-only), the active one checked. Under them, the `gh_accounts` map of `quiet.json`: map an owner to a login (pick one of the logged-in logins or type it), edit it, or unmap it. The owner is saved in lowercase, which matches its `origin` in any case. The panel writes only the pair you change and keeps the other keys of the file and the other pairs, also ones it can't show. When `gh` fails, the panel shows its error, not an empty list. It doesn't write a file that it can't read or that is not valid JSON (it shows the reason), or one that changed after the panel read it.

Esc closes the open form, then the panel. The panel reads the accounts again every 15 seconds while it is open, so a login in the new tab shows without a click.

### Orchestrating agents

- **Needs you:** when an agent anywhere waits for you, a row appears above the spaces. A click goes to the next waiting agent; resting on it lists them all with what each one asks.
- **Sub-agents:** the bot count on a space is its agents' live sub-agents; the card shows each one's model, effort and working time.
- **Review verdicts:** an orchestrator can label its reviewer terminals after it checks their review, and the PR line shows `opus ✓  sol ✗4`:

  ```sh
  hc label <reviewer> quiet.pr=42 quiet.verdict=ISSUES quiet.findings=4   # optional: quiet.repo=<repo>
  ```

## Developing

If `mods/quiet-spaces` is a symlink into a clone, Herdr may not notice edits made in the clone. Switch layouts (`herdr-app do layout.switch --name main`, then `--name quiet`) to load the new code, and check it with `herdr-app check`.

The status bar's readers are plain functions in `mods/quiet-status/usage.js`. Test them with `node test/quiet-status.test.mjs` (it runs the reader against a fake home).

The accounts panel's parsing and commands are in `mods/quiet-accounts/accounts.js`. `node --test test/` runs all tests; the panel's tests run `agent-account` against a temporary registry (`AGENT_ACCOUNTS_HOME`), never your accounts.

## Credits

`mods/quiet-spaces`, `mods/quiet-agents` and `mods/quiet-status` are forks of the `spaces`, `agents` and `workspace-status` mods that ship with Herdr (Apache-2.0). The look borrows from t3code and Orca.

## License

Apache-2.0
