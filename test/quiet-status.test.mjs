// Tests for the quiet-status readers: `node test/quiet-status.test.mjs`.
// The shell part runs against a fake home, never the real one.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { READ, parseRead, providerState } from "../mods/quiet-status/usage.js";

const NOW = Date.parse("2030-01-01T12:00:00Z");
const S = NOW / 1000;

const LIST = {
  claude: {
    active: "work",
    accounts: [
      { name: "default", home: "/home/u/.claude", email: "a@example.com", logged_in: true, account_id: null },
      { name: "work", home: "/home/u/.local/share/agent-accounts/claude/work", email: "b@example.com", logged_in: true, account_id: null },
      { name: "spare", home: "/home/u/.local/share/agent-accounts/claude/spare", email: null, logged_in: false, account_id: null },
    ],
  },
  codex: {
    active: "default",
    accounts: [
      { name: "default", home: "/home/u/.codex", email: "a@example.com", logged_in: true, account_id: "acct-a", plan: "plus" },
      { name: "team", home: "/home/u/.local/share/agent-accounts/codex/team", email: "c@example.com", logged_in: true, account_id: "acct-b", plan: "pro" },
    ],
  },
};

const claudeFile = (five, seven, capturedAgoMin = 5) => JSON.stringify({
  captured_at: S - capturedAgoMin * 60,
  rate_limits: { five_hour: { used_percentage: five, resets_at: S + 3600 }, seven_day: { used_percentage: seven, resets_at: S + 86400 } },
});

const meta = (id) => JSON.stringify({ timestamp: "2030-01-01T10:00:00Z", type: "session_meta", payload: { id: "s", creator_account_id: id, base_instructions: { text: "x".repeat(2000) } } });

const limits = (five, seven, minutesAgo = 10) => JSON.stringify({
  timestamp: new Date(NOW - minutesAgo * 60000).toISOString(),
  type: "event_msg",
  payload: {
    type: "token_count",
    info: { total_token_usage: { total_tokens: 12345 } },
    rate_limits: {
      primary: { used_percent: five, window_minutes: 300, resets_at: S + 3600 },
      secondary: { used_percent: seven, window_minutes: 10080, resets_at: S + 86400 },
      plan_type: "plus",
    },
  },
});

test("parseRead keeps one Claude reading per account and Codex readings in order", () => {
  const out = [
    `accounts\t${JSON.stringify(LIST)}`,
    `claude\tdefault\t${claudeFile(10, 20)}`,
    `claude\twork\t${claudeFile(55, 80)}`,
    `claude\tbroken\t{not json`,
    `codex\tacct-b\t${limits(30, 40)}`,
    `codex\tacct-a\t${limits(5, 6, 120)}`,
    "noise",
  ].join("\n");
  const p = parseRead(out, NOW);
  assert.equal(p.accounts.claude.active, "work");
  assert.deepEqual(Object.keys(p.claude).sort(), ["default", "work"]);
  assert.equal(p.claude.work.windows[0].used, 55);
  assert.deepEqual(p.codex.map((c) => c.id), ["acct-b", "acct-a"]);
  assert.equal(p.codex[0].reading.sessionTokens, 12345);
});

test("providerState names the active account and lists all when there are several", () => {
  const p = parseRead([
    `accounts\t${JSON.stringify(LIST)}`,
    `claude\tdefault\t${claudeFile(10, 20)}`,
    `claude\twork\t${claudeFile(55, 80)}`,
    `codex\tacct-b\t${limits(30, 40)}`,
    `codex\tacct-a\t${limits(5, 6, 120)}`,
  ].join("\n"), NOW);

  const c = providerState(p, "claude");
  assert.equal(c.name, "work");
  assert.equal(c.reading.windows[0].used, 55);
  assert.deepEqual(c.accounts.map((a) => [a.name, a.active, a.loggedIn, Boolean(a.reading)]), [
    ["default", false, true, true],
    ["work", true, true, true],
    ["spare", false, false, false],
  ]);

  const x = providerState(p, "codex");
  assert.equal(x.name, "default");
  assert.equal(x.reading.windows[0].used, 5); // acct-a, not the newer acct-b
  assert.equal(x.accounts.find((a) => a.name === "team").reading.windows[0].used, 30);
});

test("an unknown active name falls back to default", () => {
  const list = structuredClone(LIST);
  list.claude.active = "gone";
  const p = parseRead(`accounts\t${JSON.stringify(list)}\nclaude\tdefault\t${claudeFile(10, 20)}`, NOW);
  const c = providerState(p, "claude");
  assert.equal(c.name, "default");
  assert.equal(c.reading.windows[0].used, 10);
});

test("several accounts and no reading still show, so the card can switch", () => {
  const c = providerState(parseRead(`accounts\t${JSON.stringify(LIST)}`, NOW), "claude");
  assert.equal(c.reading, null);
  assert.equal(c.accounts.length, 3);
});

test("without agent-account: one unnamed reading, as before", () => {
  const p = parseRead([
    `claude\tdefault\t${claudeFile(10, 20)}`,
    `codex\tacct-b\t${limits(30, 40)}`,
    `codex\tacct-a\t${limits(5, 6, 120)}`,
  ].join("\n"), NOW);
  const c = providerState(p, "claude");
  assert.equal(c.name, null);
  assert.deepEqual(c.accounts, []);
  assert.equal(c.reading.windows[0].used, 10);
  assert.equal(providerState(p, "codex").reading.windows[0].used, 30); // the newest
  assert.equal(providerState(parseRead("", NOW), "claude"), null);
  assert.equal(providerState({}, "codex"), null);
});

test("the first version's rate-limits.json counts as the default account", () => {
  const p = parseRead(`claude\trate-limits\t${claudeFile(42, 50)}`, NOW);
  assert.equal(providerState(p, "claude").reading.windows[0].used, 42);
});

test("one account: every reading on the machine is its own", () => {
  const list = { codex: { active: "default", accounts: [{ name: "default", email: null, logged_in: true, account_id: null }] } };
  const p = parseRead(`accounts\t${JSON.stringify(list)}\ncodex\t\t${limits(7, 8)}`, NOW);
  const x = providerState(p, "codex");
  assert.equal(x.name, null);
  assert.equal(x.reading.windows[0].used, 7);
});

test("the READ script reads a fake home: accounts, Claude files, newest Codex reading per account", () => {
  const home = mkdtempSync(join(tmpdir(), "quiet-status-"));
  try {
    const bin = join(home, "bin");
    mkdirSync(bin);
    // Indented with tabs, which must not be taken for field separators.
    writeFileSync(join(bin, "agent-account"), `#!/bin/sh\n[ "$1 $2" = "list --json" ] || exit 2\ncat <<'EOF'\n${JSON.stringify(LIST, null, "\t")}\nEOF\n`);
    chmodSync(join(bin, "agent-account"), 0o755);

    const cache = join(home, "cache", "claude-usage");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "default.json"), `${claudeFile(10, 20)}\n`);
    writeFileSync(join(cache, "work.json"), claudeFile(55, 80).replace(",", ",\n"));

    const day = join(home, ".codex", "sessions", "2030", "01", "01");
    mkdirSync(day, { recursive: true });
    const rollout = (name, lines, ageMin) => {
      const f = join(day, `rollout-${name}.jsonl`);
      writeFileSync(f, lines.join("\n") + "\n");
      const t = (NOW - ageMin * 60000) / 1000;
      utimesSync(f, t, t);
    };
    rollout("a-new", [meta("acct-a"), '{"type":"event_msg","payload":{"type":"agent_message"}}'], 1); // no reading
    rollout("b-new", [meta("acct-b"), limits(10, 11), limits(30, 40)], 2);
    rollout("a-old", [meta("acct-a"), limits(5, 6, 120)], 3);
    rollout("b-old", [meta("acct-b"), limits(99, 99, 300)], 4); // older than b-new: skipped

    const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, XDG_CACHE_HOME: join(home, "cache") };
    const stdout = execFileSync("sh", ["-c", READ], { env, encoding: "utf8" });
    const kinds = stdout.trim().split("\n").map((l) => (l.startsWith("accounts\t") ? "accounts" : l.split("\t").slice(0, 2).join(" ")));
    assert.deepEqual(kinds, ["accounts", "claude default", "claude work", "codex acct-b", "codex acct-a"]);

    const p = parseRead(stdout, NOW);
    assert.equal(providerState(p, "claude").reading.windows[0].used, 55);
    const x = providerState(p, "codex");
    assert.equal(x.reading.windows[0].used, 5);
    assert.equal(x.accounts.find((a) => a.name === "team").reading.windows[0].used, 30);

    // Without agent-account on PATH, the same files still give one reading each.
    const plain = execFileSync("sh", ["-c", READ], { env: { ...env, PATH: "/usr/bin:/bin" }, encoding: "utf8" });
    const q = parseRead(plain, NOW);
    assert.equal(q.accounts, null);
    assert.equal(providerState(q, "claude").reading.windows[0].used, 10);
    assert.equal(providerState(q, "codex").reading.windows[0].used, 30);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
