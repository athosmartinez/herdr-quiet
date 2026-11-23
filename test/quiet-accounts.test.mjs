// Tests for the quiet-accounts helpers: `node --test test/`.
// The CLI part runs against a fake registry (AGENT_ACCOUNTS_HOME), never the real one.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVIDERS, parseAccounts, validId, addArgs, setArgs, useArgs, loginArgv, loginCommand,
  parseGhStatus, parseGhStatusText, ghStatusFromText, flagRejected, readGhAccounts, editGhAccounts, addedExisting,
  validGhName, firstLine,
} from "../mods/quiet-accounts/accounts.js";

const LIST = {
  claude: {
    active: "work",
    accounts: [
      { id: "default", name: "default", label: "alice", tag: "personal", home: "/h/.claude", email: "a@example.com", logged_in: true, account_id: null },
      { id: "work", name: "work", label: "bob", tag: "work", home: "/h/claude/work", email: "b@example.com", logged_in: true, account_id: null },
      { id: "spare", name: "spare", label: null, tag: null, home: "/h/claude/spare", email: null, logged_in: false, account_id: null },
    ],
  },
  codex: {
    active: "default",
    accounts: [
      { id: "default", name: "default", label: "alice", tag: null, home: "/h/.codex", email: "a@example.com", logged_in: true, account_id: "acct-a", plan: "plus" },
    ],
  },
};

test("parseAccounts gives every provider, in order, with each account's state", () => {
  const groups = parseAccounts(JSON.stringify(LIST));
  assert.deepEqual(groups.map((g) => g.key), PROVIDERS.map((p) => p.key));
  const [claude, codex, cursor] = groups;
  assert.equal(claude.name, "Claude");
  assert.equal(claude.active, "work");
  assert.deepEqual(claude.accounts.map((a) => [a.id, a.label, a.active, a.state]), [
    ["default", "alice", false, "in"],
    ["work", "bob", true, "in"],
    ["spare", "spare", false, "out"],
  ]);
  assert.equal(claude.accounts[2].tag, "");
  assert.equal(claude.accounts[2].email, "");
  assert.equal(codex.accounts[0].plan, "plus");
  // A provider the CLI doesn't list still has its normal home.
  assert.deepEqual(cursor.accounts.map((a) => [a.id, a.state, a.active]), [["default", "unknown", true]]);
});

test("parseAccounts treats a null login as unknown and survives bad input", () => {
  const groups = parseAccounts(JSON.stringify({ cursor: { active: "ci", accounts: [{ id: "ci", logged_in: null }] } }));
  assert.deepEqual(groups[2].accounts.map((a) => [a.id, a.state, a.active]), [["default", "unknown", false], ["ci", "unknown", true]]);
  assert.equal(parseAccounts("not json"), null);
  assert.equal(parseAccounts(""), null);
  assert.equal(parseAccounts("[]"), null);
});

test("validId follows agent-account's rule", () => {
  for (const ok of ["work", "a", "team.2", "x_y-z", "a".repeat(32)]) assert.equal(validId(ok), true, ok);
  for (const bad of ["", "default", "active", "accounts.json", "Work", "-x", ".x", "a b", "a/b", "a".repeat(33)]) {
    assert.equal(validId(bad), false, bad);
  }
});

test("addArgs builds the add command and checks the id", () => {
  assert.deepEqual(addArgs("claude", "team", { label: "Team", tag: "work" }), { args: ["add", "claude", "team", "--label", "Team", "--tag", "work"] });
  assert.deepEqual(addArgs("codex", " team ", { label: "  ", tag: "" }), { args: ["add", "codex", "team"] });
  assert.match(addArgs("claude", "Team", {}).error, /lowercase/);
  assert.match(addArgs("claude", "default", {}).error, /already exists/);
  assert.match(addArgs("nope", "team", {}).error, /provider/);
});

test("setArgs sends only what changed, and an empty value clears it", () => {
  const a = { id: "work", label: "bob", tag: "work" };
  assert.equal(setArgs("claude", a, { label: "bob", tag: "work" }), null);
  assert.deepEqual(setArgs("claude", a, { label: "Bob", tag: "work" }), ["set", "claude", "work", "--label", "Bob"]);
  assert.deepEqual(setArgs("claude", a, { label: "bob", tag: " " }), ["set", "claude", "work", "--tag", ""]);
  // The label shown falls back to the id: typing the id again changes nothing.
  assert.equal(setArgs("claude", { id: "spare", label: "spare", tag: "" }, { label: "spare", tag: "" }), null);
  // A label starting with "-" stays one argument: the CLI reads it as the value of --label.
  assert.deepEqual(setArgs("claude", a, { label: "-x", tag: "work" }), ["set", "claude", "work", "--label", "-x"]);
});

test("useArgs and the login command", () => {
  assert.deepEqual(useArgs("codex", "team"), ["use", "codex", "team"]);
  assert.deepEqual(loginArgv("claude", "spare"), ["agent-account", "login", "claude", "spare"]);
  assert.equal(loginCommand("cursor", "ci"), "agent-account login cursor ci");
});

test("parseGhStatus lists each login per host, active first, and never a token", () => {
  const json = JSON.stringify({
    hosts: {
      "github.com": [
        { state: "success", active: false, host: "github.com", login: "work-me", tokenSource: "keyring", scopes: "repo", token: "gho_secret" },
        { state: "success", active: true, host: "github.com", login: "me", tokenSource: "keyring", scopes: "repo" },
      ],
      "ghe.example.com": [{ state: "error", active: true, host: "ghe.example.com", login: "corp-me", error: "token expired" }],
    },
  });
  const list = parseGhStatus(json);
  assert.deepEqual(list, [
    { host: "github.com", login: "me", active: true, ok: true },
    { host: "github.com", login: "work-me", active: false, ok: true },
    { host: "ghe.example.com", login: "corp-me", active: true, ok: false },
  ]);
  assert.ok(!JSON.stringify(list).includes("gho_"));
  assert.equal(parseGhStatus("nope"), null);
});

test("parseGhStatusText reads the plain output of older gh", () => {
  const text = [
    "github.com",
    "  ✓ Logged in to github.com account me (keyring)",
    "  - Active account: true",
    "  - Git operations protocol: https",
    "  - Token: gho_************************************",
    "",
    "  ✓ Logged in to github.com account work-me (keyring)",
    "  - Active account: false",
    "",
    "  X Failed to log in to github.com account old-me (keyring)",
    "  - Active account: false",
  ].join("\n");
  assert.deepEqual(parseGhStatusText(text), [
    { host: "github.com", login: "me", active: true, ok: true },
    { host: "github.com", login: "work-me", active: false, ok: true },
    { host: "github.com", login: "old-me", active: false, ok: false },
  ]);
  assert.deepEqual(parseGhStatusText("You are not logged into any GitHub hosts."), []);
});

test("parseGhStatusText reads gh before 2.40: \"as <login>\", one account per host", () => {
  const text = [
    "github.com",
    "  ✓ Logged in to github.com as me (oauth_token)",
    "  ✓ Git operations for github.com configured to use https protocol.",
    "  ✓ Token: *******************",
    "ghe.example.com",
    "  X Failed to log in to ghe.example.com as corp-me (GH_TOKEN)",
  ].join("\n");
  assert.deepEqual(parseGhStatusText(text), [
    { host: "github.com", login: "me", active: true, ok: true },
    { host: "ghe.example.com", login: "corp-me", active: true, ok: false },
  ]);
});

test("ghStatusFromText tells no account apart from a failed query", () => {
  assert.deepEqual(ghStatusFromText(1, "", "You are not logged into any GitHub hosts. To log in, run: gh auth login"), { list: [] });
  assert.deepEqual(ghStatusFromText(1, "", "error connecting to api.github.com\ncheck your internet connection"), { error: "error connecting to api.github.com" });
  assert.deepEqual(ghStatusFromText(2, "", ""), { error: "gh exited with 2" });
  // A failed login among others still lists the accounts.
  assert.equal(ghStatusFromText(1, "github.com\n  X Failed to log in to github.com account me (keyring)\n  - Active account: true", "").list.length, 1);
  assert.equal(flagRejected("unknown flag: --no-refresh"), true);
  assert.equal(flagRejected("flag provided but not defined: -json"), true);
  assert.equal(flagRejected("You are not logged into any GitHub hosts."), false);
});

test("readGhAccounts keeps only valid owner → login pairs", () => {
  const text = JSON.stringify({ gate: true, gh_accounts: { "my-co": "work-me", bad: "x y", "": "me", other: 3 } });
  assert.deepEqual(readGhAccounts(text), { ok: true, map: { "my-co": "work-me" } });
  assert.deepEqual(readGhAccounts(null), { ok: true, map: {} });
  assert.deepEqual(readGhAccounts(""), { ok: true, map: {} });
  assert.equal(readGhAccounts("{ broken").ok, false);
  assert.equal(readGhAccounts("[1]").ok, false);
});

test("editGhAccounts changes one pair and keeps every other key and pair", () => {
  const before = JSON.stringify({ stall_minutes: 20, gh_accounts: { old: "me", my_org: "hand-written" }, trackers: { "*": { pattern: "x-\\d+" } } });
  const after = JSON.parse(editGhAccounts(before, { owner: "my-co", login: "work-me" }));
  assert.deepEqual(Object.keys(after), ["stall_minutes", "gh_accounts", "trackers"]);
  // A pair the panel can't show ("my_org") stays as it was written.
  assert.deepEqual(after.gh_accounts, { old: "me", my_org: "hand-written", "my-co": "work-me" });
  assert.deepEqual(after.trackers, { "*": { pattern: "x-\\d+" } });
  // Edit: the edited key goes, the new one comes; unmap removes only that key.
  assert.deepEqual(JSON.parse(editGhAccounts(before, { from: "old", owner: "new", login: "me" })).gh_accounts, { my_org: "hand-written", new: "me" });
  assert.deepEqual(JSON.parse(editGhAccounts(before, { from: "old" })).gh_accounts, { my_org: "hand-written" });
  // No file yet: only the map. An empty map drops the key.
  assert.deepEqual(JSON.parse(editGhAccounts(null, { owner: "a", login: "b" })), { gh_accounts: { a: "b" } });
  assert.deepEqual(JSON.parse(editGhAccounts(JSON.stringify({ gate: true, gh_accounts: { a: "b" } }), { from: "a" })), { gate: true });
  assert.ok(editGhAccounts(null, { owner: "a", login: "b" }).endsWith("}\n"));
  // A broken file, or a gh_accounts that is not an object, is never overwritten.
  assert.throws(() => editGhAccounts("{ broken", { owner: "a", login: "b" }), /not valid JSON/);
  assert.throws(() => editGhAccounts(JSON.stringify({ gh_accounts: "x" }), { owner: "a", login: "b" }), /not an object/);
  assert.throws(() => editGhAccounts(null, { owner: "a b", login: "c" }), /owner/);
  assert.throws(() => editGhAccounts(null, { owner: "a", login: "c d" }), /login/);
});

test("editGhAccounts saves the owner in lowercase, as quiet-spaces looks it up", () => {
  const out = JSON.parse(editGhAccounts(JSON.stringify({ gh_accounts: { "My-Company": "old-me", other: "x" } }), { owner: "My-Company", login: "work-me" }));
  // The mixed-case key would win over the lowercase one in quiet-spaces: it goes.
  assert.deepEqual(out.gh_accounts, { other: "x", "my-company": "work-me" });
});

test("addedExisting reads the output of add on an id that exists", () => {
  assert.equal(addedExisting("claude account 'team' exists: /h/claude/team (its own files are kept; links refreshed)\nLog in, ..."), true);
  assert.equal(addedExisting("claude account 'team' created: /h/claude/team\nLog in, ..."), false);
  assert.equal(addedExisting(""), false);
});

test("validGhName and firstLine", () => {
  assert.equal(validGhName("my-co"), true);
  assert.equal(validGhName("a_b"), false);
  assert.equal(validGhName(""), false);
  assert.equal(firstLine("\n  boom\nmore"), "boom");
  assert.equal(firstLine(null), "");
});

// The commands the panel builds, run against agent-account with a fake
// registry inside this folder, removed after. Cursor, because its accounts
// hold only a key file: `add` links nothing from the real homes. Skipped when
// agent-account is not installed here.
const hasCli = spawnSync("sh", ["-c", "command -v agent-account"]).status === 0;

test("the built commands work with agent-account", { skip: !hasCli && "agent-account is not installed" }, () => {
  const home = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), ".registry-"));
  const env = { ...process.env, AGENT_ACCOUNTS_HOME: home };
  const cli = (args) => execFileSync("agent-account", args, { env, encoding: "utf8" });
  try {
    assert.equal(addedExisting(cli(addArgs("cursor", "team", { label: "Team", tag: "work" }).args)), false);
    let cursor = parseAccounts(cli(["list", "--json"]))[2];
    const team = cursor.accounts.find((a) => a.id === "team");
    assert.deepEqual([team.label, team.tag, team.state], ["Team", "work", "out"]);
    cli(setArgs("cursor", team, { label: "Team 2", tag: "" }));
    cli(useArgs("cursor", "team"));
    cursor = parseAccounts(cli(["list", "--json"]))[2];
    const after = cursor.accounts.find((a) => a.id === "team");
    assert.deepEqual([after.label, after.tag, after.active], ["Team 2", "", true]);
    // add on an existing id doesn't fail: its output says the account exists.
    assert.equal(addedExisting(cli(addArgs("cursor", "team", {}).args)), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
