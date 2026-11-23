# Quiet for Herdr

A calm layout for [Herdr](https://herdr.dev): black or near-white, hairline borders, one indigo accent. Color appears only where something needs you. Each space in the sidebar shows its agent status and name, then its branch, pull request (number, state, review, base) and diff.

Unlike [Herdr T3](https://github.com/JinJieBeWater/herdr-t3), Quiet keeps Herdr's own main layout and adds git and pull request state to each space.

See [RECIPE.md](RECIPE.md) for what it does and how it is built.

## Install

Ask your Herdr agent to add `github.com/athosmartinez/herdr-quiet`, or copy by hand:

```sh
cp layouts/quiet.json ~/.config/herdr-app/layouts/
cp themes/quiet-*.json ~/.config/herdr-app/themes/
cp -R mods/quiet-spaces ~/.config/herdr-app/mods/
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

### Orchestrating agents

- **Needs you:** when an agent anywhere waits for you, a row appears above the spaces. A click goes to the next waiting agent; resting on it lists them all with what each one asks.
- **Sub-agents:** the bot count on a space is its agents' live sub-agents; the card shows each one's model, effort and working time.
- **Review verdicts:** an orchestrator can label its reviewer terminals after it checks their review, and the PR line shows `opus ✓  sol ✗4`:

  ```sh
  hc label <reviewer> quiet.pr=42 quiet.verdict=ISSUES quiet.findings=4   # optional: quiet.repo=<repo>
  ```

## Developing

If `mods/quiet-spaces` is a symlink into a clone, Herdr may not notice edits made in the clone. Switch layouts (`herdr-app do layout.switch --name main`, then `--name quiet`) to load the new code, and check it with `herdr-app check`.

## Credits

`mods/quiet-spaces` is a fork of the `spaces` mod that ships with Herdr (Apache-2.0). The look borrows from t3code and Orca.

## License

Apache-2.0
