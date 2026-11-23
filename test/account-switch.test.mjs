// Tests for the account switch of the status bar and the accounts panel:
// `agent-account use <provider> <id> --restart`, with a fallback for an older
// agent-account. Each mod keeps its own copy (a mod imports only its own
// files), so both copies run the same cases. No real agent-account runs here.

import test from "node:test";
import assert from "node:assert/strict";
import * as status from "../mods/quiet-status/usage.js";
import * as accounts from "../mods/quiet-accounts/accounts.js";

// A fake `cli` that records each call and answers from `answers` in turn.
const fakeCli = (...answers) => {
  const calls = [];
  const cli = async (args) => { calls.push(args); return answers.shift(); };
  return { cli, calls };
};

for (const [name, { switchAccount, switchToast }] of Object.entries({ status, accounts })) {
  test(`${name}: switchAccount restarts Claude and Codex sessions, never Cursor`, async () => {
    const line = "2 claude sessions will restart on atendimento when idle";
    let f = fakeCli({ code: 0, stdout: `${line}\n`, stderr: "" });
    let r = await switchAccount(f.cli, "claude", "atendimento");
    assert.deepEqual(f.calls, [["use", "claude", "atendimento", "--restart"]]);
    assert.equal(r.restart, "on");
    assert.deepEqual(switchToast("Claude", "atendimento", r), { title: "Claude: new sessions use atendimento", body: line, level: "success", timeout: 5000 });

    f = fakeCli({ code: 0, stdout: "0 codex sessions will restart on team when idle\n", stderr: "" });
    r = await switchAccount(f.cli, "codex", "team");
    assert.deepEqual(f.calls, [["use", "codex", "team", "--restart"]]);
    assert.equal(switchToast("Codex", "carol", r).body, "0 codex sessions will restart on team when idle");

    f = fakeCli({ code: 0, stdout: "cursor: new sessions use ci (ci); running sessions keep their account\n", stderr: "" });
    r = await switchAccount(f.cli, "cursor", "ci");
    assert.deepEqual(f.calls, [["use", "cursor", "ci"]]);
    assert.equal(r.restart, "off");
    assert.equal(switchToast("Cursor", "ci", r).body, "Running sessions keep their account.");
  });

  test(`${name}: switchAccount falls back to plain use when agent-account rejects --restart`, async () => {
    const f = fakeCli(
      { code: 1, stdout: "", stderr: "agent-account: unknown option '--restart'\n" },
      { code: 0, stdout: "codex: new sessions use team (c@example.com); running sessions keep their account\n", stderr: "" },
    );
    const r = await switchAccount(f.cli, "codex", "team");
    assert.deepEqual(f.calls, [["use", "codex", "team", "--restart"], ["use", "codex", "team"]]);
    assert.deepEqual([r.code, r.restart], [0, "unsupported"]);
    const t = switchToast("Codex", "carol", r);
    assert.deepEqual([t.level, t.title], ["success", "Codex: new sessions use carol"]);
    assert.match(t.body, /keep their account/);
    assert.match(t.body, /--restart/);
  });

  test(`${name}: an old use that ignores --restart, and a real failure`, async () => {
    // The agent-account before --restart ignores extra arguments: it switches
    // and restarts nothing, and says so in its line.
    let f = fakeCli({ code: 0, stdout: "claude: new sessions use work (b@example.com); running sessions keep their account\n", stderr: "" });
    let r = await switchAccount(f.cli, "claude", "work");
    assert.equal(f.calls.length, 1);
    assert.equal(r.restart, "unsupported");
    assert.match(switchToast("Claude", "bob", r).body, /keep their account/);

    // Another error is not retried: it is the toast.
    f = fakeCli({ code: 1, stdout: "", stderr: "agent-account: no claude account 'gone'\n" });
    r = await switchAccount(f.cli, "claude", "gone");
    assert.equal(f.calls.length, 1);
    assert.deepEqual(switchToast("Claude", "gone", r), { title: "Claude: could not switch to gone", body: "agent-account: no claude account 'gone'", level: "error" });
    assert.equal(switchToast("Claude", "x", { code: 3, stdout: "", stderr: "" }).body, "agent-account exited with 3");
  });
}
