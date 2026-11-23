// Quiet spaces: a fork of Herdr's shipped `spaces` mod. Two lines per space:
// line 1 is the agent status glyph and the name; line 2 is the branch, its pull
// request (number, state, review, base) and the diff against that base.
// Worktrees sit under their checkout, grouped by machine when more than one is
// known. Click to switch, right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, machines, panes, agents, terminals, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, readTextFile, appHome } from "herdr";
import { hover, prCard, branchCard, diffCard, subsCard, statusCard, spaceCard, machineCard, needsCard, verdictChip, trackerCard, clean, kidStatus } from "./cards.js";

// Live sub-agents per space: each live terminal with a parent is walked up to
// its first ancestor that is an agent in a space (the same `parent` links the
// agents list draws as a tree). `all`: terminals(); `top`: agents().
// Returns { space id: [terminal, ...] }.
export function subAgents(all, top) {
  const parent = new Map(all.map((k) => [k.address, k.parent ?? null]));
  const spaceOf = new Map(top.map((a) => [a.address, a.space]));
  const kids = {};
  for (const k of all) {
    if (!k.parent || k.state !== "live") continue;
    let at = k.parent;
    for (let hops = 0; at && !spaceOf.has(at) && hops < 32; hops++) at = parent.get(at) ?? null;
    const space = at ? spaceOf.get(at) : null;
    if (space) (kids[space] ??= []).push(k);
  }
  return kids;
}

// The last `max` meaningful lines of a screen: no blank lines, no lines made
// only of box-drawing borders, each cut at 160 characters.
export function screenTail(text, max = 12) {
  const lines = String(text ?? "").split("\n").map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() && !/^[\s─━│┃┌┐└┘├┤┬┴┼╭╮╯╰═║╔╗╚╝╟╢╌╍┄┅┈┉·.\-_=|+]+$/.test(l));
  return lines.slice(-max).map((l) => (l.length > 160 ? `${l.slice(0, 159)}…` : l));
}

// A tracker task looked up by `command` is cached this long.
const TRACKER_TTL = 300000;

// The task key in a branch name, upper case, for a pattern from config
// ("abc-\\d+" finds "ABC-123" in "feat/abc-123-login"). Only keys shaped like
// ABC-123 pass, so a key is always safe as one argv element.
export function trackerKey(branch, pattern) {
  if (typeof branch !== "string" || typeof pattern !== "string" || !pattern) return null;
  let m = null;
  try { m = branch.match(new RegExp(pattern, "i")); } catch { return null; }
  const key = m?.[0]?.toUpperCase() ?? null;
  return key && /^[A-Z][A-Z0-9]+-\d+$/.test(key) ? key : null;
}

// A plain object from config, or {}.
const objectOf = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// The model and effort a coding agent was started with, from its argv only
// (never the rest of argv: it holds task prompts and paths). Claude Code:
// `--model X --effort Y`; Codex: `-m X`, `-c model_reasoning_effort=Y`.
// "claude-opus-5-5" -> "opus", "gpt-6.1-sol" -> "sol". Null when not found.
export function modelOf(argv) {
  if (!Array.isArray(argv)) return null;
  let model = null, effort = null;
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]), next = argv[i + 1] == null ? null : String(argv[i + 1]);
    if ((a === "--model" || a === "-m") && next) model = next;
    else if (a.startsWith("--model=")) model = a.slice(8);
    else if (a === "--effort" && next) effort = next;
    else if (a.startsWith("--effort=")) effort = a.slice(9);
    else if ((a === "-c" || a === "--config") && next && /^model_reasoning_effort=/.test(next)) effort = next.split("=")[1];
  }
  if (!model) return null;
  const short = model.replace(/^claude-/, "").replace(/-\d+(-\d+)*$/, "").replace(/^gpt-[\d.]+-/, "");
  return { model: short, effort: effort ? effort.replace(/["']/g, "") : null };
}

// One line that says what a blocked agent asks, from its screen tail: the line
// after "requires confirmation" (a hook's reason) or after a tool header
// ("Bash command", "Edit file"), else the line before "Do you want to proceed?".
export function askLine(tail) {
  if (!Array.isArray(tail) || !tail.length) return null;
  const bare = tail.map((l) => l.replace(/^[\s│┃|]+/, "").trim());
  let i = bare.findIndex((l) => /requires confirmation|^(Bash command|Edit file|Write file|Read file|Fetch)\b/i.test(l));
  if (i >= 0 && bare[i + 1]) return bare[i + 1];
  i = bare.findIndex((l) => /do you want to/i.test(l));
  return i > 0 ? bare[i - 1] : bare[bare.length - 1];
}

// What an agent says it is doing: its own report, else its cleaned title when
// that says more than its name.
function said(k, name) {
  const r = k.report;
  const text = typeof r === "string" ? r : r?.message ?? r?.summary ?? r?.title ?? "";
  const title = clean(k.title);
  return clean(text) || (title && title !== name ? title : "");
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
// Two lines when there is git to show, one otherwise.
const rowHeight = ({ g }) => (g ? 46 : 30);
// Icons drawn before each value on line 2, from this mod's own folder.
const ICON = (name) => `mods/quiet-spaces/icons/${name}.svg`;
// A pull request is looked up again at most this often for the same branch.
// The branch changing, or the space becoming the active one, asks sooner.
const PR_EVERY = 120000;
// Commits the branch card draws in its tree.
const HISTORY = 6;
const RAIL_CELL = 32;
// A space's name and its git tail never shrink below this, so a short one ("api")
// stays readable instead of turning into an ellipsis next to a long branch.
const SIDE_MIN = 48;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Places looked at together (two git runs each). All at once, a few hundred spaces
// run out of the app's open files (256 when started from the Dock on macOS) or
// past a machine core's 16 running execs, and those spaces wait for FALLBACK.
const AT_ONCE = 6;

// Both runs, finished: a place isn't done while one of its runs still holds a slot.
async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map((d) => d.value);
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// Each status has its own shape as well as its own color, so it reads at a
// glance and without color: an arc that turns, a pulsing "?", a check, a ring.
// No agents in the space: an empty cell, so the names stay aligned.
export function statusGlyph(t, status) {
  const cell = (el) => h_flex().w(16).h(16).flex_none().items_center().justify_center().child(el);
  if (status === "working") return cell(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900));
  if (status === "blocked") return cell(div().size(14).rounded(7).bg(t.blocked + "26").text_size(10.5).font_bold()
    .text_color(t.blocked).flex().items_center().justify_center().loop("opacity", { from: 0.55, to: 1, period: 1600 }).child("?"));
  if (status === "done") return cell(svg("mods/workspace-chrome/check.svg").size(13).text_color(t.done));
  if (status === "idle") return cell(div().size(7).rounded(4).border(1.5).border_color(t.idle ?? t.dim));
  return cell(div());
}

// The format `git log --graph` prints with HISTORY_FORMAT, one line each:
// the graph drawing, then (on commit lines) short hash, full SHA, subject, author, time, refs.
const HISTORY_FORMAT = "--format=%x1f%h%x1f%H%x1f%s%x1f%an%x1f%ct%x1f%D";
export function graphLog(text) {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const i = line.indexOf("\x1f");
    if (i < 0) return { graph: line.trimEnd() };
    const [hash, sha, subject, author, at, refs] = line.slice(i + 1).split("\x1f");
    return { graph: line.slice(0, i).trimEnd(), hash, sha, subject, author, at: Number(at), refs: (refs ?? "").replace(/^HEAD -> /, "").split(", ").filter(Boolean) };
  });
}

// `git diff --numstat` ("82\t14\tpath", "-\t-\tbinary") -> the totals, the file
// count and the `top` files that changed most (binary files count as 0 lines).
export function numstat(text, top = 5) {
  const files = text.split("\n").filter(Boolean).map((line) => {
    const [a, d, ...rest] = line.split("\t");
    return { path: rest.join("\t"), add: a === "-" ? null : Number(a), del: d === "-" ? null : Number(d) };
  });
  const sum = (k) => files.reduce((s, f) => s + (f[k] ?? 0), 0);
  const size = (f) => (f.add ?? 0) + (f.del ?? 0);
  return { add: sum("add"), del: sum("del"), count: files.length, files: [...files].sort((x, y) => size(y) - size(x)).slice(0, top) };
}

// The pull request's look: an icon, a short word and a theme color.
export function prLook(t, pr) {
  if (pr.state === "MERGED") return { icon: "git-merge", word: "merged", color: t.accent };
  if (pr.state === "CLOSED") return { icon: "git-pull-request-closed", word: "closed", color: t.dim };
  if (pr.draft) return { icon: "git-pull-request", word: "draft", color: t.dim };
  if (pr.review === "APPROVED") return { icon: "git-pull-request", word: "approved", color: t.done };
  if (pr.review === "CHANGES_REQUESTED") return { icon: "git-pull-request", word: "changes", color: t.blocked };
  if (pr.review === "REVIEW_REQUIRED") return { icon: "git-pull-request", word: "review", color: t.muted };
  return { icon: "git-pull-request", word: "open", color: t.muted };
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Map(); // local repos' pending folder watches
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.scroll = ScrollHandle.new(); // the list's position: the active space is brought into view through it
    this.activeAt = -1; // the active space's place among the list's children (headers and rows), -1 when not drawn
    this.machines = [];
    this.pr = {}; // JSON [where(), branch] -> { number, state, draft, review, base }, null: no PR or gh couldn't say
    this.prAt = {}; // the same key -> when it was last looked up
    this.activeId = null; // the active space at the last look, to ask for its PR again when it changes
    try {
      this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
      if (!this.reconnecting || typeof this.reconnecting !== "object" || Array.isArray(this.reconnecting)) this.reconnecting = {};
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch { this.reconnecting = {}; }
    try { this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]")); } catch { this.folded = new Set(); }
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    this.config = {};
    this.prompts = {}; // blocked agent address -> the last lines of its screen
    cx.timer.every(4000, (cx) => this.readPrompts(cx));
    this.loadConfig(cx);
    cx.timer.every(60000, (cx) => this.loadConfig(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const ps = panes();
    const due = this.due(now, sp, ps);
    // A space just shown: look at its PR now instead of waiting for PR_EVERY.
    const active = sp.find((s) => s.active);
    if (active && active.id !== this.activeId) {
      this.activeId = active.id;
      const k = where(active, ps);
      if (JSON.parse(k)[1]) {
        for (const p of Object.keys(this.prAt)) if (JSON.parse(p)[0] === k) delete this.prAt[p];
        due.add(k);
      }
    }
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
      for (const p of Object.keys(this.pr)) if (JSON.parse(p)[0] === k) { delete this.pr[p]; delete this.prAt[p]; }
    }
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
      }
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      // The repo's GitHub owner picks the gh account and the tracker; asked
      // only when quiet.json maps owners.
      const needsOwner = Object.keys(objectOf(this.config?.gh_accounts)).length || Object.keys(objectOf(this.config?.trackers)).length;
      info.owner = needsOwner ? await this.ownerOf(on, cwd) : null;
      const pr = branch.code === 0 ? await this.lookPr(key, info.branch, on, cwd, info.owner) : null;
      info.pr = pr;
      // Opt-in tracker chip: the task key in the branch name, for this owner's tracker.
      info.tracker = await this.trackerOf(info.owner, info.branch);
      // For the branch card: the last commit, the upstream's name and how many
      // files are not committed. Failures leave the field out of the card.
      // Two at a time, as above: AT_ONCE places x 2 runs stays under a machine
      // core's 16 running execs.
      const [diff, log] = await Promise.all([
        this.diff(pr, on, cwd),
        // The branch's tree: the last HISTORY commits, with merges drawn as branches.
        exec("git", ["log", "--graph", `-n${HISTORY}`, HISTORY_FORMAT], { cwd, on, timeout: 10000 }).catch(() => null),
      ]);
      const [up, dirty] = await Promise.all([
        exec("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { cwd, on, timeout: 10000 }).catch(() => null),
        // --untracked-files=all: a new folder counts as its files, not as one entry.
        exec("git", ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"], { cwd, on, timeout: 15000 }).catch(() => null),
      ]);
      info.diff = diff;
      info.history = log?.code === 0 ? graphLog(log.stdout) : [];
      info.commit = info.history.find((h) => h.hash) ?? null;
      info.upstream = up?.code === 0 ? up.stdout.trim() : null;
      info.dirty = dirty?.code === 0 ? dirty.stdout.split("\n").filter(Boolean).length : null;
      // Opt-in (`"gate": true`): the PR gate's stamp for HEAD, written by a gate
      // script at <git common dir>/agent-pr-gate/<HEAD sha>.json with `pass`.
      // A file read, no exec. null: gate off or no commit.
      info.gate = null;
      if (this.config?.gate === true && info.commit?.sha) {
        let stamp = null;
        try { stamp = JSON.parse(await readTextFile(`${repo}/agent-pr-gate/${info.commit.sha}.json`, { on }) ?? "null"); } catch {}
        info.gate = { stamped: Boolean(stamp), pass: stamp?.pass === true, pushed: Boolean(info.upstream) && ahead === 0 };
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  // The branch's pull request, from `gh` on the space's machine. Any failure (no
  // gh, no login, another account, no PR) means no PR, never an error: the row
  // then shows only the branch. Cached per place and branch for PR_EVERY.
  async lookPr(key, branch, on, cwd, owner) {
    const k = JSON.stringify([key, branch]);
    if (k in this.pr && Date.now() - (this.prAt[k] ?? 0) < PR_EVERY) return this.pr[k];
    this.prAt[k] = Date.now();
    let pr = null;
    try {
      const fields = "number,state,isDraft,reviewDecision,baseRefName,headRefName,title,author,url,updatedAt,mergeable,statusCheckRollup,latestReviews,reviewRequests";
      const account = this.ghAccount(owner);
      // gh answers with its active account. A repo whose owner maps to another
      // logged-in account gets that account's token for this one call only:
      // the token stays in the child's environment and is never printed.
      const r = account
        ? await exec("sh", ["-c", 'GH_TOKEN="$(gh auth token --user "$1")" || exit 1; export GH_TOKEN; exec gh pr view --json "$2"', "quiet-gh", account, fields], { cwd, on, timeout: 15000 })
        : await exec("gh", ["pr", "view", "--json", fields], { cwd, on, timeout: 15000 });
      if (r.code === 0) {
        const j = JSON.parse(r.stdout);
        // gh can answer with a PR from another branch of the same name on a fork: keep only ours.
        if (j.headRefName === branch) pr = {
          number: j.number, state: j.state, draft: j.isDraft, review: j.reviewDecision || null, base: j.baseRefName, head: j.headRefName,
          // For the PR card.
          title: j.title, author: j.author?.login ?? null, url: j.url, updatedAt: j.updatedAt, mergeable: j.mergeable,
          checks: j.statusCheckRollup ?? [], reviews: j.latestReviews ?? [], requested: j.reviewRequests ?? [],
        };
      }
    } catch {}
    for (const p of Object.keys(this.pr)) if (JSON.parse(p)[0] === key && p !== k) { delete this.pr[p]; delete this.prAt[p]; }
    this.pr[k] = pr;
    return pr;
  }

  // `quiet.json` in the Herdr home, the person's own options (see the README):
  // gh_accounts, trackers, gate, stall_minutes. Read at start and every minute;
  // a missing or broken file means no options.
  loadConfig(cx) {
    cx.spawn(async (cx) => {
      let j = {};
      try {
        const text = await readTextFile(`${appHome()}/quiet.json`);
        const parsed = text ? JSON.parse(text) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) j = parsed;
      } catch {}
      this.config = j;
      cx.notify();
    });
  }

  // The GitHub owner in the `origin` remote, or null.
  async ownerOf(on, cwd) {
    try {
      const r = await exec("git", ["remote", "get-url", "origin"], { cwd, on, timeout: 5000 });
      return r.code === 0 ? r.stdout.trim().match(/github\.com[:/]([^/]+)\//i)?.[1] ?? null : null;
    } catch { return null; }
  }

  // The tracker task of a branch, from `trackers` in quiet.json, picked by the
  // repo's GitHub owner (else "*"): { pattern, url, command? }. `pattern` finds
  // the key in the branch name ("abc-\\d+"), `url` opens it ("{KEY}" is
  // replaced), and the optional `command` (argv, no shell) prints JSON
  // { title, status } for the key, cached TRACKER_TTL. The window's own
  // machine runs it: its login is there. Null when nothing matches.
  async trackerOf(owner, branch) {
    const trackers = objectOf(this.config?.trackers);
    const tr = objectOf((owner && (trackers[owner] ?? trackers[owner.toLowerCase()])) ?? trackers["*"]);
    const key = trackerKey(branch, tr.pattern);
    if (!key) return null;
    const url = typeof tr.url === "string" && /^https?:\/\//.test(tr.url) ? tr.url.split("{KEY}").join(key) : null;
    let about = null;
    if (Array.isArray(tr.command) && tr.command.length && tr.command.every((a) => typeof a === "string")) {
      this.tracked ??= {};
      const hit = this.tracked[key];
      if (hit && Date.now() - hit.at < TRACKER_TTL) about = hit.about;
      else {
        try {
          const argv = tr.command.map((a) => a.split("{KEY}").join(key));
          const r = await exec(argv[0], argv.slice(1), { timeout: 15000 });
          const j = r.code === 0 ? JSON.parse(r.stdout) : null;
          if (j && typeof j === "object") about = { title: typeof j.title === "string" ? j.title : null, status: typeof j.status === "string" ? j.status : null };
        } catch {}
        this.tracked[key] = { at: Date.now(), about };
      }
    }
    return { key, url, about };
  }

  // The gh account for this repo's GitHub owner, from `gh_accounts`:
  // { "<owner>": "<gh login>" }. Null (the active account) when not mapped.
  ghAccount(owner) {
    const accounts = objectOf(this.config?.gh_accounts);
    const account = owner ? accounts[owner] ?? accounts[owner.toLowerCase()] : null;
    return typeof account === "string" && /^[A-Za-z0-9-]+$/.test(account) ? account : null;
  }

  // Lines added and removed. With a PR: the branch against its base, as the PR
  // shows it. Without one, the base is unknown (each task picks its own), so
  // only the changes not yet committed count. Null when git can't say.
  async diff(pr, on, cwd) {
    // --no-optional-locks: a plain diff may rewrite .git/index, which the repo
    // watch sees as a change and answers with another look, in a loop.
    const range = pr && pr.state === "OPEN" ? [`origin/${pr.base}...HEAD`] : ["HEAD"];
    const args = ["--no-optional-locks", "diff", "--numstat", ...range];
    try {
      const r = await exec("git", args, { cwd, on, timeout: 15000 });
      return r.code === 0 ? numstat(r.stdout) : null;
    } catch { return null; }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    // Where the active space's row lands among the children this returns: the list scrolls by its direct
    // children, and machine headers, login notes and loading rows count too.
    this.activeAt = -1;
    let before = 0;
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) {
      if (loading(null) && !rows.length) return [loadingRow(null)];
      this.activeAt = rows.findIndex(r => r.w.active);
      return rows.map(draw);
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).font_medium().text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(machine?.keeps_running_after_logout === false, el => el.child(div().id(`machine-logout-${m}`)
          .flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); }).child("⚠")))
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) { before += 1; return [head]; }
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const ids = new Set(mine.map((r) => r.w.id));
      const headCard = collapsed ? head : hover(`machine-card-${m ?? "local"}`, head, machineCard(t, `machine-card-${m ?? "local"}`, m, {
        state: !m ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " "),
        spaces: mine.length,
        agents: (this.agentList ?? []).filter((a) => ids.has(a.space)).length,
      }));
      const items = [cell(headCard), ...guidance, ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : cell(empty)])];
      const first = folded ? -1 : mine.findIndex(r => r.w.active);
      if (first >= 0) this.activeAt = before + 1 + guidance.length + first;
      before += items.length;
      return items;
    });
  }

  // After the name on line 1: the repo, only when the name doesn't already say
  // it, and ahead/behind its upstream.
  repoTail(g, tree, name, t) {
    const repo = tree || g.name.toLowerCase() === name.toLowerCase() ? "" : g.name;
    return h_flex()
      .flex_auto()
      .min_w(repo ? SIDE_MIN : 0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.muted)
      .when(Boolean(repo), (el) => el.child(div().min_w(0).truncate().child(repo)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.muted).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.muted).child(`\u2193${g.behind}`)));
  }

  // Line 2: an icon before each value, so each one says what it is:
  // [branch] name  [PR] #124 approved \u2192 dev  [diff] +82 \u221214.
  // The branch gives way first; the PR and the diff stay whole.
  // Reviewers of this PR, from labels the orchestrator sets on their terminals
  // after it checks a review: quiet.pr=<n>, quiet.verdict=<PASS|ISSUES|...>,
  // quiet.findings=<count>, optional quiet.repo=<repo name>. No labels: none.
  reviewersOf(g) {
    if (!g?.pr) return [];
    const out = [];
    for (const k of this.terms?.values() ?? []) {
      const l = objectOf(k.labels);
      if (l["quiet.pr"] !== String(g.pr.number)) continue;
      if (l["quiet.repo"] && l["quiet.repo"] !== g.name) continue;
      const findings = Number.parseInt(l["quiet.findings"] ?? "", 10);
      out.push({
        address: k.address, name: k.name || k.address, model: modelOf(k.argv), live: k.state === "live",
        verdict: (l["quiet.verdict"] ?? "").trim().toUpperCase() || null,
        findings: Number.isFinite(findings) ? findings : null,
      });
    }
    return out;
  }

  // Live agents waiting for the person, anywhere: their status is blocked (a
  // sub-agent's "error" counts, as in the agents list). Each gets its space's
  // name and the tail of its screen, where the tool draws its question.
  needsYou(all) {
    const spaceName = new Map(spaces().map((s) => [s.id, s.name]));
    const spaceOfKid = new Map(Object.entries(this.subs ?? {}).flatMap(([space, kids]) => kids.map((k) => [k.address, space])));
    const agentSpace = new Map((this.agentList ?? []).map((a) => [a.address, a.space]));
    const out = [];
    for (const k of all) {
      if (k.state !== "live") continue;
      const status = this.listed.has(k.address) ? this.listed.get(k.address) : kidStatus(k, this.listed);
      if (status !== "blocked") continue;
      const space = agentSpace.get(k.address) ?? spaceOfKid.get(k.address) ?? null;
      out.push({ ...this.agentRow(k, "blocked"), space: space ? spaceName.get(space) ?? null : null, ask: askLine(this.prompts?.[k.address]) });
    }
    // Look at their screens on a timer, never here.
    this.blockedNow = out.map((a) => a.address);
    return out;
  }

  // Screen tails of blocked agents: read with `hc read` every 4s while some
  // agent is blocked, at most 4 at a time; dropped once it moves on.
  readPrompts(cx) {
    const want = this.blockedNow ?? [];
    for (const a of Object.keys(this.prompts)) if (!want.includes(a)) delete this.prompts[a];
    if (!want.length || this.readingPrompts) return;
    this.readingPrompts = true;
    cx.spawn(async (cx) => {
      const queue = [...want];
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) {
          const addr = queue.shift();
          try {
            const r = await hc(["read", addr, "--lines", "0"]);
            if (r.code === 0) this.prompts[addr] = screenTail(r.stdout);
          } catch {}
        }
      }));
      this.readingPrompts = false;
      cx.notify();
    });
  }

  // A terminal as a card line, named as the agents list names a sub-agent.
  // `since`: when its tab started working (Herdr's `working_since`), only while
  // it works; null when Herdr doesn't know, so the card shows no time at all.
  agentRow(k, status) {
    const name = k.name || k.template || k.program?.name || k.address;
    const since = status === "working" ? this.workingSince?.get(k.address) ?? null : null;
    // Working longer than `stall_minutes` (default 20): the card shows the time in amber.
    const stallMs = (Number(this.config?.stall_minutes) > 0 ? Number(this.config.stall_minutes) : 20) * 60000;
    const long = Boolean(since) && Date.now() - since > stallMs;
    return { address: k.address, name, status, since, long, report: said(k, name), program: k.program, model: modelOf(k.argv) };
  }

  // The space's agents, most urgent first, as card lines.
  spaceAgents(spaceId) {
    const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
    return (this.agentList ?? []).filter((a) => a.space === spaceId)
      .sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0))
      .map((a) => {
        const k = this.terms?.get(a.address) ?? { address: a.address, program: a.program, title: a.title };
        const row = this.agentRow({ ...k, name: k.name || a.tab_name }, a.status);
        return row;
      });
  }

  spaceInfo(w) {
    const changed = Math.max(0, ...(w.tabs ?? []).map((c) => c.changed_at ?? 0));
    return {
      folder: place(w, this.paneList ?? []),
      agents: (this.agentList ?? []).filter((a) => a.space === w.id).length,
      changed: changed || null,
    };
  }

  // Each part opens its own card on hover.
  detail(g, t, w) {
    const icon = (name, color) => svg(ICON(name)).size(13).flex_none().text_color(color);
    const pr = g.pr;
    const look = pr && prLook(t, pr);
    const diff = g.diff && (g.diff.add || g.diff.del) ? g.diff : null;
    const part = () => h_flex().flex_none().gap(4).items_center();
    const reviewers = this.reviewersOf(g);
    const branch = h_flex().min_w(0).gap(4).items_center()
      .child(icon("git-branch", t.dim))
      .child(div().min_w(0).max_w(170).truncate().text_color(t.muted).child(g.branch ?? "detached"));
    return h_flex().gap(10).items_center().text_size(11.5).text_color(t.dim).min_w(0).overflow_hidden()
      .child(hover(`branch-card-${w.id}`, branch, branchCard(t, `branch-card-${w.id}`, g, ICON("git-branch"))).flex_initial().min_w(0))
      // Opt-in tracker chip: the task key from the branch name; its card says more.
      .when(Boolean(g.tracker), (el) => el.child(hover(`tracker-card-${w.id}`, part()
        .child(icon("ticket", t.dim))
        .child(div().text_color(t.muted).child(g.tracker.key)), trackerCard(t, `tracker-card-${w.id}`, g.tracker, ICON("ticket"))).flex_none()))
      // Opt-in gate shield: green only when the stamp passed for HEAD and HEAD is pushed.
      .when(Boolean(g.gate) && (g.gate.stamped || pr?.state === "OPEN"), (el) => {
        const gt = g.gate;
        const [iconName, color, tip] = gt.pass && gt.pushed ? ["shield-check", t.done, "Gate passed for this commit"]
          : gt.pass ? ["shield-check", t.muted, "Gate passed for this commit; push it so origin matches"]
          : gt.stamped ? ["shield", t.blocked, "Gate failed for this commit"]
          : ["shield", t.dim, "No gate run for this commit"];
        return el.child(div().id(`gate-${w.id}`).flex_none().tooltip(tip).child(icon(iconName, color)));
      })
      .when(Boolean(pr), (el) => el.child(hover(`pr-card-${w.id}`, part()
        .child(icon(look.icon, look.color))
        .child(div().text_color(t.muted).child(`#${pr.number}`))
        .child(div().text_color(look.color).child(look.word))
        // The base only matters while the PR is open; capped so a long one can't push the row.
        .when(pr.state === "OPEN", (p) => p.child(div().max_w(90).truncate().child(`\u2192 ${pr.base}`)))
        // Reviewer verdicts from labels: "opus ✓  sol ✗4".
        .children(reviewers.map((r) => verdictChip(t, r))), prCard(t, `pr-card-${w.id}`, pr, look, ICON(look.icon), reviewers)).flex_none()))
      .when(Boolean(diff), (el) => el.child(hover(`diff-card-${w.id}`, part()
        .child(icon("file-diff", t.dim))
        .child(div().text_color(t.done).child(`+${diff.add}`))
        .child(div().text_color(t.ansi1).child(`\u2212${diff.del}`)), diffCard(t, `diff-card-${w.id}`, g, ICON("file-diff"), w.id, w.active)).flex_none()));
  }

  row({ w, i, g, tree }, t) {
    const on = w.active;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    // The name's left edge: line 2 starts under it (avatar or worktree mark, then the gap).
    const indent = tree ? 22 + 13 + 9 : 18 + 9;
    const kids = (this.subs?.[w.id] ?? []).map((k) => this.agentRow(k, kidStatus(k, this.listed)));
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .gap(3)
      .h(rowHeight({ g }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          // Herdr's own identity: the space's colored letter, or the worktree mark.
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(hover(`space-card-${w.id}`, div().min_w(0).truncate().text_color(on ? t.foreground : t.muted).when(on, (n) => n.font_medium()).child(w.name),
            spaceCard(t, `space-card-${w.id}`, w, this.spaceInfo(w))).flex_initial().min_w(SIDE_MIN))
          .child(g ? this.repoTail(g, tree, w.name, t) : div().flex_1())
          // Live sub-agents started by this space's agents, wherever they run.
          .when(kids.length > 0, el => el.child(hover(`subs-card-${w.id}`, h_flex().flex_none().gap(4).items_center()
            .text_size(11.5).text_color(t.muted)
            .child(svg(ICON("bot")).size(13).flex_none().text_color(t.dim))
            .child(String(kids.length)), subsCard(t, `subs-card-${w.id}`, kids, statusGlyph, ICON("bot"))).flex_none()))
          // Status on the right, where the agents list shows it too.
          .child(hover(`status-card-${w.id}`, statusGlyph(t, w.status), statusCard(t, `status-card-${w.id}`, this.spaceAgents(w.id), statusGlyph)).flex_none()),
      )
      .when(Boolean(g), (el) => el.child(div().pl(indent).min_w(0).child(this.detail(g, t, w))));
  }

  compact({ w, i }, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(1).top(1).child(statusGlyph(t, w.status))));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    // Read once per render, for the rows and their cards.
    const all = terminals();
    this.agentList = agents();
    this.paneList = panes();
    this.terms = new Map(all.map((k) => [k.address, k]));
    this.listed = new Map(this.agentList.map((a) => [a.address, a.status]));
    // Agent address -> when its tab started working.
    const tabSince = new Map(spaces().flatMap((s) => (s.tabs ?? []).map((c) => [c.id, c.working_since])));
    this.workingSince = new Map(this.agentList.map((a) => [a.address, tabSince.get(a.tab) ?? null]));
    this.subs = subAgents(all, this.agentList);
    const needs = this.needsYou(all);
    const list = this.grouped(t, collapsed);
    // Bring the active space into view when it, or its place in the list, changes; a row already in view stays put.
    const active = sp.find(p => p.active)?.id;
    if (active !== this.revealed || this.activeAt !== this.revealedAt) {
      this.revealed = active;
      this.revealedAt = this.activeAt;
      if (this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child(div().font_medium().child("Spaces")))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      // Every agent waiting for you, in any space or machine, behind one row.
      // A click goes straight to the next one (each click moves along the
      // queue); resting on it shows who waits, where, and for what.
      .when(needs.length > 0 && !collapsed, (el) => {
        const next = needs[(this.needsAt ?? 0) % needs.length];
        return el.child(div().px(8).pb(4).child(hover("needs-card",
          h_flex().id("needs-row").h(28).px(8).gap(8).items_center().rounded(7).bg(t.blocked + "1f").text_size(12).text_color(t.blocked)
            .cursor_pointer().hover((s) => s.bg(t.blocked + "33"))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              run("agent.focus", { terminal: next.address });
              this.needsAt = ((this.needsAt ?? 0) + 1) % needs.length;
              cx.notify();
            })
            .child(statusGlyph(t, "blocked"))
            .child(div().flex_none().font_medium().child(`${needs.length} need${needs.length === 1 ? "s" : ""} you`))
            .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(`→ ${next.name}`)),
          needsCard(t, "needs-card", needs, statusGlyph, next.address)).w_full()));
      })
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        // A block above (another mod's) growing, or the window resizing, shrinks this list and can push the active space out.
        .on_size_change((_size, cx) => { if (this.activeAt >= 0) { this.scroll.scroll_to_item(this.activeAt); cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(list));
  }
}
