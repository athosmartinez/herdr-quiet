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

## Credits

`mods/quiet-spaces` is a fork of the `spaces` mod that ships with Herdr (Apache-2.0). The look borrows from t3code and Orca.

## License

Apache-2.0
