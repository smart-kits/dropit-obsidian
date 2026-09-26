# AGENTS.md

Instructions for AI agents (Claude Code, Codex, Cursor, …) that **install dropit for Obsidian
for a user** or **work on this repository**. Humans: see [README.md](./README.md).

---

## Part 1 · Installing the plugin for a user

### Ground rules

1. **Never print, log, paste or commit a token.** Tokens start with `dk_`. The plugin stores its
   token in `<vault>/.obsidian/plugins/dropit/data.json`. **Never read, write or create that
   file yourself** — pairing happens in Obsidian's settings UI.
2. **Ask before creating an account.** Ask the user: *"Do you already use dropit on another device?"*
   If yes, they need a pairing code from that device (`dropit code` in the CLI). If the dropit CLI
   is installed and paired on this machine, you can run `dropit code` yourself and hand them the code.
   A code is 6 characters and expires after 5 minutes.
3. Steps marked **👤 user** need the user's hands in the Obsidian UI. Tell them exactly what to
   click; don't pretend you did it.

### 1 · Find the vault

Ask the user which vault, or list the vaults Obsidian knows about:

```bash
# macOS
python3 -c 'import json,os; print("\n".join(v["path"] for v in json.load(open(os.path.expanduser("~/Library/Application Support/obsidian/obsidian.json")))["vaults"].values()))'
# Linux: same file at ~/.config/obsidian/obsidian.json
```

If there is more than one, ask which one. Below, `VAULT` is that path.

### 2 · Install

```bash
VAULT="/path/to/vault"
mkdir -p "$VAULT/.obsidian/plugins"
git clone https://github.com/smart-kits/dropit-obsidian.git "$VAULT/.obsidian/plugins/dropit"
```

If `$VAULT/.obsidian/plugins/dropit` already exists, stop and ask — it may hold an existing
pairing (`data.json`). To update an existing install, use `git -C "$VAULT/.obsidian/plugins/dropit" pull`.

### 3 · Enable

**Preferred — 👤 user:** *Settings → Community plugins* → turn off Restricted mode if it's on →
enable **dropit**.

**Alternative — agent**, only while Obsidian is **fully quit** (it rewrites the file on exit):
add `"dropit"` to the JSON array in `$VAULT/.obsidian/community-plugins.json`, creating the file
as `["dropit"]` if it doesn't exist. This does nothing if Restricted mode is on.

### 4 · Pair — 👤 user

*Settings → dropit* asks *Is this your first device?*

- First device → *Yes, create a new account* → *Create*
- Otherwise → *No, I have a pairing code* → enter the code → *Join*

The plugin follows Obsidian's language. If the user's Obsidian is set to Chinese, the buttons are in
Chinese — [README.zh-CN.md](./README.zh-CN.md) names them.

### 5 · Verify

- The dropit settings page now shows *Folder* (default `Inbox`) and *Cursor*.
- Send a test item from another device — e.g. `dropit send "hello from the CLI"` — and check that
  `Inbox/YYYY-MM-DD-<seq>.md` appears within a few seconds (or after the ribbon's **inbox** icon
  / the command *dropit: Sync now* if real-time push isn't available).

### 6 · Warn about vault sync

If the vault is synced or published (Git, iCloud, Obsidian Sync, a public repo), tell the user
to exclude `.obsidian/plugins/dropit/data.json` — it contains the token. For a Git-backed vault,
offer to add that path to the vault's `.gitignore`.

### Uninstall

👤 *Settings → dropit → Unpair*, disable the plugin, then
`rm -rf "$VAULT/.obsidian/plugins/dropit"`. To revoke the device itself, run `dropit devices`
and `dropit revoke <device_id>` from a CLI with a full token.

### Troubleshooting

| Notice | Meaning | Fix |
|---|---|---|
| `Invalid token` · `This device was removed` | Token invalid or device revoked | 👤 Unpair, then join with a fresh code |
| `Invalid pairing code` · `Pairing code expired` | Wrong or expired code | Get a fresh code (valid 5 min) |
| `Device limit reached` | Device limit reached | `dropit revoke <id>` an unused device |
| Nothing arrives | Plugin disabled, or not paired | Check steps 3–4; details are in the developer console under `[dropit]` |

---

## Part 2 · Working on this repository

- **Enable the secret scan first:** `git config core.hooksPath .githooks` (needs `gitleaks`).
  When the plugin is symlinked into a vault for development, Obsidian writes `data.json`
  **into this repository** — it is gitignored and the hook blocks tokens, keep both in place.
- **Tests:** `node test.cjs` (no dependencies). Run it after every change.
- **Interface text is bilingual:** every string lives in `STRINGS.en` and `STRINGS.zh` in `main.js`. Add both — the test checks the keys match.
- **Commit messages in English.**
- **Docs come in pairs:** `README.md` (English) and `README.zh-CN.md`. Change both.
- **No backend details** in docs or comments — the plugin talks to the API; that's all it needs to know.
- **No build step:** `main.js` is loaded by Obsidian as-is (plain CommonJS).
- `manifest.json` must stay at the repository root (the Obsidian community directory reads it there).
