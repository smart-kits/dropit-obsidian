# dropit for Obsidian

**English** · [简体中文](./README.zh-CN.md)

Everything you send to dropit — from your phone, browser or terminal — lands in your vault
as notes, in real time. That's all it does: no sorting, no tagging, no rendering.

## Features

- **Real-time.** New items appear in your vault seconds after you send them.
- **Catches up.** Obsidian was closed for two days? Everything you sent meanwhile arrives on the next start.
- **Never loses an item.** Progress advances only after a note is written. A crash means a duplicate at worst — and duplicates are skipped, because every file name carries the item's sequence number.
- **Files too.** Images, PDFs and other files are saved next to your notes with their original names.
- **Never stuck.** If a file can't be downloaded, a placeholder note explains what and why, and everything after it still arrives.
- **Quiet.** Background sync never interrupts you; notices only appear when you sync by hand.
- **Desktop and mobile.** No build step, plain CommonJS.

## Let your AI install it

Using an AI coding agent (Claude Code, Codex, Cursor, …)? Paste this:

```text
Install the dropit plugin into my Obsidian vault by following
https://raw.githubusercontent.com/smart-kits/dropit-obsidian/main/AGENTS.md
Ask me which vault and before creating an account, and never show or commit my token.
```

The agent finds your vault, installs and enables the plugin, and tells you exactly what to
click to pair it. Instructions for agents are in [AGENTS.md](./AGENTS.md).

## Install

Not yet in the Community Plugins directory. Install it manually:

```bash
git clone https://github.com/smart-kits/dropit-obsidian.git \
  "<your vault>/.obsidian/plugins/dropit"
```

Or download `main.js` and `manifest.json` into `<your vault>/.obsidian/plugins/dropit/`.

Then: *Settings → Community plugins* → enable **dropit**.

## First run

Open *Settings → dropit*. You'll be asked whether this is your first device (这是你的第一台设备吗？):

- **First device** → 是，创建新账号 (*Yes, create a new account*) → 创建
- **Already using dropit** → 否，我有配对码 (*No, I have a pairing code*) → enter the 6-character code from another device → 加入 (*Join*)

To add more devices, generate a code under 配对码 (*Pairing code*) → 生成 (*Generate*).
It's copied to your clipboard and valid for 5 minutes.

## Where items go

| Item | Saved as |
|---|---|
| Text or link | `Inbox/YYYY-MM-DD-<seq>.md` |
| File | `Inbox/YYYY-MM-DD-<seq>-<original name>` |
| File that failed to download | `Inbox/YYYY-MM-DD-<seq>.md`, with `download_failed: true` |

Every note starts with front matter you can query:

```yaml
---
dropit_seq: 42
kind: url
source: ios-shortcut
created: 2026-09-25T08:00:00.000Z
---
```

## Settings

| Setting | What it does |
|---|---|
| 服务地址 · *Server address* | The dropit service address. Leave it unless told otherwise |
| 落地文件夹 · *Folder* | Where items are written, relative to the vault (default `Inbox`) |
| 配对码 · *Pairing code* | Generate a code for a new device |
| 游标 · *Cursor* | Shows how far you've received. **Reset** pulls every item still kept (30 days) again; existing files are skipped |
| 解除配对 · *Unpair* | Clears this device's settings. Your items and other devices are untouched |

Sync by hand any time: the **inbox** icon in the ribbon, or the command **立即拉取** (*Sync now*).

## How it stays connected

- A heartbeat every 60 s detects dead connections — after sleep/wake, a socket often looks open but receives nothing — and reconnects with backoff from 1 s up to 60 s.
- If real-time push isn't included in your plan, the plugin doesn't retry or complain; it catches up on start and whenever you sync by hand.
- There is no polling timer; the heartbeat is the only one.

## When something goes wrong

| Notice | Meaning | What to do |
|---|---|---|
| `token 无效` / `设备已被移除` | The token is invalid or this device was revoked | Unpair, then join again with a new code |
| `设备数已达上限` | Device limit reached | Revoke an unused device from another device (`dropit revoke <id>`) |
| `请求失败 HTTP …` or a network error | The service couldn't be reached | Check your connection and the server address |

Background failures are only logged to the developer console (`[dropit]`).

## Privacy

- The token is stored in this plugin's `data.json` inside your vault. **If you sync or publish your vault, exclude `.obsidian/plugins/dropit/data.json`.**
- Unpairing clears it from this device.

## Development

```bash
ln -s "$(pwd)" "<your vault>/.obsidian/plugins/dropit"   # edit here, reload in Obsidian
node test.cjs                                             # no dependencies
brew install gitleaks && git config core.hooksPath .githooks   # block tokens from being committed
```

Commit messages are in English. Docs come in pairs — please update both `README.md` and `README.zh-CN.md`.

## Limitations

- Receive-only. To send, use the [CLI, browser extension or iOS Shortcuts](https://github.com/smart-kits/dropit-client).
- The interface is Chinese only for now.

## License

[MIT](./LICENSE)
