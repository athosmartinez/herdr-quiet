// The status bar of the Quiet layout: Herdr's `workspace-status`, plus how
// much of each logged-in agent's usage limit is spent, for the machine the
// bar names. Color appears only when a limit is spent faster than its window
// passes, as in a burn-down chart.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec, knownAgents } from "herdr";

const READ_MS = 60000;
// A Claude reading comes from its statusline, which runs only while a session
// draws. Older than this, the numbers show dim: they may have moved since.
const STALE_MS = 30 * 60000;

// One shell call per machine: the Claude statusline's cache, then the last
// rate-limit event in the newest Codex sessions. Only the file tails are read,
// because a long session file grows to many megabytes.
const READ = `
c="\${XDG_CACHE_HOME:-$HOME/.cache}/claude-usage/rate-limits.json"
if [ -r "$c" ]; then printf 'claude\\t'; tr -d '\\n' < "$c"; echo; fi
for f in $(ls -t "\${CODEX_HOME:-$HOME/.codex}"/sessions/*/*/*/rollout-*.jsonl 2>/dev/null | head -n 5); do
  l=$(tail -c 400000 "$f" | grep '"rate_limits":{' | tail -n 1)
  if [ -n "$l" ]; then printf 'codex\\t%s\\n' "$l"; break; fi
done
`;

const PROVIDERS = [
  { key: "claude", name: "Claude" },
  { key: "codex", name: "Codex" },
];

// "5h", "7d": a window named by its length, not by its slot, because a plan
// can have only the weekly one.
function windowName(min) {
  if (!min) return "?";
  return min < 1440 ? `${Math.round(min / 60)}h` : `${Math.round(min / 1440)}d`;
}

function windowWord(min) {
  if (min === 300) return "5-hour";
  if (min === 10080) return "Weekly";
  return `${windowName(min)} window`;
}

function span(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  return `${span(ms)} ago`;
}

function tokens(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

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

export function parseRead(stdout, now) {
  const out = {};
  for (const line of (stdout ?? "").split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const key = line.slice(0, tab);
    try {
      if (key === "claude") out.claude = parseClaude(line.slice(tab + 1), now);
      if (key === "codex") out.codex = parseCodex(line.slice(tab + 1), now);
    } catch {}
  }
  return out;
}

// How far the spending runs ahead of the clock, in points of percent: 0 is on
// pace, 20 means 20% more spent than the share of the window that has passed.
function pace(w, now) {
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
function runway(w, now) {
  if (w.used == null || !w.resets || w.used <= 0) return null;
  const len = w.min * 60000;
  const passed = len - (w.resets - now);
  if (passed <= 0) return null;
  return ((100 - w.used) * passed) / w.used;
}

export default class QuietStatus extends View {
  init(_props, cx) {
    this.usage = {}; // machine name ("" for this computer) -> { claude, codex, read }
    this.icons = {}; // machine name -> { [program key]: Program }
    this.reading = new Set();
    this.machine = this.activeMachine();
    this.read(this.machine, cx);
    cx.timer.every(READ_MS, (cx) => this.read(this.activeMachine(), cx));
    // The bar follows the active space: read a newly named machine at once.
    cx.timer.every(2000, (cx) => {
      const m = this.activeMachine();
      if (m === this.machine) return;
      this.machine = m;
      if (!this.usage[m] || Date.now() - this.usage[m].read > READ_MS) this.read(m, cx);
      cx.notify();
    });
  }

  activeMachine() {
    return spaces().find((s) => s.active)?.machine ?? "";
  }

  read(machine, cx) {
    if (this.reading.has(machine)) return;
    this.reading.add(machine);
    const on = machine || null;
    cx.spawn(async (cx) => {
      try {
        if (!this.icons[machine]) {
          const list = await knownAgents({ on }).catch(() => []);
          this.icons[machine] = Object.fromEntries(list.filter((p) => p.icon).map((p) => [p.key, p]));
        }
        const r = await exec("sh", ["-c", READ], { on, timeout: 10000 });
        if (r.code === 0) this.usage[machine] = { ...parseRead(r.stdout, Date.now()), read: Date.now() };
      } catch {}
      this.reading.delete(machine);
      cx.notify();
    });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  icon(provider, size, color) {
    const p = this.icons[this.machine]?.[provider.key];
    if (!p?.icon) return div().flex_none().text_color(color).child(provider.name);
    return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
  }

  // One provider in the bar: its icon, then "5h 12%  7d 78%".
  gauge(t, provider, u, now) {
    const stale = u.at != null && now - u.at > STALE_MS;
    const values = u.windows.map((w) => {
      const lv = stale ? "quiet" : level(w, now);
      const color = stale || w.used == null ? t.dim : lv === "quiet" ? t.muted : t.blocked;
      return h_flex().gap(4).items_center()
        .child(div().text_color(t.dim).child(windowName(w.min)))
        .child(div().text_color(color).when(lv === "high", (el) => el.font_semibold())
          .child(w.used == null ? "–" : `${Math.round(w.used)}%`));
    });
    const trigger = h_flex().id(`usage-${provider.key}`).gap(8).items_center().cursor_default()
      .child(this.icon(provider, 13, stale ? t.dim : t.muted))
      .children(values);
    return HoverCard.new(`usage-card-${provider.key}`).open_delay(600).close_delay(300).anchor("bottom_left")
      .trigger(trigger).content(this.card(t, provider, u, now));
  }

  card(t, provider, u, now) {
    const fact = (label, value, color) => h_flex().gap(8).items_center().min_w(0)
      .child(div().w(80).flex_none().text_size(11.5).text_color(t.muted).child(label))
      .child(div().flex_1().min_w(0).truncate().text_color(color ?? t.foreground).child(value));
    const rows = [];
    for (const w of u.windows) {
      rows.push(v_flex().pt(4).gap(2).child(div().text_size(11.5).font_medium().text_color(t.muted).child(windowWord(w.min))));
      if (w.used == null) {
        rows.push(fact("Used", "reset since the last reading", t.dim));
        continue;
      }
      const lv = level(w, now);
      rows.push(fact("Used", `${Math.round(w.used)}%`, lv === "quiet" ? null : t.blocked));
      if (w.resets) rows.push(fact("Resets in", span(w.resets - now)));
      const p = pace(w, now);
      if (p != null) rows.push(fact("Pace", Math.abs(p) < 1 ? "on pace" : p > 0 ? `${Math.round(p)}% ahead of the clock` : `${Math.round(-p)}% behind the clock`, p >= 15 ? t.blocked : null));
      const r = runway(w, now);
      if (r != null && w.resets) rows.push(fact("Lasts", r >= w.resets - now ? "past the reset" : `about ${span(r)} more`, r < w.resets - now ? t.blocked : null));
    }
    if (u.plan) rows.push(fact("Plan", u.plan));
    const st = tokens(u.sessionTokens);
    if (st) rows.push(fact("Last session", `${st} tokens`));
    if (u.at) rows.push(fact("Updated", ago(now - u.at), now - u.at > STALE_MS ? t.dim : t.muted));
    return v_flex().w(280).p(10).gap(6).bg(t.popover).border_1().border_color(t.border).rounded(8).shadow_sm()
      .text_size(12).text_color(t.foreground)
      .child(h_flex().gap(6).pb(2).items_center()
        .child(this.icon(provider, 14, t.muted))
        .child(div().font_semibold().child(`${provider.name} usage limits`)))
      .children(rows);
  }

  render() {
    const t = theme();
    const now = Date.now();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const usage = this.usage[this.machine] ?? {};
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const gauges = PROVIDERS.filter((p) => usage[p.key]).map((p) => this.gauge(t, p, usage[p.key], now));
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .when(gauges.length > 0, (el) => el.child(h_flex().gap(14).items_center().pl(14).border_l(1).border_color(t.border).children(gauges)))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint()));
  }
}
