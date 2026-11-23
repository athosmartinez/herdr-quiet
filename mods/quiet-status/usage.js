// Usage limits and accounts, read on one machine and parsed here. Nothing in
// this file touches Herdr, so plain `node` can test it (test/quiet-status.test.mjs).

// A Claude reading comes from its statusline, which runs only while a session
// draws. Older than this, the numbers show dim: they may have moved since.
export const STALE_MS = 30 * 60000;

// One shell call per machine, each line `kind<TAB>...`:
// - `accounts<TAB><json>`: `agent-account list --json`, when it is installed;
// - `claude<TAB><account><TAB><json>`: each file the Claude statusline saves,
//   one per account, named after it;
// - `codex<TAB><account id><TAB><json>`: the last rate-limit event of the
//   20 newest session files. Sessions are shared by every account, so the
//   first line of a session file says whose it is; the JS keeps the newest
//   event per account (a file's time is not its last event's time). Only the
//   file tails are read, because a long session file grows to many megabytes.
export const READ = `
if command -v agent-account >/dev/null 2>&1; then
  a=$(agent-account list --json 2>/dev/null | tr -d '\\n')
  if [ -n "$a" ]; then printf 'accounts\\t%s\\n' "$a"; fi
fi
for c in "\${XDG_CACHE_HOME:-$HOME/.cache}"/claude-usage/*.json; do
  [ -r "$c" ] || continue
  printf 'claude\\t%s\\t' "$(basename "$c" .json)"; tr -d '\\n' < "$c"; echo
done
for f in $(ls -t "\${CODEX_HOME:-$HOME/.codex}"/sessions/*/*/*/rollout-*.jsonl 2>/dev/null | head -n 20); do
  id=$(head -n 1 "$f" | grep -o '"creator_account_id":"[^"]*"' | head -n 1 | cut -d '"' -f 4)
  l=$(tail -c 400000 "$f" | grep '"rate_limits":{' | grep '"used_percent"' | tail -n 1)
  [ -n "$l" ] || continue
  printf 'codex\\t%s\\t%s\\n' "$id" "$l"
done
`;

// { min, used, resets } with `resets` in ms. A window whose reset time has
// passed is kept with `used: null`: its percent belonged to the old window.
function limit(min, used, resetsAt, now) {
  if (!Number.isFinite(used)) return null;
  const resets = Number.isFinite(resetsAt) ? resetsAt * 1000 : null;
  return { min, used: resets && resets <= now ? null : used, resets };
}

export function parseClaude(text, now) {
  const j = JSON.parse(text);
  const r = j?.rate_limits;
  if (!r) return null;
  const windows = [
    r.five_hour && limit(300, Number(r.five_hour.used_percentage), Number(r.five_hour.resets_at), now),
    r.seven_day && limit(10080, Number(r.seven_day.used_percentage), Number(r.seven_day.resets_at), now),
  ].filter(Boolean);
  const at = Number(j.captured_at) * 1000;
  return windows.length ? { windows, at: Number.isFinite(at) ? at : null } : null;
}

export function parseCodex(text, now) {
  const j = JSON.parse(text);
  const r = j?.payload?.rate_limits;
  if (!r) return null;
  const windows = [r.primary, r.secondary]
    .filter((w) => w && Number.isFinite(Number(w.window_minutes)))
    .map((w) => limit(Number(w.window_minutes), Number(w.used_percent), Number(w.resets_at), now))
    .filter(Boolean)
    .sort((a, b) => a.min - b.min);
  const at = Date.parse(j.timestamp);
  const total = j.payload.info?.total_token_usage?.total_tokens;
  return windows.length ? { windows, at: Number.isFinite(at) ? at : null, plan: r.plan_type ?? null, sessionTokens: Number(total) } : null;
}

// { accounts, claude: { [account]: reading }, codex: [{ id, reading }] }, the
// Codex readings newest first. A line that doesn't parse is skipped.
export function parseRead(stdout, now) {
  const out = { accounts: null, claude: {}, codex: [] };
  // Only the first tabs split fields: the JSON after them may hold tabs too.
  for (const line of (stdout ?? "").split("\n")) {
    const a = line.indexOf("\t");
    if (a < 0) continue;
    const kind = line.slice(0, a);
    const b = line.indexOf("\t", a + 1);
    try {
      if (kind === "accounts") out.accounts = JSON.parse(line.slice(a + 1));
      if (b < 0) continue;
      const key = line.slice(a + 1, b);
      if (kind === "claude") {
        const reading = parseClaude(line.slice(b + 1), now);
        if (reading) out.claude[key] = reading;
      }
      if (kind === "codex") {
        const reading = parseCodex(line.slice(b + 1), now);
        if (reading) out.codex.push({ id: key || null, reading });
      }
    } catch {}
  }
  return out;
}

function claudeReading(parsed, name) {
  return parsed?.claude?.[name] ?? null;
}

function newest(readings) {
  return readings.filter(Boolean).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? null;
}

// What the bar shows for one provider ("claude" | "codex" | "cursor"), or
// null for nothing: { reading, label, accounts }.
// - `reading`: the active account's last reading, or null (always for
//   Cursor, which saves no usage limits);
// - `label`: the active account's label, only when there are several;
// - `accounts`: every account, only when there are several, each
//   { id, label, tag, email, loggedIn, active, reading }. `id` is what
//   `agent-account use` takes; `label` is for people and falls back to it.
// Without `agent-account` there is one unlabeled reading, the newest one.
export function providerState(parsed, key) {
  const list = parsed?.accounts?.[key];
  // Without `agent-account` there is no owner to check: the newest reading.
  const fallback = key === "claude"
    ? claudeReading(parsed, "default") ?? newest(Object.values(parsed?.claude ?? {}))
    : key === "codex" ? newest((parsed?.codex ?? []).map((c) => c.reading)) : null;
  if (!Array.isArray(list?.accounts) || list.accounts.length === 0) {
    return fallback ? { reading: fallback, label: null, accounts: [] } : null;
  }
  const idOf = (a) => a.id ?? a.name;
  const ids = list.accounts.map(idOf);
  const activeId = ids.includes(list.active) ? list.active : "default";
  const readingOf = (id, a) => key === "claude" ? claudeReading(parsed, id)
    : key === "codex" ? (a.account_id ? newest((parsed.codex ?? []).filter((c) => c.id === a.account_id).map((c) => c.reading)) : null)
    : null;
  const accounts = list.accounts.map((a) => {
    const id = idOf(a);
    return {
      id,
      label: a.label || id,
      tag: a.tag || null,
      email: a.email ?? null,
      loggedIn: a.logged_in !== false,
      active: id === activeId,
      reading: readingOf(id, a),
    };
  });
  if (accounts.length === 1) {
    // One account: its own reading. A reading of another owner (an old
    // login, a removed account) is never shown as its. Only a Codex account
    // whose id is unknown takes the newest one.
    const own = accounts[0].reading;
    const reading = own ?? (key === "codex" && !list.accounts[0].account_id ? fallback : null);
    return reading ? { reading, label: null, accounts: [] } : null;
  }
  const active = accounts.find((a) => a.active) ?? accounts[0];
  return { reading: active.reading, label: active.label, accounts };
}

// How far the spending runs ahead of the clock, in points of percent: 0 is on
// pace, 20 means 20% more spent than the share of the window that has passed.
export function pace(w, now) {
  if (w.used == null || !w.resets) return null;
  const len = w.min * 60000;
  const passed = Math.min(len, Math.max(0, len - (w.resets - now)));
  return w.used - (passed / len) * 100;
}

// "quiet" | "warn" | "high". Very high use is never quiet, whatever the pace.
export function level(w, now) {
  if (w.used == null) return "quiet";
  const p = pace(w, now) ?? 0;
  if (w.used >= 90 || p >= 35) return "high";
  if (w.used >= 75 || p >= 15) return "warn";
  return "quiet";
}

// Time until 100% at the average speed so far in this window.
export function runway(w, now) {
  if (w.used == null || !w.resets || w.used <= 0) return null;
  const len = w.min * 60000;
  const passed = len - (w.resets - now);
  if (passed <= 0) return null;
  return ((100 - w.used) * passed) / w.used;
}
