// Hover cards for the Quiet spaces list. Each card shows what the row has no
// room for, and a few actions. The agent helpers (clean, duration, kidStatus)
// follow Herdr's shipped `agents` mod, so a card says what that list says.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, HoverCard } from "gpui-base";
import { run, exec, window } from "herdr";

// Herdr's own hover timing: rest 600ms to open, 300ms to cross into the card.
const OPEN_MS = 600;
const CLOSE_MS = 300;
const WIDTH = 320;

// Drops what an agent puts before its title: a status glyph or spinner and the
// separator after it, and Codex's blinking "[ ! ] " / "[ . ] " mark.
export const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent.
export const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

const STATUS_WORD = { working: "Working", blocked: "Needs you", done: "Done", idle: "Idle" };

// Wraps `trigger` so that resting on it opens `content` below it.
export function hover(id, trigger, content) {
  return HoverCard.new(id).open_delay(OPEN_MS).close_delay(CLOSE_MS).anchor("bottom_left").trigger(trigger).content(content);
}

function card(t) {
  return v_flex().w(WIDTH).p(10).gap(7).bg(t.popover).border_1().border_color(t.border).rounded(8).shadow_lg()
    .text_size(12).text_color(t.foreground);
}

function heading(t, iconPath, text, color) {
  return h_flex().gap(6).items_center().min_w(0)
    .when(Boolean(iconPath), (el) => el.child(svg(iconPath).size(14).flex_none().text_color(color ?? t.muted)))
    .child(div().flex_1().min_w(0).truncate().font_semibold().child(text));
}

// A label and its value on one line: "Base   dev".
function fact(t, label, value, color) {
  return h_flex().gap(8).items_center().min_w(0)
    .child(div().w(72).flex_none().text_color(t.dim).child(label))
    .child(div().flex_1().min_w(0).truncate().text_color(color ?? t.muted).child(value));
}

function actions(...buttons) {
  return h_flex().gap(6).pt(2).items_center().children(buttons.filter(Boolean));
}

// A card button. Clicks stop here so the row under the card doesn't also react.
function button(t, id, label, onClick) {
  return div().id(id).px(8).py(3).rounded(5).bg(t.raised).border_1().border_color(t.border)
    .text_size(11.5).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(label);
}

function openUrl(url) {
  const opener = window()?.platform === "macos" ? "open" : window()?.platform === "windows" ? "explorer" : "xdg-open";
  exec(opener, [url]).catch(() => {});
}

const ago = (iso) => {
  const at = typeof iso === "number" ? iso : Date.parse(iso ?? "");
  return Number.isFinite(at) ? `${duration(Date.now() - at)} ago` : "";
};

// Checks of a PR, counted: { pass, fail, pending }.
export function checkCounts(rollup) {
  const c = { pass: 0, fail: 0, pending: 0 };
  for (const r of rollup ?? []) {
    const word = (r.conclusion || r.state || r.status || "").toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(word)) c.pass++;
    else if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(word)) c.fail++;
    else c.pending++;
  }
  return c;
}

export function prCard(t, id, pr, look, iconPath) {
  const checks = checkCounts(pr.checks);
  const total = checks.pass + checks.fail + checks.pending;
  const reviewers = (pr.reviews ?? []).map((r) => `${r.author?.login ?? "?"} ${r.state === "APPROVED" ? "✓" : r.state === "CHANGES_REQUESTED" ? "±" : "·"}`);
  const asked = (pr.requested ?? []).map((r) => r.login ?? r.name ?? r.slug).filter(Boolean);
  const merge = pr.mergeable === "CONFLICTING" ? ["conflicts", t.blocked] : pr.mergeable === "MERGEABLE" ? ["no conflicts", t.done] : ["unknown", t.dim];
  return card(t)
    .child(heading(t, iconPath, `#${pr.number} ${pr.title ?? ""}`, look.color))
    .child(fact(t, "State", look.word, look.color))
    .child(fact(t, "Branches", `${pr.head ?? "?"} → ${pr.base}`))
    .when(Boolean(pr.author), (el) => el.child(fact(t, "Author", `${pr.author}${pr.updatedAt ? ` · updated ${ago(pr.updatedAt)}` : ""}`)))
    .when(total > 0, (el) => el.child(h_flex().gap(8).items_center()
      .child(div().w(72).flex_none().text_color(t.dim).child("Checks"))
      .child(div().text_color(t.done).child(`✓ ${checks.pass}`))
      .when(checks.fail > 0, (r) => r.child(div().text_color(t.blocked).child(`✗ ${checks.fail}`)))
      .when(checks.pending > 0, (r) => r.child(div().text_color(t.working).child(`◌ ${checks.pending}`)))))
    .when(reviewers.length > 0, (el) => el.child(fact(t, "Reviews", reviewers.join(", "))))
    .when(asked.length > 0, (el) => el.child(fact(t, "Asked", asked.join(", "))))
    .when(pr.state === "OPEN", (el) => el.child(fact(t, "Merge", merge[0], merge[1])))
    .when(Boolean(pr.url), (el) => el.child(actions(
      button(t, `${id}-open`, "Open on GitHub", () => openUrl(pr.url)),
      button(t, `${id}-copy`, "Copy URL", (cx) => cx.write_to_clipboard(pr.url)),
    )));
}

export function branchCard(t, id, g, iconPath) {
  const c = g.commit;
  return card(t)
    .child(heading(t, iconPath, g.branch ?? "detached"))
    .when(Boolean(c), (el) => el.child(fact(t, "Last commit", c.subject, t.foreground))
      .child(fact(t, "", `${c.author} · ${ago(c.at * 1000)}`)))
    .child(fact(t, "Upstream", g.upstream ? `${g.upstream}${g.ahead || g.behind ? ` · ↑${g.ahead} ↓${g.behind}` : " · in sync"}` : "none"))
    .child(fact(t, "Uncommitted", g.dirty == null ? "unknown" : g.dirty === 0 ? "clean" : `${g.dirty} file${g.dirty === 1 ? "" : "s"}`, g.dirty ? t.blocked : t.muted))
    .child(actions(button(t, `${id}-copy`, "Copy branch", (cx) => cx.write_to_clipboard(g.branch ?? ""))));
}

export function diffCard(t, id, g, iconPath, spaceId, active) {
  const d = g.diff;
  const against = g.pr && g.pr.state === "OPEN" ? `against origin/${g.pr.base}` : "not committed yet";
  return card(t)
    .child(heading(t, iconPath, `${d.count} file${d.count === 1 ? "" : "s"} changed`))
    .child(div().text_color(t.dim).child(against))
    .children((d.files ?? []).map((f) => h_flex().gap(8).items_center().min_w(0)
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(f.path))
      .child(div().flex_none().text_color(t.done).child(f.add == null ? "bin" : `+${f.add}`))
      .when(f.del != null, (r) => r.child(div().flex_none().text_color(t.ansi1).child(`−${f.del}`)))))
    .when(d.count > (d.files ?? []).length, (el) => el.child(div().text_color(t.dim).child(`and ${d.count - d.files.length} more`)))
    .child(actions(button(t, `${id}-changes`, "Open Changes", (cx) => {
      const open = () => { run("layout.select", { stack: "panel-body", child: "changes" }); run("layout.show", { id: "panel" }); };
      if (active) { open(); return; }
      // Switching spaces makes the shipped `tabs` mod restore that space's own
      // panel choice (often closed). Open Changes after that restore, so it sticks.
      run("space.select", { id: spaceId });
      cx.timer.after(300, () => open());
    })));
}

// A list that scrolls inside the card past `max` px, so the last lines stay reachable.
function scrollList(id, rows, max = 280) {
  return v_flex().id(`${id}-list`).gap(2).max_h(max).overflow_y_scrollbar().children(rows);
}

// One agent line: program icon, name, status word, how long, and the agent's own report.
function agentLine(t, id, a, statusGlyph, onClick) {
  const pic = a.program?.icon ? (a.program.tint ? svg(a.program.icon).size(13).flex_none().text_color(t.foreground) : image(a.program.icon).w(13).h(13).flex_none()) : null;
  return v_flex().id(id).gap(1).px(6).py(4).rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(); })
    .child(h_flex().gap(6).items_center().min_w(0)
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_1().min_w(0).truncate().child(a.name))
      .child(div().flex_none().text_size(11).text_color(t[a.status] ?? t.dim).child(`${STATUS_WORD[a.status] ?? a.status ?? ""}${a.since ? ` · ${duration(Date.now() - a.since)}` : ""}`))
      .child(statusGlyph(t, a.status)))
    .when(Boolean(a.report), (el) => el.child(div().pl(pic ? 19 : 0).text_size(11).text_color(t.dim).truncate().child(a.report)));
}

// `kids`: [{ address, name, status, since, report, program }]. Click: show it.
export function subsCard(t, id, kids, statusGlyph, iconPath) {
  return card(t)
    .child(heading(t, iconPath, `${kids.length} sub-agent${kids.length === 1 ? "" : "s"} running`))
    .child(scrollList(id, kids.map((k, i) => agentLine(t, `${id}-k${i}`, k, statusGlyph, () => run("agent.focus", { terminal: k.address })))));
}

// The space's agents, most urgent first. Click: go to that agent.
export function statusCard(t, id, list, statusGlyph) {
  return card(t)
    .child(heading(t, null, list.length ? `${list.length} agent${list.length === 1 ? "" : "s"} here` : "No agents here"))
    .child(scrollList(id, list.map((a, i) => agentLine(t, `${id}-a${i}`, a, statusGlyph, () => run("agent.focus", { terminal: a.address })))));
}

export function spaceCard(t, id, s, info) {
  return card(t)
    .child(heading(t, null, s.name))
    .child(fact(t, "Folder", info.folder || "~"))
    .child(fact(t, "Machine", s.machine ?? "This computer"))
    .child(fact(t, "Tabs", String(s.tabs?.length ?? 0)))
    .child(fact(t, "Agents", String(info.agents)))
    .when(Boolean(info.changed), (el) => el.child(fact(t, "Last change", ago(info.changed))))
    .child(actions(button(t, `${id}-copy`, "Copy folder", (cx) => cx.write_to_clipboard(info.folder || ""))));
}

export function machineCard(t, id, name, info) {
  return card(t)
    .child(heading(t, null, name ?? "This computer"))
    .child(fact(t, "Connection", info.state, info.state === "connected" ? t.done : t.blocked))
    .child(fact(t, "Spaces", String(info.spaces)))
    .child(fact(t, "Agents", String(info.agents)));
}
