/**
 * dropit · Obsidian plugin
 *
 * Receives: real-time push over WebSocket, a catch-up sync when the window regains focus, and a
 * manual sync from the status bar, ribbon or command palette. **No polling timer.**
 * Sends: a selection, a note or files, from the editor and file-explorer menus.
 *
 * Plain CommonJS, no build step.
 */

const obsidian = require('obsidian');
const {
  Plugin, PluginSettingTab, Setting, Notice, Modal, FuzzySuggestModal, normalizePath, requestUrl, addIcon, Platform,
} = obsidian;

const DEFAULT_ENDPOINT = 'https://dropit.smart-kits.xyz';
// Retrying a dropped connection: these waits, then the next address
const RETRY_MS = [400, 1200];
// A failed sync tries again by itself after these waits (the last one repeats)
const SYNC_RETRY_MS = [5_000, 15_000, 60_000];
/** Safe to send twice: reads, a ticket, a cursor reset, and sends (the server recognizes a repeat within a minute) */
const retriable = (method, path) => method === 'GET' || /^\/v1\/(ws\/ticket|cursor\/reset|ingest)/.test(path);
const REPO = 'https://github.com/smart-kits/dropit-obsidian';

const DEFAULTS = {
  endpoints: [DEFAULT_ENDPOINT], // tried in order; the first one that answers moves to the front
  token: '',
  device_id: '',
  cursor: 0,                     // the local cursor is the source of truth
  maxSeq: 0,                     // highest item ever written; below it, check the vault before writing again
  mode: 'note',                  // 'note' · 'append' · 'daily'
  folder: 'Inbox',
  appendPath: 'Inbox/dropit.md',
  hookCommand: '',               // an Obsidian command id to run after each item is written
  batches: {},                   // batch id → where its first item went, so later ones join it
  sent: [],                      // seqs this device sent: they come back in the pull, and are skipped
  appended: [],                  // seqs added to the append note or daily notes, as [first, last] ranges
  missingAt: {},                 // seq → { path, line }: the warning written where a failed download goes
};

const PAGE = 200;
const HEARTBEAT_MS = 60_000;      // heartbeat every 60 s
const STALE_MS = 150_000;         // silent for two heartbeats = dead connection
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000];
const FOCUS_SYNC_MS = 10_000;     // at most one catch-up sync per 10 s of window focus changes
const HOOK_GAP_MS = 1_000;        // between two runs of the user's command
const DAY_MS = 86_400_000;
const BATCH_KEEP_MS = 86_400_000; // a batch's later items arrive within seconds; a day is plenty
const ENDPOINTS_CHECK_MS = 86_400_000;
const MAX_SEND_FILES = 16;
const SENT_KEEP = 200;
const MISSING_KEEP = 500;
const TEXT_MAX_BYTES = 1_000_000;
const ICON = 'dropit';

// ── Language ──────────────────────────────────────────────────────────
// Follows Obsidian's interface language: Simplified Chinese for any Chinese setting, English otherwise.

const STRINGS = {
  en: {
    errors: {                                  // keyed by the API error code
      INVALID_TOKEN: 'Invalid token — pair again',
      DEVICE_REVOKED: 'This device was removed — pair again',
      SCOPE_INSUFFICIENT: 'This token can only send, not receive',
      DEVICE_LIMIT_REACHED: 'Device limit reached — remove a device first',
      PAIRING_CODE_INVALID: 'Invalid pairing code',
      PAIRING_CODE_EXPIRED: 'Pairing code expired — generate a new one',
      RATE_LIMITED: 'Sending too fast — try again in a moment',
      SIGNUP_LIMITED: 'Too many accounts were created on this network today. Join an existing account with a pairing code, or try again tomorrow',
      PAIRING_LIMITED: 'Too many wrong pairing codes from this network today. Check the code on the other device and try again tomorrow',
      TURNSTILE_REQUIRED: 'Quite a few accounts were created on this network today. Create this one in the browser at dropit.smart-kits.xyz, then join it here with a pairing code',
      QUOTA_EXCEEDED: 'Storage is full',
      PAYLOAD_TOO_LARGE: 'Too large for your plan',
      GLOBAL_CIRCUIT_OPEN: 'dropit is busy right now — try again later',
    },
    httpFailed: (status) => `Request failed: HTTP ${status}`,
    offline: (msg) => `Can't reach the server (${msg})`,
    ribbon: 'dropit: sync now',
    cmdSync: 'Sync now',
    cmdSendNote: 'Send current note',
    cmdSendSelection: 'Send selection',
    menuSend: 'Send to dropit',
    menuSendFiles: (n) => `Send ${n} files to dropit`,
    received: (n) => `dropit: received ${n} item${n === 1 ? '' : 's'}`,
    openNote: (name) => `Open ${name}`,
    nothingNew: 'dropit: nothing new',
    sent: (n) => `dropit: sent${n > 1 ? ` ${n} items` : ''}`,
    alreadySent: 'dropit: already sent a moment ago',
    sendFailed: (name, msg) => `dropit: ${name} didn't go — ${msg}`,
    nothingToSend: 'dropit: nothing to send',
    tooManyFiles: (n) => `dropit: at most ${n} files at a time`,
    notPaired: 'dropit: not paired yet — open Settings → dropit',
    status: {
      unpaired: 'dropit · not paired',
      live: '● dropit',
      manual: '○ dropit',
      offline: '○ dropit · offline',
      connecting: '◌ dropit',
      syncing: '↻ dropit',
      error: '⚠ dropit',
    },
    statusTip: {
      unpaired: 'Click to pair',
      live: 'Receiving in real time · click to sync now',
      manual: 'Syncs when Obsidian opens or you come back to it · click to sync now',
      offline: 'Disconnected, reconnecting · click to sync now',
      connecting: 'Connecting… · click to sync now',
      syncing: 'Syncing…',
      error: (msg) => `${msg} · click to try again`,
    },
    unnamedFile: 'untitled file',
    missing: (name, kb, msg) => `⚠️ ${name} (${kb} KB) couldn't be downloaded: ${msg}. Settings → dropit → Pull again tries once more.`,
    noRealtime: 'dropit: real-time push isn\'t in your plan (new accounts get it for 10 days). '
      + 'New items now arrive when Obsidian opens, when you come back to it, or when you sync by hand.',
    trialOver: 'dropit: the 10-day real-time trial has ended. '
      + 'New items now arrive when Obsidian opens, when you come back to it, or when you sync by hand.',
    trialEnding: 'dropit: real-time push ends in less than a day (new accounts get it for 10 days). '
      + 'After that, new items arrive when Obsidian opens, when you come back to it, or when you sync by hand.',
    trialFull: 'dropit: today\'s real-time spots are full — it comes back by itself tomorrow. '
      + 'Until then, new items arrive when Obsidian opens, when you come back to it, or when you sync by hand.',
    daysLeft: (n) => (n < 1 ? 'less than a day left' : `${n} day${n === 1 ? '' : 's'} left`),
    tipLiveTrial: (left) => `Receiving in real time (trial: ${left}) · click to sync now`,
    tipTrialOver: 'Real-time trial ended · syncs when Obsidian opens or you come back to it · click to sync now',
    tipTrialFull: 'Today\'s real-time spots are full, back tomorrow · click to sync now',
    // settings · not paired
    setupHeading: 'Join with a pairing code',
    haveCode: 'Pairing code',
    haveCodeDesc: 'Generate it in a dropit client you already use — 6 characters, valid for 5 minutes',
    join: 'Join',
    create: 'First time using dropit?',
    createDesc: 'Create a new account on this device, then add your phone and browsers from here',
    createButton: 'Create a new account',
    // settings · paired
    stateLive: '● Receiving in real time',
    stateLiveTrial: (left) => `● Receiving in real time · trial: ${left}`,
    stateManual: '○ Syncs when you open or come back to Obsidian',
    stateTrialOver: '○ Real-time trial ended · syncs when you open or come back',
    stateTrialFull: '○ Real-time spots are full today · back tomorrow',
    stateOffline: '○ Disconnected — reconnecting',
    stateConnecting: '◌ Connecting…',
    stateError: (msg) => `⚠ ${msg}`,
    account: (m) => `${m.plan === 'paid' ? 'Paid' : 'Free'} · ${m.devices_used} of ${m.devices_limit} devices · `
      + `${mb(m.bytes_used)} of ${mb(m.bytes_limit, 0)} MB · items kept ${m.plan === 'paid' ? '10 days' : '1 day'} after sending`,
    accountLoading: 'Loading…',
    accountRetry: (msg) => `Couldn't read your account (${msg}) — trying again shortly`,
    syncNow: 'Sync now',
    receiveHeading: 'Receiving',
    mode: 'Write items to',
    modes: { note: 'A new note for each', append: 'The end of one note', daily: 'Today\'s daily note' },
    modeDesc: {
      note: 'Text sent together with files becomes one note, with the files embedded.',
      append: 'Each item is added to the end of the note below.',
      daily: (folder, format) => `Uses the Daily notes settings: folder “${folder || '/'}”, format ${format}. Created from its template if it doesn't exist yet.`,
    },
    folder: 'Folder',
    folderDesc: 'Where new notes go. Files go where Obsidian keeps attachments (Settings → Files and links).',
    appendPath: 'Note',
    appendPathDesc: 'Path in the vault; created if it doesn\'t exist',
    hook: 'Run a command after receiving',
    hookDesc: 'Runs once for each item, after it is in the vault — for example a QuickAdd macro or a Templater script. '
      + 'Your script reads the item from app.plugins.plugins.dropit.received. See the README for the format.',
    hookNone: 'None',
    hookPick: 'Choose…',
    hookClear: 'Clear',
    hookPlaceholder: 'Search commands',
    hookMissing: (id) => `Command not found: ${id}`,
    repull: 'Pull again',
    repullDesc: (seq) => `Received up to #${seq}. Items already in the vault are skipped; downloads that failed are tried again.`,
    repullAll: 'Everything',
    repullLast: 'The last N items',
    repullDays: 'The last N days',
    repullGo: 'Pull',
    repullNumber: 'Enter a positive number',
    devicesHeading: 'Devices',
    addDevice: 'Add a device',
    addDeviceDesc: 'On the other device, enter the code or scan the QR code with its camera',
    generate: 'Generate a pairing code',
    codeValid: (min) => `Valid for ${min} min · copied`,
    codeExpired: 'Expired — generate a new one',
    deviceJoined: 'dropit: a new device joined',
    thisDevice: 'this device',
    lastSeen: (when) => `last seen ${when}`,
    scopeSendOnly: 'send only',
    remove: 'Remove',
    removeConfirm: (name) => `Remove “${name}”? It stops sending and receiving right away.`,
    removeYes: 'Remove',
    cancel: 'Cancel',
    feedback: 'Feedback',
    feedbackDesc: 'Something wrong, or an idea? Tell us on GitHub. Issues are public: never paste your token.',
    reportIssue: 'Report a problem',
    sourceCode: 'Source code',
    issueBody: (env) => `What happened, or what you'd like:\n\n\n---\n${env}\n\nPlease don't paste a token (dk_…) or anything private: issues are public.`,
    advanced: 'Advanced',
    serverAddress: 'Server address',
    serverAddressDesc: 'Rarely needs changing. If it stops answering, the built-in address is tried next.',
    unpair: 'Unpair',
    unpairDesc: 'Clears this device\'s settings only — your items and devices stay',
    unpairButton: 'Unpair',
    ago: { now: 'just now', min: (n) => `${n} min ago`, hour: (n) => `${n} h ago`, day: (n) => `${n} d ago` },
  },
  zh: {
    errors: {
      INVALID_TOKEN: 'token 无效，请重新配对',
      DEVICE_REVOKED: '这台设备已被移除，请重新配对',
      SCOPE_INSUFFICIENT: '这个 token 只能投递，不能接收',
      DEVICE_LIMIT_REACHED: '设备数已达上限，先移除一台',
      PAIRING_CODE_INVALID: '配对码无效',
      PAIRING_CODE_EXPIRED: '配对码已过期，请重新生成',
      RATE_LIMITED: '投递过于频繁，稍后再试',
      SIGNUP_LIMITED: '这个网络今天建的账号太多了。可以用配对码加入已有账号，或者明天再试',
      PAIRING_LIMITED: '这个网络今天输错配对码的次数太多了。核对一下另一台设备上的码，明天再试',
      TURNSTILE_REQUIRED: '这个网络今天建的账号较多。请在浏览器里打开 dropit.smart-kits.xyz 建号，再在这里用配对码加入',
      QUOTA_EXCEEDED: '空间已满',
      PAYLOAD_TOO_LARGE: '超过了当前套餐的大小上限',
      GLOBAL_CIRCUIT_OPEN: 'dropit 现在比较忙，稍后再试',
    },
    httpFailed: (status) => `请求失败 HTTP ${status}`,
    offline: (msg) => `连不上服务器（${msg}）`,
    ribbon: 'dropit：立即同步',
    cmdSync: '立即同步',
    cmdSendNote: '发送当前笔记',
    cmdSendSelection: '发送选中的内容',
    menuSend: '发到 dropit',
    menuSendFiles: (n) => `把这 ${n} 个文件发到 dropit`,
    received: (n) => `dropit：收到 ${n} 条`,
    openNote: (name) => `打开 ${name}`,
    nothingNew: 'dropit：没有新内容',
    sent: (n) => `dropit：已发送${n > 1 ? ` ${n} 条` : ''}`,
    alreadySent: 'dropit：刚才已经发过这条了',
    sendFailed: (name, msg) => `dropit：${name} 没发出去 —— ${msg}`,
    nothingToSend: 'dropit：没有可发送的内容',
    tooManyFiles: (n) => `dropit：一次最多 ${n} 个文件`,
    notPaired: 'dropit：还没配对，去 设置 → dropit',
    status: {
      unpaired: 'dropit · 未配对',
      live: '● dropit',
      manual: '○ dropit',
      offline: '○ dropit · 已断开',
      connecting: '◌ dropit',
      syncing: '↻ dropit',
      error: '⚠ dropit',
    },
    statusTip: {
      unpaired: '点这里配对',
      live: '实时接收中 · 点击立即同步',
      manual: '打开或回到 Obsidian 时同步 · 点击立即同步',
      offline: '已断开，正在重连 · 点击立即同步',
      connecting: '正在连接… · 点击立即同步',
      syncing: '正在同步…',
      error: (msg) => `${msg} · 点击重试`,
    },
    unnamedFile: '未命名文件',
    missing: (name, kb, msg) => `⚠️ ${name}（${kb} KB）没能下载下来：${msg}。设置 → dropit → 重新拉取 会再试一次。`,
    noRealtime: 'dropit：当前套餐不含实时推送（新账号有 10 天体验期）。新内容改为在打开 Obsidian、回到窗口或手动同步时拉取。',
    trialOver: 'dropit：10 天的实时推送体验已结束。新内容改为在打开 Obsidian、回到窗口或手动同步时拉取。',
    trialEnding: 'dropit：实时推送体验不到 1 天就结束了（新账号有 10 天）。之后新内容在打开 Obsidian、回到窗口或手动同步时拉取。',
    trialFull: 'dropit：今天的实时名额满了，明天自动恢复。在那之前，新内容在打开 Obsidian、回到窗口或手动同步时拉取。',
    daysLeft: (n) => (n < 1 ? '不到 1 天' : `还剩 ${n} 天`),
    tipLiveTrial: (left) => `实时接收中（体验${left}）· 点击立即同步`,
    tipTrialOver: '实时推送体验已结束 · 打开或回到 Obsidian 时同步 · 点击立即同步',
    tipTrialFull: '今天的实时名额满了，明天自动恢复 · 点击立即同步',
    setupHeading: '用配对码加入',
    haveCode: '配对码',
    haveCodeDesc: '在你已经在用的 dropit 客户端里生成，6 位，5 分钟内有效',
    join: '加入',
    create: '第一次用 dropit？',
    createDesc: '在这台设备上创建新账号，之后在这里把手机和浏览器加进来',
    createButton: '创建新账号',
    stateLive: '● 实时接收中',
    stateLiveTrial: (left) => `● 实时接收中 · 体验${left}`,
    stateManual: '○ 打开或回到 Obsidian 时同步',
    stateTrialOver: '○ 实时推送体验已结束 · 打开或回到时同步',
    stateTrialFull: '○ 今天的实时名额满了 · 明天自动恢复',
    stateOffline: '○ 已断开，正在重连',
    stateConnecting: '◌ 正在连接…',
    stateError: (msg) => `⚠ ${msg}`,
    account: (m) => `${m.plan === 'paid' ? '付费版' : '免费版'} · 设备 ${m.devices_used}/${m.devices_limit} 台 · `
      + `空间 ${mb(m.bytes_used)}/${mb(m.bytes_limit, 0)} MB · 投递后保留 ${m.plan === 'paid' ? 10 : 1} 天`,
    accountLoading: '正在读取…',
    accountRetry: (msg) => `读不到账号信息（${msg}），稍后自动重试`,
    syncNow: '立即同步',
    receiveHeading: '接收',
    mode: '收到的内容写到',
    modes: { note: '每次新建一篇笔记', append: '追加到一篇指定笔记', daily: '追加到今天的日记' },
    modeDesc: {
      note: '一起发来的文字和文件合成一篇笔记，文件嵌在文字下面。',
      append: '每条追加到下面这篇笔记的末尾。',
      daily: (folder, format) => `按「日记」核心插件的设置：文件夹「${folder || '/'}」，格式 ${format}。今天的日记还没有时，用它的模板新建。`,
    },
    folder: '文件夹',
    folderDesc: '新笔记放在这里。文件按 Obsidian 的附件位置存放（设置 → 文件与链接）。',
    appendPath: '笔记',
    appendPathDesc: 'vault 里的路径，不存在会自动创建',
    hook: '收到后运行的命令',
    hookDesc: '每条内容写进 vault 之后运行一次，比如 QuickAdd 宏、Templater 脚本。'
      + '脚本从 app.plugins.plugins.dropit.received 读到这条内容，格式见 README。',
    hookNone: '不运行',
    hookPick: '选择…',
    hookClear: '清除',
    hookPlaceholder: '搜索命令',
    hookMissing: (id) => `找不到命令：${id}`,
    repull: '重新拉取',
    repullDesc: (seq) => `已收到 #${seq}。vault 里已有的不会重复写；之前下载失败的会重新下载。`,
    repullAll: '全部',
    repullLast: '最近 N 条',
    repullDays: '最近 N 天',
    repullGo: '拉取',
    repullNumber: '请填一个正整数',
    devicesHeading: '设备',
    addDevice: '添加设备',
    addDeviceDesc: '在新设备上输入配对码，或用它的相机扫二维码',
    generate: '生成配对码',
    codeValid: (min) => `${min} 分钟内有效 · 已复制`,
    codeExpired: '已过期，请重新生成',
    deviceJoined: 'dropit：新设备已加入',
    thisDevice: '本机',
    lastSeen: (when) => `${when}在线`,
    scopeSendOnly: '只能投递',
    remove: '移除',
    removeConfirm: (name) => `移除「${name}」？它会立刻停止收发。`,
    removeYes: '移除',
    cancel: '取消',
    feedback: '反馈',
    feedbackDesc: '遇到问题或有想法？到 GitHub 告诉我们。issue 是公开的，不要贴你的 token。',
    reportIssue: '反馈问题',
    sourceCode: '源代码',
    issueBody: (env) => `发生了什么，或者你希望怎样：\n\n\n---\n${env}\n\n请不要贴 token（dk_ 开头）或私人内容：issue 是公开的。`,
    advanced: '高级',
    serverAddress: '服务地址',
    serverAddressDesc: '一般不用改。这个地址连不上时，会自动改用内置地址。',
    unpair: '解除配对',
    unpairDesc: '只清空本机设置，不会删掉服务端的设备或内容',
    unpairButton: '解除',
    ago: { now: '刚刚', min: (n) => `${n} 分钟前`, hour: (n) => `${n} 小时前`, day: (n) => `${n} 天前` },
  },
};

/** Obsidian >= 1.8 exposes getLanguage(); older versions keep the setting in localStorage. */
function detectLang() {
  let tag = 'en';
  try { tag = obsidian.getLanguage?.() ?? globalThis.localStorage?.getItem('language') ?? 'en'; } catch { /* default */ }
  return /^zh/i.test(tag) ? 'zh' : 'en';
}
const lang = detectLang();
const t = STRINGS[lang];

// A line version of the dropit mark: the airmail envelope's striped edge around the "d".
const ICON_SVG = '<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">'
  + '<rect x="8" y="8" width="84" height="84" rx="16" stroke-dasharray="12 10"/>'
  + '<circle cx="45" cy="60" r="14"/><path d="M59 28v46"/></g>';

class ApiError extends Error {
  constructor(message, { code, status, data } = {}) {
    super(message);
    Object.assign(this, { code, status, data });
  }
}

const DropitPlugin = class DropitPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.retry = 0;
    this.recent = [];                              // the last few payloads, for scripts that want more than one
    this.received = null;                          // the payload of the item being handed to the command right now
    this.hookQueue = Promise.resolve();
    this.state = 'unpaired';

    addIcon(ICON, ICON_SVG);
    this.addSettingTab(this.tab = new DropitSettingTab(this.app, this));
    this.addRibbonIcon(ICON, t.ribbon, () => this.sync(true));
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('mod-clickable');
    this.registerDomEvent(this.statusEl, 'click', () => (this.settings.token ? this.sync(true) : this.openSettings()));

    this.addCommand({ id: 'sync', name: t.cmdSync, callback: () => this.sync(true) });
    this.addCommand({
      id: 'send-note',
      name: t.cmdSendNote,
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.sendFiles([file]);
        return true;
      },
    });
    this.addCommand({
      id: 'send-selection',
      name: t.cmdSendSelection,
      editorCheckCallback: (checking, editor) => {
        const text = editor.getSelection();
        if (!text.trim()) return false;
        if (!checking) this.sendText(text);
        return true;
      },
    });
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
      const text = editor.getSelection();
      if (!text.trim()) return;
      menu.addItem((i) => i.setTitle(t.menuSend).setIcon(ICON).onClick(() => this.sendText(text)));
    }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!isFile(file)) return;
      menu.addItem((i) => i.setTitle(t.menuSend).setIcon(ICON).onClick(() => this.sendFiles([file])));
    }));
    this.registerEvent(this.app.workspace.on('files-menu', (menu, files) => {
      const list = files.filter(isFile);
      if (!list.length) return;
      menu.addItem((i) => i.setTitle(t.menuSendFiles(list.length)).setIcon(ICON).onClick(() => this.sendFiles(list)));
    }));

    // Coming back to Obsidian is when missed items matter. Real-time covers it while the socket is fresh;
    // after sleep the socket often still says OPEN but is dead, so a stale one gets a sync and a reconnect.
    const onFocus = () => {
      if (!this.settings.token || document.visibilityState === 'hidden') return;
      if (this.socketFresh()) return;
      if (Date.now() - (this.lastFocusSync ?? 0) < FOCUS_SYNC_MS) return;
      this.lastFocusSync = Date.now();
      this.sync(false);
      this.heartbeat();
    };
    this.registerDomEvent(window, 'focus', onFocus);
    this.registerDomEvent(document, 'visibilitychange', onFocus);

    // The heartbeat is the only timer. After sleep/wake a socket often goes stale while readyState still says OPEN.
    this.registerInterval(window.setInterval(() => this.heartbeat(), HEARTBEAT_MS));
    // Closing the socket fires onclose, which schedules a reconnect: without the flag and the cleared
    // timer, a disabled plugin kept reconnecting and writing notes, and each reload leaked a connection.
    this.register(() => {
      this.unloaded = true;
      window.clearTimeout(this.reconnectTimer);
      window.clearTimeout(this.retryTimer);
      window.clearTimeout(this.syncRetryTimer);
      this.socket?.close();
    });

    this.setStatus(this.settings.token ? 'offline' : 'unpaired');
    // Wait for the vault index: writing before it's ready can miss notes that already exist.
    this.app.workspace.onLayoutReady(() => this.start());
  }

  async start() {
    if (!this.settings.token || this.unloaded) return;
    // Catch up and connect at the same time: done one after the other, real-time showed up only after
    // the whole catch-up and a ticket round trip. A push that lands mid-sync just queues one more sync.
    this.connect();
    await this.sync(false);
    if (Date.now() - (this.settings.endpointsCheckedAt ?? 0) > ENDPOINTS_CHECK_MS) this.refreshEndpoints();
  }

  async loadSettings() {
    const data = (await this.loadData()) ?? {};
    // 2.x kept one address in `endpoint`, which could go stale with no way back; it becomes the head of the list.
    if (data.endpoint && !data.endpoints) data.endpoints = [data.endpoint];
    delete data.endpoint;
    this.settings = Object.assign({}, DEFAULTS, data);
    this.settings.batches = { ...(data.batches ?? {}) };
    this.settings.sent = [...(data.sent ?? [])];
    this.settings.appended = (data.appended ?? []).map((r) => [...r]);
    this.settings.missingAt = { ...(data.missingAt ?? {}) };
    // Upgrading from a version that didn't record it: everything up to the cursor is already in the vault.
    if (data.maxSeq == null) this.settings.maxSeq = this.settings.cursor;
  }

  // ── Pull ──────────────────────────────────────────────────────────────

  /**
   * One sync at a time. A request that arrives mid-sync (a push, a focus) runs right after it,
   * instead of being dropped — dropping one used to leave an item waiting for the next trigger.
   * @param {boolean} verbose show a Notice when nothing arrived or it failed (triggered by hand)
   * @param {{since?: number}} opts
   */
  sync(verbose = false, opts = {}) {
    if (!this.settings.token) {
      if (verbose) new Notice(t.notPaired);
      return Promise.resolve(0);
    }
    // While sending, a push for our own item can arrive before we know its seq: hold the sync until then.
    if (this.sendDepth && !verbose && !opts.since) {
      this.heldSync = true;
      return Promise.resolve(0);
    }
    if (this.running) {
      this.pending = { verbose: verbose || !!this.pending?.verbose, opts: opts.since ? opts : (this.pending?.opts ?? {}) };
      return this.running;
    }
    this.running = (async () => {
      let total = 0;
      try {
        for (let job = { verbose, opts }; job; job = this.pending) {
          this.pending = null;
          total += await this.syncOnce(job.verbose, job.opts);
        }
      } finally {
        this.running = null;
      }
      return total;
    })();
    return this.running;
  }

  async syncOnce(verbose, { since = 0 } = {}) {
    this.setStatus('syncing');
    const ctx = { written: [] };
    try {
      for (let hasMore = true; hasMore; ) {
        const page = await this.api('GET', `/v1/pull?after=${this.settings.cursor}&limit=${PAGE}${since ? `&since=${since}` : ''}`);
        for (const item of page.items) {
          const done = await this.deliver(item, ctx);
          if (done) ctx.written.push(done);
        }
        // advance the cursor only after writing — a duplicate beats a lost item
        this.settings.cursor = page.next_after;
        await this.save();
        hasMore = page.has_more;
      }
      this.error = null;
      this.syncFails = 0;
      window.clearTimeout(this.syncRetryTimer);
      this.setStatus(this.liveState());
      if (ctx.written.length) this.announce(ctx.written);
      else if (verbose) new Notice(t.nothingNew);
      // Syncing by hand is also when real-time gets another try — e.g. right after upgrading.
      if (verbose && this.noRealtime) { this.noRealtime = false; this.connect(); }
    } catch (err) {
      console.error('[dropit] sync', err);
      this.error = err.message;
      this.setStatus('error');
      // Don't sit on "⚠" until a push, a focus or a click: try again by itself, backing off
      this.syncFails = (this.syncFails ?? 0) + 1;
      window.clearTimeout(this.syncRetryTimer);
      if (!this.unloaded) this.syncRetryTimer = window.setTimeout(() => this.sync(false), SYNC_RETRY_MS[Math.min(this.syncFails, SYNC_RETRY_MS.length) - 1]);
      if (verbose) new Notice(`dropit: ${err.message}`);
    }
    return ctx.written.length;
  }

  /** One Notice per sync, however many arrived; clicking it opens the last note. */
  announce(written) {
    const last = written[written.length - 1].note;
    const notice = new Notice(createFragment((f) => {
      f.createDiv({ text: t.received(written.length) });
      f.createDiv({ text: t.openNote(basename(last)), cls: 'dropit-notice-link' });
    }), 6_000);
    (notice.messageEl ?? notice.noticeEl)?.addEventListener('click', () => this.app.workspace.openLinkText(last, '', false));
  }

  /**
   * Write one item, then hand it to the user's command. Items of one batch (sent together) share a
   * destination: the first creates it, the rest join it — whether they arrive in the same pull or later.
   * @returns the payload when written, null when it was already in the vault
   */
  async deliver(item, ctx) {
    const { seq } = item;
    // Sent from this vault: it's already here. The server says which device sent each item; the list of
    // seqs we sent is the fallback for a server that doesn't, and only covers items not seen yet.
    const own = this.settings.sent.indexOf(seq);
    if (own !== -1) this.settings.sent.splice(own, 1);
    if (own !== -1 || (item.device_id && item.device_id === this.settings.device_id)) {
      this.settings.maxSeq = Math.max(this.settings.maxSeq, seq);
      return null;
    }
    if (seq <= this.settings.maxSeq) {             // pulled before — this is a pull-again or a crash replay
      ctx.index ??= this.buildIndex();
      if (ctx.index.written.has(seq) || inRanges(this.settings.appended, seq)) return null;
      const where = ctx.index.missing.get(seq);
      if (where) return item.url ? this.retryMissing(item, where, ctx) : null;
    }
    const group = groupOf(item);
    let dest = group ? (this.settings.batches[group.id] ?? (ctx.index?.batches.has(group.id)
      ? { path: ctx.index.batches.get(group.id), kind: 'note' } : null)) : null;
    if (dest && !this.app.vault.getFileByPath(dest.path)) dest = null;

    dest ??= await this.startEntry(item);
    const out = await this.addMember(dest, item);
    if (group) this.settings.batches[group.id] = { ...dest, at: Date.now() };
    this.settings.maxSeq = Math.max(this.settings.maxSeq, seq);
    (out.missing ? ctx.index?.missing : ctx.index?.written)?.set(seq, dest.path);
    const payload = payloadOf(item, dest.path, out.files);
    this.hook(payload);
    return payload;
  }

  /**
   * What's already in the vault, built only when an item at or below maxSeq comes back (pulling again).
   * New notes carry `dropit_seq` in their front matter — the metadata cache has it without reading files.
   * Appended entries carry nothing in the note (a %% comment shows in live preview): they're in
   * settings.appended, checked in deliver().
   */
  buildIndex() {
    const written = new Map();
    const missing = new Map();
    const batches = new Map();
    const { vault, metadataCache } = this.app;
    for (const file of vault.getMarkdownFiles()) {
      const fm = metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      for (const s of listOf(fm.dropit_seq)) written.set(Number(s), file.path);
      for (const s of listOf(fm.dropit_missing)) missing.set(Number(s), file.path);
      if (fm.dropit_batch) batches.set(String(fm.dropit_batch), file.path);
    }
    for (const [seq, at] of Object.entries(this.settings.missingAt)) missing.set(Number(seq), at.path);
    for (const s of written.keys()) missing.delete(s);   // a later success wins
    return { written, missing, batches };
  }

  /** Create where this item (and the rest of its batch) goes. @returns {{path, kind: 'note'|'append'}} */
  async startEntry(item) {
    const { vault } = this.app;
    if (this.settings.mode === 'append' || this.settings.mode === 'daily') {
      const path = this.settings.mode === 'daily' ? await this.dailyNote() : await this.appendNote();
      const file = vault.getFileByPath(path);
      await vault.process(file, (s) => joinBlock(s, [entryHeading(item)], '\n\n'));
      return { path, kind: 'append' };
    }
    const folder = normalizePath(this.settings.folder || '/');
    await this.ensureFolder(folder);
    const base = noteTitle(item);
    let path = normalizePath(`${folder}/${base}.md`);
    for (let n = 2; vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} ${n}.md`);
    const group = groupOf(item);
    await vault.create(path, [
      '---',
      `kind: ${group ? 'batch' : item.kind}`,
      `source: ${yamlString(item.source)}`,
      `created: ${new Date(item.created_at).toISOString()}`,
      ...(group ? [`dropit_batch: ${group.id}`] : []),
      '---',
      '',
    ].join('\n'));
    return { path, kind: 'note' };
  }

  /**
   * Add one item's content to its destination.
   * A file that fails to download **never blocks the queue**: a one-line warning takes its place, and
   * pulling again later swaps the warning for the file. Blocking would let one undownloadable file hold
   * back everything after it, invisibly.
   */
  async addMember(dest, item) {
    const { vault, fileManager } = this.app;
    const file = vault.getFileByPath(dest.path);
    let lines;
    let files = [];
    let missing = false;
    if (item.url) {
      try {
        const saved = await this.saveAttachment(item, dest.path);
        files = [saved.path];
        lines = [`!${fileManager.generateMarkdownLink(saved, dest.path)}`];
      } catch (err) {
        console.error('[dropit] download failed', item.seq, err);
        missing = true;
        lines = [missingLine(item, err)];
        this.settings.missingAt[item.seq] = { path: dest.path, line: lines[0] };
      }
    } else {
      lines = renderBody(item);
    }
    if (dest.kind === 'append' && !missing) addToRanges(this.settings.appended, item.seq);
    // The source line goes in even when the download failed: pulling again swaps only the warning line.
    const gap = dest.kind === 'note' ? '\n\n' : '\n';
    await vault.process(file, (s) => withSource(s, lines, gap, sourceLine(item), !!groupOf(item)));
    if (dest.kind === 'note') {
      await fileManager.processFrontMatter(file, (fm) => addSeq(fm, missing ? 'dropit_missing' : 'dropit_seq', item.seq));
    }
    return { files, missing };
  }

  /** Pulling again after a failed download: fetch it, and put it where the warning was. */
  async retryMissing(item, path, ctx) {
    const { vault, fileManager } = this.app;
    const file = vault.getFileByPath(path);
    if (!file) return null;
    let saved;
    try { saved = await this.saveAttachment(item, path); } catch (err) {
      console.error('[dropit] download failed again', item.seq, err);
      return null;
    }
    const isNote = listOf(this.app.metadataCache.getFileCache(file)?.frontmatter?.dropit_missing).map(Number).includes(item.seq);
    const embed = `!${fileManager.generateMarkdownLink(saved, path)}`;
    // Put it where the warning was; if the warning was edited away, at the end.
    const warning = this.settings.missingAt[item.seq]?.line;
    await vault.process(file, (s) => (warning && s.includes(warning) ? s.replace(warning, () => embed) : joinBlock(s, [embed], '\n\n')));
    delete this.settings.missingAt[item.seq];
    if (!isNote) addToRanges(this.settings.appended, item.seq);
    if (isNote) {
      await fileManager.processFrontMatter(file, (fm) => {
        const left = listOf(fm.dropit_missing).filter((s) => Number(s) !== item.seq);
        if (left.length) fm.dropit_missing = left; else delete fm.dropit_missing;
        addSeq(fm, 'dropit_seq', item.seq);
      });
    }
    ctx.index.missing.delete(item.seq);
    ctx.index.written.set(item.seq, path);
    const payload = payloadOf(item, path, [saved.path]);
    this.hook(payload);
    return payload;
  }

  /** Download into the vault's attachment folder (Settings → Files and links), under the file's own name. */
  async saveAttachment(item, notePath) {
    const res = await requestUrl({ url: item.url, throw: false });
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    const name = sanitize(item.meta?.filename || `dropit-${item.seq}`);
    const path = await this.app.fileManager.getAvailablePathForAttachment(name, notePath);
    await this.ensureFolder(parentOf(path));
    return this.app.vault.createBinary(path, res.arrayBuffer);
  }

  async appendNote() {
    const path = normalizePath(withMd(this.settings.appendPath || DEFAULTS.appendPath));
    if (!this.app.vault.getFileByPath(path)) {
      await this.ensureFolder(parentOf(path));
      await this.app.vault.create(path, '');
    }
    return path;
  }

  /** Daily notes core plugin's settings; its defaults when it has none. */
  async dailyOptions() {
    let opts = this.app.internalPlugins?.getPluginById?.('daily-notes')?.instance?.options;
    if (!opts) {
      try { opts = JSON.parse(await this.app.vault.adapter.read(`${this.app.vault.configDir}/daily-notes.json`)); } catch { opts = {}; }
    }
    return { folder: (opts.folder ?? '').trim(), format: (opts.format || 'YYYY-MM-DD').trim(), template: (opts.template ?? '').trim() };
  }

  /**
   * Today's daily note, created if it doesn't exist yet — from the template the Daily notes plugin uses.
   * A template written for Templater goes through Templater, or its <% %> tags would land in the note as-is.
   */
  async dailyNote() {
    const { vault } = this.app;
    const { folder, format, template } = await this.dailyOptions();
    const name = obsidian.moment().format(format);
    const path = normalizePath(`${folder ? `${folder}/` : ''}${name}.md`);
    if (vault.getFileByPath(path)) return path;
    await this.ensureFolder(parentOf(path));
    const tpl = template ? vault.getFileByPath(normalizePath(withMd(template))) : null;
    const body = tpl ? await vault.read(tpl) : '';
    const templater = this.app.plugins?.plugins?.['templater-obsidian']?.templater;
    if (tpl && /<%/.test(body) && templater?.create_new_note_from_template) {
      try {
        const made = await templater.create_new_note_from_template(tpl, vault.getFolderByPath(parentOf(path)) ?? parentOf(path), basename(path), false);
        if (made && vault.getFileByPath(path)) return path;
      } catch (err) { console.error('[dropit] templater', err); }
      if (vault.getFileByPath(path)) return path;
    }
    await vault.create(path, coreTemplate(body, name));
    return path;
  }

  async ensureFolder(path) {
    const folder = normalizePath(path || '/');
    if (folder === '/' || this.app.vault.getAbstractFileByPath(folder)) return;
    await this.app.vault.createFolder(folder).catch(() => {});   // created meanwhile — fine
  }

  // ── Hook: the user's own command, after the item is in the vault ──────

  /**
   * Delivery never depends on this: it runs after the write, in the background, once, with no retry.
   * Items are handed over one at a time, a second apart, so a script reading `received` sees its own item.
   * Anyone listening with app.workspace.on('dropit:received', payload => …) gets every one directly.
   */
  hook(payload) {
    this.recent.push(payload);
    if (this.recent.length > 20) this.recent.shift();
    const id = this.settings.hookCommand;
    this.hookQueue = this.hookQueue.then(async () => {
      if (this.unloaded) return;
      this.received = payload;
      this.app.workspace.trigger('dropit:received', payload);
      if (!id) return;
      const ran = this.app.commands?.executeCommandById?.(id);
      if (ran === false) console.warn(`[dropit] ${t.hookMissing(id)}`);
      await new Promise((r) => window.setTimeout(r, HOOK_GAP_MS));
    }).catch((err) => console.error('[dropit] hook', err));
  }

  // ── Real-time ─────────────────────────────────────────────────────────

  async connect() {
    // One attempt at a time; one stuck for 30 s (a ticket request that never answers) doesn't block the next
    if (this.socket || (this.connecting && Date.now() - this.connectingAt < 30_000)) return;
    if (!this.settings.token || this.unloaded || this.noRealtime) return;
    // "Connecting", not "disconnected": from the ticket request until the socket opens or fails
    this.connecting = true;
    this.connectingAt = Date.now();
    if (this.state === 'offline') this.setStatus('connecting');
    try {
      const { ticket, realtime_until: until } = await this.api('POST', '/v1/ws/ticket');
      this.realtimeUntil = until ?? null;             // null = paid, always on; otherwise the end of the trial
      this.ticketDay = Math.floor(Date.now() / DAY_MS);  // the trial's real-time is granted per UTC day
      if (this.unloaded || this.socket) return void this.connected(false);
      const url = new URL(this.base() + '/v1/ws');
      url.protocol = url.protocol.replace('http', 'ws');
      url.searchParams.set('ticket', ticket);

      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        this.connecting = false;
        this.retry = 0;
        this.realtimeWhy = null;
        this.lastBeat = Date.now();
        if (!this.running) this.setStatus('live');
      };
      socket.onmessage = (ev) => {
        this.lastBeat = Date.now();
        if (ev.data === 'pong') return;
        this.sync(false);
        // The last push of a day whose real-time spots ran out says so, and the server then closes the socket.
        // Read it here rather than from the close: a socket the server closes can sit in CLOSING for a long time.
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch { /* not JSON: an older server's message */ }
        if (msg?.end === 'trial_full') this.stopRealtime('trial_full');
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        this.connecting = false;
        if (!this.unloaded && (this.state === 'live' || this.state === 'connecting')) this.setStatus('offline');
        this.scheduleReconnect();
      };
      socket.onerror = () => socket.close();
    } catch (err) {
      this.connecting = false;
      // 403 WS_REQUIRES_PAID: real-time isn't available — the trial is over, or today's spots are full.
      if (err.code === 'WS_REQUIRES_PAID') return void await this.stopRealtime(err.data?.reason ?? null);
      console.error('[dropit] ws', err);
      if (this.state !== 'error') this.setStatus('offline');
      this.scheduleReconnect();
    }
  }

  /**
   * Real-time is off. trial_over: until the plan changes (a manual sync or a restart asks again).
   * trial_full: spots are counted per UTC day, so ask again a little after midnight. Either way, say so once —
   * every heartbeat used to ask again, forever — and fall back to syncing on open, focus and by hand.
   */
  async stopRealtime(why) {
    this.noRealtime = true;
    this.realtimeWhy = why;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    window.clearTimeout(this.reconnectTimer);
    this.setStatus(this.error ? 'error' : 'manual');
    if (why === 'trial_full') {
      // Spread out over ten minutes, so everyone turned away today doesn't ask in the same second.
      const wait = DAY_MS - (Date.now() % DAY_MS) + Math.random() * 600_000;
      window.clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => { this.noRealtime = false; this.connect(); }, wait);
      const day = Math.floor(Date.now() / DAY_MS);
      if (this.settings.fullNoticedDay === day) return;
      new Notice(t.trialFull, 15_000);
      this.settings.fullNoticedDay = day;
      return void await this.save();
    }
    if (this.settings.noRealtimeNoticed) return;
    new Notice(why === 'trial_over' ? t.trialOver : t.noRealtime, 15_000);
    this.settings.noRealtimeNoticed = true;
    await this.save();
  }

  /**
   * While on the trial, two things only the client can notice, both handled by asking for a fresh ticket:
   * - a new UTC day: real-time is granted per day, and a socket can stay open for days. A little after midnight
   *   (spread over ten minutes) reconnect once, or pushes stop for the rest of the day.
   * - the end of the trial by the local clock: don't conclude anything here — the user may have upgraded since.
   *   The server answers: a ticket with no end (paid), or 403 trial_over. At most once an hour, in case clocks disagree.
   * A day before the end, it warns once. Returns true when it reconnected.
   */
  checkTrial() {
    if (this.realtimeUntil == null || !this.socket) return false;
    const now = Date.now();
    const left = this.realtimeUntil - now;
    if (left > 0 && left < DAY_MS && !this.settings.trialEndingNoticed) {
      new Notice(t.trialEnding, 15_000);
      this.settings.trialEndingNoticed = true;
      this.save();
    }
    this.dayJitter ??= Math.random() * 600_000;
    const newDay = Math.floor((now - this.dayJitter) / DAY_MS) > this.ticketDay;
    const ended = left <= 0 && now - (this.lastRecheck ?? 0) > 3_600_000;
    if (!newDay && !ended) return false;
    if (ended) this.lastRecheck = now;
    const socket = this.socket;
    this.socket = null;
    socket.close();
    this.connect();
    return true;
  }

  /** "3 days left" while on the trial; null on a paid plan or before the server has said */
  trialLeft() {
    if (this.realtimeUntil == null) return null;
    const left = this.realtimeUntil - Date.now();
    return left > 0 ? t.daysLeft(left < DAY_MS ? 0 : Math.ceil(left / DAY_MS)) : null;
  }

  /** Exponential backoff, capped at 60 s */
  scheduleReconnect() {
    if (this.unloaded || this.noRealtime) return;
    const delay = BACKOFF_MS[Math.min(this.retry++, BACKOFF_MS.length - 1)];
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  heartbeat() {
    if (!this.settings.token || this.noRealtime || this.unloaded) return;
    if (this.checkTrial()) return;
    if (!this.socket) return void this.connect();
    if (this.socket.readyState !== 1) return;          // still connecting
    if (Date.now() - this.lastBeat > STALE_MS) return void this.socket.close();  // stale — reconnect
    try { this.socket.send('ping'); } catch { this.socket.close(); }
  }

  socketFresh() {
    return this.socket?.readyState === 1 && Date.now() - (this.lastBeat ?? 0) < STALE_MS;
  }

  /** The ticket arrived but there's nothing to open (unloaded, or another socket won the race) */
  connected(open) {
    this.connecting = false;
    if (!open && this.state === 'connecting') this.setStatus(this.liveState());
  }

  liveState() {
    if (this.socketFresh()) return 'live';
    if (this.connecting) return 'connecting';
    return this.noRealtime ? 'manual' : 'offline';
  }

  setStatus(state) {
    this.state = state;
    if (this.statusEl) {
      this.statusEl.setText(t.status[state]);
      const tip = t.statusTip[state];
      const left = state === 'live' && this.trialLeft();
      this.statusEl.setAttribute('aria-label', left ? t.tipLiveTrial(left)
        : state === 'manual' && this.realtimeWhy === 'trial_over' ? t.tipTrialOver
          : state === 'manual' && this.realtimeWhy === 'trial_full' ? t.tipTrialFull
            : typeof tip === 'function' ? tip(this.error ?? '') : tip);
      this.statusEl.setAttribute('data-tooltip-position', 'top');
    }
    this.tab?.onStatus?.();
  }

  openSettings() {
    this.app.setting?.open?.();
    this.app.setting?.openTabById?.(this.manifest?.id ?? 'dropit');
  }

  /**
   * Pull again: everything, the last n items, or the last n days. What's already in the vault is
   * skipped (deliver() checks), so this fills in what's missing and retries failed downloads.
   * The server only hands this device items after the point it was reset to, so the reset must succeed.
   */
  async repull(mode, n) {
    if (mode !== 'all' && !(Number.isInteger(n) && n >= 1)) throw new Error(t.repullNumber);
    const res = await this.api('POST', '/v1/cursor/reset', mode === 'last' ? { last: n } : { to_seq: 0 });
    this.settings.cursor = mode === 'last' ? (res.to_seq ?? 0) : 0;
    await this.save();
    await this.sync(true, { since: mode === 'days' ? Date.now() - n * 86_400_000 : 0 });
  }

  // ── Send ──────────────────────────────────────────────────────────────

  /** Run a send; syncs asked for meanwhile wait until the sent seqs are recorded. */
  async sending(fn) {
    this.sendDepth = (this.sendDepth ?? 0) + 1;
    try {
      return await fn();
    } finally {
      if (--this.sendDepth === 0 && this.heldSync) {
        this.heldSync = false;
        this.sync(false);
      }
    }
  }

  remember(seq) {
    if (!Number.isInteger(seq) || seq < 1 || this.settings.sent.includes(seq)) return;
    this.settings.sent.push(seq);
    if (this.settings.sent.length > SENT_KEEP) this.settings.sent.shift();
  }

  sendText(raw) {
    return this.sending(() => this.sendTextNow(raw));
  }

  async sendTextNow(raw) {
    const text = raw.trim();
    if (!text) return void new Notice(t.nothingToSend);
    if (!this.settings.token) return void new Notice(t.notPaired);
    try {
      await this.ingestText(text);
      new Notice(t.sent(1));
    } catch (err) {
      new Notice(err.code === 'DEDUPED' ? t.alreadySent : `dropit: ${err.message}`);
    }
  }

  async ingestText(text, group) {
    const res = await this.api('POST', '/v1/ingest', {
      kind: /^https?:\/\/\S+$/i.test(text) ? 'url' : 'text',
      raw: text,
      source: 'obsidian',
      client_ts: Date.now(),
      ...(group ? { meta: { group } } : {}),
    });
    this.remember(res.seq);
    await this.save();
    return res;
  }

  /**
   * A note goes as its text (readable anywhere); anything else, or a note too long for text, as a file.
   * Several at once are one batch, so the other end shows them together.
   */
  sendFiles(files) {
    return this.sending(() => this.sendFilesNow(files));
  }

  async sendFilesNow(files) {
    if (!this.settings.token) return void new Notice(t.notPaired);
    if (files.length > MAX_SEND_FILES) return void new Notice(t.tooManyFiles(MAX_SEND_FILES));
    const group = files.length > 1 ? { id: batchId(), n: files.length } : null;
    let sent = 0;
    for (const [index, file] of files.entries()) {
      const g = group ? { ...group, i: index + 1 } : undefined;
      try {
        let text = null;
        if (file.extension === 'md') {
          text = (await this.app.vault.cachedRead(file)).trim();
          if (new TextEncoder().encode(text).byteLength > TEXT_MAX_BYTES) text = null;
        }
        if (text) await this.ingestText(text, g);
        else if (text === '') throw new Error(t.nothingToSend);
        else await this.uploadFile(file, g);
        sent++;
      } catch (err) {
        if (err.code === 'DEDUPED') { sent++; continue; }
        new Notice(t.sendFailed(file.name, err.message), 8_000);
      }
    }
    if (sent) new Notice(t.sent(sent));
  }

  /** Three steps: ask for an upload link → PUT the bytes → confirm */
  async uploadFile(file, group) {
    const data = await this.app.vault.readBinary(file);
    const mime = mimeOf(file.extension);
    const start = await this.api('POST', '/v1/ingest/blob', {
      kind: mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file',
      filename: file.name, size: data.byteLength, mime, source: 'obsidian', client_ts: Date.now(),
      ...(group ? { group } : {}),
    });
    const put = await requestUrl({ url: start.upload_url, method: 'PUT', body: data, contentType: mime, throw: false });
    if (put.status >= 400) {                        // fail loudly, never pretend it worked
      const code = safeJson(put)?.error;
      throw new ApiError(t.errors[code] ?? t.httpFailed(put.status), { code, status: put.status });
    }
    this.remember(safeJson(put)?.seq);               // the item is live once the bytes are in
    const done = await this.api('POST', `/v1/ingest/blob/${start.seq}/done`);
    this.remember(done.seq);
    await this.save();
  }

  // ── First run: create an account or join with a pairing code ──────────

  async createAccount() {
    const res = await this.api('POST', '/v1/accounts', { device_name: 'Obsidian' }, false);
    await this.adopt(res);
  }

  async claimCode(code) {
    const res = await this.api('POST', '/v1/pair/claim',
      { code: code.trim().toUpperCase().replace(/[^0-9A-Z]/g, ''), device_name: 'Obsidian', scope: 'full' }, false);
    await this.adopt(res);
  }

  async adopt({ token, device_id }) {
    Object.assign(this.settings, { token, device_id, cursor: 0, maxSeq: 0, batches: {}, sent: [], appended: [], missingAt: {},
      noRealtimeNoticed: false, trialEndingNoticed: false, fullNoticedDay: null });
    Object.assign(this, { noRealtime: false, realtimeWhy: null, realtimeUntil: null });
    await this.save();
    await this.sync(true);
    this.connect();
    this.refreshEndpoints();
  }

  async unpair() {
    Object.assign(this.settings, { token: '', device_id: '', cursor: 0, maxSeq: 0, batches: {}, sent: [], appended: [], missingAt: {} });
    await this.save();
    this.socket?.close();
    this.socket = null;
    window.clearTimeout(this.reconnectTimer);
    this.setStatus('unpaired');
  }

  // ── Plumbing ──────────────────────────────────────────────────────────

  /** The addresses to try, in order. The built-in one is always last, so a stale address heals itself. */
  endpointList() {
    const list = (this.settings.endpoints ?? []).map((e) => String(e).trim().replace(/\/+$/, '')).filter(Boolean);
    return [...new Set([...list, DEFAULT_ENDPOINT])];
  }

  base() {
    return this.endpointList()[0];
  }

  /**
   * Tries each address until one answers. An address that answers with an error is still the right
   * server — only a network failure moves on to the next. The one that answers goes first next time.
   */
  async api(method, path, body, auth = true) {
    const list = this.endpointList();
    let lastErr;
    for (const base of list) {
      let res;
      // A connection dropped on the way (a flaky proxy: net::ERR_CONNECTION_CLOSED) is tried again on the same
      // address before giving up on it — but only requests that are safe to send twice
      for (let attempt = 0; !res; attempt++) {
        try {
          res = await requestUrl({
            url: base + path,
            method,
            throw: false,
            headers: auth ? { authorization: `Bearer ${this.settings.token}` } : {},
            ...(body ? { contentType: 'application/json', body: JSON.stringify(body) } : {}),
          });
        } catch (err) {
          lastErr = err;
          if (attempt >= RETRY_MS.length || !retriable(method, path)) break;
          await new Promise((r) => window.setTimeout(r, RETRY_MS[attempt]));
        }
      }
      if (!res) continue;
      if (base !== list[0]) {
        this.settings.endpoints = [base, ...list.filter((e) => e !== base && e !== DEFAULT_ENDPOINT)];
        await this.save();
      }
      const data = safeJson(res) ?? {};
      if (res.status < 400) return data;
      throw new ApiError(t.errors[data.error] ?? t.httpFailed(res.status), { code: data.error, status: res.status, data });
    }
    throw new ApiError(t.offline(lastErr?.message ?? ''));
  }

  /**
   * Learn the server's current addresses. **Merge, don't replace**: the one in use just worked,
   * and a wrong list must not drop it.
   */
  async refreshEndpoints() {
    try {
      const { endpoints } = await this.api('GET', '/v1/endpoints', null, false);
      if (Array.isArray(endpoints) && endpoints.length) {
        const current = this.base();
        this.settings.endpoints = [...new Set([current, ...endpoints.map((e) => String(e).replace(/\/+$/, ''))])];
      }
      this.settings.endpointsCheckedAt = Date.now();
      await this.save();
    } catch { /* keep the list we have */ }
  }

  save() {
    const now = Date.now();
    for (const [id, b] of Object.entries(this.settings.batches)) if (!(now - b.at < BATCH_KEEP_MS)) delete this.settings.batches[id];
    const missing = Object.keys(this.settings.missingAt).map(Number).sort((a, b) => a - b);
    for (const seq of missing.slice(0, Math.max(0, missing.length - MISSING_KEEP))) delete this.settings.missingAt[seq];
    return this.saveData(this.settings);
  }
};

// ── Rendering ───────────────────────────────────────────────────────────

/** A sorted list of [first, last] ranges: seqs mostly come in a row, so thousands stay a few pairs. */
function inRanges(ranges, n) {
  return ranges.some(([a, b]) => n >= a && n <= b);
}

function addToRanges(ranges, n) {
  if (inRanges(ranges, n)) return;
  ranges.push([n, n]);
  ranges.sort((x, y) => x[0] - y[0]);
  for (let i = ranges.length - 1; i > 0; i--) {
    if (ranges[i][0] <= ranges[i - 1][1] + 1) {
      ranges[i - 1][1] = Math.max(ranges[i - 1][1], ranges[i][1]);
      ranges.splice(i, 1);
    }
  }
}

const pad = (n) => String(n).padStart(2, '0');
const mb = (bytes, digits = 1) => (bytes / 1_048_576).toFixed(digits);
const isFile = (f) => f && typeof f.extension === 'string';
const listOf = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).filter((s) => Number.isFinite(Number(s)));
const withMd = (p) => (/\.md$/i.test(p) ? p : `${p}.md`);
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '/');
const basename = (p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '');
const safeJson = (res) => { try { return res.json; } catch { return null; } };
const yamlString = (s) => (/^[\w .@/-]*$/.test(String(s)) ? String(s) : JSON.stringify(String(s)));

function groupOf(item) {
  const g = item.meta?.group;
  return g && typeof g.id === 'string' ? g : null;
}

const batchId = () => 'b' + [...crypto.getRandomValues(new Uint8Array(9))].map((x) => x.toString(36).padStart(2, '0')).join('');

/** Characters that break a file name on some OS, or a [[link]] in Obsidian */
const sanitize = (name) => String(name).replace(/[/\\:*?"<>|#^[\]]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';

/** `09-29 15.30 the start of the text` — readable in the file list, sorted by time */
function noteTitle(item) {
  const d = new Date(item.created_at);
  const when = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  return `${when} ${sanitize(topic(item)).slice(0, 40).trim()}`.trim();
}

function topic(item) {
  if (item.meta?.title) return item.meta.title;
  if (item.url) return (item.meta?.filename ?? '').replace(/\.[^.]+$/, '') || item.kind;
  const raw = String(item.raw ?? '');
  if (item.kind === 'url' || /^https?:\/\/\S+$/i.test(raw.trim())) {
    try { const u = new URL(raw.trim()); return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`; } catch { /* as text */ }
  }
  const line = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')    // [text](link) → text
    .replace(/^[#>*\-+\s]+|[`*_~]/g, '')
    .replace(/^\d+\.\s+/, '');
}

/** Text as sent, with its source line below when it has one. */
function renderText(item) {
  const src = sourceLine(item);
  return src ? [renderBody(item).join('\n').trimEnd(), '', src] : renderBody(item);
}

/** Text as sent. A lone http(s) address with a title (the browser extension sends one) shows the title and description. */
function renderBody(item) {
  const raw = String(item.raw ?? '');
  const url = raw.trim();
  const title = linkText(item.meta?.title);
  if (!title || !/^https?:\/\/\S+$/i.test(url)) return [raw];   // by the text, not by kind
  const lines = [`[${title}](${linkTarget(url)})`];
  const desc = String(item.meta?.description ?? '').trim();
  if (desc) lines.push('', ...desc.split(/\r?\n/).map((l) => `> ${l}`.trimEnd()));
  return lines;
}

/** Link text: no brackets or line breaks; a backslash is escaped so it can't swallow the closing `]`. */
const linkText = (s) => String(s ?? '').replace(/[[\]]/g, '').replace(/\s*[\r\n]+\s*/g, ' ').trim()
  .replace(/\\/g, '\\\\');

/** Link target: wrapped in <…> when it has spaces, brackets or backslashes, which would end or bend a bare one. */
function linkTarget(url) {
  const u = url.replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return /[\s()<>\\]/.test(u) ? `<${u.replace(/[\\<>]/g, '\\$&')}>` : u;
}

/**
 * `— [Page title](https://…)`: the page a selection, image or file was sent from (the browser extension
 * adds it). No title → the site's host name. Only http(s) addresses; anything else gets no line.
 */
function sourceLine(item) {
  const url = item.meta?.from?.url;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (!host) return null;
  return `— [${linkText(item.meta.from.title) || linkText(host)}](${linkTarget(url)})`;
}

/**
 * Append lines, and the source line a blank line below them. Members of one batch sent from the same
 * page share one source line: when the note already ends with it, the new lines go above it.
 */
function withSource(s, lines, gap, src, shared) {
  if (!src) return joinBlock(s, lines, gap);
  let head = s.replace(/\s+$/, '');
  if (shared && (head === src || head.endsWith(`\n${src}`))) head = head.slice(0, -src.length);
  return `${joinBlock(head, lines, gap).replace(/\s+$/, '')}\n\n${src}\n`;
}

function missingLine(item, err) {
  return t.missing(item.meta?.filename ?? t.unnamedFile, ((item.bytes ?? 0) / 1024).toFixed(0), err.message);
}

/** The line that starts an entry in the append note or the daily note */
function entryHeading(item) {
  const d = new Date(item.created_at);
  return `**${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}** · ${item.source}`;
}

/** Append lines to a note's text, after `gap` (a blank line between blocks, a newline within one) */
function joinBlock(s, lines, gap) {
  const head = s.replace(/\s+$/, '');
  const sep = !head ? '' : /^---\n[\s\S]*\n---$/.test(head) ? '\n\n' : gap;
  return `${head}${sep}${lines.join('\n')}\n`;
}

/** One seq on its own stays a number; a second one turns it into a list. */
function addSeq(fm, key, seq) {
  const now = listOf(fm[key]).map(Number);
  if (now.includes(seq)) return;
  fm[key] = now.length ? [...now, seq] : seq;
}

/** What the user's command and `dropit:received` listeners get. Version 1 — see the README. */
function payloadOf(item, note, files) {
  const g = groupOf(item);
  const meta = {};
  for (const k of ['filename', 'mime', 'title', 'description']) if (item.meta?.[k] != null) meta[k] = item.meta[k];
  const from = item.meta?.from;
  if (from && typeof from.url === 'string') meta.from = Object.freeze({ url: from.url, ...(from.title != null ? { title: from.title } : {}) });
  // Frozen all the way down: every listener and command gets the same object, and one can't change it for the next.
  return Object.freeze({
    v: 1,
    seq: item.seq,
    kind: item.kind,
    source: item.source,
    created: new Date(item.created_at).toISOString(),
    batch: g ? Object.freeze({ id: g.id, index: g.i, count: g.n }) : null,
    text: item.url ? '' : String(item.raw ?? ''),
    meta: Object.freeze(meta),
    note,
    files: Object.freeze([...files]),
  });
}

/** The core Daily notes template variables: {{date}}, {{time}}, {{title}}, {{date:FORMAT}} */
function coreTemplate(body, title) {
  const now = obsidian.moment();
  return body
    .replace(/{{\s*(date|time)\s*:\s*([^}]+?)\s*}}/gi, (_, _k, fmt) => now.format(fmt))
    .replace(/{{\s*date\s*}}/gi, title)
    .replace(/{{\s*time\s*}}/gi, now.format('HH:mm'))
    .replace(/{{\s*title\s*}}/gi, title);
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml',
  bmp: 'image/bmp', avif: 'image/avif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', pdf: 'application/pdf',
  md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
  canvas: 'application/json', excalidraw: 'application/json',
};
const mimeOf = (ext) => MIME[String(ext).toLowerCase()] ?? 'application/octet-stream';

/** Versions and platform only: an issue is public */
function issueUrl(version) {
  const platform = Platform?.isIosApp ? 'iOS' : Platform?.isAndroidApp ? 'Android' : Platform?.isMacOS ? 'macOS'
    : Platform?.isWin ? 'Windows' : Platform?.isLinux ? 'Linux' : 'unknown';
  const env = `Plugin: ${version} · Obsidian: ${obsidian.apiVersion ?? '?'} · ${platform}`;
  return `${REPO}/issues/new?title=${encodeURIComponent(`[${version}] `)}&body=${encodeURIComponent(t.issueBody(env))}`;
}

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return t.ago.now;
  if (s < 5400) return t.ago.min(Math.round(s / 60));
  if (s < 129_600) return t.ago.hour(Math.round(s / 3600));
  return t.ago.day(Math.round(s / 86_400));
}

// ── QR code ─────────────────────────────────────────────────────────────
// A tiny encoder for the one case pairing needs: versions 1–5, error correction L, byte mode.
// That range is all single-block (no interleaving) with at most one alignment pattern; 106 bytes is
// plenty for a pairing link. Kept identical to the web inbox's encoder, which is checked bit for bit
// against an independent implementation and decoded by a real reader.

const QR = (() => {
  const VERSIONS = { 1: [19, 7], 2: [34, 10], 3: [55, 15], 4: [80, 20], 5: [108, 26] };  // [data, ecc] codewords
  const ALIGN_AT = { 2: 18, 3: 22, 4: 26, 5: 30 };
  const ECC_L = 0b01;
  const PAD = [0xEC, 0x11];

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function generator(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(poly.length + 1).fill(0);
      // multiply by (x + α^i): coefficients are highest power first, so "times x" stays in place
      poly.forEach((c, j) => {
        next[j] ^= c;
        next[j + 1] ^= mul(c, EXP[i]);
      });
      poly = next;
    }
    return poly;
  }

  function ecc(data, n) {
    const gen = generator(n);
    const out = new Array(n).fill(0);
    for (const byte of data) {
      const factor = byte ^ out[0];
      out.shift();
      out.push(0);
      if (factor) gen.slice(1).forEach((g, i) => { out[i] ^= mul(g, factor); });
    }
    return out;
  }

  function encode(text) {
    const bytes = new TextEncoder().encode(text);
    const version = Object.keys(VERSIONS).map(Number).find((v) => bytes.length + 2 <= VERSIONS[v][0]);
    if (!version) throw new Error(`too long for a QR code here (${bytes.length} bytes, 106 at most)`);
    const [dataLen, eccLen] = VERSIONS[version];
    const bits = [];
    const push = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1); };
    push(0b0100, 4);                                   // byte mode
    push(bytes.length, 8);                             // 8-bit count for versions 1–9
    bytes.forEach((b) => push(b, 8));
    push(0, Math.min(4, dataLen * 8 - bits.length));   // terminator
    while (bits.length % 8) bits.push(0);
    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
    for (let i = 0; codewords.length < dataLen; i++) codewords.push(PAD[i % 2]);   // padding always starts at 0xEC
    return { version, codewords: codewords.concat(ecc(codewords, eccLen)) };
  }

  const FINDER = [
    [1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1], [1, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1],
  ];

  function skeleton(version) {
    const size = 17 + version * 4;
    const m = Array.from({ length: size }, () => new Array(size).fill(null));
    const put = (r, c, v) => { if (r >= 0 && c >= 0 && r < size && c < size) m[r][c] = v; };
    for (const [br, bc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      FINDER.forEach((row, r) => row.forEach((v, c) => put(br + r, bc + c, v)));
      for (let i = -1; i <= 7; i++) { put(br + i, bc - 1, 0); put(br + i, bc + 7, 0); }
      for (let i = -1; i <= 7; i++) { put(br - 1, bc + i, 0); put(br + 7, bc + i, 0); }
    }
    for (let i = 8; i < size - 8; i++) {               // timing patterns
      const v = i % 2 === 0 ? 1 : 0;
      m[6][i] = v;
      m[i][6] = v;
    }
    m[size - 8][8] = 1;                                // the fixed dark module
    const a = ALIGN_AT[version];
    if (a) {
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) m[a + r][a + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1 ? 1 : 0;
      }
    }
    return m;
  }

  function formatCells(size) {
    const cells = [];
    for (let i = 0; i <= 5; i++) cells.push([8, i], [i, 8]);
    cells.push([8, 7], [8, 8], [7, 8]);
    for (let i = 0; i < 8; i++) cells.push([8, size - 1 - i]);
    for (let i = 0; i < 7; i++) cells.push([size - 1 - i, 8]);
    return cells;
  }

  function placeData(m, codewords) {
    const size = m.length;
    const bits = [];
    codewords.forEach((b) => { for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1); });
    let idx = 0;
    let upward = true;
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;                      // skip the vertical timing column
      for (let step = 0; step < size; step++) {
        const row = upward ? size - 1 - step : step;
        for (const col of [right, right - 1]) {
          if (m[row][col] === null) m[row][col] = bits[idx++] ?? 0;
        }
      }
      upward = !upward;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function formatBits(mask) {                          // BCH(15,5), then XOR 0x5412
    const data = (ECC_L << 3) | mask;
    let rem = data << 10;
    for (let i = 4; i >= 0; i--) if ((rem >> (i + 10)) & 1) rem ^= 0x537 << i;
    return ((data << 10) | rem) ^ 0x5412;
  }

  function applyFormat(m, mask) {
    const size = m.length;
    const bits = formatBits(mask);
    const at = (i) => (bits >> i) & 1;
    for (let i = 0; i <= 5; i++) m[i][8] = at(i);
    m[7][8] = at(6);
    m[8][8] = at(7);
    m[8][7] = at(8);
    for (let i = 9; i <= 14; i++) m[8][14 - i] = at(i);
    for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = at(i);
    for (let i = 8; i <= 14; i++) m[size - 15 + i][8] = at(i);
  }

  function penalty(m) {
    const size = m.length;
    let score = 0;
    const runs = (get) => {
      for (let a = 0; a < size; a++) {
        let run = 1;
        for (let b = 1; b < size; b++) {
          if (get(a, b) === get(a, b - 1)) run++;
          else { if (run >= 5) score += run - 2; run = 1; }
        }
        if (run >= 5) score += run - 2;
      }
    };
    runs((r, c) => m[r][c]);
    runs((c, r) => m[r][c]);
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    const BAD = [[1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]];
    const hit = (pat, get, a, b) => pat.every((v, i) => get(a, b + i) === v);
    for (const pat of BAD) {
      for (let a = 0; a < size; a++) {
        for (let b = 0; b + 10 < size; b++) {
          if (hit(pat, (x, y) => m[x][y], a, b)) score += 40;
          if (hit(pat, (x, y) => m[y][x], a, b)) score += 40;
        }
      }
    }
    const dark = m.flat().filter((v) => v).length;
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  }

  /** @returns {number[][]} 0/1, 1 = dark */
  function matrix(text, opts = {}) {
    const { version, codewords } = encode(text);
    const base = skeleton(version);
    formatCells(base.length).forEach(([r, c]) => { base[r][c] = base[r][c] ?? 0; });
    const reserved = base.map((row) => row.map((v) => v !== null));
    placeData(base, codewords);
    let best = null;
    const masks = opts.mask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [opts.mask];
    for (const mask of masks) {
      const candidate = base.map((row, r) => row.map((v, c) => (!reserved[r][c] && MASKS[mask](r, c) ? v ^ 1 : v)));
      applyFormat(candidate, mask);
      const score = penalty(candidate);
      if (!best || score < best.score) best = { score, matrix: candidate };
    }
    return best.matrix;
  }

  /** Draw into `parent` as SVG elements (no HTML strings). The 4-module quiet zone is required to scan. */
  function draw(parent, text, { scale = 5, quiet = 4 } = {}) {
    const m = matrix(text);
    const size = m.length + quiet * 2;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ width: size * scale, height: size * scale, viewBox: `0 0 ${size} ${size}`, 'shape-rendering': 'crispEdges' })) svg.setAttribute(k, String(v));
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', String(size));
    bg.setAttribute('height', String(size));
    bg.setAttribute('fill', '#fff');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', m.flatMap((row, r) => row.map((v, c) => (v ? `M${c + quiet} ${r + quiet}h1v1h-1z` : ''))).join(''));
    path.setAttribute('fill', '#000');
    svg.append(bg, path);
    parent.appendChild(svg);
    return svg;
  }

  return { matrix, draw };
})();

// ── Settings ────────────────────────────────────────────────────────────

class DropitSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    this.containerEl.empty();
    window.clearInterval(this.pairTimer);
    this.plugin.settings.token ? this.paired() : this.setup();
    this.feedback();
    this.advanced();
  }

  /** The source, and a new issue with the versions filled in — never anything from this account */
  feedback() {
    const version = this.plugin.manifest?.version ?? '';
    new Setting(this.containerEl)
      .setName(t.feedback)
      .setDesc(t.feedbackDesc)
      .addButton((b) => b.setButtonText(t.reportIssue).onClick(() => window.open(issueUrl(version))))
      .addButton((b) => b.setButtonText(t.sourceCode).onClick(() => window.open(REPO)));
  }

  hide() {
    window.clearInterval(this.pairTimer);
    window.clearTimeout(this.accountTimer);
    this.stateSetting = null;
  }

  /**
   * The account line under the connection state. A failed read (the network not up yet right after
   * Obsidian starts) used to stay on screen under "● Receiving in real time" until the tab was reopened:
   * now it tries again — sooner when the connection comes back, else after 3 s, 10 s, 30 s.
   */
  loadAccount() {
    const row = this.stateSetting;
    if (!row || this.accountBusy) return;
    window.clearTimeout(this.accountTimer);
    this.accountBusy = true;
    const p = this.plugin;
    // Block bodies, never `=> setting.setX()`: Obsidian's Setting has a then(), so returning one from a
    // promise callback makes the promise adopt it — then() hands itself back, forever, and the window hangs.
    p.api('GET', '/v1/me').then((m) => {
      this.accountBusy = false;
      this.accountFailed = false;
      if (this.stateSetting !== row) return;
      row.setDesc(t.account(m));
      if ('realtime_until' in m) { p.realtimeUntil = m.realtime_until; this.onStatus(); }   // the countdown, fresh
    }, (err) => {
      this.accountBusy = false;
      this.accountFailed = true;
      if (this.stateSetting !== row) return;
      row.setDesc(t.accountRetry(err.message));
      const wait = [3_000, 10_000, 30_000][Math.min(this.accountTries++, 2)];
      this.accountTimer = window.setTimeout(() => this.loadAccount(), wait);
    });
  }

  /** Called when the connection state changes, so the top line stays true while the tab is open. */
  onStatus() {
    if (!this.stateSetting) return;
    const p = this.plugin;
    const live = p.state === 'live' || (p.state === 'syncing' && p.socketFresh());
    const connecting = !live && (p.state === 'connecting' || (p.state === 'syncing' && p.connecting));
    const left = live && p.trialLeft();
    // Back online after the account line failed: read it now instead of waiting for the timer
    if (live && this.accountFailed) this.loadAccount();
    this.stateSetting.setName(p.state === 'error' ? t.stateError(p.error ?? '')
      : live ? (left ? t.stateLiveTrial(left) : t.stateLive)
        : connecting ? t.stateConnecting
        : !p.noRealtime ? t.stateOffline
          : p.realtimeWhy === 'trial_over' ? t.stateTrialOver
            : p.realtimeWhy === 'trial_full' ? t.stateTrialFull : t.stateManual);
  }

  /**
   * Asked once; never shown again after pairing. Joining comes first and is the call to action:
   * creating an account by mistake splits someone's items across two accounts.
   */
  setup() {
    const { containerEl } = this;
    new Setting(containerEl).setName(t.setupHeading).setHeading();
    let code = '';
    new Setting(containerEl)
      .setName(t.haveCode)
      .setDesc(t.haveCodeDesc)
      .addText((x) => x.setPlaceholder('K7M2QX').onChange((v) => { code = v; }))
      .addButton((b) => b.setButtonText(t.join).setCta().onClick(() => this.run(() => this.plugin.claimCode(code))));
    new Setting(containerEl)
      .setName(t.create)
      .setDesc(t.createDesc)
      .addButton((b) => b.setButtonText(t.createButton).onClick(() => this.run(() => this.plugin.createAccount())));
  }

  paired() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;

    // Connection and account, first: the answer to "is it working?"
    this.stateSetting = new Setting(containerEl)
      .setDesc(t.accountLoading)
      .addButton((b) => b.setButtonText(t.syncNow).onClick(() => this.run(() => p.sync(true))));
    this.onStatus();
    this.accountTries = 0;
    this.loadAccount();

    new Setting(containerEl).setName(t.receiveHeading).setHeading();
    const modeRow = new Setting(containerEl)
      .setName(t.mode)
      .setDesc(s.mode === 'daily' ? '' : t.modeDesc[s.mode] ?? '')
      .addDropdown((d) => d.addOptions(t.modes).setValue(s.mode).onChange(async (v) => {
        s.mode = v;
        await p.save();
        this.display();
      }));
    if (s.mode === 'daily') p.dailyOptions().then(({ folder, format }) => { modeRow.setDesc(t.modeDesc.daily(folder, format)); });
    if (s.mode === 'note') this.text(t.folder, t.folderDesc, 'folder', 'Inbox');
    if (s.mode === 'append') this.text(t.appendPath, t.appendPathDesc, 'appendPath', DEFAULTS.appendPath);

    const commandName = (id) => (id ? p.app.commands?.findCommand?.(id)?.name ?? t.hookMissing(id) : t.hookNone);
    new Setting(containerEl)
      .setName(t.hook)
      .setDesc(createFragment((f) => {
        f.createEl('strong', { text: commandName(s.hookCommand) });
        f.createEl('br');
        f.appendText(t.hookDesc);
      }))
      .addButton((b) => b.setButtonText(t.hookPick).onClick(() => new CommandPicker(p.app, async (cmd) => {
        s.hookCommand = cmd.id;
        await p.save();
        this.display();
      }).open()))
      .addExtraButton((b) => b.setIcon('x').setTooltip(t.hookClear).setDisabled(!s.hookCommand).onClick(async () => {
        s.hookCommand = '';
        await p.save();
        this.display();
      }));

    let mode = 'all';
    let n = '';
    let number;
    new Setting(containerEl)
      .setName(t.repull)
      .setDesc(t.repullDesc(s.cursor))
      .addDropdown((d) => d.addOptions({ all: t.repullAll, last: t.repullLast, days: t.repullDays }).onChange((v) => {
        mode = v;
        number.inputEl.toggle(v !== 'all');
        if (!n) { n = v === 'days' ? '7' : '20'; number.setValue(n); }
      }))
      .addText((x) => {
        number = x;
        x.inputEl.type = 'number';
        x.inputEl.min = '1';
        x.inputEl.addClass('dropit-number');
        x.inputEl.toggle(false);
        x.onChange((v) => { n = v; });
      })
      .addButton((b) => b.setButtonText(t.repullGo).onClick(() => this.run(() => p.repull(mode, Number(n)))));

    new Setting(containerEl).setName(t.devicesHeading).setHeading();
    const add = new Setting(containerEl)
      .setName(t.addDevice)
      .setDesc(t.addDeviceDesc)
      .addButton((b) => b.setButtonText(t.generate).setCta().onClick(() => this.run(() => this.showCode(pairBox), false)));
    const pairBox = containerEl.createDiv({ cls: 'dropit-pair' });
    pairBox.toggle(false);
    add.settingEl.after(pairBox);
    this.devicesEl = containerEl.createDiv();
    this.devices();
  }

  /** The code big, the QR next to it, a countdown, and a quiet check for the new device joining */
  async showCode(box) {
    const p = this.plugin;
    const [{ code, expires_at }, before] = await Promise.all([
      p.api('POST', '/v1/pair'),
      p.api('GET', '/v1/me').then((m) => m.devices_used).catch(() => null),
    ]);
    navigator.clipboard?.writeText(code).catch(() => {});
    box.empty();
    box.toggle(true);
    QR.draw(box.createDiv({ cls: 'dropit-qr' }), `${p.base()}/?pair=${code}`, { scale: 4 });
    const side = box.createDiv();
    side.createDiv({ cls: 'dropit-code', text: code });      // exactly what to type: no dash to skip over
    const hint = side.createDiv({ cls: 'setting-item-description' });
    let ticks = 0;
    const tick = async () => {
      const left = expires_at - Date.now();
      if (left <= 0) { hint.setText(t.codeExpired); return void window.clearInterval(this.pairTimer); }
      hint.setText(t.codeValid(Math.max(1, Math.ceil(left / 60_000))));
      if (before == null || ++ticks % 4) return;       // every 4 s
      const m = await p.api('GET', '/v1/me').catch(() => null);
      if (m && m.devices_used > before) {
        window.clearInterval(this.pairTimer);
        new Notice(t.deviceJoined);
        this.display();
      }
    };
    window.clearInterval(this.pairTimer);
    this.pairTimer = window.setInterval(tick, 1_000);
    p.registerInterval(this.pairTimer);
    tick();
  }

  async devices() {
    const el = this.devicesEl;
    const p = this.plugin;
    let list = [];
    try { ({ devices: list } = await p.api('GET', '/v1/devices')); } catch (err) {
      return void el.createDiv({ cls: 'setting-item-description', text: err.message });
    }
    el.empty();
    for (const d of list) {
      const self = d.device_id === p.settings.device_id;
      const bits = [self ? t.thisDevice : d.last_seen_at ? t.lastSeen(ago(d.last_seen_at)) : '', d.scope === 'ingest_only' ? t.scopeSendOnly : '']
        .filter(Boolean);
      const row = new Setting(el).setName(d.name).setDesc(bits.join(' · '));
      if (!self) {
        row.addButton((b) => b.setButtonText(t.remove).onClick(() => new Confirm(p.app, t.removeConfirm(d.name), t.removeYes, () => this.run(async () => {
          await p.api('DELETE', `/v1/devices/${encodeURIComponent(d.device_id)}`);
        })).open()));
      }
    }
  }

  /** Server address and unpairing: needed rarely, so folded away */
  advanced() {
    const p = this.plugin;
    const details = this.containerEl.createEl('details', { cls: 'dropit-advanced' });
    details.createEl('summary', { text: t.advanced });
    new Setting(details)
      .setName(t.serverAddress)
      .setDesc(t.serverAddressDesc)
      .addText((x) => x.setPlaceholder(DEFAULT_ENDPOINT).setValue(p.base()).onChange(async (v) => {
        const value = v.trim().replace(/\/+$/, '');
        p.settings.endpoints = value ? [value] : [DEFAULT_ENDPOINT];
        await p.save();
      }));
    if (p.settings.token) {
      new Setting(details)
        .setName(t.unpair)
        .setDesc(t.unpairDesc)
        .addButton((b) => b.setButtonText(t.unpairButton).setWarning().onClick(() => this.run(() => p.unpair())));
    }
  }

  text(name, desc, key, placeholder) {
    new Setting(this.containerEl).setName(name).setDesc(desc).addText((x) =>
      x.setPlaceholder(placeholder).setValue(String(this.plugin.settings[key] ?? '')).onChange(async (v) => {
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

/** Pick any Obsidian command — a QuickAdd macro, a Templater script, another plugin's action */
class CommandPicker extends FuzzySuggestModal {
  constructor(app, onPick) {
    super(app);
    this.onPick = onPick;
    this.setPlaceholder(t.hookPlaceholder);
  }

  getItems() {
    return Object.values(this.app.commands?.commands ?? {}).filter((c) => !c.id.startsWith('dropit:'));
  }

  getItemText(cmd) {
    return cmd.name;
  }

  onChooseItem(cmd) {
    this.onPick(cmd);
  }
}

class Confirm extends Modal {
  constructor(app, message, yes, onYes) {
    super(app);
    Object.assign(this, { message, yes, onYes });
  }

  onOpen() {
    this.contentEl.createEl('p', { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t.cancel).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.yes).setWarning().onClick(() => { this.close(); this.onYes(); }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = DropitPlugin;
// for tests
Object.assign(module.exports, { STRINGS, QR, noteTitle, renderText, sourceLine, withSource, payloadOf, joinBlock, addSeq, coreTemplate, inRanges, addToRanges, issueUrl });
