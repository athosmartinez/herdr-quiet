// The accounts panel of the Quiet layout: a window to manage the agent
// accounts of terminal-tools' `agent-account` (switch, label, tag, create, log
// in) and the `gh_accounts` map of quiet.json (which logged-in gh account
// reads the PRs of a GitHub owner). It opens from the status bar's account
// card, or with `mod.open {name: "quiet-accounts"}`.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { spaces, theme, exec, run, notify, props, closeOverlay, readTextFile, writeTextFile, appHome, checking } from "herdr";
import {
  parseAccounts, addArgs, setArgs, useArgs, loginArgv, loginCommand,
  parseGhStatus, ghStatusFromText, flagRejected, readGhAccounts, writeGhAccounts, validGhName, firstLine,
} from "./accounts.js";

// A login runs in its own terminal: read again while the panel is open, so
// the account shows as logged in without a click. agent-account only reads
// files, so this is cheap.
const READ_MS = 15000;
const ICON = "mods/workspace-chrome";

export default class QuietAccounts extends View {
  init(_props, cx) {
    // The machine whose accounts this panel shows: the status bar's, else the
    // active space's. "" is this computer.
    this.machine = props()?.machine ?? spaces().find((s) => s.active)?.machine ?? "";
    this.groups = null; // parseAccounts(...)
    this.listError = null;
    this.gh = null; // [{ host, login, active, ok }]
    this.ghError = null;
    this.config = { text: null, ok: true, map: {} }; // quiet.json and its gh_accounts
    this.form = null; // the one open form: { kind, provider?, account?, owner?, inputs, error }
    this.focusedInput = null;
    this.busy = false;
    this.handle = cx.focus_handle();
    if (checking()) return;
    this.handle.focus();
    this.reload(cx);
    cx.timer.every(READ_MS, (cx) => this.readAccounts(cx));
  }

  get on() { return this.machine || null; }
  get where() { return this.machine || "this computer"; }
  get configPath() { return `${appHome()}/quiet.json`; }

  reload(cx) {
    this.readAccounts(cx);
    this.readGh(cx);
    this.readConfig(cx);
  }

  readAccounts(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("agent-account", ["list", "--json"], { on: this.on, timeout: 15000 });
        const groups = r.code === 0 ? parseAccounts(r.stdout) : null;
        if (groups) { this.groups = groups; this.listError = null; }
        else this.listError = r.code === 127 ? this.missing("agent-account") : firstLine(r.stderr) || "agent-account list gave no list";
      } catch {
        this.listError = this.missing("agent-account");
      }
      cx.notify();
    });
  }

  missing(program) {
    return `${program} is not installed on ${this.where}`;
  }

  // `--json` and `--no-refresh` keep it read-only and token-free; an older gh
  // without `--json` prints text, and only the logins are taken from it. The
  // plain form drops `--no-refresh` only when gh rejects that flag too. A
  // failed query shows gh's error, never "no account".
  readGh(cx) {
    cx.spawn(async (cx) => {
      const gh = (args) => exec("gh", ["auth", "status", ...args], { on: this.on, timeout: 15000 });
      let res;
      try {
        const r = await gh(["--json", "hosts", "--no-refresh"]);
        const list = r.code === 0 ? parseGhStatus(r.stdout) : null;
        if (list) res = { list };
        else if (r.code === 127) res = { error: this.missing("gh") };
        else {
          let t = await gh(["--no-refresh"]);
          if (flagRejected(`${t.stdout}\n${t.stderr}`)) t = await gh([]);
          res = ghStatusFromText(t.code, t.stdout, t.stderr);
          if (res.error) res.error = `gh auth status failed on ${this.where}: ${res.error}`;
        }
      } catch {
        res = { error: this.missing("gh") };
      }
      this.gh = res.list ?? null;
      this.ghError = res.error ?? null;
      cx.notify();
    });
  }

  readConfig(cx) {
    cx.spawn(async (cx) => {
      let text = null;
      try { text = await readTextFile(this.configPath); } catch {}
      this.config = { text, ...readGhAccounts(text) };
      cx.notify();
    });
  }

  async cli(args) {
    try {
      return await exec("agent-account", args, { on: this.on, timeout: 15000 });
    } catch (e) {
      return { code: -1, stdout: "", stderr: String(e?.message ?? e) };
    }
  }

  // --- forms -------------------------------------------------------------

  // One retained input. InputState needs a live host call, so it is made in
  // the click that opens the form, never in render.
  input(name, value, placeholder) {
    const st = InputState.new({ value, placeholder });
    st.on("submit", (_e, cx) => this.submit(cx));
    st.on("focus", (_e, cx) => { this.focusedInput = name; cx.notify(); });
    st.on("blur", (_e, cx) => { if (this.focusedInput === name) this.focusedInput = null; cx.notify(); });
    return st;
  }

  open(form, first, cx) {
    this.close();
    this.form = { error: null, ...form };
    this.form.inputs[first].focus();
    cx.notify();
  }

  close() {
    this.form = null;
    this.focusedInput = null;
  }

  value(name) {
    return this.form?.inputs[name]?.value() ?? "";
  }

  fail(message, cx) {
    if (this.form) this.form.error = message;
    this.busy = false;
    cx.notify();
  }

  submit(cx) {
    const f = this.form;
    if (!f || this.busy) return;
    if (f.kind === "add") this.add(f, cx);
    if (f.kind === "edit") this.edit(f, cx);
    if (f.kind === "map") this.saveMap(f, cx);
  }

  // --- agent accounts -----------------------------------------------------

  use(group, a, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      const r = await this.cli(useArgs(group.key, a.id));
      this.busy = false;
      if (r.code === 0) notify({ title: `${group.name}: new sessions use ${a.label}`, body: "Running sessions keep their account.", level: "success", timeout: 5000 });
      else notify({ title: `${group.name}: could not switch to ${a.label}`, body: firstLine(r.stderr) || firstLine(r.stdout) || `agent-account exited with ${r.code}`, level: "error" });
      this.readAccounts(cx);
      cx.notify();
    });
  }

  edit(f, cx) {
    const args = setArgs(f.provider.key, f.account, { label: this.value("label"), tag: this.value("tag") });
    if (!args) { this.close(); cx.notify(); return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      const r = await this.cli(args);
      if (r.code !== 0) return this.fail(firstLine(r.stderr) || `agent-account exited with ${r.code}`, cx);
      this.busy = false;
      this.close();
      this.readAccounts(cx);
      cx.notify();
    });
  }

  add(f, cx) {
    const built = addArgs(f.provider.key, this.value("id"), { label: this.value("label"), tag: this.value("tag") });
    if (built.error) return this.fail(built.error, cx);
    const id = built.args[2];
    if (f.provider.accounts.some((a) => a.id === id)) return this.fail(`${id} already exists`, cx);
    this.busy = true;
    cx.spawn(async (cx) => {
      const r = await this.cli(built.args);
      if (r.code !== 0) return this.fail(firstLine(r.stderr) || `agent-account exited with ${r.code}`, cx);
      this.busy = false;
      this.close();
      notify({ title: `${f.provider.name} account ${id} created`, body: "Log in to it to use it.", level: "success", timeout: 5000 });
      this.readAccounts(cx);
      cx.notify();
    });
  }

  // The login asks for a browser, a code or a hidden API key, so it runs in
  // a new tab the person sees, in a space on the panel's machine.
  login(group, a) {
    const here = (s) => (s.machine ?? "") === this.machine;
    const space = spaces().find((s) => s.active && here(s)) ?? spaces().find(here);
    if (!space) {
      notify({ title: `No space on ${this.where}`, body: `Run in a terminal there: ${loginCommand(group.key, a.id)}`, level: "warning" });
      return;
    }
    run("tab.new", { name: `${group.name} login · ${a.label}`, space: space.id, argv: loginArgv(group.key, a.id) });
  }

  // --- GitHub accounts ----------------------------------------------------

  saveMap(f, cx) {
    const owner = this.value("owner").trim();
    const login = this.value("login").trim();
    if (!validGhName(owner)) return this.fail("Owner: the GitHub user or organization in the repo's origin", cx);
    if (!validGhName(login)) return this.fail("Account: a gh login (letters, digits and -)", cx);
    const map = { ...this.config.map };
    if (f.owner && f.owner !== owner) delete map[f.owner];
    map[owner] = login;
    this.writeMap(map, cx);
  }

  unmap(owner, cx) {
    const map = { ...this.config.map };
    delete map[owner];
    this.writeMap(map, cx);
  }

  // Writes quiet.json only if it is still the text read, so an edit made in
  // the meantime (by hand or by another window) is never lost.
  writeMap(map, cx) {
    if (this.busy) return;
    let next;
    try { next = writeGhAccounts(this.config.text, map); } catch (e) {
      if (this.form) return this.fail(String(e?.message ?? e), cx);
      notify({ title: "quiet.json not changed", body: String(e?.message ?? e), level: "error" });
      return;
    }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(this.configPath, next, this.config.text ?? null);
      } catch {
        this.readConfig(cx);
        const msg = "quiet.json changed since the panel read it. It is read again: try once more.";
        if (this.form) return this.fail(msg, cx);
        this.busy = false;
        notify({ title: "quiet.json not changed", body: msg, level: "warning" });
        return;
      }
      this.busy = false;
      this.close();
      this.readConfig(cx);
      cx.notify();
    });
  }

  // --- render -------------------------------------------------------------

  key(e, cx) {
    if (e.key !== "escape") return;
    cx.stop_propagation();
    if (this.form) { this.close(); this.handle.focus(); cx.notify(); return; }
    closeOverlay(props().overlay);
  }

  // A control inside a window: its press must not start a window drag.
  control(el, action) {
    return el.on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); });
  }

  button(t, id, label, action, primary = false) {
    const off = this.busy;
    const el = h_flex().id(id).flex_none().h(22).px(8).items_center().rounded(5).text_size(11.5)
      .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground).font_medium())
      .when(!primary, (el) => el.border_1().border_color(t.border).text_color(t.muted))
      .when(off, (el) => el.opacity(0.5))
      .when(!off, (el) => el.cursor_pointer().hover((s) => (primary ? s.opacity(0.88) : s.bg(t.hover).text_color(t.foreground))))
      .child(label);
    return off ? el.on_mouse_down("left", (_e, cx) => cx.stop_propagation()) : this.control(el, action);
  }

  field(t, name, width) {
    const st = this.form.inputs[name];
    return div().id(`field-${name}`).h(26).px(8).flex().items_center().rounded(6).border_1()
      .border_color(this.focusedInput === name ? t.accent : t.input).bg(t.background).cursor_text()
      .when(Boolean(width), (el) => el.w(width).flex_none())
      .when(!width, (el) => el.flex_1().min_w(0))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(st).h_full().w_full().text_size(12).text_color(t.foreground));
  }

  // The open form's row of inputs, its buttons and its error.
  formView(t, fields, saveLabel, hint) {
    const f = this.form;
    return v_flex().pl(20).pr(6).pt(4).pb(6).gap(6)
      .child(h_flex().gap(6).items_center().min_w(0)
        .children(fields.map(([name, width]) => this.field(t, name, width)))
        .child(this.button(t, "form-save", saveLabel, (cx) => this.submit(cx), true))
        .child(this.button(t, "form-cancel", "Cancel", (cx) => { this.close(); cx.notify(); })))
      .when(Boolean(f.error), (el) => el.child(div().text_size(11).text_color(t.blocked).child(f.error)))
      .when(!f.error && Boolean(hint), (el) => el.child(div().text_size(11).text_color(t.dim).child(hint)));
  }

  section(t, label, right) {
    return h_flex().gap(8).items_center().px(6).pt(2)
      .child(div().flex_1().text_size(11.5).font_medium().text_color(t.muted).child(label))
      .when(Boolean(right), (el) => el.child(right));
  }

  chip(t, text) {
    return div().flex_none().h(16).px(5).rounded(4).bg(t.selected).text_size(10.5).text_color(t.muted)
      .flex().items_center().max_w(80).truncate().child(text);
  }

  check(t, on) {
    return div().w(14).flex_none().when(on, (el) => el.child(svg(`${ICON}/check.svg`).size(12).text_color(t.foreground)));
  }

  account(t, g, a) {
    const f = this.form;
    const editing = f?.kind === "edit" && f.provider.key === g.key && f.account.id === a.id;
    const email = a.email && a.email !== a.label ? a.email : "";
    const note = a.state === "out" ? `not logged in · ${loginCommand(g.key, a.id)}` : "";
    const actions = h_flex().flex_none().gap(4).items_center()
      .when(!a.active && a.state !== "out", (el) => el.child(this.button(t, `use-${g.key}-${a.id}`, "Use", (cx) => this.use(g, a, cx))))
      .when(a.state === "out", (el) => el.child(this.button(t, `login-${g.key}-${a.id}`, "Log in", () => this.login(g, a))))
      .when(!editing, (el) => el.child(this.button(t, `edit-${g.key}-${a.id}`, "Edit", (cx) => this.open({
        kind: "edit", provider: g, account: a,
        inputs: { label: this.input("label", a.label, "Label"), tag: this.input("tag", a.tag, "Tag") },
      }, "label", cx))));
    return v_flex().id(`account-${g.key}-${a.id}`).min_w(0)
      .child(h_flex().px(6).py(4).gap(6).items_center().rounded(5).min_w(0)
        .child(this.check(t, a.active))
        .child(div().flex_none().max_w(140).truncate().font_medium().text_color(a.state === "out" ? t.muted : t.foreground).child(a.label))
        .when(Boolean(a.tag), (el) => el.child(this.chip(t, a.tag)))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(email))
        .child(actions))
      .when(Boolean(note), (el) => el.child(div().id(`account-note-${g.key}-${a.id}`).pl(26).pb(2).min_w(0).truncate()
        .text_size(11).text_color(t.dim).tooltip(note).child(note)))
      .when(editing, (el) => el.child(this.formView(t, [["label"], ["tag", 120]], "Save",
        `id ${a.id} · an empty field clears it`)));
  }

  provider(t, g) {
    const f = this.form;
    const adding = f?.kind === "add" && f.provider.key === g.key;
    const add = adding ? null : this.button(t, `add-${g.key}`, "Add account", (cx) => this.open({
      kind: "add", provider: g,
      inputs: { id: this.input("id", "", "id"), label: this.input("label", "", "Label"), tag: this.input("tag", "", "Tag") },
    }, "id", cx));
    return v_flex().gap(2).min_w(0)
      .child(h_flex().gap(8).items_center().px(6).pt(4)
        .child(div().font_medium().child(g.name))
        .child(div().flex_1().text_size(11.5).text_color(t.dim).child(g.accounts.length === 1 ? "1 account" : `${g.accounts.length} accounts`))
        .when(Boolean(add), (el) => el.child(add)))
      .children(g.accounts.map((a) => this.account(t, g, a)))
      .when(adding, (el) => el.child(this.formView(t, [["id", 120], ["label"], ["tag", 100]], "Create",
        "id: lowercase letters, digits, \".\", \"_\" and \"-\". Then log in to it.")));
  }

  agents(t) {
    const rows = [this.section(t, "Agent accounts")];
    if (this.listError) {
      rows.push(div().px(6).text_size(11).text_color(t.dim).child(`${this.listError}. Install agent-account from terminal-tools to manage accounts.`));
    } else if (!this.groups) {
      rows.push(div().px(6).text_size(11).text_color(t.dim).child("Reading…"));
    } else {
      rows.push(...this.groups.map((g) => this.provider(t, g)));
      rows.push(div().px(6).pt(2).text_size(11).text_color(t.dim).child("Use: new sessions start with that account; running sessions keep theirs."));
    }
    return v_flex().gap(6).children(rows);
  }

  github(t) {
    const f = this.form;
    const logins = (this.gh ?? []).filter((a) => a.ok).map((a) => a.login);
    const rows = [this.section(t, `GitHub accounts in gh on ${this.where}`)];
    if (this.ghError) rows.push(div().px(6).text_size(11).text_color(t.dim).child(`${this.ghError}.`));
    else if (!this.gh) rows.push(div().px(6).text_size(11).text_color(t.dim).child("Reading…"));
    else if (!this.gh.length) rows.push(div().px(6).text_size(11).text_color(t.dim).child("No account is logged in. Run gh auth login in a terminal."));
    for (const a of this.gh ?? []) {
      rows.push(h_flex().px(6).py(4).gap(6).items_center().min_w(0)
        .child(this.check(t, a.active))
        .child(div().flex_none().max_w(180).truncate().font_medium().text_color(a.ok ? t.foreground : t.muted).child(a.login))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(a.host))
        .child(div().flex_none().text_size(11).text_color(a.ok ? t.dim : t.blocked).child(a.ok ? (a.active ? "active" : "") : "login failed")));
    }

    const editing = f?.kind === "map";
    const add = editing && !f.owner ? null : this.button(t, "map-add", "Map an owner", (cx) => this.open({
      kind: "map", owner: null,
      inputs: { owner: this.input("owner", "", "GitHub owner"), login: this.input("login", "", "gh account") },
    }, "owner", cx));
    rows.push(this.section(t, "Owner → gh account", this.config.ok ? add : null));
    if (!this.config.ok) {
      rows.push(div().px(6).text_size(11).text_color(t.blocked).child(`${this.config.error}. Fix the file by hand; the panel does not write over it.`));
    } else {
      const map = Object.entries(this.config.map);
      if (!map.length && !editing) rows.push(div().px(6).text_size(11).text_color(t.dim).child("No owner is mapped: every repo uses the active gh account."));
      for (const [owner, login] of map) {
        const here = editing && f.owner === owner;
        const known = !this.gh || logins.includes(login);
        rows.push(v_flex().id(`map-${owner}`).min_w(0)
          .child(h_flex().px(6).py(4).gap(6).items_center().rounded(5).min_w(0)
            .child(div().w(14).flex_none())
            .child(div().flex_none().max_w(160).truncate().font_medium().child(owner))
            .child(div().flex_none().text_color(t.dim).child("→"))
            .child(div().flex_none().max_w(160).truncate().text_color(known ? t.foreground : t.muted).child(login))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.blocked).child(known ? "" : "not logged in to gh"))
            .when(!here, (el) => el
              .child(this.button(t, `map-edit-${owner}`, "Edit", (cx) => this.open({
                kind: "map", owner,
                inputs: { owner: this.input("owner", owner, "GitHub owner"), login: this.input("login", login, "gh account") },
              }, "login", cx)))
              .child(this.button(t, `map-unmap-${owner}`, "Unmap", (cx) => this.unmap(owner, cx)))))
          .when(here, (el) => el.child(this.mapForm(t, logins))));
      }
      if (editing && !f.owner) rows.push(this.mapForm(t, logins));
      rows.push(div().px(6).pt(2).text_size(11).text_color(t.dim)
        .child("A repo whose origin is under the owner reads its PRs with that gh account. Saved in quiet.json."));
    }
    return v_flex().gap(6).children(rows);
  }

  // The owner → account form, with the logged-in gh accounts to pick from.
  mapForm(t, logins) {
    return v_flex()
      .child(this.formView(t, [["owner"], ["login"]], "Save", null))
      .when(logins.length > 0, (el) => el.child(h_flex().pl(20).pb(4).gap(4).items_center().flex_wrap()
        .child(div().text_size(11).text_color(t.dim).pr(2).child("Pick:"))
        .children(logins.map((l) => this.control(
          h_flex().id(`pick-${l}`).h(18).px(6).items_center().rounded(4).bg(t.selected).text_size(11).text_color(t.muted)
            .cursor_pointer().hover((s) => s.text_color(t.foreground)).child(l),
          (cx) => { this.form?.inputs.login.set_value(l); cx.notify(); })))));
  }

  render() {
    const t = theme();
    const closeX = this.control(div().id("close").size(22).flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .child(svg(`${ICON}/x.svg`).size(13)), () => closeOverlay(props().overlay));
    return v_flex().id("quiet-accounts").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().bg(t.popover).text_size(12).text_color(t.foreground)
      .child(h_flex().flex_none().h(42).px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Accounts"))
        .child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.muted)
          .child(svg(`${ICON}/${this.machine ? "server" : "monitor"}.svg`).size(12))
          .child(this.machine || "This computer"))
        .child(div().flex_1())
        .child(this.button(t, "refresh", "Refresh", (cx) => this.reload(cx)))
        .child(closeX))
      .child(div().id("accounts-body").flex_1().min_h(0).overflow_y_scrollbar()
        .child(v_flex().px(10).py(12).gap(16)
          .child(this.agents(t))
          .child(div().h(1).bg(t.border))
          .child(this.github(t))));
  }
}
