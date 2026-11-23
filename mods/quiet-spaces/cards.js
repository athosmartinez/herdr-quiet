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

function card(t, width = WIDTH) {
  return v_flex().w(width).p(10).gap(7).bg(t.popover).border_1().border_color(t.border).rounded(8).shadow_lg()
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
    .child(div().w(84).flex_none().text_color(t.dim).child(label))
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

// A reviewer's verdict as a mark and a color: ✓ pass, ✗n issues, ! blocked,
// ◌ still reviewing, ? ended without a verdict label.
export function verdictLook(t, r) {
  const v = r.verdict ?? "";
  if (/^(PASS|APPROVE|APPROVED)$/.test(v)) return { mark: "✓", color: t.done, word: "pass" };
  if (/^(ISSUES|REQUEST CHANGES|CHANGES_REQUESTED|CHANGES)$/.test(v)) return { mark: `✗${r.findings ?? ""}`, color: t.blocked, word: `${r.findings ?? "some"} issue${r.findings === 1 ? "" : "s"}` };
  if (v === "BLOCKED") return { mark: "!", color: t.blocked, word: "blocked" };
  if (!v && r.live) return { mark: "◌", color: t.working, word: "reviewing" };
  return { mark: "?", color: t.dim, word: v ? v.toLowerCase() : "no verdict" };
}

export function verdictChip(t, r) {
  const look = verdictLook(t, r);
  return h_flex().flex_none().gap(3).items_center()
    .child(div().text_color(t.dim).child(r.model?.model ?? r.name))
    .child(div().text_color(look.color).child(look.mark));
}

export function prCard(t, id, pr, look, iconPath, agentReviews = []) {
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
      .child(div().w(84).flex_none().text_color(t.dim).child("Checks"))
      .child(div().text_color(t.done).child(`✓ ${checks.pass}`))
      .when(checks.fail > 0, (r) => r.child(div().text_color(t.blocked).child(`✗ ${checks.fail}`)))
      .when(checks.pending > 0, (r) => r.child(div().text_color(t.working).child(`◌ ${checks.pending}`)))))
    .when(reviewers.length > 0, (el) => el.child(fact(t, "Reviews", reviewers.join(", "))))
    .when(asked.length > 0, (el) => el.child(fact(t, "Asked", asked.join(", "))))
    .when(pr.state === "OPEN", (el) => el.child(fact(t, "Merge", merge[0], merge[1])))
    // Agent reviewers (labels on their terminals); click one to show it.
    .when(agentReviews.length > 0, (el) => el.child(v_flex().gap(2)
      .child(div().text_color(t.dim).child("Agent reviews"))
      .children(agentReviews.map((r, i) => {
        const v = verdictLook(t, r);
        return h_flex().id(`${id}-rev${i}`).gap(6).px(6).py(3).rounded(5).items_center().min_w(0).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); run("agent.focus", { terminal: r.address }); })
          .child(div().flex_1().min_w(0).truncate().child(r.name))
          .when(Boolean(r.model), (row) => row.child(div().flex_none().px(4).rounded(4).bg(t.raised).font_family("JetBrains Mono").text_size(10.5)
            .text_color(t.muted).child(r.model.effort ? `${r.model.model}·${r.model.effort}` : r.model.model)))
          .child(div().flex_none().text_color(v.color).child(`${v.mark} ${v.word}`));
      }))))
    .when(Boolean(pr.url), (el) => el.child(actions(
      button(t, `${id}-open`, "Open on GitHub", () => openUrl(pr.url)),
      button(t, `${id}-copy`, "Copy URL", (cx) => cx.write_to_clipboard(pr.url)),
    )));
}

// The branch's tree, as `git log --graph` draws it: the graph in a mono font,
// then for each commit its short hash, its refs, its subject and its age.
// Lines with only graph (a merge's "|\") keep the branches joined.
// The last copied SHA and when, shared by every card, so the hash that was
// clicked shows "copied" for a moment.
let copied = { sha: null, at: 0 };
const COPIED_MS = 1500;

function tree(t, id, history) {
  // The short hash is a button: a click copies the full SHA (for git revert,
  // reset or checkout) and the hash reads "copied" for COPIED_MS.
  const hashButton = (h, i) => {
    const done = copied.sha === h.sha && Date.now() - copied.at < COPIED_MS;
    return div().id(`${id}-sha${i}`).flex_none().px(3).rounded(4).cursor_pointer()
      .font_family("JetBrains Mono").text_size(11.5).text_color(done ? t.done : t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(`Copy ${h.sha}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        cx.write_to_clipboard(h.sha ?? h.hash);
        copied = { sha: h.sha, at: Date.now() };
        cx.notify();
        cx.timer.after(COPIED_MS + 50, (cx) => cx.notify());
      })
      .child(done ? "copied" : h.hash);
  };
  const mono = (text, color) => div().flex_none().font_family("JetBrains Mono").text_size(11.5).text_color(color)
    .child(text.replace(/ /g, " "));
  // Every graph cell padded to the widest one, so hashes line up.
  const wide = Math.max(0, ...history.map((h) => h.graph.length));
  return v_flex().gap(0).min_w(0).children(history.map((h, i) => h_flex().h(h.hash ? 20 : 12).gap(6).items_center().min_w(0)
    .child(mono(h.graph.padEnd(wide).replace(/\*/g, "●"), t.accent))
    .when(Boolean(h.hash), (el) => el
      .child(hashButton(h, i))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(h.subject))
      // Refs after the subject, so subjects line up.
      .children(h.refs.slice(0, 2).map((r) => div().flex_none().px(4).rounded(4).bg(t.raised).text_size(10.5).text_color(t.muted).max_w(100).truncate().child(r)))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(h.at * 1000))))));
}

export function branchCard(t, id, g, iconPath) {
  const history = g.history ?? [];
  return card(t, 420)
    .child(heading(t, iconPath, g.branch ?? "detached"))
    .when(history.length > 0, (el) => el.child(tree(t, id, history)))
    .when(Boolean(g.commit?.author), (el) => el.child(fact(t, "Last author", g.commit.author)))
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
      // The model and effort it was started with: "opus·high"; "sol" alone when no effort was passed.
      .when(Boolean(a.model), (el) => el.child(div().flex_none().px(4).rounded(4).bg(t.raised).font_family("JetBrains Mono").text_size(10.5)
        .text_color(t.muted).child(a.model.effort ? `${a.model.model}·${a.model.effort}` : a.model.model)))
      .child(div().flex_none().text_size(11).text_color(t[a.status] ?? t.dim).child(STATUS_WORD[a.status] ?? a.status ?? ""))
      // How long it has been working; amber past stall_minutes.
      .when(Boolean(a.since), (el) => el.child(div().flex_none().text_size(11).text_color(a.long ? t.blocked : t.dim).child(duration(Date.now() - a.since))))
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

// Every agent waiting for the person, in brief: who, where, and one line of
// what it asks. The row under the card already takes the person to the next
// one on click, so the card is for reading; a click on a line goes to that
// agent. Nothing is approved from here: the answer is given in the agent's
// own terminal. `next`: the address the row's next click opens.
export function needsCard(t, id, list, statusGlyph, next) {
  return card(t, 400)
    .child(heading(t, null, `${list.length} agent${list.length === 1 ? "" : "s"} waiting for you`))
    .child(div().text_size(11).text_color(t.dim).child("Click the row to go to the next one."))
    .child(scrollList(id, list.map((a, i) => v_flex().id(`${id}-a${i}`).gap(2).px(6).py(4).rounded(6).cursor_pointer()
      .when(a.address === next, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); run("agent.focus", { terminal: a.address }); })
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(statusGlyph(t, "blocked"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(a.name))
        .when(a.address === next, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.blocked).child("next")))
        .when(Boolean(a.model), (el) => el.child(div().flex_none().px(4).rounded(4).bg(t.raised).font_family("JetBrains Mono").text_size(10.5)
          .text_color(t.muted).child(a.model.effort ? `${a.model.model}·${a.model.effort}` : a.model.model)))
        .when(Boolean(a.space), (el) => el.child(div().flex_none().max_w(120).truncate().text_size(11).text_color(t.dim).child(a.space))))
      .child(div().pl(22).text_size(11).text_color(t.muted).truncate().child(a.ask ?? "Reading its screen…")))));
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
