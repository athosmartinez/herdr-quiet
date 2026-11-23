// Parsing and command building for the accounts panel. Nothing in this file
// touches Herdr, so plain `node` can test it (test/quiet-accounts.test.mjs).

export const PROVIDERS = [
  { key: "claude", name: "Claude" },
  { key: "codex", name: "Codex" },
  { key: "cursor", name: "Cursor" },
];

const isProvider = (key) => PROVIDERS.some((p) => p.key === key);
const text = (v) => (typeof v === "string" ? v : "");
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export const firstLine = (s) => (s ?? "").trim().split("\n", 1)[0];

// `agent-account list --json` as one group per provider, always all three and
// in PROVIDERS order, so an account can be added to a provider with none yet.
// Each account: { id, label (the id when it has none), tag, email, plan,
// state: "in" | "out" | "unknown" (the CLI's null: Cursor keeps its own login
// where the CLI can't see it), active }. Null when the text is not a list.
export function parseAccounts(stdout) {
  let j;
  try { j = JSON.parse(stdout); } catch { return null; }
  if (!isObject(j)) return null;
  return PROVIDERS.map((p) => {
    const g = isObject(j[p.key]) ? j[p.key] : {};
    const active = text(g.active) || "default";
    const list = Array.isArray(g.accounts) ? g.accounts.filter((a) => isObject(a) && text(a.id)) : [];
    if (!list.some((a) => a.id === "default")) list.unshift({ id: "default", logged_in: null });
    const accounts = list.map((a) => ({
      id: a.id,
      label: text(a.label) || a.id,
      tag: text(a.tag),
      email: text(a.email),
      plan: text(a.plan),
      state: a.logged_in === true ? "in" : a.logged_in === false ? "out" : "unknown",
      active: a.id === active,
    }));
    return { key: p.key, name: p.name, active, accounts };
  });
}

// agent-account's id rule: lowercase letters, digits, ".", "_" and "-",
// starting with a letter or a digit, at most 32; "default" is the normal home,
// "active" and "accounts.json" are registry files.
export function validId(id) {
  if (["default", "active", "accounts.json"].includes(id)) return false;
  return /^[a-z0-9][a-z0-9._-]{0,31}$/.test(id ?? "");
}

// `agent-account add <provider> <id> [--label ..] [--tag ..]`: { args } or
// { error } for the form. Blank label and tag are left out.
export function addArgs(provider, id, { label, tag } = {}) {
  if (!isProvider(provider)) return { error: `unknown provider "${provider}"` };
  const name = (id ?? "").trim();
  if (name === "default") return { error: "default already exists: it is the normal home" };
  if (!validId(name)) return { error: "Id: lowercase letters, digits, \".\", \"_\" and \"-\", at most 32" };
  const args = ["add", provider, name];
  const l = (label ?? "").trim();
  const t = (tag ?? "").trim();
  if (l) args.push("--label", l);
  if (t) args.push("--tag", t);
  return { args };
}

// `agent-account set <provider> <id> --label .. --tag ..` with only the fields
// that changed (an empty one clears it), or null when nothing changed. Exec
// passes each value as one argument, so no shell quoting is needed.
export function setArgs(provider, account, { label, tag }) {
  const args = ["set", provider, account.id];
  const l = (label ?? "").trim();
  const t = (tag ?? "").trim();
  if (l !== account.label) args.push("--label", l);
  if (t !== account.tag) args.push("--tag", t);
  return args.length > 3 ? args : null;
}

export const useArgs = (provider, id) => ["use", provider, id];

// The login is interactive (a browser, a code, or a hidden API key for
// Cursor), so it runs in a terminal the person sees, never in the background.
export const loginArgv = (provider, id) => ["agent-account", "login", provider, id];
export const loginCommand = (provider, id) => loginArgv(provider, id).join(" ");

// A GitHub owner or login: letters, digits and "-" (what quiet-spaces accepts).
export const validGhName = (s) => /^[A-Za-z0-9-]+$/.test(s ?? "");

const byHost = (a, b) => (a.host === b.host ? Number(b.active) - Number(a.active) : 0);

// `gh auth status --json hosts`: [{ host, login, active, ok }], the active
// account of each host first. Only these fields leave: never a token.
export function parseGhStatus(stdout) {
  let j;
  try { j = JSON.parse(stdout); } catch { return null; }
  if (!isObject(j?.hosts)) return null;
  const out = [];
  for (const [host, list] of Object.entries(j.hosts)) {
    for (const a of Array.isArray(list) ? list : []) {
      if (!isObject(a) || !text(a.login)) continue;
      out.push({ host: text(a.host) || host, login: a.login, active: a.active === true, ok: a.state === "success" });
    }
  }
  return out.sort(byHost);
}

// The plain `gh auth status` of a gh without `--json`: "✓ Logged in to <host>
// account <login> (...)" or "X Failed to log in to <host> account <login>",
// then "- Active account: true|false". A gh older than 2.40 says "as <login>"
// and has one account per host, so an entry without that line is active.
export function parseGhStatusText(stdout) {
  const out = [];
  for (const line of (stdout ?? "").split("\n")) {
    const m = line.match(/(Logged in|Failed to log in) to (\S+) (?:account|as) ([A-Za-z0-9-]+)/);
    if (m) {
      out.push({ host: m[2], login: m[3], active: null, ok: m[1] === "Logged in" });
      continue;
    }
    const act = line.match(/Active account:\s*(true|false)/);
    if (act && out.length) out[out.length - 1].active = act[1] === "true";
  }
  return out.map((a) => ({ ...a, active: a.active ?? true })).sort(byHost);
}

// gh refuses a flag it doesn't know (`--json`, `--no-refresh` on an old gh).
export const flagRejected = (out) => /unknown (?:shorthand )?flag|flag provided but not defined/i.test(out ?? "");

// The result of a plain `gh auth status` run: { list } or { error }. "Not
// logged in" is an empty list; any other failure that names no login is the
// error gh printed, so it never reads as "no accounts".
export function ghStatusFromText(code, stdout, stderr) {
  const all = `${stdout ?? ""}\n${stderr ?? ""}`;
  const list = parseGhStatusText(all);
  if (list.length) return { list };
  if (/not logged in/i.test(all)) return { list: [] };
  if (code === 0) return { list: [] };
  return { error: firstLine(stderr) || firstLine(stdout) || `gh exited with ${code}` };
}

// The `gh_accounts` map of quiet.json ({ "<owner>": "<gh login>" }), only its
// valid pairs. { ok: false } when the file is not a JSON object: the panel
// then shows the error and never writes over it.
export function readGhAccounts(fileText) {
  if (!fileText || !fileText.trim()) return { ok: true, map: {} };
  let j;
  try { j = JSON.parse(fileText); } catch (e) { return { ok: false, error: `quiet.json is not valid JSON: ${firstLine(e?.message)}` }; }
  if (!isObject(j)) return { ok: false, error: "quiet.json is not a JSON object" };
  const map = {};
  for (const [owner, login] of Object.entries(isObject(j.gh_accounts) ? j.gh_accounts : {})) {
    if (validGhName(owner) && typeof login === "string" && validGhName(login)) map[owner] = login;
  }
  return { ok: true, map };
}

// quiet.json with `gh_accounts` set to `map` and every other key kept as it
// was (and in its place). An empty map removes the key. Throws on a broken
// file or an invalid pair, so nothing is written then.
export function writeGhAccounts(fileText, map) {
  for (const [owner, login] of Object.entries(map)) {
    if (!validGhName(owner)) throw new Error(`"${owner}" is not a GitHub owner name`);
    if (!validGhName(login)) throw new Error(`"${login}" is not a GitHub login`);
  }
  let j = {};
  if (fileText && fileText.trim()) {
    try { j = JSON.parse(fileText); } catch (e) { throw new Error(`quiet.json is not valid JSON: ${firstLine(e?.message)}`); }
    if (!isObject(j)) throw new Error("quiet.json is not a JSON object");
  }
  if (Object.keys(map).length) j.gh_accounts = { ...map };
  else delete j.gh_accounts;
  return `${JSON.stringify(j, null, 2)}\n`;
}
