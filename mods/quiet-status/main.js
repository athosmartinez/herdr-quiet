// The status bar of the Quiet layout: Herdr's `workspace-status`, plus how
// much of each logged-in agent's usage limit is spent, for the machine the
// bar names. Color appears only when a limit is spent faster than its window
// passes, as in a burn-down chart. With terminal-tools' `agent-account`, the
// hover card lists every account of an agent and picks the one that new
// sessions use.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec, knownAgents, notify, openOverlay } from "herdr";
import { READ, STALE_MS, parseRead, providerState, pace, level, runway, windowName } from "./usage.js";

const READ_MS = 60000;

// `limits: false`: a reading is not sure to come (Cursor's comes only from an
// agent-account with `usage`, and an account it cannot read has none), so a
// missing one is silent: the account with no gauge, no "–".
const PROVIDERS = [
  { key: "claude", name: "Claude", limits: true },
  { key: "codex", name: "Codex", limits: true },
  { key: "cursor", name: "Cursor", limits: false },
];

// What a not-logged-in account needs: a login for Claude and Codex; for
// Cursor, `add` prints the command that saves the account's API key.
// The `default` account is the CLI's own login.
const loginCommand = (provider, id) =>
  provider.key === "cursor"
    ? (id === "default" ? "cursor-agent login" : `agent-account add cursor ${id}`)
    : id === "default" ? `${provider.key} login` : `agent-account login ${provider.key} ${id}`;

function windowWord(w) {
  if (w.billing) return "Billing period";
  if (w.min === 300) return "5-hour";
  if (w.min === 10080) return "Weekly";
  return `${windowName(w.min)} window`;
}

const usd = (n) => `$${n.toFixed(2)}`;

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

const firstLine = (s) => (s ?? "").trim().split("\n", 1)[0];

export default class QuietStatus extends View {
  init(_props, cx) {
    this.usage = {}; // machine name ("" for this computer) -> parseRead(...) + { read }
    this.icons = {}; // machine name -> { [program key]: Program }
    this.reading = new Set();
    this.again = new Set(); // machines to read once more when their read ends
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

  // `force`: when a read of that machine runs now, read once more after it,
  // because what it reads may already be old (an account was just switched).
  read(machine, cx, force = false) {
    if (this.reading.has(machine)) {
      if (force) this.again.add(machine);
      return;
    }
    this.reading.add(machine);
    const on = machine || null;
    cx.spawn(async (cx) => {
      do {
        this.again.delete(machine);
        try {
          if (!this.icons[machine]) {
            const list = await knownAgents({ on }).catch(() => []);
            this.icons[machine] = Object.fromEntries(list.filter((p) => p.icon).map((p) => [p.key, p]));
          }
          const r = await exec("sh", ["-c", READ], { on, timeout: 10000 });
          // A read that started before a switch is already old: the next one wins,
          // so the switched account's mark is not undone in between.
          if (r.code === 0 && !this.again.has(machine)) this.usage[machine] = { ...parseRead(r.stdout, Date.now()), read: Date.now() };
        } catch {}
      } while (this.again.has(machine));
      this.reading.delete(machine);
      cx.notify();
    });
  }

  // Makes account `a` the one that new sessions of `provider` use on the
  // bar's machine. Running sessions keep theirs.
  use(provider, a, cx) {
    const machine = this.machine;
    cx.spawn(async (cx) => {
      let r;
      try {
        r = await exec("agent-account", ["use", provider.key, a.id], { on: machine || null, timeout: 10000 });
      } catch (e) {
        r = { code: -1, stdout: "", stderr: String(e?.message ?? e) };
      }
      if (r.code === 0) {
        const list = this.usage[machine]?.accounts?.[provider.key];
        if (list) list.active = a.id;
        notify({ title: `${provider.name}: new sessions use ${a.label}`, body: "Running sessions keep their account.", level: "success", timeout: 5000 });
      } else {
        notify({ title: `${provider.name}: could not switch to ${a.label}`, body: firstLine(r.stderr) || firstLine(r.stdout) || `agent-account exited with ${r.code}`, level: "error" });
      }
      cx.notify();
      this.read(machine, cx, true);
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

  // Each window of a reading as "5h 12%", colored as in a burn-down chart.
  values(t, u, now) {
    const stale = u.at != null && now - u.at > STALE_MS;
    return u.windows.map((w) => {
      const lv = stale ? "quiet" : level(w, now);
      const color = stale || w.used == null ? t.dim : lv === "quiet" ? t.muted : t.blocked;
      return h_flex().gap(4).items_center()
        .child(div().text_color(t.dim).child(windowName(w.min, w.billing)))
        .child(div().text_color(color).when(lv === "high", (el) => el.font_semibold())
          .child(w.used == null ? "–" : `${Math.round(w.used)}%`));
    });
  }

  // One provider in the bar: its icon, the active account's label when there
  // are several, then "5h 12%  7d 78%".
  gauge(t, provider, s, now) {
    const u = s.reading;
    const stale = u ? u.at != null && now - u.at > STALE_MS : provider.limits;
    const trigger = h_flex().id(`usage-${provider.key}`).gap(8).items_center().cursor_default()
      .child(this.icon(provider, 13, stale ? t.dim : t.muted))
      .when(Boolean(s.label), (el) => el.child(div().text_color(t.muted).child(s.label)))
      .when(Boolean(u), (el) => el.children(this.values(t, u, now)))
      .when(!u && provider.limits, (el) => el.child(div().text_color(t.dim).child("–")));
    return HoverCard.new(`usage-card-${provider.key}`).open_delay(600).close_delay(300).anchor("bottom_left")
      .trigger(trigger).content(this.card(t, provider, s, now));
  }

  // One account in the card: a check on the active one, its label, tag and
  // email, its last readings and how old they are. A click on another
  // logged-in account makes it the one that new sessions use.
  account(t, provider, a, now) {
    const pick = !a.active && a.loggedIn;
    const u = a.reading;
    const note = !a.loggedIn ? `not logged in · ${loginCommand(provider, a.id)}`
      : !u ? (provider.limits ? "no reading yet" : "")
      : u.at ? `updated ${ago(now - u.at)}` : "";
    // The email only when the label doesn't already say it.
    const email = a.email && a.email !== a.label ? a.email : "";
    return v_flex().id(`account-${provider.key}-${a.id}`).px(6).py(4).gap(2).rounded(5).min_w(0)
      .when(pick, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.use(provider, a, cx); }))
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(div().w(14).flex_none().when(a.active, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(12).text_color(t.foreground))))
        .child(div().flex_none().max_w(140).truncate().font_medium().text_color(a.loggedIn ? t.foreground : t.muted).child(a.label))
        .when(Boolean(a.tag), (el) => el.child(div().flex_none().h(16).px(5).rounded(4).bg(t.selected).text_size(10.5)
          .text_color(t.muted).flex().items_center().max_w(80).truncate().child(a.tag)))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(email))
        .when(Boolean(u), (el) => el.child(h_flex().flex_none().gap(8).items_center().text_size(11.5).children(this.values(t, u, now)))))
      .when(Boolean(note), (el) => el.child(div().id(`account-note-${provider.key}-${a.id}`).pl(20).min_w(0).truncate()
        .text_size(11).text_color(t.dim).tooltip(note).child(note)));
  }

  // The last row of the Accounts section: opens the quiet-accounts panel for
  // the bar's machine (rename, tag, create and log in to accounts).
  manage(t) {
    const machine = this.machine;
    return h_flex().id("manage-accounts").px(6).py(4).gap(6).items_center().rounded(5).cursor_pointer()
      .text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "quiet-accounts", kind: "window", key: "quiet-accounts", width: 600, height: 640, props: { machine } });
      })
      .child(div().w(14).flex_none().child(svg("mods/workspace-chrome/settings.svg").size(12)))
      .child("Manage accounts…");
  }

  card(t, provider, s, now) {
    const u = s.reading;
    const fact = (label, value, color) => h_flex().gap(8).items_center().min_w(0)
      .child(div().w(80).flex_none().text_size(11.5).text_color(t.muted).child(label))
      .child(div().flex_1().min_w(0).truncate().text_color(color ?? t.foreground).child(value));
    const section = (label) => v_flex().pt(4).gap(2).child(div().text_size(11.5).font_medium().text_color(t.muted).child(label));
    const rows = [];
    if (!u && provider.limits) rows.push(div().text_size(11).text_color(t.dim).child("No reading yet for this account."));
    if (!u && !provider.limits) rows.push(div().text_size(11).text_color(t.dim).child("No usage reading for this account."));
    for (const w of u?.windows ?? []) {
      rows.push(section(windowWord(w)));
      if (w.used == null) {
        rows.push(fact("Used", "reset since the last reading", t.dim));
        continue;
      }
      const lv = level(w, now);
      rows.push(fact("Used", `${Math.round(w.used)}%`, lv === "quiet" ? null : t.blocked));
      if (u.spentUsd != null) rows.push(fact("Spent", u.limitUsd != null ? `${usd(u.spentUsd)} of ${usd(u.limitUsd)}` : usd(u.spentUsd)));
      if (w.resets) rows.push(fact("Resets in", span(w.resets - now)));
      const p = pace(w, now);
      if (p != null) rows.push(fact("Pace", Math.abs(p) < 1 ? "on pace" : p > 0 ? `${Math.round(p)}% ahead of the clock` : `${Math.round(-p)}% behind the clock`, p >= 15 ? t.blocked : null));
      const r = runway(w, now);
      if (r != null && w.resets) rows.push(fact("Lasts", r >= w.resets - now ? "past the reset" : `about ${span(r)} more`, r < w.resets - now ? t.blocked : null));
    }
    if (u?.plan) rows.push(fact("Plan", u.plan));
    const st = tokens(u?.sessionTokens);
    if (st) rows.push(fact("Last session", `${st} tokens`));
    if (u?.at) rows.push(fact("Updated", ago(now - u.at), now - u.at > STALE_MS ? t.dim : t.muted));
    if (s.accounts.length) {
      rows.push(section("Accounts"));
      rows.push(v_flex().children(s.accounts.map((a) => this.account(t, provider, a, now))));
      rows.push(div().text_size(11).text_color(t.dim).child("Click an account to use it in new sessions."));
      rows.push(this.manage(t));
    } else if (s.managed) {
      // One account: no list to switch, but the panel can add another.
      rows.push(section("Accounts"));
      rows.push(this.manage(t));
    }
    const what = provider.limits || u ? `${provider.name} usage limits` : `${provider.name} accounts`;
    const title = s.label ? `${what} · ${s.label}` : what;
    return v_flex().w(s.accounts.length ? 340 : 280).p(10).gap(6).bg(t.popover).border_1().border_color(t.border).rounded(8).shadow_sm()
      .text_size(12).text_color(t.foreground)
      .child(h_flex().gap(6).pb(2).items_center().min_w(0)
        .child(this.icon(provider, 14, t.muted))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(title)))
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
    const gauges = PROVIDERS.map((p) => [p, providerState(usage, p.key)]).filter(([, s]) => s).map(([p, s]) => this.gauge(t, p, s, now));
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.5).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .when(gauges.length > 0, (el) => el.child(h_flex().gap(14).items_center().pl(14).border_l(1).border_color(t.border).children(gauges)))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint()));
  }
}
