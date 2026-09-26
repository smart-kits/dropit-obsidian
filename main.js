/**
 * dropit · Obsidian plugin
 *
 * Real-time push over WebSocket + manual refresh + heartbeat liveness check.
 * **No polling timer** — without push, it catches up on manual refresh and on next start.
 *
 * Plain CommonJS, no build step.
 */

const obsidian = require('obsidian');
const { Plugin, PluginSettingTab, Setting, Notice, normalizePath } = obsidian;

const DEFAULTS = {
  endpoint: 'https://dropit.realeye.top',
  token: '',
  folder: 'Inbox',
  cursor: 0,          // the local cursor is the source of truth
  device_id: '',
};

const PAGE = 200;
const HEARTBEAT_MS = 60_000;      // heartbeat every 60 s
const STALE_MS = 150_000;         // silent for two heartbeats = dead connection
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000];

// ── Language ──────────────────────────────────────────────────────────
// Follows Obsidian's interface language: Simplified Chinese for any Chinese setting, English otherwise.

const STRINGS = {
  en: {
    errors: {                                  // keyed by the API error code
      INVALID_TOKEN: 'Invalid token — pair again',
      DEVICE_REVOKED: 'This device was removed — pair again',
      SCOPE_INSUFFICIENT: 'This token can only send, not receive',
      DEVICE_LIMIT_REACHED: 'Device limit reached — remove a device elsewhere first',
      PAIRING_CODE_INVALID: 'Invalid pairing code',
      PAIRING_CODE_EXPIRED: 'Pairing code expired — generate a new one',
      RATE_LIMITED: 'Sending too fast',
      QUOTA_EXCEEDED: 'Storage is full',
    },
    httpFailed: (status) => `Request failed: HTTP ${status}`,
    ribbon: 'dropit: sync now',
    command: 'Sync now',
    received: (n) => `dropit: received ${n} item${n === 1 ? '' : 's'}`,
    nothingNew: 'dropit: nothing new',
    unnamedFile: 'untitled file',
    missing: (kb, msg) => `⚠️ This ${kb} KB file couldn't be downloaded: ${msg}`,
    missingWhere: 'The item is kept on the server for 30 days. You can get it from the web inbox or with `dropit watch`.',
    missingRetry: 'To pull it again: reset the cursor in the plugin settings.',
    serverAddress: 'Server address',
    serverAddressDesc: 'No trailing slash',
    setupTitle: 'Is this your first device?',
    create: 'Yes, create a new account',
    createDesc: 'Then generate pairing codes here to add your phone and browsers',
    createButton: 'Create',
    haveCode: 'No, I have a pairing code',
    haveCodeDesc: 'Generate it on a device already using dropit — 6 characters, valid for 5 minutes',
    join: 'Join',
    folder: 'Folder',
    folderDesc: 'Where items are written, relative to the vault',
    pairingCode: 'Pairing code',
    pairingCodeDesc: 'For a new device, valid for 5 minutes',
    generate: 'Generate',
    codeNotice: (code) => `Pairing code: ${code} (copied)`,
    cursor: 'Cursor',
    cursorDesc: (seq) => `Received up to seq ${seq}. Reset to pull every item still kept again.`,
    reset: 'Reset',
    unpair: 'Unpair',
    unpairDesc: 'Clears this device\'s settings only — your items and devices stay',
    unpairButton: 'Unpair',
  },
  zh: {
    errors: {
      INVALID_TOKEN: 'token 无效，请重新配对',
      DEVICE_REVOKED: '设备已被移除，请重新配对',
      SCOPE_INSUFFICIENT: '这个 token 只能投递，不能接收',
      DEVICE_LIMIT_REACHED: '设备数已达上限，先在别处移除一台',
      PAIRING_CODE_INVALID: '配对码无效',
      PAIRING_CODE_EXPIRED: '配对码已过期，请重新生成',
      RATE_LIMITED: '投递过于频繁',
      QUOTA_EXCEEDED: '空间已满',
    },
    httpFailed: (status) => `请求失败 HTTP ${status}`,
    ribbon: 'dropit：立即拉取',
    command: '立即拉取',
    received: (n) => `dropit：收到 ${n} 条`,
    nothingNew: 'dropit：没有新内容',
    unnamedFile: '未命名文件',
    missing: (kb, msg) => `⚠️ 这是一个 ${kb} KB 的文件，没能下载下来：${msg}`,
    missingWhere: '内容还在服务器上（保留 30 天）。到 Web 收件箱或用 `dropit watch` 可以拿到。',
    missingRetry: '手动重拉：在插件设置里把游标重置。',
    serverAddress: '服务地址',
    serverAddressDesc: '不带尾斜杠',
    setupTitle: '这是你的第一台设备吗？',
    create: '是，创建新账号',
    createDesc: '之后在这里生成配对码，把手机和浏览器加进来',
    createButton: '创建',
    haveCode: '否，我有配对码',
    haveCodeDesc: '在已经用上 dropit 的设备上生成，6 位，5 分钟内有效',
    join: '加入',
    folder: '落地文件夹',
    folderDesc: 'vault 内的相对路径',
    pairingCode: '配对码',
    pairingCodeDesc: '给新设备用，5 分钟内有效',
    generate: '生成',
    codeNotice: (code) => `配对码：${code}（已复制）`,
    cursor: '游标',
    cursorDesc: (seq) => `已收到 seq ${seq}。重置后重新拉取全部保留中的内容。`,
    reset: '重置',
    unpair: '解除配对',
    unpairDesc: '只清空本机设置，不会删掉服务端的设备或内容',
    unpairButton: '解除',
  },
};

/** Obsidian >= 1.8 exposes getLanguage(); older versions keep the setting in localStorage. */
function detectLang() {
  let tag = 'en';
  try { tag = obsidian.getLanguage?.() ?? globalThis.localStorage?.getItem('language') ?? 'en'; } catch { /* default */ }
  return /^zh/i.test(tag) ? 'zh' : 'en';
}
const t = STRINGS[detectLang()];

const DropitPlugin = class DropitPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.retry = 0;
    this.addSettingTab(new DropitSettingTab(this.app, this));
    this.addRibbonIcon('inbox', t.ribbon, () => this.sync(true));
    this.addCommand({ id: 'sync', name: t.command, callback: () => this.sync(true) });

    // The heartbeat is the only timer. After sleep/wake a socket often goes stale
    // while readyState still says OPEN.
    this.registerInterval(window.setInterval(() => this.heartbeat(), HEARTBEAT_MS));
    this.register(() => this.socket?.close());

    if (this.settings.token) {
      await this.sync(false);      // catch up first, then go real-time
      this.connect();
    }
  }

  // ── Pull ──────────────────────────────────────────────────────────────

  /** @param {boolean} verbose show a Notice only when triggered by hand; background failures go to the console */
  async sync(verbose) {
    if (this.syncing || !this.settings.token) return;
    this.syncing = true;
    try {
      let written = 0;
      for (let hasMore = true; hasMore; ) {
        const page = await this.api('GET', `/v1/pull?after=${this.settings.cursor}&limit=${PAGE}`);
        for (const item of page.items) written += (await this.write(item)) ? 1 : 0;
        // advance the cursor only after writing — a duplicate beats a lost item
        this.settings.cursor = page.next_after;
        await this.save();
        hasMore = page.has_more;
      }
      if (verbose) new Notice(written ? t.received(written) : t.nothingNew);
    } catch (err) {
      console.error('[dropit] sync', err);
      if (verbose) new Notice(`dropit: ${err.message}`);
    } finally {
      this.syncing = false;
    }
  }

  /** File names include seq, so they never collide; an existing file means it was already written */
  async write(item) {
    const folder = normalizePath(this.settings.folder);
    if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
    if (item.url) return this.writeBinary(folder, item);      // binary item: fetch from its signed download URL
    const path = normalizePath(`${folder}/${stamp(item.created_at)}-${item.seq}.md`);
    if (this.app.vault.getFileByPath(path)) return false;
    await this.app.vault.create(path, render(item));
    return true;
  }

  /**
   * item.url is the signed download URL returned by /pull.
   *
   * A failed download **never blocks the queue** — write an explanatory note and move on.
   * Blocking would let one undownloadable file hold back everything after it, invisibly.
   */
  async writeBinary(folder, item) {
    const name = `${stamp(item.created_at)}-${item.seq}-${sanitize(item.meta?.filename ?? 'file')}`;
    const path = normalizePath(`${folder}/${name}`);
    const fallback = normalizePath(`${folder}/${stamp(item.created_at)}-${item.seq}.md`);
    if (this.app.vault.getFileByPath(path) || this.app.vault.getFileByPath(fallback)) return false;
    try {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await this.app.vault.createBinary(path, await res.arrayBuffer());
    } catch (err) {
      console.error('[dropit] download failed', item.seq, err);
      await this.app.vault.create(fallback, renderMissing(item, err));
    }
    return true;
  }

  // ── Real-time ─────────────────────────────────────────────────────────

  async connect() {
    if (this.socket || !this.settings.token) return;
    try {
      const { ticket } = await this.api('POST', '/v1/ws/ticket');
      const url = new URL(this.base() + '/v1/ws');
      url.protocol = url.protocol.replace('http', 'ws');
      url.searchParams.set('ticket', ticket);

      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => { this.retry = 0; this.lastBeat = Date.now(); };
      socket.onmessage = (ev) => {
        this.lastBeat = Date.now();
        if (ev.data !== 'pong') this.sync(false);
      };
      socket.onclose = () => { this.socket = null; this.scheduleReconnect(); };
      socket.onerror = () => socket.close();
    } catch (err) {
      // 403 WS_REQUIRES_PAID: real-time isn't included — don't retry, don't complain
      if (err.code === 'WS_REQUIRES_PAID') return;
      console.error('[dropit] ws', err);
      this.scheduleReconnect();
    }
  }

  /** Exponential backoff, capped at 60 s */
  scheduleReconnect() {
    const delay = BACKOFF_MS[Math.min(this.retry++, BACKOFF_MS.length - 1)];
    window.setTimeout(() => this.connect(), delay);
  }

  heartbeat() {
    if (!this.settings.token) return;
    if (!this.socket) return void this.connect();
    if (Date.now() - this.lastBeat > STALE_MS) return void this.socket.close();  // stale — reconnect
    try { this.socket.send('ping'); } catch { this.socket.close(); }
  }

  // ── First run: create an account or join with a pairing code ──────────

  async createAccount() {
    const res = await this.api('POST', '/v1/accounts', { device_name: 'Obsidian' }, false);
    await this.adopt(res);
  }

  async claimCode(code) {
    const res = await this.api('POST', '/v1/pair/claim',
      { code: code.trim().toUpperCase(), device_name: 'Obsidian', scope: 'full' }, false);
    await this.adopt(res);
  }

  async adopt({ token, device_id }) {
    Object.assign(this.settings, { token, device_id, cursor: 0 });
    await this.save();
    await this.sync(true);
    this.connect();
  }

  // ── Plumbing ──────────────────────────────────────────────────────────

  base() {
    return this.settings.endpoint.replace(/\/$/, '');
  }

  async api(method, path, body, auth = true) {
    const res = await fetch(this.base() + path, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${this.settings.token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const err = new Error(t.errors[data.error] ?? t.httpFailed(res.status));
    err.code = data.error;
    throw err;
  }

  save() {
    return this.saveData(this.settings);
  }
};

function stamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const sanitize = (name) => String(name).replace(/[/\\:*?"<>|]/g, '_').slice(0, 120);

function frontmatter(item, extra = []) {
  return [
    '---',
    `dropit_seq: ${item.seq}`,
    `kind: ${item.kind}`,
    `source: ${item.source}`,
    `created: ${new Date(item.created_at).toISOString()}`,
    ...extra,
    '---',
    '',
  ];
}

function render(item) {
  return [...frontmatter(item), item.raw, ''].join('\n');
}

/** Placeholder for a file that failed to download: what it is, why it failed, where else to get it. */
function renderMissing(item, err) {
  const name = item.meta?.filename ?? t.unnamedFile;
  return [
    ...frontmatter(item, [`filename: ${name}`, `bytes: ${item.bytes}`, 'download_failed: true']),
    t.missing((item.bytes / 1024).toFixed(0), err.message),
    '',
    t.missingWhere,
    t.missingRetry,
    '',
  ].join('\n');
}

class DropitSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    this.containerEl.empty();
    this.field(t.serverAddress, t.serverAddressDesc, 'endpoint');
    this.plugin.settings.token ? this.paired() : this.setup();
  }

  /** Asked once; never shown again after pairing */
  setup() {
    const { containerEl } = this;
    containerEl.createEl('h3', { text: t.setupTitle });

    new Setting(containerEl)
      .setName(t.create)
      .setDesc(t.createDesc)
      .addButton((b) => b.setButtonText(t.createButton).setCta().onClick(() => this.run(() => this.plugin.createAccount())));

    let code = '';
    new Setting(containerEl)
      .setName(t.haveCode)
      .setDesc(t.haveCodeDesc)
      .addText((t) => t.setPlaceholder('K7M2QX').onChange((v) => { code = v; }))
      .addButton((b) => b.setButtonText(t.join).onClick(() => this.run(() => this.plugin.claimCode(code))));
  }

  paired() {
    const { containerEl } = this;
    this.field(t.folder, t.folderDesc, 'folder');

    new Setting(containerEl)
      .setName(t.pairingCode)
      .setDesc(t.pairingCodeDesc)
      .addButton((b) => b.setButtonText(t.generate).onClick(() => this.run(async () => {
        const { code } = await this.plugin.api('POST', '/v1/pair');
        new Notice(t.codeNotice(code), 300_000);
        await navigator.clipboard.writeText(code).catch(() => {});
      }, false)));

    new Setting(containerEl)
      .setName(t.cursor)
      .setDesc(t.cursorDesc(this.plugin.settings.cursor))
      .addButton((b) => b.setButtonText(t.reset).setWarning().onClick(() => this.run(async () => {
        this.plugin.settings.cursor = 0;
        await this.plugin.save();
        await this.plugin.sync(true);
      })));

    new Setting(containerEl)
      .setName(t.unpair)
      .setDesc(t.unpairDesc)
      .addButton((b) => b.setButtonText(t.unpairButton).setWarning().onClick(() => this.run(async () => {
        Object.assign(this.plugin.settings, { token: '', device_id: '', cursor: 0 });
        await this.plugin.save();
      })));
  }

  field(name, desc, key) {
    new Setting(this.containerEl).setName(name).setDesc(desc).addText((t) =>
      t.setValue(String(this.plugin.settings[key])).onChange(async (v) => {
        this.plugin.settings[key] = v.trim();
        await this.plugin.save();
      }));
  }

  async run(fn, redraw = true) {
    try {
      await fn();
      if (redraw) this.display();
    } catch (err) {
      new Notice(`dropit: ${err.message}`);
    }
  }
}

module.exports = DropitPlugin;
module.exports.STRINGS = STRINGS;            // for tests
