// Tests for the quiet-status readers: `node test/quiet-status.test.mjs`.
// The shell part runs against a fake home, never the real one.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { READ, CURSOR_USAGE, parseRead, providerState, parseCursor, parseCursorUsage, withRead, withCursor, pace, level, windowName } from "../mods/quiet-status/usage.js";

const NOW = Date.parse("2030-01-01T12:00:00Z");
const S = NOW / 1000;

const account = (id, label, tag, rest) => ({ id, name: id, label: label ?? id, tag: tag ?? null, ...rest });

const LIST = {
  claude: {
    active: "work",
    accounts: [
      account("default", "alice", "personal", { home: "/home/u/.claude", email: "a@example.com", logged_in: true, account_id: null }),
      account("work", "bob", "work", { home: "/home/u/.local/share/agent-accounts/claude/work", email: "b@example.com", logged_in: true, account_id: null }),
      account("spare", null, null, { home: "/home/u/.local/share/agent-accounts/claude/spare", email: null, logged_in: false, account_id: null }),
    ],
  },
  codex: {
    active: "default",
    accounts: [
      account("default", "alice", "personal", { home: "/home/u/.codex", email: "a@example.com", logged_in: true, account_id: "acct-a", plan: "plus" }),
      account("team", "carol", "work", { home: "/home/u/.local/share/agent-accounts/codex/team", email: "c@example.com", logged_in: true, account_id: "acct-b", plan: "pro" }),
    ],
  },
  cursor: {
    active: "default",
    accounts: [
      account("default", "alice", "personal", { home: "/home/u/.cursor", email: null, logged_in: null, account_id: null }),
      account("ci", null, "work", { home: "/home/u/.local/share/agent-accounts/cursor/ci", email: null, logged_in: false, account_id: null }),
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
  assert.equal(c.label, "bob");
  assert.equal(c.reading.windows[0].used, 55);
  assert.deepEqual(c.accounts.map((a) => [a.id, a.label, a.tag, a.active, a.loggedIn, Boolean(a.reading)]), [
    ["default", "alice", "personal", false, true, true],
    ["work", "bob", "work", true, true, true],
    ["spare", "spare", null, false, false, false],
  ]);

  const x = providerState(p, "codex");
  assert.equal(x.label, "alice"); // the label, never "default"
  assert.equal(x.reading.windows[0].used, 5); // acct-a, not the newer acct-b
  assert.equal(x.accounts.find((a) => a.id === "team").reading.windows[0].used, 30);
});

test("an unknown active name falls back to default", () => {
  const list = structuredClone(LIST);
  list.claude.active = "gone";
  const p = parseRead(`accounts\t${JSON.stringify(list)}\nclaude\tdefault\t${claudeFile(10, 20)}`, NOW);
  const c = providerState(p, "claude");
  assert.equal(c.label, "alice");
  assert.equal(c.accounts.find((a) => a.active).id, "default");
  assert.equal(c.reading.windows[0].used, 10);
});

test("an account without label or tag: the label is its id", () => {
  const list = { claude: { active: "x", accounts: [{ name: "default" }, { id: "x", name: "x", label: "", tag: "" }] } };
  const c = providerState(parseRead(`accounts\t${JSON.stringify(list)}`, NOW), "claude");
  assert.equal(c.label, "x");
  assert.deepEqual(c.accounts.map((a) => [a.id, a.label, a.tag]), [["default", "default", null], ["x", "x", null]]);
});

test("Cursor: accounts without gauges; one account shows nothing", () => {
  const p = parseRead(`accounts\t${JSON.stringify(LIST)}\ncodex\tacct-a\t${limits(5, 6)}`, NOW);
  const k = providerState(p, "cursor");
  assert.equal(k.reading, null);
  assert.equal(k.label, "alice");
  assert.deepEqual(k.accounts.map((a) => [a.id, a.tag, a.loggedIn, a.reading]), [
    ["default", "personal", true, null], // logged_in null: unknown, still selectable
    ["ci", "work", false, null],
  ]);
  const one = { cursor: { active: "default", accounts: [account("default", "alice", null, { logged_in: true })] } };
  assert.equal(providerState(parseRead(`accounts\t${JSON.stringify(one)}`, NOW), "cursor"), null);
  assert.equal(providerState(parseRead("", NOW), "cursor"), null);
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
  assert.equal(c.label, null);
  assert.deepEqual(c.accounts, []);
  assert.equal(c.reading.windows[0].used, 10);
  assert.equal(providerState(p, "codex").reading.windows[0].used, 30); // the newest
  assert.equal(providerState(parseRead("", NOW), "claude"), null);
  assert.equal(providerState({}, "codex"), null);
});

test("a Claude file of another account is never the default account's", () => {
  const list = { claude: { active: "default", accounts: [{ name: "default", email: null, logged_in: true }] } };
  const p = parseRead(`accounts\t${JSON.stringify(list)}\nclaude\trate-limits\t${claudeFile(42, 50)}\nclaude\told\t${claudeFile(87, 90)}`, NOW);
  assert.equal(providerState(p, "claude"), null);
});

test("one account: a Codex reading of another account id is not its own", () => {
  const list = { codex: { active: "default", accounts: [{ name: "default", email: null, logged_in: true, account_id: "new-id" }] } };
  const p = parseRead(`accounts\t${JSON.stringify(list)}\ncodex\told-id\t${limits(87, 8)}`, NOW);
  assert.equal(providerState(p, "codex"), null);
});

test("one account with an unknown id: the newest reading", () => {
  const list = { codex: { active: "default", accounts: [{ name: "default", email: null, logged_in: true, account_id: null }] } };
  const p = parseRead(`accounts\t${JSON.stringify(list)}\ncodex\t\t${limits(7, 8)}`, NOW);
  const x = providerState(p, "codex");
  assert.equal(x.label, null);
  assert.equal(x.reading.windows[0].used, 7);
});

test("managed: agent-account listed the provider, also with one account", () => {
  const one = { claude: { active: "default", accounts: [{ name: "default", email: null, logged_in: true }] } };
  const c = providerState(parseRead(`accounts\t${JSON.stringify(one)}\nclaude\tdefault\t${claudeFile(10, 20)}`, NOW), "claude");
  assert.deepEqual([c.managed, c.accounts.length, c.label], [true, 0, null]);
  assert.equal(providerState(parseRead(`accounts\t${JSON.stringify(LIST)}`, NOW), "claude").managed, true);
  // Without agent-account there is nothing to manage.
  assert.equal(providerState(parseRead(`claude\tdefault\t${claudeFile(10, 20)}`, NOW), "claude").managed, false);
});

test("Codex: the newest event per account wins, not the first file", () => {
  const list = { codex: { active: "default", accounts: [
    { name: "default", email: null, logged_in: true, account_id: "a1" },
    { name: "work", email: null, logged_in: true, account_id: "a2" },
  ] } };
  const at = (min) => new Date(NOW - min * 60000).toISOString();
  const ev = (used, ts) => limits(used, 8).replace(/"timestamp":"[^"]*"/, `"timestamp":"${ts}"`);
  const p = parseRead(`accounts\t${JSON.stringify(list)}\ncodex\ta1\t${ev(10, at(120))}\ncodex\ta1\t${ev(80, at(5))}`, NOW);
  assert.equal(providerState(p, "codex").reading.windows[0].used, 80);
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
    // A rate-limit event with no window is no reading: the older file's one stays.
    rollout("a-new", [meta("acct-a"), '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":null,"secondary":null}}}'], 1);
    rollout("b-new", [meta("acct-b"), limits(10, 11), limits(30, 40)], 2);
    rollout("a-old", [meta("acct-a"), limits(5, 6, 120)], 3);
    rollout("b-old", [meta("acct-b"), limits(99, 99, 300)], 4); // read, but its event is older than b-new's

    const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, XDG_CACHE_HOME: join(home, "cache") };
    const stdout = execFileSync("sh", ["-c", READ], { env, encoding: "utf8" });
    const kinds = stdout.trim().split("\n").map((l) => (l.startsWith("accounts\t") ? "accounts" : l.split("\t").slice(0, 2).join(" ")));
    assert.deepEqual(kinds, ["accounts", "claude default", "claude work", "codex acct-b", "codex acct-a", "codex acct-b"]);

    const p = parseRead(stdout, NOW);
    assert.equal(providerState(p, "claude").reading.windows[0].used, 55);
    const x = providerState(p, "codex");
    assert.equal(x.reading.windows[0].used, 5);
    assert.equal(x.accounts.find((a) => a.id === "team").reading.windows[0].used, 30);

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

// --- Cursor usage (`agent-account usage cursor --json`) --------------------

const cursorItem = (id, rest) => ({
  provider: "cursor", id, plan: "Super", used_percent: 42.5, spent_usd: 12.34, limit_usd: 40,
  resets_at: new Date(NOW + 10 * 86400000).toISOString(), window_minutes: 43200,
  updated_at: new Date(NOW - 3 * 60000).toISOString(), error: null, ...rest,
});

const USAGE = [
  cursorItem("default"),
  cursorItem("ci", { plan: null, used_percent: null, spent_usd: null, limit_usd: null, resets_at: null, window_minutes: null, error: "HTTP 401" }),
];

test("parseCursor: one billing-period window with spent and limit in USD", () => {
  const u = parseCursor(cursorItem("default"), NOW);
  assert.equal(u.windows.length, 1);
  assert.deepEqual([u.windows[0].min, u.windows[0].used, u.windows[0].resets], [43200, 42.5, NOW + 10 * 86400000]);
  assert.deepEqual([u.plan, u.spentUsd, u.limitUsd, u.at], ["Super", 12.34, 40, NOW - 3 * 60000]);
  // An account that could not be read, or a plan with no limit, has no gauge.
  assert.equal(parseCursor(USAGE[1], NOW), null);
  assert.equal(parseCursor(cursorItem("x", { used_percent: null }), NOW), null);
  assert.equal(parseCursor(null, NOW), null);
  // A period that ended since the reading: the percent belonged to the old one.
  assert.equal(parseCursor(cursorItem("x", { resets_at: new Date(NOW - 1000).toISOString() }), NOW).windows[0].used, null);
});

// The state after a READ and a Cursor read that printed `usage`.
const ok = (stdout) => ({ code: 0, stdout, stderr: "" });
const withUsage = (readOut, usage) => withCursor(withRead(undefined, parseRead(readOut, NOW), NOW), ok(JSON.stringify(usage)), NOW);

test("parseCursorUsage keeps one Cursor reading per account; an error account has none", () => {
  const c = parseCursorUsage(JSON.stringify(USAGE), NOW);
  assert.deepEqual(Object.keys(c), ["default"]);
  const k = providerState(withUsage(`accounts\t${JSON.stringify(LIST)}`, USAGE), "cursor");
  assert.equal(k.label, "alice");
  assert.equal(k.reading.windows[0].used, 42.5);
  assert.deepEqual(k.accounts.map((a) => [a.id, a.reading?.windows[0].used ?? null]), [["default", 42.5], ["ci", null]]);
  // Not a list (an old agent-account that printed something else): no readings.
  assert.equal(parseCursorUsage('{"error":"x"}', NOW), null);
  assert.equal(parseCursorUsage("Usage: agent-account <command>", NOW), null);
  assert.equal(parseCursorUsage("", NOW), null);
});

test("Cursor with one account shows when it has a reading", () => {
  const one = { cursor: { active: "default", accounts: [account("default", "alice", null, { logged_in: null })] } };
  const k = providerState(withUsage(`accounts\t${JSON.stringify(one)}`, [cursorItem("default")]), "cursor");
  assert.deepEqual([k.label, k.accounts.length, k.managed, k.reading.windows[0].used], [null, 0, true, 42.5]);
  // An error account alone shows nothing, as before.
  const err = withUsage(`accounts\t${JSON.stringify(one)}`, [{ ...USAGE[1], id: "default" }]);
  assert.equal(providerState(err, "cursor"), null);
});

test("a failed or slow Cursor read never erases the other readings, and keeps the last good one", () => {
  const out = [`accounts\t${JSON.stringify(LIST)}`, `claude\twork\t${claudeFile(55, 80)}`, `codex\tacct-a\t${limits(5, 6)}`].join("\n");
  let st = withRead(undefined, parseRead(out, NOW), NOW);
  // The first Cursor read times out (exec rejects: the caller passes null) or fails.
  assert.equal(withCursor(st, null, NOW), st);
  assert.equal(withCursor(st, { code: -1, stdout: "", stderr: "timeout" }, NOW), st);
  assert.equal(providerState(st, "claude").reading.windows[0].used, 55);
  assert.equal(providerState(st, "codex").reading.windows[0].used, 5);
  assert.equal(providerState(st, "cursor").reading, null);

  // A good read, then a failed one: the good reading stays.
  st = withCursor(st, ok(JSON.stringify(USAGE)), NOW);
  st = withCursor(st, { code: 1, stdout: "", stderr: "agent-account: unknown command 'usage'" }, NOW);
  st = withCursor(st, ok("not json"), NOW);
  assert.equal(providerState(st, "cursor").reading.windows[0].used, 42.5);
  assert.equal(providerState(st, "claude").reading.windows[0].used, 55);

  // The next READ replaces the other readings and keeps the Cursor ones.
  st = withRead(st, parseRead([`accounts\t${JSON.stringify(LIST)}`, `claude\twork\t${claudeFile(60, 80)}`].join("\n"), NOW), NOW + 1000);
  assert.equal(st.read, NOW + 1000);
  assert.equal(providerState(st, "claude").reading.windows[0].used, 60);
  assert.equal(providerState(st, "cursor").reading.windows[0].used, 42.5);

  // A Cursor read that comes before any READ keeps its readings for later.
  const early = withCursor(undefined, ok(JSON.stringify(USAGE)), NOW);
  assert.equal(providerState(withRead(early, parseRead(`accounts\t${JSON.stringify(LIST)}`, NOW), NOW), "cursor").reading.windows[0].used, 42.5);
});

test("the Cursor gauge takes the pace colors of the other windows", () => {
  const at = (used, leftDays) => parseCursor(cursorItem("x", { used_percent: used, resets_at: new Date(NOW + leftDays * 86400000).toISOString() }), NOW).windows[0];
  // 15 of 30 days passed: 50% is on pace, 70% runs 20 points ahead.
  assert.equal(Math.round(pace(at(50, 15), NOW)), 0);
  assert.equal(level(at(50, 15), NOW), "quiet");
  assert.equal(level(at(70, 15), NOW), "warn");
  assert.equal(level(at(90, 25), NOW), "high");
  // A period of unknown length has no pace: only the percent can color it.
  const noLen = parseCursor(cursorItem("x", { window_minutes: null, used_percent: 50 }), NOW).windows[0];
  assert.equal(pace(noLen, NOW), null);
  assert.equal(level(noLen, NOW), "quiet");
});

test("windowName: hours, days, and mo for a monthly billing period", () => {
  assert.deepEqual([300, 10080, 43200, 44640, 40320, null].map((m) => windowName(m)), ["5h", "7d", "mo", "mo", "mo", "?"]);
  assert.equal(windowName(20160), "14d");
  assert.equal(windowName(null, true), "mo");
});

test("Cursor usage is its own agent-account call; READ never runs it, and an old agent-account breaks nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "quiet-status-"));
  try {
    const bin = join(home, "bin");
    mkdirSync(bin);
    const fake = (usage) => {
      writeFileSync(join(bin, "agent-account"), `#!/bin/sh
case "$1 $2" in
  "list --json") cat <<'EOF'
${JSON.stringify(LIST)}
EOF
  ;;
  "usage cursor") ${usage}
  ;;
  *) echo "agent-account: unknown command '$1'" >&2; exit 1 ;;
esac
`);
      chmodSync(join(bin, "agent-account"), 0o755);
    };
    const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, XDG_CACHE_HOME: join(home, "cache") };
    const usage = () => spawnSync("agent-account", CURSOR_USAGE, { env, encoding: "utf8" });

    // READ stays fast: a usage call that hangs is never part of it.
    fake("sleep 30");
    const t0 = Date.now();
    const out = execFileSync("sh", ["-c", READ], { env, encoding: "utf8", timeout: 10000 });
    assert.ok(Date.now() - t0 < 5000);
    assert.ok(!out.split("\n").some((l) => l.startsWith("cursor\t")));
    const st = withRead(undefined, parseRead(out, NOW), NOW);
    assert.equal(st.accounts.claude.active, "work");

    fake(`[ $# -eq 5 ] && [ "$3 $4 $5" = "--json --max-age 300" ] || exit 2; cat <<'EOF'\n${JSON.stringify(USAGE, null, "\t")}\nEOF`);
    const r = usage();
    const good = withCursor(st, { code: r.status, stdout: r.stdout, stderr: r.stderr }, NOW);
    assert.equal(providerState(good, "cursor").reading.windows[0].used, 42.5);

    // An old agent-account: no `usage` command, a usage text on stdout and an error.
    fake(`echo "Usage: agent-account <command>"; echo "agent-account: unknown command 'usage'" >&2; exit 1`);
    const o = usage();
    const old = withCursor(st, { code: o.status, stdout: o.stdout, stderr: o.stderr }, NOW);
    assert.equal(old, st);
    assert.equal(providerState(old, "cursor").reading, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an account id that names an Object member (constructor) has no reading of its own by accident", () => {
  const list = {
    claude: { active: "constructor", accounts: [{ id: "default", name: "default", logged_in: true }, { id: "constructor", name: "constructor", logged_in: true }] },
    cursor: { active: "default", accounts: [{ id: "default", name: "default", logged_in: null }, { id: "constructor", name: "constructor", logged_in: null }, { id: "toString", name: "toString", logged_in: null }] },
  };
  const p = parseRead(`accounts\t${JSON.stringify(list)}`, NOW);
  const c = providerState(p, "claude");
  assert.equal(c.reading, null);
  assert.deepEqual(c.accounts.map((a) => a.reading), [null, null]);
  const k = providerState(p, "cursor");
  assert.deepEqual(k.accounts.map((a) => a.reading), [null, null, null]);
  // Its real reading still comes through.
  const q = parseRead(`accounts\t${JSON.stringify(list)}\nclaude\tconstructor\t${claudeFile(33, 44)}`, NOW);
  assert.equal(providerState(q, "claude").reading.windows[0].used, 33);
});
