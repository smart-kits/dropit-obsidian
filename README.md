# dropit for Obsidian

**English** · [简体中文](./README.zh-CN.md)

Everything you send to dropit — from your phone, browser or terminal — lands in your vault, in real
time. And anything in your vault goes out to your other devices with a right-click.

dropit delivers; what happens next is up to you. If you want more — summaries, tags, filing — the
plugin can hand each item to a command of your own choosing, and stays out of it (see [Run your own
command](#run-your-own-command)).

## Features

- **Real-time.** New items appear seconds after you send them. The status bar shows it: **● dropit** receiving live, **○ dropit** not.
- **Catches up.** Obsidian was closed for two days, or the laptop slept? Everything sent meanwhile arrives when Obsidian opens or when you come back to it. No polling timer.
- **One delivery, one note.** Text and files sent together become one note — the text on top, the files embedded below.
- **Readable names.** Notes are named after their time and content (`09-29 15.30 Slides for the 3pm meeting.md`); links with a page title (from the browser extension) show the title, the link and the description.
- **Files where you keep attachments.** Saved with their original names, where *Settings → Files and links* says attachments go.
- **Three places to write.** A new note for each delivery, the end of one note you choose, or today's daily note.
- **Send from Obsidian.** Right-click selected text, a note or files → *Send to dropit*. Or use the commands.
- **Never loses an item, never writes one twice.** Progress advances only after a note is written. Pulling again skips what's already in the vault.
- **Never stuck.** If a file can't be downloaded, a one-line warning takes its place and everything after it still arrives; pulling again later swaps the warning for the file.
- **Heals itself.** If the server address stops answering, the built-in one is tried next.
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

Or download `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/dropit/`.

Then: *Settings → Community plugins* → enable **dropit**.

## First run

Open *Settings → dropit*. It opens on *Join with a pairing code*:

- **Already using dropit** → enter the 6-character code from another device → *Join*
- **First device** → *First time using dropit?* → *Create a new account*

To add another device later: *Settings → dropit → Add a device → Generate a pairing code*. Type the
code on the new device, or scan the QR code with its camera. The page notices when the device joins.

## Where items go

Choose under *Settings → dropit → Write items to*.

**A new note for each** (default). One note per delivery, in the folder you set (default `Inbox`):

```markdown
---
kind: batch
source: web
created: 2026-09-29T07:30:00.000Z
dropit_batch: b3k9x0
dropit_seq: [41, 42, 43]
---

Slides for the 3pm meeting

![[budget.png]]

![[timeline.pdf]]
```

A single item carries `dropit_seq: 42`; `kind` is `text`, `url`, `image`, `file` …, or `batch` for
several sent together.

**The end of one note.** Each item is added to the note you name (created if missing):

```markdown
**09-29 15:30** · ios-shortcut
Call the dentist back
```

**Today's daily note.** Same format, added to the end of today's note — using the folder, date
format and template of the core *Daily notes* plugin. If today's note doesn't exist yet it's created
from that template; a template written for Templater goes through Templater.

Nothing else is added to the note. The plugin remembers which items it appended, so pulling again
skips them — including one you've since deleted from the note on purpose.

## Send to dropit

| From | How |
|---|---|
| Selected text | Right-click → *Send to dropit*, or the command *dropit: Send selection* |
| A note | Right-click it in the file list → *Send to dropit*, or *dropit: Send current note*. It goes as text; a note over 1 MB goes as a file |
| Files | Right-click one or several → *Send to dropit*. Several at once arrive together, as one delivery |

What you send from this vault doesn't come back into it.

## Run your own command

*Settings → dropit → Run a command after receiving* picks any Obsidian command — a QuickAdd macro, a
Templater script, another plugin's action. It runs once for each item, **after** the item is in
the vault.

The contract:

- **Delivery never depends on it.** The item is written first; the command runs afterwards, once, with no retry. If it fails, nothing is undone and nothing is re-sent.
- **One item at a time.** Items are handed over in order, a second apart.
- **dropit defines the format; your script is yours.** The plugin does nothing with the content beyond writing it.

Your script reads the current item from `app.plugins.plugins.dropit.received`:

```js
{
  v: 1,                      // format version
  seq: 42,                   // the item's number, increasing
  kind: 'image',             // 'text' · 'url' · 'image' · 'video' · 'file' · …
  source: 'web',             // where it was sent from
  created: '2026-09-29T07:30:00.000Z',
  batch: { id: 'b3k9x0', index: 2, count: 3 },   // null when sent on its own
  text: '',                  // the text or link; '' for files
  meta: { filename: 'budget.png', mime: 'image/png' },   // also title / description for links
  note: 'Inbox/09-29 15.30 Slides for the 3pm meeting.md',   // where it was written
  files: ['Inbox/budget.png'],                   // files saved to the vault for it
}
```

`app.plugins.plugins.dropit.recent` holds the last 20. From another plugin or a startup script you
can also listen directly — every item, no command needed:

```js
app.workspace.on('dropit:received', (item) => { /* same object */ });
```

For example, a QuickAdd macro's user script:

```js
module.exports = async ({ app }) => {
  const item = app.plugins.plugins.dropit.received;
  if (item.kind !== 'url') return;
  // …your own processing
};
```

> **Treat the content as untrusted input.** Anyone holding a send-only token for your account — an
> old phone, a leaked shortcut — can put anything into it. Don't `eval` it, and never build a shell
> command line out of it: pass it to a program on **stdin** or in a file. The object is frozen, so a
> script can't change what the next one sees.

## Settings

| Setting | What it does |
|---|---|
| *(top line)* | Whether it's receiving live, your plan, devices and space used — and *Sync now* |
| Write items to · Folder · Note | Where items go (above) |
| Run a command after receiving | Your command (above) |
| Pull again | Pulls again: **everything**, **the last N items**, or **the last N days**. What's already in the vault is skipped; downloads that failed are tried again |
| Add a device | A pairing code and QR code for a new device |
| Devices | Every device on your account; remove the ones you don't use |
| Feedback | *Report a problem* opens a new issue on GitHub with the plugin and Obsidian versions filled in; *Source code* opens this repository. Issues are public: never paste your token |
| Advanced → Server address | Rarely needs changing. If it stops answering, the built-in address is tried next |
| Advanced → Unpair | Clears this device's settings. Your items and other devices are untouched |

Sync by hand any time: click the status bar item or the ribbon icon, or run *dropit: Sync now*.

## How it stays connected

- Real-time push over a WebSocket. A heartbeat every 60 s detects dead connections — after sleep/wake a socket often looks open but receives nothing — and reconnects with backoff from 1 s up to 60 s.
- Coming back to the Obsidian window syncs when the connection isn't known to be live.
- If real-time push isn't included in your plan (new accounts get it for 14 days), the plugin says so once and stops asking; it syncs when Obsidian opens, when you come back to it, and when you sync by hand.

## When something goes wrong

| Status bar / notice | Meaning | What to do |
|---|---|---|
| `○ dropit · offline` | Disconnected, reconnecting | Wait, or click it to sync now |
| `⚠ dropit` | The last sync failed — hover for why | Click it to try again |
| `Invalid token` / `This device was removed` | The token is invalid or this device was removed | *Advanced → Unpair*, then join again with a new code |
| `Device limit reached` | Your plan's device limit | Remove an unused device under *Devices* |
| `Can't reach the server` | Network problem | Check your connection; the built-in address is tried automatically |

Details are in the developer console, under `[dropit]`.

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

The interface follows your language: English by default, Simplified Chinese when Obsidian is set to Chinese.

## License

[MIT](./LICENSE)
