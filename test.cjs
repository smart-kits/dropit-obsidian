/**
 * Tests for the plugin, run against the real main.js.
 *
 * The plugin has no build step, so neither do the tests: `obsidian`, the vault and the server are
 * stubbed. Just `node test.cjs`.
 */
process.env.TZ = 'UTC';                        // note titles carry the local time
const Module = require('node:module');
const orig = Module._load;
let language;                                  // what the stubbed getLanguage() reports
const notices = [];                            // every Notice the plugin shows
let lastNotice = null;                         // the last one, whole: its fragment (text, links) and how long it stays
const timers = [];                             // every timeout the plugin schedules
console.error = () => {};                      // the plugin logs expected failures; keep the output readable
let net = async () => { throw new Error('no network in this test'); };

/** Just enough of Obsidian's HTMLElement helpers for the plugin's status bar and notices */
const el = () => ({
  setText() {}, addClass() {}, setAttribute() {}, addEventListener() {}, createDiv: () => el(), createEl: () => el(),
  appendText() {}, empty() {}, toggle() {},
});
globalThis.createFragment = (fn) => { const f = el(); f.text = []; f.links = []; f.createDiv = ({ text }) => { f.text.push(text); return el(); }; f.createEl = (tag, o) => { f.links.push(o); return el(); }; fn?.(f); return f; };
globalThis.window = {
  setTimeout: (fn, ms) => { timers.push(ms); setImmediate(fn); return 0; },
  clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
};
globalThis.document = { visibilityState: 'visible' };
/** An element or component that accepts any call: the settings page only needs to run, not to draw */
const anything = () => new Proxy(function () {}, {
  get: (target, key) => (key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : (target[key] ??= anything())),
  apply: (target, self) => self ?? target,
  set: (target, key, v) => { target[key] = v; return true; },
});
let thenCalls = 0;
const ui = { names: [], buttons: [], toggles: [], dropdowns: [], opened: [], checks: [], links: [], sliders: [] };    // what the settings page and its modals drew, and what can be clicked
/** A button or toggle that remembers its handler, so a test can press it */
const control = (rec) => {
  const c = anything();
  c.setButtonText = (text) => { rec.text = text; return c; };
  c.onClick = (fn) => { rec.click = fn; return c; };
  c.setValue = (v) => { rec.value = v; return c; };
  c.onChange = (fn) => { rec.change = fn; return c; };
  c.addOptions = (o) => { rec.options = o; return c; };
  return c;
};
/** Like Obsidian's: chainable, with a then(cb) that calls back with itself — which makes every Setting a thenable */
class Setting {
  constructor() {
    this.settingEl = anything();
    this.settingEl.addEventListener = (ev, fn) => { (this.listeners ??= {})[ev] = fn; };
    // Obsidian's controlEl: a row can put its own element in it (a checkbox, a link); the page's handlers are kept so a test can fire them
    const make = (tag, o = {}) => {
      const rec = { name: this.name, tag, ...o, checked: false, shown: true, on: {}, addEventListener(ev, fn) { rec.on[ev] = fn; }, setAttribute() {}, toggle(v) { rec.shown = v; }, setText() {} };
      (tag === 'input' ? ui.checks : ui.links).push(rec);
      return rec;
    };
    this.controlEl = { createEl: make, createSpan: () => ({ createEl: make }), createDiv: (o = {}) => {
      const cell = { cls: o.cls, labels: [], on: {}, createSpan: (x = {}) => { const l = { cls: x.cls, text: '', setText(v) { l.text = v; } }; cell.labels.push(l); return l; }, addEventListener(ev, fn) { cell.on[ev] = fn; }, append() {} };
      (this.cells ??= []).push(cell);
      return cell;
    } };
  }
  setName(n) { this.name = n; ui.names.push(n); return this; }
  setDesc(d) { this.desc = d; return this; }
  setHeading() { return this; }
  addButton(cb) { const rec = { name: this.name }; ui.buttons.push(rec); cb(control(rec)); return this; }
  addExtraButton(cb) { cb(anything()); return this; }
  addDropdown(cb) { const rec = { name: this.name }; ui.dropdowns.push(rec); cb(control(rec)); return this; }
  addText(cb) { cb(anything()); return this; }
  addTextArea(cb) { cb(anything()); return this; }
  addSlider(cb) {
    const rec = { row: this, min: null, max: null, step: null, value: null, tooltip: false };
    const c = { sliderEl: { setAttribute(k, v) { (rec.attrs ??= {})[k] = v; } }, setLimits(a, b, st) { Object.assign(rec, { min: a, max: b, step: st }); return c; }, setValue(v) { rec.value = v; return c; },
      setDynamicTooltip() { rec.tooltip = true; return c; }, onChange(fn) { rec.change = (v) => { rec.value = v; fn(v); }; return c; } };
    ui.sliders.push(rec);
    cb(c);
    return this;
  }
  addToggle(cb) { const rec = { name: this.name }; ui.toggles.push(rec); cb(control(rec)); return this; }
  then(cb) { if (++thenCalls < 1000) cb(this); return this; }   // past 1000, stop the loop so the test can say so
}
/** Which Node modules main.js asked for: none may be asked for just by loading it, and none at all on a phone */
const nodeLoads = [];
const platform = { isDesktopApp: true };
const fakeMoment = () => ({ format: (f) => ({ 'YYYY-MM-DD': '2026-09-29', 'HH:mm': '10:30', 'dddd': 'Tuesday' }[f] ?? f) });

Module._load = (req, ...rest) => (req !== 'obsidian' && /obsidian-plugin\/main\.js$/.test(rest[0]?.filename ?? '') && nodeLoads.push(req), req === 'obsidian'
  ? {
      Plugin: class {
        constructor(app) { this.app = app; this.commands = []; this.manifest = { id: 'dropit' }; }
        addCommand(c) { this.commands.push(c); }
        addRibbonIcon() {} addSettingTab() {} addStatusBarItem() { return el(); }
        registerDomEvent() {} registerEvent() {} registerInterval() {} register(fn) { (this.cleanups ??= []).push(fn); }
        async loadData() { return this.stored; }
        async saveData(d) { this.stored = JSON.parse(JSON.stringify(d)); }
      },
      PluginSettingTab: class { constructor(a, p) { this.plugin = p; } },
      Modal: class { constructor(app) { this.app = app; this.contentEl = anything(); } open() { ui.opened.push(this); this.onOpen?.(); } close() { this.onClose?.(); } },
      FuzzySuggestModal: class { constructor(app) { this.app = app; } setPlaceholder() {} open() { ui.opened.push(this); } },
      Platform: platform, Setting,
      Notice: class { constructor(m, ms) { notices.push(typeof m === 'string' ? m : m.text.join(' ')); lastNotice = { m, ms }; } },
      normalizePath: (p) => p.replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || '/',
      requestUrl: (req) => net(req),
      addIcon: () => {},
      moment: fakeMoment,
      getLanguage: () => language,
    }
  : orig(req, ...rest));

/** Load a fresh copy of main.js as if Obsidian's language were `lang`. */
function loadPlugin(lang) {
  language = lang;
  delete require.cache[require.resolve('./main.js')];
  return require('./main.js');
}

let DropitPlugin = loadPlugin('en');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ok  ' : 'FAIL  '}${n}${c ? '' : ' → ' + e}`); };
const settle = () => new Promise((r) => setImmediate(r));

// ── A vault that keeps front matter the way Obsidian's metadata cache reports it ──

function makeVault() {
  const files = new Map();                     // path → string | Buffer
  const fm = new Map();                        // path → front matter object
  const file = (path) => ({ path, name: path.split('/').pop(), extension: path.split('.').pop() });
  const parseFm = (path, s) => {
    const m = /^---\n([\s\S]*?)\n---/.exec(s);
    if (!m) return;
    const o = {};
    // Like YAML: a number reads as a number, a double-quoted value as the string inside
    const value = (v) => (/^-?\d+$/.test(v) ? Number(v) : v.startsWith('"') ? JSON.parse(v) : v);
    for (const line of m[1].split('\n')) { const [k, ...v] = line.split(': '); o[k] = value(v.join(': ')); }
    fm.set(path, o);
  };
  const vault = {
    configDir: '.obsidian',
    adapter: { read: async () => { throw new Error('none'); }, readBinary: async (p) => { const f = files.get(p); return Uint8Array.from(f).buffer; }, stat: async (p) => (files.has(p) ? { size: files.get(p).length } : null) },
    getFileByPath: (p) => (files.has(p) ? file(p) : null),
    getAbstractFileByPath: (p) => (files.has(p) ? file(p) : null),
    getFolderByPath: () => null,
    createFolder: async () => {},
    getMarkdownFiles: () => [...files.keys()].filter((p) => p.endsWith('.md')).map(file),
    create: async (p, s) => { if (files.has(p)) throw new Error('exists'); files.set(p, s); parseFm(p, s); return file(p); },
    createBinary: async (p, buf) => { files.set(p, Buffer.from(buf)); return file(p); },
    process: async (f, fn) => { files.set(f.path, fn(files.get(f.path))); },
    read: async (f) => files.get(f.path),
    cachedRead: async (f) => files.get(f.path),
    readBinary: async (f) => files.get(f.path),
  };
  const fileManager = {
    processFrontMatter: async (f, fn) => { const o = fm.get(f.path) ?? {}; fn(o); fm.set(f.path, o); },
    generateMarkdownLink: (f) => `[[${f.name}]]`,
    // Obsidian's "same folder as the note" setting, which is what "./" means
    getAvailablePathForAttachment: async (name, src) => {
      const dir = src.includes('/') ? src.slice(0, src.lastIndexOf('/') + 1) : '';
      let p = `${dir}${name}`;
      for (let n = 1; files.has(p); n++) p = `${dir}${name.replace(/(\.[^.]+)?$/, ` ${n}$1`)}`;
      return p;
    },
  };
  const metadataCache = { getFileCache: (f) => (fm.has(f.path) ? { frontmatter: fm.get(f.path) } : null) };
  return { files, fm, vault, fileManager, metadataCache };
}

/** A plugin that went through the real onload(), with its settings, a fresh vault, and a stub server. */
async function makePlugin(settings = {}, stored, local = {}) {
  const v = makeVault();
  const events = [];
  const ran = [];
  const app = {
    vault: v.vault, fileManager: v.fileManager, metadataCache: v.metadataCache,
    workspace: { onLayoutReady() {}, on: () => ({}), trigger: (name, payload) => events.push({ name, payload }), getActiveFile: () => null },
    commands: { executeCommandById: (id) => { ran.push({ id, received: p.received }); return true; } },
    ...local,
  };
  const p = new DropitPlugin(app);
  p.stored = stored ?? { token: 'dk_x', ...settings };
  // Looking for agents asks the person's own shell: tests never do, and never find a real agent
  p.detect = async () => [{ id: 'claude', label: 'Claude Code', path: null, verified: 'Claude Code 2.1.301', modes: ['think', 'files', 'web'] },
    { id: 'codex', label: 'Codex CLI', path: null, verified: null, modes: [] }];
  await p.onload();
  return { p, ...v, events, ran };
}

/** Route stub requests: `routes` maps "METHOD /path-prefix" to a handler returning {status?, json?, bytes?} */
function serve(routes) {
  const calls = [];
  net = async (req) => {
    const method = req.method ?? 'GET';
    const { pathname, search, host } = new URL(req.url);
    calls.push({ method, path: pathname + search, host, auth: req.headers?.authorization, body: req.body, contentType: req.contentType });
    const key = Object.keys(routes).find((k) => { const [m, p] = k.split(' '); return m === method && (pathname + search).startsWith(p); });
    if (!key) return { status: 404, json: { error: 'NOT_FOUND' } };
    const out = await routes[key](req.body && typeof req.body === 'string' ? JSON.parse(req.body) : req.body, pathname + search, host);
    if (out instanceof Error) throw out;
    return { status: out.status ?? 200, json: out.json ?? {}, arrayBuffer: out.bytes };
  };
  return calls;
}

/** A pull endpoint that hands out `items` once, then nothing */
function pages(...batches) {
  return () => {
    const items = batches.shift() ?? [];
    return { json: { items, has_more: false, next_after: items.length ? items[items.length - 1].seq : 0 } };
  };
}

const AT = Date.parse('2026-09-17T08:00:00Z');
const text = (seq, raw, extra = {}) => ({ seq, kind: 'text', source: 'cli', raw, created_at: AT, bytes: raw.length, meta: null, ...extra });
const blob = (seq, filename, extra = {}) => ({ seq, kind: 'image', source: 'web', raw: '', url: `https://files.example/${seq}`, bytes: 2048,
  created_at: AT, meta: { filename, mime: 'image/png' }, ...extra });
const PNG = Buffer.from([137, 80, 78, 71]);
const PNG_BYTES = () => Uint8Array.from(PNG).buffer;   // its own ArrayBuffer: a small Buffer shares Node's 8 KB pool

(async () => {
  console.log('── A text item becomes a note named after its start ──');
  {
    const { p, files, fm } = await makePlugin();
    serve({ 'GET /v1/pull': pages([text(7, '# 下午开会要用的资料\n第二行')]) });
    await p.sync(false);
    const path = 'Inbox/09-17 08.00 下午开会要用的资料.md';
    ok('note title: date, time, first line without markdown', files.has(path), [...files.keys()].join());
    ok('body is the text as sent', files.get(path)?.trimEnd().endsWith('# 下午开会要用的资料\n第二行'), files.get(path));
    ok('front matter has seq, kind, source, created', fm.get(path)?.dropit_seq === 7 && fm.get(path).kind === 'text'
      && fm.get(path).source === 'cli' && fm.get(path).created === '2026-09-17T08:00:00.000Z', JSON.stringify(fm.get(path)));
    ok('cursor and maxSeq advance', p.settings.cursor === 7 && p.settings.maxSeq === 7);
    ok('one notice for the sync, naming the note', notices.at(-1)?.includes('received 1 item') && notices.at(-1).includes('下午开会要用的资料'), notices.at(-1));

    serve({ 'GET /v1/pull': pages([text(7, '# 下午开会要用的资料\n第二行')]) });
    p.settings.cursor = 0;
    await p.sync(false);
    ok('pulling it again does not write it twice', [...files.keys()].length === 1, [...files.keys()].join());

    serve({ 'GET /v1/pull': pages([text(8, '# 下午开会要用的资料\n另一条')]) });
    await p.sync(false);
    ok('same title, different item → a second note, numbered', files.has('Inbox/09-17 08.00 下午开会要用的资料 2.md'), [...files.keys()].join());
  }

  console.log('── A batch (text + files sent together) is one note ──');
  {
    const { p, files, fm } = await makePlugin({ folder: '00-Inbox' });
    const g = (i) => ({ group: { id: 'bAAAAAAAA', i, n: 3 } });
    serve({
      'GET /v1/pull': pages([text(9, '周报材料', { meta: g(1) }), blob(10, '截图 /a:b.png', { meta: { filename: '截图 /a:b.png', ...g(2) } })],
        [blob(11, 'chart.png', { meta: { filename: 'chart.png', ...g(3) } })]),
      'GET /': () => ({ bytes: PNG_BYTES() }),
    });
    await p.sync(false);
    await p.sync(false);                        // the last file arrives in a later pull
    const notes = [...files.keys()].filter((k) => k.endsWith('.md'));
    ok('one note for the three items', notes.length === 1, notes.join());
    const body = files.get(notes[0]);
    ok('text on top, files embedded below in order',
      /周报材料\n\n!\[\[截图 _a_b\.png\]\]\n\n!\[\[chart\.png\]\]\n$/.test(body), JSON.stringify(body));
    ok('files saved with their own names, cleaned, next to the note (attachment setting)',
      Buffer.compare(files.get('00-Inbox/截图 _a_b.png'), PNG) === 0 && files.has('00-Inbox/chart.png'), [...files.keys()].join());
    ok('front matter lists all three seqs and the batch', JSON.stringify(fm.get(notes[0]).dropit_seq) === '[9,10,11]'
      && fm.get(notes[0]).dropit_batch === 'bAAAAAAAA' && fm.get(notes[0]).kind === 'batch', JSON.stringify(fm.get(notes[0])));
  }

  console.log('── A file on its own ──');
  {
    const { p, files } = await makePlugin();
    serve({ 'GET /v1/pull': pages([blob(12, 'IMG_0042.HEIC')]), 'GET /': () => ({ bytes: PNG_BYTES() }) });
    await p.sync(false);
    ok('a note named after the file, embedding it', files.get('Inbox/09-17 08.00 IMG_0042.md')?.includes('![[IMG_0042.HEIC]]'), [...files.keys()].join());
  }

  console.log('── A failed download never blocks the queue, and pulling again fixes it ──');
  {
    const { p, files, fm } = await makePlugin();
    serve({ 'GET /v1/pull': pages([blob(8, 'photo.png'), text(9, 'after it')]), 'GET /8': () => new Error('网络不可用') });
    await p.sync(false);
    const note = 'Inbox/09-17 08.00 photo.md';
    ok('the item after it still arrives', files.has('Inbox/09-17 08.00 after it.md'), [...files.keys()].join());
    ok('a warning naming the file and the reason', files.get(note)?.includes('photo.png') && files.get(note).includes('网络不可用'), files.get(note));
    ok('no marker in the note (a %% comment shows in live preview)', !files.get(note).includes('%%'), files.get(note));
    ok('tagged as missing, not as written', fm.get(note).dropit_missing === 8 && fm.get(note).dropit_seq === undefined, JSON.stringify(fm.get(note)));

    serve({ 'GET /v1/pull': pages([blob(8, 'photo.png'), text(9, 'after it')]), 'GET /8': () => ({ bytes: PNG_BYTES() }), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
    await p.repull('all');
    ok('pulling again swaps the warning for the file', files.get(note).includes('![[photo.png]]') && !files.get(note).includes('⚠️'), files.get(note));
    ok('front matter moves it to written', fm.get(note).dropit_seq === 8 && fm.get(note).dropit_missing === undefined, JSON.stringify(fm.get(note)));
    ok('the text item is not written twice', [...files.keys()].filter((k) => k.includes('after it')).length === 1);
  }

  console.log('── Append to one note ──');
  {
    const { p, files } = await makePlugin({ mode: 'append', appendPath: 'Inbox/dropit' });
    serve({ 'GET /v1/pull': pages([text(20, 'first'), text(21, 'second')]) });
    await p.sync(false);
    const body = files.get('Inbox/dropit.md');
    ok('created, with .md added', typeof body === 'string', [...files.keys()].join());
    // Nothing but the content: a %% comment shows in live preview (it did, in the user's vault)
    ok('each item: a time line and the text, nothing else', body === '**09-17 08:00** · cli\nfirst\n\n**09-17 08:00** · cli\nsecond\n', JSON.stringify(body));
    ok('what was appended is recorded by the plugin instead', JSON.stringify(p.settings.appended) === '[[20,21]]', JSON.stringify(p.settings.appended));
    serve({ 'GET /v1/pull': pages([text(20, 'first'), text(21, 'second')]), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
    await p.repull('all');
    ok('pulling again skips what was appended, and adds nothing', files.get('Inbox/dropit.md') === body, JSON.stringify(files.get('Inbox/dropit.md')));
  }

  console.log('── Append mode: a failed download, then pulling again ──');
  {
    const { p, files } = await makePlugin({ mode: 'append', appendPath: 'Inbox/dropit.md' });
    serve({ 'GET /v1/pull': pages([blob(25, 'scan.pdf')]), 'GET /25': () => new Error('offline') });
    await p.sync(false);
    const before = files.get('Inbox/dropit.md');
    ok('a warning line, with no marker in the note', before.includes('scan.pdf') && !before.includes('%%'), JSON.stringify(before));
    serve({ 'GET /v1/pull': pages([blob(25, 'scan.pdf')]), 'GET /25': () => ({ bytes: PNG_BYTES() }), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
    await p.repull('all');
    const after = files.get('Inbox/dropit.md');
    ok('pulling again puts the file where the warning was', after.includes('![[scan.pdf]]') && !after.includes('⚠️') && !after.includes('%%'), JSON.stringify(after));
    ok('…and records it as appended', DropitPlugin.inRanges(p.settings.appended, 25) && !p.settings.missingAt[25], JSON.stringify(p.settings));
  }

  console.log('── Ranges ──');
  {
    const r = [];
    for (const n of [5, 3, 4, 10, 6, 12, 11]) DropitPlugin.addToRanges(r, n);
    ok('neighbours merge into ranges', JSON.stringify(r) === '[[3,6],[10,12]]', JSON.stringify(r));
    ok('membership', DropitPlugin.inRanges(r, 4) && DropitPlugin.inRanges(r, 12) && !DropitPlugin.inRanges(r, 7) && !DropitPlugin.inRanges(r, 2));
    DropitPlugin.addToRanges(r, 8); DropitPlugin.addToRanges(r, 7); DropitPlugin.addToRanges(r, 9);
    ok('filling the gap joins them', JSON.stringify(r) === '[[3,12]]', JSON.stringify(r));
  }

  console.log('── Append to today\'s daily note ──');
  {
    const { p, files } = await makePlugin({ mode: 'daily' });
    p.app.internalPlugins = { getPluginById: () => ({ instance: { options: { folder: 'Journal', format: 'YYYY-MM-DD', template: 'Templates/Daily' } } }) };
    files.set('Templates/Daily.md', '# {{title}}\n');
    serve({ 'GET /v1/pull': pages([text(30, 'hello')]) });
    await p.sync(false);
    ok('created from the core template when it has no Templater tags',
      files.get('Journal/2026-09-29.md')?.startsWith('# 2026-09-29\n\n**09-17 08:00** · cli\nhello'), JSON.stringify(files.get('Journal/2026-09-29.md')));

    const t2 = await makePlugin({ mode: 'daily' });
    t2.p.app.internalPlugins = p.app.internalPlugins;
    t2.files.set('Templates/Daily.md', '# <% tp.date.now() %>\n');
    let asked;
    t2.p.app.plugins = { plugins: { 'templater-obsidian': { templater: {
      create_new_note_from_template: async (tpl, folder, name, open) => { asked = { tpl: tpl.path, folder, name, open }; t2.files.set(`Journal/${name}.md`, '# rendered\n'); return {}; },
    } } } };
    serve({ 'GET /v1/pull': pages([text(31, 'hi')]) });
    await t2.p.sync(false);
    ok('a Templater template goes through Templater, without opening the note',
      asked?.tpl === 'Templates/Daily.md' && asked.name === '2026-09-29' && asked.open === false, JSON.stringify(asked));
    ok('and the item lands below what it rendered', t2.files.get('Journal/2026-09-29.md')?.startsWith('# rendered\n\n**09-17'), JSON.stringify(t2.files.get('Journal/2026-09-29.md')));
  }

  console.log('── Links ──');
  {
    const { renderText, noteTitle } = DropitPlugin;
    const url = text(40, 'https://example.com/a/b', { kind: 'url' });
    ok('a bare link stays as sent', renderText(url).join('\n') === 'https://example.com/a/b');
    ok('its title is the host and path', noteTitle(url) === '09-17 08.00 example.com_a_b', noteTitle(url));
    const rich = { ...url, meta: { title: 'A [great] page', description: 'line one\nline two' } };
    ok('with a title: a link, then the description quoted', renderText(rich).join('\n') === '[A great page](https://example.com/a/b)\n\n> line one\n> line two', renderText(rich).join('\n'));
    ok('the note is named after the title (brackets dropped, not turned into _)', noteTitle(rich) === '09-17 08.00 A great page', noteTitle(rich));
    ok('long titles are cut to 40 characters', noteTitle(text(41, 'x'.repeat(80))).length === '09-17 08.00 '.length + 40);
  }

  console.log('── The command you choose, and the event ──');
  {
    const { p, events, ran } = await makePlugin({ hookCommand: 'quickadd:choice:abc' });
    const g = { group: { id: 'bBBBBBBBB', i: 1, n: 2 } };
    serve({ 'GET /v1/pull': pages([text(50, 'for the script', { meta: g }), blob(51, 'a.png', { meta: { filename: 'a.png', mime: 'image/png', group: { ...g.group, i: 2 } } })]), 'GET /': () => ({ bytes: PNG_BYTES() }) });
    await p.sync(false);
    await p.hookQueue;
    ok('runs once per item, in order', ran.length === 2 && ran.every((r) => r.id === 'quickadd:choice:abc'), JSON.stringify(ran.map((r) => r.id)));
    const [first, second] = ran.map((r) => r.received);
    ok('each run sees its own item in `received`', first?.seq === 50 && second?.seq === 51);
    ok('payload v1: seq, kind, source, created, batch, text, meta, note, files',
      first.v === 1 && first.kind === 'text' && first.source === 'cli' && first.created === '2026-09-17T08:00:00.000Z'
      && first.batch.id === 'bBBBBBBBB' && first.batch.index === 1 && first.batch.count === 2 && first.text === 'for the script'
      && first.note === 'Inbox/09-17 08.00 for the script.md' && first.files.length === 0, JSON.stringify(first));
    ok('a file: no text, its vault path, its filename and mime', second.text === '' && second.files[0] === 'Inbox/a.png'
      && second.meta.filename === 'a.png' && second.meta.mime === 'image/png' && second.note === first.note, JSON.stringify(second));
    ok('the payload cannot be changed by a script, nested parts included', [first, first.batch, first.meta, second.files].every(Object.isFrozen));
    ok('dropit:received fires for each', events.filter((e) => e.name === 'dropit:received').length === 2);
    ok('commands run a second apart', timers.includes(1000));
  }

  console.log('── The command did not run: say why ──');
  {
    const { p } = await makePlugin({ hookCommand: 'editor:toggle-bold' });
    const warned = [];
    const warn = console.warn;
    console.warn = (m) => warned.push(m);
    try {
      // false from executeCommandById: either there's no such command, or it declined (e.g. it needs an open editor)
      p.app.commands = { executeCommandById: () => false, findCommand: (id) => (id === 'editor:toggle-bold' ? { id, name: 'Toggle bold' } : undefined) };
      p.hook({ seq: 1 });
      await p.hookQueue;
      ok('a command that exists but declined: "didn\'t run", not "not found"',
        warned.length === 1 && warned[0].includes(DropitPlugin.STRINGS.en.hookNotRun('editor:toggle-bold')) && !/not found/i.test(warned[0]), JSON.stringify(warned));
      p.settings.hookCommand = 'gone:plugin-removed';
      p.hook({ seq: 2 });
      await p.hookQueue;
      ok('a command that is gone: "not found"', warned.length === 2 && warned[1].includes(DropitPlugin.STRINGS.en.hookMissing('gone:plugin-removed')), JSON.stringify(warned));
      ok('both in Chinese too', /前提条件不满足/.test(DropitPlugin.STRINGS.zh.hookNotRun('x')) && /找不到命令/.test(DropitPlugin.STRINGS.zh.hookMissing('x')));
    } finally {
      console.warn = warn;
    }
  }

  console.log('── Where it came from (the browser extension adds the page) ──');
  {
    const { renderText, noteTitle, payloadOf } = DropitPlugin;
    const FROM = { url: 'https://example.com/post/1', title: 'A Post' };
    const SRC = '— [A Post](https://example.com/post/1)';
    const quote = (seq, raw, from = FROM, extra = {}) => text(seq, raw, { meta: { from }, ...extra });
    const photo = (seq, filename, from, group) => blob(seq, filename, { meta: { filename, mime: 'image/png', ...(from ? { from } : {}), ...(group ? { group } : {}) } });

    // O1
    ok('text: the source a blank line below', renderText(quote(60, 'a quoted line')).join('\n') === `a quoted line\n\n${SRC}`, JSON.stringify(renderText(quote(60, 'a quoted line'))));
    ok('no title → the host name', renderText(quote(60, 'x', { url: 'https://sub.example.org/a?b=1' })).at(-1) === '— [sub.example.org](https://sub.example.org/a?b=1)', renderText(quote(60, 'x', { url: 'https://sub.example.org/a?b=1' })).at(-1));
    {
      const { p, files } = await makePlugin();
      serve({ 'GET /v1/pull': pages([quote(61, 'a quoted line')]) });
      await p.sync(false);
      const body = files.get('Inbox/09-17 08.00 a quoted line.md');
      ok('…and that is how the note ends', body?.endsWith(`---\n\na quoted line\n\n${SRC}\n`), JSON.stringify(body));
    }

    // O2 — the same escaping as the CLI, for the source line and for a link with a title
    const odd = (url, title) => renderText(quote(62, 'x', { url, title })).at(-1);
    ok('brackets leave the title, line breaks become one space, other spacing stays',
      odd('https://example.com/', 'A [b]\r\n  c]') === '— [A b c](https://example.com/)' && odd('https://example.com/', 'A  b') === '— [A  b](https://example.com/)', odd('https://example.com/', 'A [b]\r\n  c]'));
    ok('a backslash in the title is doubled, so it can\'t swallow the bracket', odd('https://example.com/', 'C:\\') === '— [C:\\\\](https://example.com/)', odd('https://example.com/', 'C:\\'));
    ok('an address with a space or ( ) goes in <…>', odd('https://example.com/a b(1)', 'T') === '— [T](<https://example.com/a b(1)>)'
      && odd('https://en.wikipedia.org/wiki/Foo_(bar)', 'T') === '— [T](<https://en.wikipedia.org/wiki/Foo_(bar)>)', odd('https://example.com/a b(1)', 'T'));
    ok('inside <…>, \\ < and > are escaped', odd('https://example.com/a<b>', 'T') === '— [T](<https://example.com/a\\<b\\>>)'
      && odd('https://example.com/a\\b', 'T') === '— [T](<https://example.com/a\\\\b>)', odd('https://example.com/a<b>', 'T') + ' ' + odd('https://example.com/a\\b', 'T'));
    ok('line breaks in the address are encoded', odd('https://example.com/a\r\nb', 'T') === '— [T](https://example.com/a%0D%0Ab)', odd('https://example.com/a\r\nb', 'T'));
    ok('only http(s): anything else gets no source line',
      ['javascript:alert(1)', 'file:///etc/passwd', 'not a url', '', ' https://example.com/', 'https://'].every((url) => renderText(quote(63, 'x', { url, title: 'T' })).join('\n') === 'x')
      && renderText(quote(63, 'x', { title: 'T' })).join('\n') === 'x' && renderText(quote(63, 'x', 'https://example.com/')).join('\n') === 'x');
    {
      const link = (raw, title, kind = 'url') => renderText(text(64, raw, { kind, meta: { title } })).join('\n');
      ok('a link with a title: same escaping for its text and address',
        link('https://en.wikipedia.org/wiki/Foo_(bar)', 'Foo\nbar\\') === '[Foo bar\\\\](<https://en.wikipedia.org/wiki/Foo_(bar)>)', link('https://en.wikipedia.org/wiki/Foo_(bar)', 'Foo\nbar\\'));
      ok('…decided by the text, not the kind', link('https://example.com/x', 'T', 'text') === '[T](https://example.com/x)'
        && link('see https://example.com/x', 'T') === 'see https://example.com/x', link('see https://example.com/x', 'T'));
      ok('…and a title that is only brackets is no title', link('https://example.com/x', '[]') === 'https://example.com/x', link('https://example.com/x', '[]'));
    }

    // O3 — the second file comes in a later pull
    {
      const { p, files } = await makePlugin();
      const g = (i) => ({ id: 'bCCCCCCCC', i, n: 2 });
      serve({ 'GET /v1/pull': pages([photo(64, 'one.png', FROM, g(1))], [photo(65, 'two.png', FROM, g(2))]), 'GET /': () => ({ bytes: PNG_BYTES() }) });
      await p.sync(false);
      await p.sync(false);
      const body = files.get('Inbox/09-17 08.00 one.md');
      ok('a batch from one page: both files, then one source line', body?.endsWith(`---\n\n![[one.png]]\n\n![[two.png]]\n\n${SRC}\n`)
        && body.split('— [').length === 2, JSON.stringify(body));
    }
    {
      const { p, files } = await makePlugin();
      serve({ 'GET /v1/pull': pages([photo(66, 'solo.png', FROM)]), 'GET /': () => ({ bytes: PNG_BYTES() }) });
      await p.sync(false);
      ok('a single file: the file, then its source', files.get('Inbox/09-17 08.00 solo.md')?.endsWith(`![[solo.png]]\n\n${SRC}\n`), JSON.stringify(files.get('Inbox/09-17 08.00 solo.md')));
    }

    // O4
    {
      const { p, files } = await makePlugin();
      const g = (i) => ({ id: 'bDDDDDDDD', i, n: 2 });
      const OTHER = { url: 'https://other.example/img' };
      serve({ 'GET /v1/pull': pages([photo(67, 'one.png', FROM, g(1)), photo(68, 'two.png', OTHER, g(2))]), 'GET /': () => ({ bytes: PNG_BYTES() }) });
      await p.sync(false);
      const body = files.get('Inbox/09-17 08.00 one.md');
      ok('a batch from two pages: each file followed by its own source',
        body?.endsWith(`---\n\n![[one.png]]\n\n${SRC}\n\n![[two.png]]\n\n— [other.example](https://other.example/img)\n`), JSON.stringify(body));
    }
    {
      const { p, files } = await makePlugin();
      const g = (i) => ({ id: 'bEEEEEEEE', i, n: 2 });
      serve({ 'GET /v1/pull': pages([photo(69, 'one.png', FROM, g(1)), photo(70, 'two.png', FROM, g(2))]), 'GET /69': () => new Error('offline'), 'GET /70': () => ({ bytes: PNG_BYTES() }) });
      await p.sync(false);
      const note = 'Inbox/09-17 08.00 one.md';
      ok('a failed download keeps its place above the shared source', /⚠️[^\n]*one\.png[^\n]*\n\n!\[\[two\.png\]\]\n\n— \[A Post\]/.test(files.get(note) ?? ''), JSON.stringify(files.get(note)));
      serve({ 'GET /v1/pull': pages([photo(69, 'one.png', FROM, g(1)), photo(70, 'two.png', FROM, g(2))]), 'GET /': () => ({ bytes: PNG_BYTES() }), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
      await p.repull('all');
      ok('…and pulling again swaps in the file, the source line staying put',
        files.get(note)?.endsWith(`---\n\n![[one.png]]\n\n![[two.png]]\n\n${SRC}\n`), JSON.stringify(files.get(note)));
    }

    // O5 — what came before stays as it was
    {
      const { p, files } = await makePlugin();
      const rich = text(71, 'https://example.com/a/b', { kind: 'url', meta: { title: 'A [great] page', description: 'line one\nline two' } });
      serve({ 'GET /v1/pull': pages([rich, text(72, 'plain')]) });
      await p.sync(false);
      ok('a link with title and description: unchanged, no source line',
        files.get('Inbox/09-17 08.00 A great page.md')?.endsWith('---\n\n[A great page](https://example.com/a/b)\n\n> line one\n> line two\n'), JSON.stringify(files.get('Inbox/09-17 08.00 A great page.md')));
      ok('an item without meta: unchanged', files.get('Inbox/09-17 08.00 plain.md')?.endsWith('---\n\nplain\n'), JSON.stringify(files.get('Inbox/09-17 08.00 plain.md')));
    }

    // O6
    {
      const { p, files } = await makePlugin({ mode: 'append', appendPath: 'Inbox/dropit' });
      const g = (i) => ({ id: 'bFFFFFFFF', i, n: 2 });
      serve({ 'GET /v1/pull': pages([quote(73, 'a quoted line'), photo(74, 'one.png', FROM, g(1))], [photo(75, 'two.png', FROM, g(2)), text(76, 'after')]), 'GET /': () => ({ bytes: PNG_BYTES() }) });
      await p.sync(false);
      await p.sync(false);
      const body = files.get('Inbox/dropit.md');
      ok('append to a note: text and files carry their source',
        body === `**09-17 08:00** · cli\na quoted line\n\n${SRC}\n\n**09-17 08:00** · web\n![[one.png]]\n![[two.png]]\n\n${SRC}\n\n**09-17 08:00** · cli\nafter\n`, JSON.stringify(body));
    }
    {
      const { p, files } = await makePlugin({ mode: 'daily' });
      serve({ 'GET /v1/pull': pages([quote(77, 'a quoted line')]) });
      await p.sync(false);
      const body = files.get('2026-09-29.md');
      ok('append to the daily note: the source line too', body === `**09-17 08:00** · cli\na quoted line\n\n${SRC}\n`, JSON.stringify(body) + [...files.keys()]);
    }

    // O7
    ok('the note is named after the text, not the page', noteTitle(quote(78, 'what I selected')) === '09-17 08.00 what I selected', noteTitle(quote(78, 'what I selected')));

    // O8
    const pl = payloadOf(quote(79, 'x'), 'Inbox/x.md', []);
    ok('hook payload: meta.from, frozen, still v1', pl.v === 1 && pl.meta.from.url === FROM.url && pl.meta.from.title === 'A Post'
      && [pl, pl.meta, pl.meta.from].every(Object.isFrozen), JSON.stringify(pl));
    const noTitle = payloadOf(quote(80, 'x', { url: 'https://example.com/' }), 'Inbox/x.md', []);
    ok('…without a title, only the url; without a source, no `from`', JSON.stringify(noTitle.meta.from) === '{"url":"https://example.com/"}'
      && !('from' in payloadOf(text(81, 'x'), 'Inbox/x.md', []).meta), JSON.stringify(noTitle.meta));
  }

  console.log('── A flaky connection (dropped by a proxy) ──');
  {
    const { p } = await makePlugin();
    p.settings.endpoints = [];
    let pulls = 0;
    const calls = serve({
      'GET /v1/pull': () => (++pulls <= 2 ? new Error('net::ERR_CONNECTION_CLOSED') : { json: { items: [], has_more: false, next_after: 0 } }),
      'POST /v1/accounts': () => new Error('net::ERR_CONNECTION_CLOSED'),
    });
    timers.length = 0;
    await p.sync(false);
    ok('a dropped connection is tried again on the same address, and gets through', pulls === 3 && p.state !== 'error', `${pulls} · ${p.state}`);
    ok('…after short waits', timers.includes(400) && timers.includes(1200), JSON.stringify(timers));

    calls.length = 0;
    let err = null;
    try { await p.api('POST', '/v1/accounts', { device_name: 'x' }, false); } catch (e) { err = e; }
    ok('creating an account is never sent twice (a lost answer would make a second account)',
      err && calls.filter((c) => c.path === '/v1/accounts').length === 1, String(calls.length));

    // A sync that still fails doesn't sit on "⚠": it tries again by itself, backing off
    const q = (await makePlugin()).p;
    q.settings.endpoints = [];
    let down = true, tries = 0;
    serve({ 'GET /v1/pull': () => { tries++; return down ? new Error('net::ERR_CONNECTION_CLOSED') : { json: { items: [], has_more: false, next_after: 0 } }; } });
    const firstRetry = (ms) => ms >= 5_000 && ms <= 7_500;      // 5 s plus up to half again, so vaults don't all retry together
    window.setTimeout = (fn, ms) => { timers.push(ms); if (!firstRetry(ms)) setImmediate(fn); else held = fn; return 0; };
    let held = null;
    timers.length = 0;
    await q.sync(false);
    ok('a failed sync shows the error and schedules a retry in 5–7.5 s', q.state === 'error' && timers.some(firstRetry) && held, `${q.state} · ${JSON.stringify(timers)}`);
    down = false;
    held();
    for (let i = 0; i < 5; i++) await settle();
    window.setTimeout = (fn, ms) => { timers.push(ms); setImmediate(fn); return 0; };
    ok('…which heals it once the network is back', q.state !== 'error' && q.syncFails === 0, `${q.state} · ${q.syncFails}`);

    // A request that never answers (a stalled connection) ends by itself instead of holding the sync, and the line "reading…", for good
    const z = (await makePlugin()).p;
    z.settings.endpoints = [];
    z.apiDeadlineMs = 50;
    let hung = 0;
    serve({ 'GET /v1/me': () => { hung++; return new Promise(() => {}); } });
    let stalled = null;
    await Promise.race([z.api('GET', '/v1/me').catch((e) => { stalled = e; }), new Promise((r) => setTimeout(r, 2000))]);
    ok('a request nobody answers ends with a message saying so, and is not sent again at once', stalled && /no answer in \d+ seconds/.test(stalled.message) && hung === 1, `${stalled?.message} · ${hung}`);
    ok('…in both languages', /30 秒内没有响应/.test(DropitPlugin.STRINGS.zh.timedOut(30)));
  }

  console.log('── Removed from the account: no endless retries ──');
  for (const code of ['INVALID_TOKEN', 'DEVICE_REVOKED']) {
    const { p } = await makePlugin();
    let pulls = 0, tickets = 0, fixed = false;
    serve({
      'GET /v1/pull': () => { pulls++; return fixed ? { json: { items: [], has_more: false, next_after: 0 } } : { status: 401, json: { error: code } }; },
      'POST /v1/ws/ticket': () => { tickets++; return fixed ? { json: { ticket: 't', realtime_until: null } } : { status: 401, json: { error: code } }; },
    });
    globalThis.WebSocket = class { constructor() { this.readyState = 0; } close() {} send() {} };
    const setTimeout = window.setTimeout;
    window.setTimeout = (fn, ms) => { timers.push(ms); return 0; };   // hold every timer: a retry must not even be scheduled
    try {
      timers.length = 0;
      await p.sync(false);
      ok(`${code}: the sync stops on ⚠ with the reason`, p.state === 'error' && p.error === DropitPlugin.STRINGS.en.errors[code], `${p.state} · ${p.error}`);
      ok(`${code}: …and schedules no retry (5 s, 15 s, 60 s)`, timers.length === 0, JSON.stringify(timers));
      p.heartbeat(); p.heartbeat();
      await p.connect();
      await p.sync(false);
      await settle();
      p.scheduleReconnect();
      ok(`${code}: heartbeats, pushes and focus ask nothing more`, tickets === 0 && pulls === 1 && timers.length === 0,
        `${tickets} tickets · ${pulls} pulls · ${JSON.stringify(timers)}`);
      fixed = true;
      await p.sync(true);
      await settle();
      ok(`${code}: a sync by hand asks again, and real-time comes back with it`, pulls === 2 && p.state !== 'error' && !p.authLost && tickets === 1,
        `${pulls} pulls · ${tickets} tickets · ${p.state}`);

      // Real-time on its own: the ticket request is refused the same way
      const r = (await makePlugin()).p;
      let rTickets = 0;
      serve({ 'POST /v1/ws/ticket': () => { rTickets++; return { status: 401, json: { error: code } }; } });
      timers.length = 0;
      await r.connect();
      ok(`${code}: a refused ticket shows ⚠ with the reason and schedules no reconnect`,
        rTickets === 1 && timers.length === 0 && r.state === 'error' && r.error === DropitPlugin.STRINGS.en.errors[code],
        `${rTickets} · ${JSON.stringify(timers)} · ${r.state} · ${r.error}`);
      r.heartbeat(); r.scheduleReconnect();
      await settle();
      ok(`${code}: …and heartbeats don't ask again`, rTickets === 1 && timers.length === 0, `${rTickets} · ${JSON.stringify(timers)}`);
      r.unloaded = true;

      // Pairing again clears it too
      const q = (await makePlugin()).p;
      serve({ 'GET /v1/pull': () => ({ status: 401, json: { error: code } }) });
      await q.sync(false);
      let qPulls = 0;
      serve({ 'GET /v1/pull': () => { qPulls++; return { json: { items: [], has_more: false, next_after: 0 } }; }, 'POST /v1/ws/ticket': () => ({ json: { ticket: 't', realtime_until: null } }) });
      await q.adopt({ token: 'dk_new', device_id: 'd_new' });
      await settle();
      ok(`${code}: pairing again starts over`, qPulls === 1 && !q.authLost && q.state !== 'error', `${qPulls} · ${q.state}`);
      // Stop both at the door: their sockets outlive this block, and a reconnect would reach the next stub server
      p.unloaded = q.unloaded = true;
    } finally {
      window.setTimeout = setTimeout;
      delete globalThis.WebSocket;
    }
  }

  console.log('── A stale server address heals itself ──');
  {
    const { p } = await makePlugin({}, { token: 'dk_x', endpoint: 'https://old.example.com' });
    ok('the old single address becomes the head of the list', p.settings.endpoints[0] === 'https://old.example.com' && !('endpoint' in p.settings));
    const calls = serve({ 'GET /v1/me': (b, path, host) => (host === 'old.example.com' ? new Error('getaddrinfo ENOTFOUND') : { json: { plan: 'free' } }) });
    const me = await p.api('GET', '/v1/me');
    ok('falls back to the built-in address', me.plan === 'free' && calls.at(-1).host === 'dropit.smart-kits.xyz', JSON.stringify(calls.map((c) => c.host)));
    ok('and tries it first from now on', p.settings.endpoints[0] === 'https://dropit.smart-kits.xyz', JSON.stringify(p.settings.endpoints));
    serve({ 'GET /v1/me': () => ({ status: 401, json: { error: 'INVALID_TOKEN' } }) });
    let err;
    try { await p.api('GET', '/v1/me'); } catch (e) { err = e; }
    ok('an error from the server is not a reason to switch', err?.code === 'INVALID_TOKEN' && /pair again/.test(err.message), err?.message);
  }

  console.log('── Pull again ──');
  {
    const { p } = await makePlugin({ cursor: 90, maxSeq: 90 });
    const calls = serve({ 'POST /v1/cursor/reset': (b) => ({ json: { ok: true, to_seq: b.last ? 80 : 0 } }), 'GET /v1/pull': pages() });
    await p.repull('last', 10);
    ok('the last 10 → the server picks the start', calls.some((c) => c.path === '/v1/cursor/reset' && JSON.parse(c.body).last === 10));
    ok('…and the pull starts there', calls.some((c) => c.path.startsWith('/v1/pull?after=80')), JSON.stringify(calls.map((c) => c.path)));
    calls.length = 0;
    await p.repull('days', 7);
    ok('the last 7 days → from the start, with since', calls.some((c) => /\/v1\/pull\?after=0.*since=\d+/.test(c.path)), JSON.stringify(calls.map((c) => c.path)));
    let refused = false;
    try { await p.repull('last', 0); } catch { refused = true; }
    ok('a bad number is refused', refused);
    serve({ 'POST /v1/cursor/reset': () => ({ status: 500, json: { error: 'INTERNAL' } }) });
    let failed = false;
    try { await p.repull('all'); } catch { failed = true; }
    ok('a failed reset is reported, not ignored (the server would send nothing)', failed);
  }

  console.log('── A push during a sync is not lost ──');
  {
    const { p, files } = await makePlugin();
    let release;
    const gate = new Promise((r) => { release = r; });
    let n = 0;
    serve({ 'GET /v1/pull': async () => {
      n++;
      if (n === 1) { await gate; return { json: { items: [text(60, 'one')], has_more: false, next_after: 60 } }; }
      return { json: n === 2 ? { items: [text(61, 'two')], has_more: false, next_after: 61 } : { items: [], has_more: false, next_after: 61 } };
    } });
    const first = p.sync(false);
    await settle();
    p.sync(false);                              // a push arrives while the first pull is in flight
    release();
    await first;
    ok('the second request runs after the first', files.has('Inbox/09-17 08.00 two.md') && n === 2, `${n} pulls · ${[...files.keys()]}`);
  }

  console.log('── Send ──');
  {
    const { p, files } = await makePlugin();
    const calls = serve({
      'POST /v1/ingest/file': () => ({ json: { seq: 71 } }),
      'POST /v1/ingest': () => ({ json: { seq: 70 } }),
    });
    await p.sendText('https://example.com/x');
    ok('a link goes as kind url, from obsidian', JSON.parse(calls[0].body).kind === 'url' && JSON.parse(calls[0].body).source === 'obsidian');
    files.set('Notes/idea.md', '# Idea\nbody');
    files.set('Pics/a.png', PNG);
    calls.length = 0;
    await p.sendFiles([{ path: 'Notes/idea.md', name: 'idea.md', extension: 'md' }, { path: 'Pics/a.png', name: 'a.png', extension: 'png' }]);
    // They go a few at a time, so which request is first is not fixed
    const note = calls.find((c) => c.path === '/v1/ingest');
    const up = calls.find((c) => c.path.startsWith('/v1/ingest/file?'));
    ok('a note goes as its text', JSON.parse(note.body).raw === '# Idea\nbody' && JSON.parse(note.body).kind === 'text');
    const g1 = JSON.parse(note.body).meta.group;
    const q = new URL(`https://x${up.path}`).searchParams;
    const g2 = { id: q.get('group'), i: Number(q.get('i')), n: Number(q.get('n')) };
    ok('both in one batch', g1.id === g2.id && g1.n === 2 && g1.i === 1 && g2.i === 2 && g2.n === 2, JSON.stringify([g1, g2]));
    ok('the image is uploaded in ONE request: its bytes as the body, its type, and its name and source in the address', calls.length === 2 && up.method === 'POST' && up.contentType === 'image/png'
      && Buffer.from(up.body).equals(PNG) && q.get('name') === 'a.png' && q.get('source') === 'obsidian', JSON.stringify(calls.map((c) => c.method + c.path)));
    ok('one notice for both', notices.at(-1) === 'dropit: sent 2 items', notices.at(-1));
    serve({ 'POST /v1/ingest': () => ({ status: 409, json: { error: 'DEDUPED', seq: 70 } }) });
    await p.sendText('again');
    ok('a duplicate says so', notices.at(-1) === 'dropit: already sent a moment ago', notices.at(-1));
    serve({ 'GET /v1/pull': pages([text(70, 'https://example.com/x', { source: 'obsidian' }), text(72, 'from elsewhere')]) });
    await p.sync(false);
    ok('what this vault sent is not written back into it', ![...files.keys()].some((k) => k.includes('example.com'))
      && files.has('Inbox/09-17 08.00 from elsewhere.md'), [...files.keys()].join());
    ok('…and is forgotten once seen', !p.settings.sent.includes(70) && p.settings.cursor === 72, JSON.stringify(p.settings.sent));
    ok('both the text and the uploaded file were remembered', p.settings.sent.includes(71), JSON.stringify(p.settings.sent));
    p.settings.device_id = 'd_me';
    p.settings.cursor = 0;
    serve({ 'GET /v1/pull': pages([text(70, 'https://example.com/x', { source: 'obsidian', device_id: 'd_me' }), text(72, 'from elsewhere', { device_id: 'd_phone' })]),
      'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
    await p.repull('all');
    ok('pulling again still leaves out what this device sent (the server says who sent it)', ![...files.keys()].some((k) => k.includes('example.com')), [...files.keys()].join());
    serve({ 'GET /v1/pull': pages([text(74, 'sent here, never remembered', { device_id: 'd_me' })]) });
    await p.sync(false);
    ok('…even one this vault never recorded (a push that beat the send response)', ![...files.keys()].some((k) => k.includes('never remembered')) && p.settings.cursor === 74, [...files.keys()].join());
    let resolve;
    p.api = () => new Promise((r) => { resolve = r; });
    const pulls = [];
    const inFlight = p.sendText('slow');
    await settle();
    const held = p.sync(false);
    ok('a push while sending waits for the send', await held === 0);
    delete p.api;
    serve({ 'GET /v1/pull': (b, path) => { pulls.push(path); return { json: { items: [], has_more: false, next_after: 74 } }; } });
    resolve({ seq: 73 });
    await inFlight;
    await settle(); await settle();
    ok('…and runs once it is done', pulls.length === 1 && p.settings.sent.includes(73), JSON.stringify(pulls));
    ok('commands registered: sync, send note, send selection', ['sync', 'send-note', 'send-selection'].every((id) => p.commands.some((c) => c.id === id)));
  }

  console.log('── Send: at most 10 files at a time ──');
  {
    const { p, files } = await makePlugin();
    let seq = 100;
    const calls = serve({ 'POST /v1/ingest': () => ({ json: { seq: ++seq } }) });
    const notes = Array.from({ length: 11 }, (_, i) => {
      files.set(`Notes/n${i}.md`, `note ${i}`);
      return { path: `Notes/n${i}.md`, name: `n${i}.md`, extension: 'md' };
    });
    notices.length = 0;
    await p.sendFiles(notes);
    ok('11 files: refused before sending anything, saying 10 is the limit', calls.length === 0 && notices.at(-1) === 'dropit: at most 10 files at a time', `${calls.length} · ${notices.at(-1)}`);
    await p.sendFiles(notes.slice(0, 10));
    ok('10 files: all sent, as one batch', calls.length === 10 && notices.at(-1) === 'dropit: sent 10 items'
      && new Set(calls.map((c) => JSON.parse(c.body).meta.group.id)).size === 1, `${calls.length} · ${notices.at(-1)}`);
  }

  console.log('── Settings page ──');
  for (const mode of ['note', 'append', 'daily']) {
    const { p } = await makePlugin({ mode });
    serve({
      'GET /v1/me': () => ({ json: { plan: 'free', devices_used: 1, devices_limit: 2, bytes_used: 0, bytes_limit: 31457280 } }),
      'GET /v1/devices': () => ({ json: { devices: [{ device_id: 'd1', name: 'Obsidian', scope: 'full', last_seen_at: Date.now() }] } }),
    });
    p.settings.device_id = 'd1';
    p.tab.containerEl = anything();
    thenCalls = 0;
    let err = null;
    try { p.tab.display(); } catch (e) { err = e; }
    for (let i = 0; i < 20; i++) await settle();
    // A Setting returned from a promise callback is adopted as a thenable, forever: the window hung at 100% CPU
    ok(`renders when paired (${mode}), without a promise adopting a Setting`, !err && thenCalls < 50, err?.stack ?? `${thenCalls} then() calls`);
  }

  console.log('── Settings page: pull again — two sliders ──');
  {
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const T = DropitPlugin.STRINGS.en;
    const Z = DropitPlugin.STRINGS.zh;
    const PLANS = { limits: { free: { days: 1 }, paid: { days: 10 } }, payments: { open: true } };
    const FREE = { plan: 'free', kept_days: 1, upgrade_url: 'https://x.test/upgrade?u=1&s=2&why=account&buy=year' };
    const draw = async (me, plans = PLANS) => {
      const { p } = await makePlugin();
      p.tab.containerEl = anything();
      p.api = async (m, path) => (path === '/v1/plans' ? (plans ?? {}) : path === '/v1/me' ? (me ?? { plan: 'free', devices_used: 1, devices_limit: 2 }) : {});
      p.meCache = me ? { m: me, at: Date.now() } : undefined;
      if (plans) p.plansCache = { plans, at: Date.now() };
      const hint = { shown: false, parts: [], links: [], toggle(v) { hint.shown = v; }, empty() { hint.parts.length = 0; hint.links.length = 0; }, createSpan(o) { hint.parts.push(o.text); return {}; },
        createEl(tag, o) { hint.links.push(o); return { addEventListener(ev, fn) { o.click = fn; } }; }, addEventListener() {} };
      ui.sliders.length = 0; ui.buttons.length = 0;
      const asked = [];
      p.repull = async (...a) => { asked.push(a); };
      const opened = [];
      p.openPlans = async (o) => { opened.push(o); };
      timers.length = 0;
      p.tab.pullAgain({ createDiv: () => hint });
      await settle();
      const [count, daysSl] = ui.sliders.slice(-2);
      const go = ui.buttons.at(-1);
      return { p, count, days: daysSl, hint, asked, opened, go };
    };
    const free = await draw(FREE);
    ok('the count is a native slider, 1 to 50, step 1, starting at 10, with its value shown while dragging', free.count.min === 1 && free.count.max === 50 && free.count.step === 1 && free.count.value === 10 && free.count.tooltip === true, JSON.stringify([free.count.min, free.count.max, free.count.value]));
    ok('the days are a slider from 1 to what Paid keeps (read from the plans, not written here), starting at 1', free.days.min === 1 && free.days.max === 10 && free.days.value === 1 && free.days.tooltip === true && free.days.step === 1, JSON.stringify([free.days.min, free.days.max, free.days.value]));
    const [countCell, daysCell] = free.days.row.cells;
    ok('one row: its name, then the two sliders side by side, each in a cell with its own words, the button after them', free.count.row === free.days.row && free.count.row.name === T.repull && free.days.row.cells.length === 2, JSON.stringify(free.days.row.cells.map((c) => c.cls)));
    ok('the words over each: the latest 10 items, the last 1 day', T.repullCount(10) === 'Latest 10 items' && T.repullCount(1) === 'Latest 1 item' && T.repullWithin(1) === 'Last 1 day' && T.repullWithin(5) === 'Last 5 days' && Z.repullCount(10) === '最新 10 条' && Z.repullWithin(1) === '最近 1 天'
      && countCell.labels[0].text === 'Latest 10 items' && daysCell.labels[0].text === 'Last 1 day', JSON.stringify([countCell.labels, daysCell.labels]));
    free.count.change(3);
    ok('…and they change as the slider moves', countCell.labels[0].text === 'Latest 3 items');
    free.count.change(10);
    ok('each slider has its own name for a screen reader, in both languages', free.count.attrs?.['aria-label'] === T.repullCountLabel && free.days.attrs?.['aria-label'] === T.repullDaysLabel && !!T.repullCountLabel && !!T.repullDaysLabel && T.repullCountLabel !== T.repullDaysLabel && !!Z.repullCountLabel && !!Z.repullDaysLabel);
    free.count.change(37);
    free.days.change(4);
    ok('free: the days slider goes back to 1 at once, whatever is dragged', free.days.value === 1 && free.hint.shown === true, JSON.stringify([free.days.value, free.hint.shown]));
    ok('…and a line under it says why, with the plans link — not a Notice', /^Free keeps items for 1 day\. With Paid, anything you missed can come back for up to 10 days\.$/.test(free.hint.parts[0]) && free.hint.links.length === 1 && free.hint.links[0].text === 'See plans' && timers.includes(4000), JSON.stringify([free.hint.parts, free.hint.links]));
    free.hint.links[0].click({ preventDefault() {}, stopPropagation() {} });
    ok('the link opens the plans, said to be about how long items are kept', same(free.opened, [{ why: 'kept' }]));
    await free.go.click();
    ok('Pull asks for the count on the slider and 1 day', same(free.asked, [['recent', 37, 1]]), JSON.stringify(free.asked));
    const rowOn = { keydown: free.days.row.listeners?.keydown, pointerdown: daysCell.on.pointerdown };
    free.days.change(2);
    rowOn.keydown({ key: 'a', stopPropagation() {} });
    ok('another key leaves the line up; Esc puts it away', free.hint.shown === true && (rowOn.keydown({ key: 'Escape', stopPropagation() {} }), free.hint.shown === false));
    free.days.change(2);
    ok('dragged again it comes back; a second touch of the row puts it away, and the drag that follows does not bring it back', free.hint.shown === true && (rowOn.pointerdown(), free.hint.shown === false) && (free.days.change(3), free.hint.shown === false));
    const paid = await draw({ plan: 'paid', kept_days: 10 });
    paid.days.change(7);
    ok('paid: the slider moves, no line appears', paid.days.value === 7 && paid.hint.shown === false);
    paid.days.change(10);
    await paid.go.click();
    ok('…up to the days Paid keeps; Pull asks for 10 items and those days', same(paid.asked, [['recent', 10, 10]]), JSON.stringify(paid.asked));
    const short = await draw({ plan: 'paid', kept_days: 4 });
    short.days.change(9);
    ok('an account that keeps items 4 days cannot go past 4 (the track is still the whole 10)', short.days.value === 4 && short.days.max === 10 && short.hint.shown === false, JSON.stringify([short.days.value, short.days.max]));
    const noPlans = await draw(FREE, null);
    ok('the plans not read: the track is as long as this account can go, and the line has no number', noPlans.days.max === 1 && (noPlans.days.change(3), /for longer\.$/.test(noPlans.hint.parts[0])), JSON.stringify(noPlans.hint.parts));
    const closed = await draw(FREE, { ...PLANS, payments: { open: false } });
    closed.days.change(2);
    ok('payments off: the sentence, and no link', closed.hint.shown === true && closed.hint.links.length === 0, JSON.stringify(closed.hint.links));
    const noLink = await draw({ plan: 'free', kept_days: 1 });
    noLink.days.change(2);
    ok('no way to Paid in the account: the sentence only', noLink.hint.shown === true && noLink.hint.links.length === 0);
    ok('the hint in Chinese, with and without a number', Z.repullHint(1, 10) === '免费版内容保留 1 天。升级付费版，错过的内容最长可以找回 10 天。' && /更久。$/.test(Z.repullHint(1, null)) && Z.repullSeePlans === '了解付费版' && T.repullSeePlans === 'See plans'
      && !/!|！/.test(T.repullHint(1, 10) + Z.repullHint(1, 10)));
    ok('the old drop-down words are gone', !('repullFreeNote' in T) && !('repullFreeNote' in Z));
    // the pure parts
    ok('what the days slider can do: track = what Paid keeps; reach = this account\'s days, at most that; 1 when not known',
      same(DropitPlugin.repullDays({ kept_days: 1 }, PLANS), { track: 10, allowed: 1, paid: 10 }) && same(DropitPlugin.repullDays({ kept_days: 10 }, PLANS), { track: 10, allowed: 10, paid: 10 })
      && DropitPlugin.repullDays({ kept_days: 30 }, PLANS).allowed === 10 && DropitPlugin.repullDays({ kept_days: 4 }, PLANS).allowed === 4 && same(DropitPlugin.repullDays(null, null), { track: 1, allowed: 1, paid: null })
      && DropitPlugin.repullDays({ kept_days: 10 }, { limits: { paid: { days: 14 } } }).allowed === 10 && DropitPlugin.repullDays({ kept_days: 20 }, { limits: { paid: { days: 14 } } }).allowed === 14);
    ok('the two values are held to 1–50 and 1–reach', same(DropitPlugin.repullRange(500, 99, { kept_days: 10 }, PLANS), { count: 50, days: 10 }) && same(DropitPlugin.repullRange(0, 0, { kept_days: 10 }, PLANS), { count: 1, days: 1 })
      && same(DropitPlugin.repullRange(20, 5, FREE, PLANS), { count: 20, days: 1 }) && same(DropitPlugin.repullRange(NaN, undefined, { kept_days: 10 }, PLANS), { count: 10, days: 1 }) && same(DropitPlugin.repullRange(12.6, 2.4, { kept_days: 10 }, PLANS), { count: 13, days: 2 }));
  }

  console.log('── Pull again: what is asked of the service ──');
  {
    const run = async (me, n, days, plans = { limits: { paid: { days: 10 } } }) => {
      const { p } = await makePlugin();
      p.meCache = { m: me, at: Date.now() };
      p.plansCache = { plans, at: Date.now() };
      const calls = serve({ 'POST /v1/cursor/reset': () => ({ json: { to_seq: 7 } }), 'GET /v1/pull': pages([]) });
      const before = Date.now();
      await p.repull('recent', n, days);
      const reset = calls.find((c) => c.path === '/v1/cursor/reset');
      const pull = calls.find((c) => c.path.startsWith('/v1/pull'));
      const q = new URL(`http://x${pull.path}`).searchParams;
      return { reset: JSON.parse(reset.body), after: q.get('after'), since: Number(q.get('since')), before, why: q.get('why') };
    };
    const day = 86_400_000;
    const near = (r, d) => Math.abs(r.since - (r.before - d * day)) < 5_000;
    const a = await run({ kept_days: 1 }, 10, 1);
    ok('both limits at once: the cursor goes back by the last 10, and the pull is limited to the last day', a.reset.last === 10 && a.after === '7' && near(a, 1) && a.why === 'repull', JSON.stringify(a));
    const b = await run({ kept_days: 1 }, 500, 6);
    ok('more than 50 items asked: 50; more days than a free account keeps: 1', b.reset.last === 50 && near(b, 1), JSON.stringify(b));
    const c = await run({ kept_days: 10 }, 33, 7);
    ok('paid, 33 items, 7 days', c.reset.last === 33 && near(c, 7), JSON.stringify(c));
    const d = await run({ kept_days: 10 }, 20, 40);
    ok('paid, 40 days asked: what Paid keeps (10)', near(d, 10), JSON.stringify(d));
    const e = await run({ kept_days: 10 }, 20, undefined);
    ok('no days given: 1 day', near(e, 1));
    const f = await run({ kept_days: 10 }, 1, 1);
    ok('one item is the least', f.reset.last === 1);
  }

  console.log('── Settings page: the top line stays true ──');
  {
    // Right after Obsidian starts the network may not be up: the account line used to keep that error
    // forever, under a headline that had meanwhile turned to "● Receiving in real time"
    const { p } = await makePlugin();
    p.tab.containerEl = anything();
    let meCalls = 0;
    p.api = async (m, path) => {
      if (path === '/v1/me') {
        if (++meCalls === 1) throw new Error('Can’t reach the server (net::ERR_CONNECTION_CLOSED)');
        return { plan: 'paid', devices_used: 5, devices_limit: 10, bytes_used: 0, bytes_limit: 524288000 };
      }
      return path === '/v1/devices' ? { devices: [] } : {};
    };
    timers.length = 0;
    p.tab.display();
    await Promise.resolve(); await Promise.resolve();
    const row = p.tab.stateSetting;
    ok('a failed account read says it will try again', /trying again/.test(row.desc) && /ERR_CONNECTION_CLOSED/.test(row.desc), row.desc);
    ok('…and schedules it', timers.includes(3_000), JSON.stringify(timers));
    for (let i = 0; i < 5; i++) await settle();
    ok('…and the account line heals on its own', meCalls === 2 && /^Paid · 5 of 10 devices/.test(row.desc), `${meCalls} · ${row.desc}`);

    // Removed from the account: the line says so and stops asking
    const gone = (await makePlugin()).p;
    gone.tab.containerEl = anything();
    let asked = 0;
    gone.api = async (m, path) => {
      if (path === '/v1/me') { asked++; throw Object.assign(new Error('This device was removed — pair again'), { code: 'DEVICE_REVOKED' }); }
      return path === '/v1/devices' ? { devices: [] } : {};
    };
    timers.length = 0;
    gone.tab.display();
    for (let i = 0; i < 5; i++) await settle();
    ok('removed from the account: the account line says so and stops asking', asked === 1
      && /removed/.test(gone.tab.stateSetting.desc) && !timers.some((ms) => [3_000, 10_000, 30_000].includes(ms)), `${asked} · ${gone.tab.stateSetting.desc} · ${JSON.stringify(timers)}`);

    // Coming back online re-reads it at once
    const q = (await makePlugin()).p;
    q.tab.containerEl = anything();
    let fails = true;
    q.api = async (m, path) => {
      if (path === '/v1/me') { if (fails) throw new Error('offline'); return { plan: 'free', devices_used: 1, devices_limit: 2, bytes_used: 0, bytes_limit: 31457280 }; }
      return path === '/v1/devices' ? { devices: [] } : {};
    };
    window.setTimeout = (fn, ms) => { timers.push(ms); return 0; };    // hold the retry timer
    q.tab.display();
    await settle();
    fails = false;
    q.setStatus('live');
    await settle();
    window.setTimeout = (fn, ms) => { timers.push(ms); setImmediate(fn); return 0; };
    ok('the connection coming back re-reads the account at once', /^Free · 1 of 2 devices/.test(q.tab.stateSetting.desc), q.tab.stateSetting.desc);
  }

  console.log('── Connecting, not "disconnected" ──');
  {
    const { p } = await makePlugin();
    p.tab.containerEl = anything();
    p.api = async (m, path) => (path === '/v1/devices' ? { devices: [] } : path === '/v1/ws/ticket' ? { ticket: 't', realtime_until: null } : {});
    p.tab.display();
    let sock = null;
    globalThis.WebSocket = class { constructor() { sock = this; this.readyState = 0; } close() { this.closed = true; this.onclose?.(); } send() {} };
    const going = p.connect();
    ok('asking for a ticket shows "connecting"', p.state === 'connecting' && p.tab.stateSetting.name === DropitPlugin.STRINGS.en.stateConnecting, `${p.state} · ${p.tab.stateSetting.name}`);
    await going;
    ok('still "connecting" while the socket opens', p.liveState() === 'connecting' && p.tab.stateSetting.name === DropitPlugin.STRINGS.en.stateConnecting, p.tab.stateSetting.name);
    sock.readyState = 1;
    sock.onopen();
    ok('open: "receiving in real time"', p.state === 'live' && p.tab.stateSetting.name === DropitPlugin.STRINGS.en.stateLive, p.tab.stateSetting.name);
    sock.onclose();
    ok('closed: "disconnected, reconnecting"', p.state === 'offline' && p.tab.stateSetting.name === DropitPlugin.STRINGS.en.stateOffline, p.tab.stateSetting.name);

    // A ticket request that never answers doesn't block the next attempt for good
    const s = (await makePlugin()).p;
    let asked = 0;
    s.api = async (m, path) => { if (path === '/v1/ws/ticket') asked++; return new Promise(() => {}); };
    s.connect();
    s.connect();
    ok('one attempt at a time', asked === 1, String(asked));
    s.connectingAt = Date.now() - 31_000;
    s.connect();
    ok('…but one stuck for 30 s gives way', asked === 2, String(asked));

    // Start: catch up and connect together, instead of real-time waiting for the whole catch-up
    const r = (await makePlugin()).p;
    const order = [];
    let release;
    r.api = async (m, path) => {
      order.push(path.split('?')[0]);
      if (path.startsWith('/v1/pull')) { await new Promise((res) => { release = res; }); return { items: [], has_more: false, next_after: 0 }; }
      return path === '/v1/ws/ticket' ? { ticket: 't', realtime_until: null } : {};
    };
    globalThis.WebSocket = class { constructor() { this.readyState = 0; } close() {} send() {} };
    const started = r.start();
    await settle();
    ok('start asks for the ticket without waiting for the catch-up', order.includes('/v1/ws/ticket') && order.includes('/v1/pull'), JSON.stringify(order));
    release();
    await started;
  }

  console.log('── Feedback ──');
  {
    const url = new URL(DropitPlugin.issueUrl('3.0.3'));
    const body = url.searchParams.get('body');
    ok('a new issue on the public plugin repository', url.origin + url.pathname === 'https://github.com/smart-kits/dropit-obsidian/issues/new');
    ok('title and body carry the version, and a warning about tokens', url.searchParams.get('title') === '[3.0.3] ' && body.includes('Plugin: 3.0.3') && /token/.test(body), body);
    ok('nothing from the account goes in it', !/dk_x|d_me|Inbox/.test(url.href), url.href);
  }

  console.log('── Real-time not included ──');
  {
    const { p } = await makePlugin();
    let asked = 0;
    const ME = { plan: 'free', trial_days: 14 };     // the length of the trial is the service's to say
    p.api = async (m, path) => {
      if (path === '/v1/ws/ticket') { asked++; throw Object.assign(new Error('paid'), { code: 'WS_REQUIRES_PAID' }); }
      return path === '/v1/me' ? ME : {};
    };
    notices.length = 0;
    await p.connect();
    ok('asks for a ticket once', asked === 1, String(asked));
    ok('remembers that real-time is not included', p.noRealtime === true && p.state === 'manual', p.state);
    ok('says so once, in the one name for it, and writes no number it was not given', notices.length === 1 && /Real-time delivery isn't part of your plan/.test(notices[0]) && !/\d/.test(notices[0]) && !/push/i.test(notices[0]), JSON.stringify(notices));
    p.heartbeat(); p.heartbeat();
    await settle();
    ok('heartbeats stop asking (every one used to)', asked === 1, String(asked));
    p.noRealtime = false;
    await p.connect();
    ok('asking again later does not repeat the notice', notices.length === 1, JSON.stringify(notices));
  }

  console.log('── Upgrade moments: numbers from the service, notices once, links tagged ──');
  {
    const T = DropitPlugin;
    const DAY = 86_400_000;
    const UP = 'https://dropit.example/upgrade?u=1&s=2&why=account&buy=year';
    const free = (extra = {}) => ({ plan: 'free', trial_days: 14, created_at: Date.now() - 12 * DAY - 1000, items_total: 41, devices_used: 2, upgrade_url: UP, ...extra });
    const sockety = () => { globalThis.WebSocket = class { constructor() { this.readyState = 1; } close() {} send() {} }; };

    // upgrade_url gets its source; the hourly limit is never sold; unsafe links stay dropped
    ok('upgradeLink tags the source at the end', T.upgradeLink({ upgrade_url: UP }) === `${UP.replace('&buy=year', '')}&src=obsidian`, T.upgradeLink({ upgrade_url: UP }));
    ok('…a link with no query gets ?src', T.upgradeLink({ upgrade_url: 'https://dropit.example/upgrade' }) === 'https://dropit.example/upgrade?src=obsidian');
    ok('…and a link with a #fragment gets it before the fragment, whether or not it has a query', T.upgradeLink({ upgrade_url: 'https://dropit.example/upgrade#plans' }) === 'https://dropit.example/upgrade?src=obsidian#plans'
      && T.upgradeLink({ upgrade_url: 'https://dropit.example/upgrade?a=1#plans' }) === 'https://dropit.example/upgrade?a=1&src=obsidian#plans');
    ok('…the hourly limit has no link', T.upgradeLink({ upgrade_url: UP, window: 'hour' }) === null);
    ok('…nor an unsafe or missing one', T.upgradeLink({ upgrade_url: 'javascript:alert(1)' }) === null && T.upgradeLink({}) === null && T.upgradeLink(undefined) === null);
    {
      notices.length = 0;
      T.errorNotice('dropit: today is used up', { data: { upgrade_url: UP, why: 'per_day' } });
      ok('a limit Notice carries the tagged link', lastNotice.m.links[0].href === `${UP.replace('&buy=year', '')}&src=obsidian`, JSON.stringify(lastNotice.m.links));
      T.errorNotice('dropit: slow down', { data: { upgrade_url: UP, why: 'per_day', window: 'hour' } });
      ok('…and the hourly one only the text', typeof lastNotice.m === 'string', JSON.stringify(lastNotice.m));
    }

    // The trial's length: the account first, then the plans, then its two dates, else no number at all
    ok('trial length: from the account', T.trialDaysOf({ trial_days: 14 }, { limits: { free: { realtimeTrialDays: 9 } } }) === 14);
    ok('…else from the plans', T.trialDaysOf({}, { limits: { free: { realtimeTrialDays: 9 } } }) === 9);
    ok('…else from the account\'s two dates', T.trialDaysOf({ created_at: 0, realtime_until: 7 * DAY }, null) === 7);
    ok('…else nothing: no number is written', T.trialDaysOf({}, null) === null && T.trialDaysOf(null, null) === null);
    ok('what the account has had: only what it said', JSON.stringify(T.trialFacts({}, 14)) === JSON.stringify({ days: 0, items: 0, devices: 0 }));
    ok('…the first day counts as 1, and it stops at the trial\'s length', T.trialFacts({ created_at: Date.now() - 100 }, 14).days === 1 && T.trialFacts({ created_at: Date.now() - 30 * DAY }, 14).days === 14);

    // The links of a moment: the plans page (no buy=), tagged, and asked for what it is for; a limit's link is the plans page too
    ok('planLink drops buy= and says why, the signed part untouched', T.planLink({ upgrade_url: UP }, 'realtime') === 'https://dropit.example/upgrade?u=1&s=2&why=realtime&src=obsidian', T.planLink({ upgrade_url: UP }, 'realtime'));
    ok('…buy= first or last, none at all, a #fragment (why goes after what is there)', T.planLink({ upgrade_url: 'https://x.test/up?buy=year&u=1' }, 'account') === 'https://x.test/up?u=1&src=obsidian&why=account'
      && T.planLink({ upgrade_url: 'https://x.test/up?u=1&buy=year' }, 'account') === 'https://x.test/up?u=1&src=obsidian&why=account'
      && T.planLink({ upgrade_url: 'https://x.test/up' }, 'realtime') === 'https://x.test/up?src=obsidian&why=realtime'
      && T.planLink({ upgrade_url: 'https://x.test/up?u=1&buy=year#top' }, 'realtime') === 'https://x.test/up?u=1&src=obsidian&why=realtime#top', T.planLink({ upgrade_url: 'https://x.test/up?u=1&buy=year#top' }, 'realtime'));
    ok('…nothing when there is no link, or it is the hourly limit', T.planLink({}, 'realtime') === null && T.planLink({ upgrade_url: UP, window: 'hour' }, 'realtime') === null);

    // Prices and facts: only what the plans and the account say
    const PLANS = { payments: { open: true }, plans: [{ id: 'year', price: { cents: 1990, currency: 'USD' }, trial: { cents: 190, days: 30 } }, { id: 'year_once', price: { cents: 2990, currency: 'USD' } }],
      limits: { free: { days: 1, perDay: 20, fileMB: 10, devices: 2 }, paid: { days: 10, perDay: 300, fileMB: 100, devices: 10 } } };
    ok('prices: first month, year and one-time year, written like the website', JSON.stringify(T.planPrices(PLANS, { trial_available: true })) === JSON.stringify({ trial: '$1.90', year: '$19.90', once: '$29.90' }), JSON.stringify(T.planPrices(PLANS, {})));
    ok('…no first month for an account that had one; nothing at all without plans', T.planPrices(PLANS, { trial_available: false }).trial === '' && JSON.stringify(T.planPrices(null, null)) === JSON.stringify({ trial: '', year: '', once: '' }));
    {
      const n = 14, now = Date.now();
      const m = { created_at: now - 13 * DAY, items_total: 41, devices_used: 2, kept_days: 1 };
      const v = T.momentFacts(m, PLANS, n, true, now);
      ok('facts: days while it is still the trial, the account\'s items and devices, the paid limits, rich', v.days === 14 && v.items === 41 && v.devices === 2 && v.kept === 1 && v.rich && v.linked && v.perks.perDay === 300 && v.perks.days === 10, JSON.stringify(v));
      ok('…long after the trial: no "these N days" (items count from sign-up)', T.momentFacts({ ...m, created_at: now - 60 * DAY }, PLANS, n, true, now).days === null);
      ok('…few items and one device: not rich; 10 items is', !T.momentFacts({ ...m, items_total: 9, devices_used: 1 }, PLANS, n, true, now).rich && T.momentFacts({ ...m, items_total: 10, devices_used: 1 }, PLANS, n, true, now).rich);
      ok('…nothing given: nothing made up', JSON.stringify(T.momentFacts({}, null, null, false, now)) === JSON.stringify({ days: null, items: 0, devices: 0, kept: null, rich: false, linked: false, perks: null }), JSON.stringify(T.momentFacts({}, null, null, false, now)));
    }

    for (const lang of ['en', 'zh']) {
      const S = T.STRINGS[lang];
      const rich = T.momentFacts({ created_at: Date.now() - 5 * DAY, items_total: 41, devices_used: 2, kept_days: 1 }, PLANS, 14, true);
      const plain = T.momentFacts({ created_at: Date.now() - 5 * DAY, items_total: 3, devices_used: 1, kept_days: 1 }, PLANS, 14, true);
      const bare = T.momentFacts({}, null, null, false);
      for (const kind of ['T2', 'T3', 'N']) {
        const r = S.moment(kind, rich), p = S.moment(kind, plain), b = S.moment(kind, bare);
        ok(`${lang}/${kind}: the fuller sentence says items, devices and what Paid adds`, /41/.test(r) && /2/.test(r) && /300/.test(r) && /100/.test(r) && /10/.test(r), r);
        ok(`${lang}/${kind}: little to show: no counts and no list of perks`, !/41|300|100/.test(p) && !/ 3 /.test(p), p);
        ok(`${lang}/${kind}: nothing known: no number at all`, !/\d/.test(b.replace('不到 1 天', '')), b);
        ok(`${lang}/${kind}: one name for it, nothing about storing or backing up`, /real-time delivery|实时送达/i.test(r) && !/push|推送|后台接收|storage|存储|备份|云盘/i.test(r + p + b), r);
      }
      ok(`${lang}/T1: the countdown comes from the caller`, S.moment('T1', bare, S.daysLeft(3)).includes('3') && !/\d{2}/.test(S.moment('T1', bare, S.daysLeft(3))), S.moment('T1', bare, S.daysLeft(3)));
      ok(`${lang}: the button says what keeping it costs: first month, else the year, else nothing`, /1\.90/.test(S.keepLabel({ trial: '$1.90', year: '$19.90' })) && /19\.90/.test(S.keepLabel({ trial: '', year: '$19.90' })) && !/\d/.test(S.keepLabel({ trial: '', year: '' })));
      ok(`${lang}: the small print under it: the year after the first month, and cancel anytime; none without a price`, /19\.90/.test(S.keepNote({ trial: '$1.90', year: '$19.90' })) && S.keepNote({ trial: '', year: '' }) === '');
      ok(`${lang}: Paid ending says the date, what it keeps; no limits given: still a sentence`, /2026-11-05/.test(S.paidEnding('2026-11-05', S.limitsLine(PLANS.limits.paid, false))) && /300/.test(S.paidEnding('2026-11-05', S.limitsLine(PLANS.limits.paid, false))) && !/\d{3}/.test(S.paidEnding('2026-11-05', '').replace('2026-11-05', '')));
      ok(`${lang}: Paid ended says the free limits and the date, not the account's total`, /20/.test(S.paidEnded('2026-11-15', S.limitsLine(PLANS.limits.free, false))) && /2026-11-15/.test(S.paidEnded('2026-11-15', '')) && !/total|累计/.test(S.paidEnded('2026-11-15', '')));
    }

    // T3: the trial ended — says what the account had, with the link when payments are open, once
    {
      const { p } = await makePlugin();
      let meReads = 0;
      p.api = async (m, path) => { if (path === '/v1/me') { meReads++; return free(); } return {}; };
      p.realtimeUntil = Date.now() - 1000;
      notices.length = 0;
      await p.stopRealtime('trial_over', undefined, Object.assign(new Error('over'), { data: { reason: 'trial_over' } }));
      ok('T3: says it ended, and what the account had', notices.length === 1 && /trial has ended/.test(notices[0]) && /41 items/.test(notices[0]) && /2 devices/.test(notices[0]) && /In these 1[34] days/.test(notices[0]), JSON.stringify(notices));
      ok('T3: the link opens the plans (no buy=), says why, is tagged with this client, and stands on its own', lastNotice.m.links.length === 1 && lastNotice.m.links[0].href === 'https://dropit.example/upgrade?u=1&s=2&why=realtime&src=obsidian' && lastNotice.m.links[0].text === 'Keep real-time delivery', JSON.stringify(lastNotice.m.links));
      ok('T3: the notice is remembered per period in the settings', Object.keys(p.stored.moments).some((k) => k.startsWith('T3.')), JSON.stringify(p.stored.moments));
      await p.stopRealtime('trial_over', undefined, null);
      ok('T3: not said again', notices.length === 1, JSON.stringify(notices));
    }
    {
      // payments closed: the service gives no link, so there is no link and no Paid sentence — only the facts
      const { p } = await makePlugin();
      p.api = async (m, path) => (path === '/v1/me' ? free({ upgrade_url: null }) : {});
      notices.length = 0;
      await p.stopRealtime('trial_over', undefined, null);
      ok('T3, payments closed: facts only — no link, no Paid sentence', notices.length === 1 && typeof lastNotice.m === 'string' && !/Paid|also get/.test(notices[0]) && /41 items/.test(notices[0]), JSON.stringify(notices));
    }
    {
      // the account can't be read: the same notice, without any number and without a link
      const { p } = await makePlugin();
      p.api = async () => { throw new Error('offline'); };
      notices.length = 0;
      await p.stopRealtime('trial_over', undefined, null);
      ok('T3, account unreadable: no number, no link, still said', notices.length === 1 && !/\d/.test(notices[0]) && typeof lastNotice.m === 'string', JSON.stringify(notices));
    }
    {
      // a paid account is told nothing about the free plan
      const { p } = await makePlugin();
      p.api = async (m, path) => (path === '/v1/me' ? { plan: 'paid', paid_until: Date.now() + 100 * DAY, renews: true } : {});
      notices.length = 0;
      await p.stopRealtime('trial_over', undefined, null);
      ok('a paid account hears nothing about the trial', notices.length === 0, JSON.stringify(notices));
    }

    // T1 (three days out) and T2 (under a day): once each, in order, T2 the already-existing "less than a day" line
    {
      const { p } = await makePlugin();
      sockety();
      p.sync = async () => {};
      p.api = async (m, path) => (path === '/v1/ws/ticket' ? { ticket: 't', realtime_until: Date.now() + 2.5 * DAY } : path === '/v1/me' ? free() : {});
      await p.connect();
      p.socket.onopen();
      notices.length = 0;
      p.heartbeat(); p.heartbeat();
      await settle();
      ok('T1: with 3 days or less left, says so once, with what the account had', notices.length === 1 && /has 3 days left/.test(notices[0]) && /In these 1[34] days you sent 41 items/.test(notices[0]), JSON.stringify(notices));
      p.realtimeUntil = Date.now() + 3 * 3_600_000;
      p.heartbeat(); p.heartbeat();
      await settle();
      ok('T2: under a day is its own notice, once', notices.length === 2 && /less than a day/.test(notices[1]) && /41 items/.test(notices[1]), JSON.stringify(notices));
      ok('T1 and T2 are remembered separately', Object.keys(p.stored.moments).some((k) => k.startsWith('T1.')) && Object.keys(p.stored.moments).some((k) => k.startsWith('T2.')), JSON.stringify(p.stored.moments));
      p.unloaded = true;
    }
    {
      // no items sent yet, one device: both halves left out, the notice still says it
      const { p } = await makePlugin();
      sockety();
      p.sync = async () => {};
      p.api = async (m, path) => (path === '/v1/ws/ticket' ? { ticket: 't', realtime_until: Date.now() + 3 * 3_600_000 } : path === '/v1/me' ? free({ items_total: 0, devices_used: 1 }) : {});
      await p.connect();
      p.socket.onopen();
      notices.length = 0;
      p.heartbeat();
      await settle();
      ok('T2: nothing sent and one device: neither half is written, and no number at all', notices.length === 1 && !/\d|devices/.test(notices[0]) && /less than a day/.test(notices[0]), JSON.stringify(notices));
      p.unloaded = true;
    }
    {
      // the local record can't be written: the notice stays silent rather than repeat
      const { p } = await makePlugin();
      p.api = async (m, path) => (path === '/v1/me' ? free() : {});
      p.saveData = async () => { throw new Error('disk full'); };
      notices.length = 0;
      await p.stopRealtime('trial_over', undefined, null).catch(() => {});
      ok('the record can\'t be written: no notice (silent beats repeating)', notices.length === 0, JSON.stringify(notices));
    }

    // P1 / P2: paid ending, paid ended
    {
      const { p } = await makePlugin();
      const until = Date.now() + 5 * DAY;
      const paid = { plan: 'paid', paid_until: until, renews: false, paid_kind: 'year', items_total: 500 };
      p.api = async (m, path) => (path === '/v1/me' ? paid : {});
      notices.length = 0;
      await p.accountMoments(paid);
      ok('P1: a paid year with under a week left says when it ends, once', notices.length === 1 && /Paid ends on \d{4}-\d{2}-\d{2}/.test(notices[0]) && !/\d+ items a day/.test(notices[0]) && typeof lastNotice.m === 'object' && lastNotice.m.links[0].href === '#' && /^Renew a year/.test(lastNotice.m.links[0].text), JSON.stringify(notices));
      await p.accountMoments(paid);
      ok('P1: not again for the same end', notices.length === 1, JSON.stringify(notices));
      ok('P1: the settings page line shows the date', /Paid until \d{4}-\d{2}-\d{2}/.test(T.STRINGS.en.account({ ...paid, devices_used: 1, devices_limit: 10, bytes_used: 0, bytes_limit: 1048576 })), 'account line');
      await p.accountMoments({ ...paid, renews: true, paid_until: Date.now() + 2 * DAY });
      ok('P1: a plan that renews itself: nothing', notices.length === 1, JSON.stringify(notices));
      await p.accountMoments({ ...paid, paid_until: Date.now() + 30 * DAY });
      ok('P1: more than a week away: nothing', notices.length === 1, JSON.stringify(notices));
      ok('the paid state is remembered for P2', p.stored.lastPlan === 'paid' && Number.isFinite(p.stored.lastPaidUntil), JSON.stringify([p.stored.lastPlan, p.stored.lastPaidUntil]));
      const endedAt = Date.now() - 1000;
      const gone = { plan: 'free', paid_until: endedAt, paid_grace_until: endedAt + 10 * DAY, items_total: 500, upgrade_url: UP };
      notices.length = 0;
      await p.accountMoments(gone);
      ok('P2: Paid just ended: one notice with the end of the grace and a plans link (no buy=)', notices.length === 1 && /Paid has ended/.test(notices[0]) && /What you already sent stays/.test(notices[0]) && !/in total/.test(notices[0]) && lastNotice.m.links[0].href === 'https://dropit.example/upgrade?u=1&s=2&why=account&src=obsidian', JSON.stringify(notices));
      await p.accountMoments(gone);
      ok('P2: once', notices.length === 1, JSON.stringify(notices));
    }
    {
      // refund or a plan that never was paid: free with no grace — nothing
      const { p } = await makePlugin({ lastPlan: 'paid', lastPaidUntil: 1 });
      notices.length = 0;
      await p.accountMoments({ plan: 'free', paid_until: 1, paid_grace_until: null });
      ok('P2: no grace period (refunded, or never paid): nothing is said', notices.length === 0, JSON.stringify(notices));
    }
  }

  console.log('── Plans entries: status bar, settings line, renewal link asked for at the click ──');
  {
    const DAY = 86_400_000;
    const UPL = 'https://dropit.example/upgrade?u=1&s=2&why=account&buy=year';
    const opened = [];
    window.open = (u) => opened.push(u);
    // The status bar item: only for a free account with a link, while the trial is ending or over
    const { p } = await makePlugin();
    let shown = null;
    p.upEl.toggle = (v) => { shown = v; };
    p.meCache = { m: { plan: 'free', upgrade_url: UPL }, at: Date.now() };
    p.refreshUpsell();
    ok('status bar item: hidden while the trial has plenty of days left', shown === false, String(shown));
    p.realtimeUntil = Date.now() + 2 * DAY; p.refreshUpsell();
    ok('…shown with 3 days or less left', shown === true, String(shown));
    p.realtimeUntil = null; p.realtimeWhy = 'trial_over'; p.refreshUpsell();
    ok('…shown once the trial is over', shown === true);
    p.meCache = { m: { plan: 'free', upgrade_url: null }, at: Date.now() }; p.refreshUpsell();
    ok('…not when there is no way to Paid (payments closed)', shown === false);
    p.meCache = { m: { plan: 'paid', paid_until: Date.now() + DAY }, at: Date.now() }; p.refreshUpsell();
    ok('…never for a paid account', shown === false);

    // A click: a free account goes to the plans from its own link; a paid one asks for the renewal link right then
    p.meCache = { m: { plan: 'free', upgrade_url: UPL }, at: Date.now() };
    let asked = [];
    p.api = async (m, path, body) => { asked.push([m, path, body]); return {}; };
    await p.openPlans({ why: 'realtime' });
    ok('click, free: the plans page from the account\'s link, no request', opened.at(-1) === 'https://dropit.example/upgrade?u=1&s=2&why=realtime&src=obsidian' && asked.length === 0, JSON.stringify([opened, asked]));
    p.meCache = { m: { plan: 'paid', paid_until: Date.now() + DAY, renews: false }, at: Date.now() };
    p.api = async (m, path, body) => { asked.push([m, path, body]); return { checkout_url: 'https://dropit.example/upgrade?_ptxn=txn_01abc', transaction_id: 'txn_01abc' }; };
    await p.openPlans();
    ok('click, paid: one request for a one-time year, from this client, and the page it names opens', asked.length === 1 && asked[0][0] === 'POST' && asked[0][1] === '/v1/checkout' && asked[0][2].plan === 'year_once' && asked[0][2].from === 'obsidian'
      && opened.at(-1) === 'https://dropit.example/upgrade?_ptxn=txn_01abc&src=obsidian', JSON.stringify([asked, opened]));
    p.api = async () => { throw Object.assign(new Error('slow down'), { code: 'RATE_LIMITED' }); };
    notices.length = 0;
    await p.openPlans();
    ok('click, too many tries today: says so, opens nothing new', notices.length === 1 && /too many tries/.test(notices[0]) && opened.length === 2, JSON.stringify(notices));
    p.api = async () => { throw new Error('offline'); };
    notices.length = 0;
    await p.openPlans();
    ok('click, offline: says it could not open', notices.length === 1 && /couldn't open/.test(notices[0]), JSON.stringify(notices));

    // The settings line: a link after the account line, for a free account with a link and a paid one about to end
    const row = (log) => ({ descEl: { createEl: (tag, o) => { log.push(o); return { addEventListener() {} }; } } });
    const entry = (m) => { const log = []; p.tab.accountEntry(row(log), m); return log.map((o) => o.text); };
    ok('settings line: free with a link: See plans', JSON.stringify(entry({ plan: 'free', upgrade_url: UPL })) === '["See plans"]', JSON.stringify(entry({ plan: 'free', upgrade_url: UPL })));
    ok('…free without one: nothing', entry({ plan: 'free' }).length === 0);
    ok('…paid and ending within a week, not renewing: Renew; renewing or far off: nothing', JSON.stringify(entry({ plan: 'paid', renews: false, paid_until: Date.now() + 3 * DAY })) === '["Renew"]' && entry({ plan: 'paid', renews: true, paid_until: Date.now() + 3 * DAY }).length === 0 && entry({ plan: 'paid', renews: false, paid_until: Date.now() + 30 * DAY }).length === 0);
  }

  console.log('── Real-time trial: countdown, end, full for today ──');
  {
    const DAY = 86_400_000;
    const { p } = await makePlugin();
    let sock = null;
    globalThis.WebSocket = class { constructor() { sock = this; this.readyState = 1; } close() { this.closed = true; } send() {} };
    p.sync = async () => {};
    p.api = async (m, path) => (path === '/v1/ws/ticket' ? { ticket: 't', realtime_until: Date.now() + 3.5 * DAY } : {});
    notices.length = 0;
    await p.connect();
    sock.onopen();
    ok('the ticket carries the end of the trial, and the plugin counts down from it', p.trialLeft() === '4 days left', p.trialLeft());
    p.heartbeat();
    ok('no warning while more than a day is left', notices.length === 0, JSON.stringify(notices));

    p.realtimeUntil = Date.now() + 3 * 3_600_000;
    p.heartbeat(); p.heartbeat();
    await settle();
    ok('less than a day left: warns once', notices.length === 1 && /less than a day/.test(notices[0]) && p.trialLeft() === 'less than a day left', JSON.stringify(notices));

    // The end by the local clock: ask the server rather than conclude — the user may have upgraded meanwhile
    let tickets = 0;
    p.api = async (m, path) => {
      if (path !== '/v1/ws/ticket') return {};
      tickets++;
      throw Object.assign(new Error('over'), { code: 'WS_REQUIRES_PAID', data: { reason: 'trial_over' } });
    };
    const before = sock;
    p.realtimeUntil = Date.now() - 1;
    p.heartbeat();
    await settle();
    ok('the trial ends by the local clock: the socket is closed and the server is asked again', before.closed === true && tickets === 1, String(tickets));
    ok('…the server says it ended: falls back and says so, once', p.noRealtime && p.realtimeWhy === 'trial_over' && notices.length === 2 && /trial has ended/.test(notices[1]), JSON.stringify(notices));

    const u = (await makePlugin()).p;
    u.sync = async () => {};
    u.api = async (m, path) => (path === '/v1/ws/ticket' ? { ticket: 't', realtime_until: Date.now() - 1 } : {});
    await u.connect();
    sock.onopen();
    u.api = async (m, path) => (path === '/v1/ws/ticket' ? { ticket: 't', realtime_until: null } : {});
    notices.length = 0;
    u.heartbeat();
    await settle();
    ok('upgraded during the trial: the recheck gets a ticket with no end, real-time stays on, no notice', u.realtimeUntil === null && !u.noRealtime && notices.length === 0, JSON.stringify({ until: u.realtimeUntil, notices }));
    u.unloaded = true;

    const d = (await makePlugin()).p;
    d.sync = async () => {};
    let dayTickets = 0;
    d.api = async (m, path) => (path === '/v1/ws/ticket' ? (dayTickets++, { ticket: 't', realtime_until: Date.now() + 5 * DAY }) : {});
    await d.connect();
    sock.onopen();
    d.heartbeat();
    ok('same UTC day: no new ticket', dayTickets === 1, String(dayTickets));
    d.ticketDay -= 1;                          // the ticket was from yesterday
    d.dayJitter = 0;
    d.heartbeat();
    await settle();
    ok('a new UTC day: one fresh ticket (real-time is granted per day; a socket can stay open for days)', dayTickets === 2, String(dayTickets));
    d.unloaded = true;

    const q = (await makePlugin()).p;
    q.sync = async () => {};
    let asked = 0;
    q.api = async (m, path) => {
      if (path !== '/v1/ws/ticket') return {};
      asked++;
      throw Object.assign(new Error('full'), { code: 'WS_REQUIRES_PAID', data: { reason: 'trial_full' } });
    };
    notices.length = 0; timers.length = 0;
    await q.connect();
    q.unloaded = true;                         // the retry below fires at once in this stub; stop it at the door
    const untilMidnight = DAY - (Date.now() % DAY);
    ok('full for today: says so, and that it comes back tomorrow', q.realtimeWhy === 'trial_full' && notices.length === 1 && /tomorrow/.test(notices[0]), JSON.stringify(notices));
    ok('asks again a little after midnight UTC, spread over ten minutes', timers.some((ms) => ms >= untilMidnight - 1000 && ms <= untilMidnight + 600_000), JSON.stringify(timers));
    await settle();
    await q.stopRealtime('trial_full');
    ok('turned away again the same day: no second notice', notices.length === 1, JSON.stringify(notices));

    const r = (await makePlugin()).p;
    r.sync = async () => {};
    r.api = async (m, path) => (path === '/v1/ws/ticket' ? { ticket: 't', realtime_until: Date.now() + 5 * DAY } : {});
    await r.connect();
    sock.onopen();
    const live = sock;
    notices.length = 0;
    sock.onmessage({ data: JSON.stringify({ type: 'new', seq: 7, end: 'trial_full' }) });
    const after = { closed: live.closed === true, why: r.realtimeWhy, off: r.noRealtime, socket: r.socket };
    r.unloaded = true;                         // before the stubbed timers fire the midnight retry
    await settle();
    ok('the last push of a full day says so: the plugin closes the socket itself and falls back', after.closed && after.why === 'trial_full' && after.off && after.socket === null, JSON.stringify(after));
    delete globalThis.WebSocket;
  }

  console.log('── Disabled plugin ──');
  {
    const { p } = await makePlugin();
    p.unloaded = true;
    let asked = 0;
    p.api = async () => { asked++; return { ticket: 't' }; };
    timers.length = 0;
    p.scheduleReconnect();
    ok('schedules no reconnect', timers.length === 0, JSON.stringify(timers));
    await p.connect();
    ok('asks for no ticket', asked === 0);
  }

  console.log('── Language ──');
  {
    const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]);
    const { en, zh } = DropitPlugin.STRINGS;
    const [ke, kz] = [keys(en), keys(zh)];
    ok('same keys in en and zh', ke.length === kz.length && ke.every((k) => kz.includes(k)),
      `only en: ${ke.filter((k) => !kz.includes(k))} · only zh: ${kz.filter((k) => !ke.includes(k))}`);

    const warningIn = async (lang) => {
      DropitPlugin = loadPlugin(lang);
      const { p, files } = await makePlugin();
      serve({ 'GET /v1/pull': pages([blob(8, 'x.png')]), 'GET /8': () => new Error('boom') });
      await p.sync(false);
      return files.get('Inbox/09-17 08.00 x.md');
    };
    ok('English by default', /couldn't be downloaded/.test(await warningIn(undefined)));
    ok('Chinese when Obsidian is set to zh', /没能下载下来/.test(await warningIn('zh')));
    ok('Chinese for zh-TW too', /没能下载下来/.test(await warningIn('zh-TW')));
    ok('English for other languages', /couldn't be downloaded/.test(await warningIn('de')));
  }

  console.log('── Pairing again takes the earlier pairing\'s place ──');
  {
    const { deviceKeyOf, localIdOf } = DropitPlugin;
    // Obsidian keeps local storage per vault: `<vault id>-<key>`, JSON (what app.saveLocalStorage does)
    const browser = new Map();
    const vaultApp = (appId) => ({
      appId,
      loadLocalStorage: (k) => (browser.has(`${appId}-${k}`) ? JSON.parse(browser.get(`${appId}-${k}`)) : null),
      saveLocalStorage: (k, v) => { if (v == null) browser.delete(`${appId}-${k}`); else browser.set(`${appId}-${k}`, JSON.stringify(v)); },
    });
    const a = await deviceKeyOf(vaultApp('vaultA'));
    const id = localIdOf(vaultApp('vaultA'));
    ok('device key is a 64-character hex hash of a random id, never the id itself', /^[0-9a-f]{64}$/.test(a) && /^[0-9a-f]{32}$/.test(id) && !a.includes(id), a);
    ok('the random id is kept in this vault\'s local storage', JSON.parse(browser.get('vaultA-dropit-device-id')) === id, JSON.stringify([...browser]));
    ok('the same vault gives the same key every time', await deviceKeyOf(vaultApp('vaultA')) === a);
    ok('another vault is another device', await deviceKeyOf(vaultApp('vaultB')) !== a);
    ok('…with an id of its own', localIdOf(vaultApp('vaultB')) !== id);

    // Before the public API (Obsidian < 1.8.7): the same entry through window.localStorage
    const ls = { getItem: (k) => browser.get(k) ?? null, setItem: (k, v) => browser.set(k, String(v)) };
    window.localStorage = ls;
    ok('older Obsidian: the same entry through window.localStorage', await deviceKeyOf({ appId: 'vaultA' }) === a);
    const before = browser.has('vaultC-dropit-device-id');
    const c = await deviceKeyOf({ appId: 'vaultC' });
    ok('…a new vault gets its id there too', !before && c && c !== a && /^[0-9a-f]{32}$/.test(JSON.parse(browser.get('vaultC-dropit-device-id'))));
    delete window.localStorage;
    ok('nowhere to keep an id: no key, nothing made up', await deviceKeyOf({}) === undefined);
    ok('storage that drops what it\'s given: no key', await deviceKeyOf({ appId: 'x', loadLocalStorage: () => null, saveLocalStorage: () => {} }) === undefined);

    // Reinstalling the plugin deletes data.json; the id lives elsewhere, so the key stays
    const reinstall = vaultApp('vaultR');
    const first = await makePlugin({}, {}, reinstall);
    let sent;
    serve({ 'POST /v1/accounts': (body) => { sent = body; return { json: { token: 'dk_r1', device_id: 'd_r1' } }; }, 'GET /v1/pull': pages([]) });
    await first.p.createAccount();
    const kept = JSON.parse(browser.get('vaultR-dropit-device-id'));
    ok('the id is not in the plugin\'s settings or data.json', !JSON.stringify(first.p.settings).includes(kept) && !JSON.stringify(first.p.stored).includes(kept),
      JSON.stringify(first.p.stored));
    const again = await makePlugin({}, {}, reinstall);          // data.json gone: no token, no previous_token
    let claimedAgain;
    serve({ 'POST /v1/pair/claim': (body) => { claimedAgain = body; return { json: { token: 'dk_r2', device_id: 'd_r2', replaced: { device_id: 'd_r1', name: 'Obsidian', how: 'key' } } }; },
      'GET /v1/pull': pages([]) });
    await again.p.claimCode('abc123');
    ok('reinstalled: pairing again sends the same key, with no old token', claimedAgain?.device_key === sent?.device_key && /^[0-9a-f]{64}$/.test(sent?.device_key ?? '')
      && !claimedAgain.previous_token, JSON.stringify([sent, claimedAgain]));

    // The audit flagged reading the computer's identity: none of it is read any more
    const src = require('node:fs').readFileSync(require.resolve('./main.js'), 'utf8');
    ok('main.js reads nothing about the computer: no os module, host name or user', !/require\(\s*['"](node:)?os['"]\s*\)/.test(src)
      && !/\bos\.(hostname|userInfo|cpus|totalmem|platform|arch|networkInterfaces)\b/.test(src) && !/userInfo|hardwareConcurrency|devicePixelRatio/.test(src));

    // A removed vault pairs again: it sends the key it had, and says it took that one's place
    const { p } = await makePlugin({ token: 'dk_old', device_id: 'd_old' }, undefined, vaultApp('vaultP'));
    let claimed;
    serve({
      'POST /v1/pair/claim': (body) => { claimed = body; return { json: { token: 'dk_new', device_id: 'd_new', replaced: { device_id: 'd_old', name: 'Obsidian', how: 'token' } } }; },
      'GET /v1/pull': pages([]),
    });
    notices.length = 0;
    await p.claimCode('abc123');
    ok('pairing again sends the key this vault had', claimed?.previous_token === 'dk_old', JSON.stringify(claimed));
    ok('…and its device key (a hash)', /^[0-9a-f]{64}$/.test(claimed?.device_key ?? ''), JSON.stringify(claimed));
    ok('…and says it took the earlier one\'s place', notices.some((n) => /took the place/.test(n)), JSON.stringify(notices));
    ok('…the new key is kept, the old one forgotten', p.settings.token === 'dk_new' && !p.settings.previous_token);

    // Unpair removes this vault from the account first
    const calls = serve({ 'DELETE /v1/devices/': () => ({ json: { ok: true } }) });
    await p.unpair();
    ok('unpair removes this device from the account first', calls.some((c) => c.method === 'DELETE' && c.path === '/v1/devices/d_new'), JSON.stringify(calls));
    ok('…then clears it here, keeping nothing', !p.settings.token && !p.settings.previous_token);

    // Offline: cleared here anyway, the key kept for the next pairing
    const { p: q } = await makePlugin({ token: 'dk_off', device_id: 'd_off' });
    net = async () => { throw new Error('offline'); };
    await q.unpair();
    ok('unpair offline: cleared here, the key kept for the next pairing', !q.settings.token && q.settings.previous_token === 'dk_off');

    // Removed because this vault paired again elsewhere: said as such
    const { p: r } = await makePlugin({ token: 'dk_gone' });
    serve({ 'GET /v1/me': () => ({ status: 403, json: { error: 'DEVICE_REVOKED', reason: 'replaced' } }) });
    const err = await r.api('GET', '/v1/me').catch((e) => e);
    ok('DEVICE_REVOKED + replaced reads as "paired again", not "removed"', /paired again/.test(err.message), err.message);
  }

  console.log('── The directory takes the manifest as is ──');
  {
    const m = JSON.parse(require('node:fs').readFileSync(require.resolve('./manifest.json'), 'utf8'));
    // 3.1.2's "dropit — Sync Anything Across Phone, PC & Web" hid the entry: "Name not allowed in the directory".
    // Every one of the directory's 8,599 names uses only these characters (10-09), and none says Obsidian
    ok('name: only letters, digits, spaces and - . + ( ) — the directory hid 3.1.2 for an em dash, & and a comma',
      /^[A-Za-z0-9 .+()-]+$/.test(m.name) && !/obsidian/i.test(m.name), m.name);
    // The directory's Short description field takes 200 (10-09: a 239-character one was cut there), and it should be the same sentence
    ok('description: at most 200 characters, ending with a period', m.description.length <= 200 && m.description.endsWith('.'), String(m.description.length));
    const versions = JSON.parse(require('node:fs').readFileSync(require.resolve('./versions.json'), 'utf8'));
    ok('versions.json lists this version', versions[m.version] === m.minAppVersion, JSON.stringify(versions));
  }

  console.log('── 3.1.2: nothing a sender sends, and no failed write, makes notes pile up ──');
  {
    // Every front-matter line must be a YAML scalar Obsidian can read: a number, a plain word, or a quoted string
    const scalar = /^(-?\d+|[A-Za-z0-9][A-Za-z0-9_.:+-]*|"(?:[^"\\]|\\.)*")$/;
    const fmLines = (s) => /^---\n([\s\S]*?)\n---/.exec(s)[1].split('\n');
    const { p, files, fm } = await makePlugin();
    const g = { group: { id: 'a: b', i: 1, n: 2 } };
    serve({ 'GET /v1/pull': pages([text(60, 'odd fields', { kind: 'note: x', source: '@phone', meta: g })]) });
    await p.sync(false);
    const note = [...files.keys()].find((k) => k.endsWith('.md'));
    ok('odd kind, source and batch id: one note, and every front-matter value is one YAML can read',
      [...files.keys()].length === 1 && fmLines(files.get(note)).every((l) => scalar.test(l.split(': ').slice(1).join(': '))), files.get(note));
    ok('…values come back exactly as sent', fm.get(note).source === '@phone' && fm.get(note).dropit_batch === 'a: b', JSON.stringify(fm.get(note)));
    ok('…and the seq is in the note from the start (written in one go)', fm.get(note).dropit_seq === 60 && p.settings.cursor === 60, JSON.stringify(fm.get(note)));
  }
  {
    // The second item of a batch fails to write once: trying again adds it once, and no second note appears
    const { p, files, fm, vault } = await makePlugin();
    const g = (i) => ({ group: { id: 'bCCCCCCCC', i, n: 2 } });
    const items = [text(61, 'first half', { meta: g(1) }), text(62, 'second half', { meta: g(2) })];
    serve({ 'GET /v1/pull': () => ({ json: { items, has_more: false, next_after: 62 } }) });
    const process = vault.process;
    let failOnce = true;
    vault.process = async (f, fn) => { if (failOnce) { failOnce = false; throw new Error('EBUSY: file is locked'); } return process(f, fn); };
    await p.sync(false);
    ok('a write fails mid-batch: the sync reports it and the cursor stays', p.state === 'error' && p.settings.cursor === 0, `${p.state} ${p.settings.cursor}`);
    ok('…what was written is saved (maxSeq), so even after a restart it is looked up, not written again', p.stored.maxSeq === 61, JSON.stringify(p.stored.maxSeq));
    const again = await makePlugin({}, p.stored);            // Obsidian restarted: settings from disk, the same vault
    for (const [k, v] of files) again.files.set(k, v);
    for (const [k, v] of fm) again.fm.set(k, { ...v });
    serve({ 'GET /v1/pull': () => ({ json: { items, has_more: false, next_after: 62 } }) });
    await again.p.sync(false);
    const notes = [...again.files.keys()].filter((k) => k.endsWith('.md'));
    ok('…trying again: still one note', notes.length === 1, notes.join());
    ok('…with each half once', (again.files.get(notes[0]).match(/first half/g) ?? []).length === 1
      && (again.files.get(notes[0]).match(/second half/g) ?? []).length === 1, JSON.stringify(again.files.get(notes[0])));
  }
  {
    // A name this system won't take: the note is made under a plain name, and what comes after still arrives
    const { p, files, vault } = await makePlugin();
    const create = vault.create;
    vault.create = async (path, s) => { if (path.includes('BAD')) throw new Error('EINVAL: invalid file name'); return create(path, s); };
    serve({ 'GET /v1/pull': pages([text(63, 'BAD name'), text(64, 'after it')]) });
    await p.sync(false);
    ok('a file name the system refuses: the note is made as "dropit <seq>.md"', files.has('Inbox/dropit 63.md') && files.get('Inbox/dropit 63.md').includes('BAD name'), [...files.keys()].join());
    ok('…and the next item arrives', files.has('Inbox/09-17 08.00 after it.md') && p.settings.cursor === 64, [...files.keys()].join());
  }

  console.log('── 3.1.2: received text never runs as a Templater template ──');
  {
    const local = (on) => ({ plugins: { plugins: { 'templater-obsidian': { settings: {} } } },
      loadLocalStorage: (k) => (k === 'templater-local-settings' ? { trigger_on_file_creation: on } : null) });
    const sent = '<%* require("child_process").exec("x") %> and <% tp.date.now() %>';
    const on = await makePlugin({}, undefined, local(true));
    serve({ 'GET /v1/pull': pages([text(70, sent, { meta: { from: { url: 'https://evil.example/', title: '<%* evil() %>' } } })]) });
    await on.p.sync(false);
    const body = [...on.files.values()][0];
    ok('Templater runs new notes as templates: no <% reaches the note', !body.includes('<%') && body.includes('<​%*'), JSON.stringify(body));
    ok('…not in the source line either', !/— \[<%/.test(body), JSON.stringify(body));
    ok('…while your command gets the text as sent', on.events.at(-1)?.payload.text === sent, JSON.stringify(on.events.at(-1)?.payload.text));
    const off = await makePlugin({}, undefined, local(false));
    serve({ 'GET /v1/pull': pages([text(71, sent)]) });
    await off.p.sync(false);
    ok('Templater installed but not running new notes: the text goes in exactly as sent', [...off.files.values()][0].includes(sent));
    const none = await makePlugin();
    serve({ 'GET /v1/pull': pages([text(72, sent)]) });
    await none.p.sync(false);
    ok('no Templater: exactly as sent', [...none.files.values()][0].includes(sent));
  }

  console.log('── 3.1.2: names every system takes ──');
  {
    const { sanitize, noteTitle } = DropitPlugin;
    const title = noteTitle(text(80, '\x1b[31mred\x07 alert'));
    ok('control characters never reach a note name', !/[\u0000-\u001f\u007f-\u009f]/.test(title) && title.includes('red'), JSON.stringify(title));
    const emoji = sanitize('😀'.repeat(130));
    ok('cut between characters, never inside an emoji', !/[\ud800-\udbff](?![\udc00-\udfff])/.test(emoji) && Array.from(emoji).length <= 120, String(emoji.length));
    const zh = sanitize('会议纪要'.repeat(40) + '.pdf');
    ok('a long Chinese file name fits 200 bytes (Android allows 255) and keeps .pdf', new TextEncoder().encode(zh).byteLength <= 200 && zh.endsWith('.pdf'), zh.slice(-6));
    ok('names Windows keeps for devices get a prefix', sanitize('CON.png') === '_CON.png' && sanitize('nul') === '_nul', sanitize('CON.png'));
    ok('no dots or spaces at the end (Windows drops them)', sanitize('notes. . .') === 'notes', JSON.stringify(sanitize('notes. . .')));
    ok('an ordinary name is unchanged', sanitize('IMG_1587.jpg') === 'IMG_1587.jpg');
  }

  {
    const { noteTitle } = DropitPlugin;
    ok('a title keeps what reads: quotes and <> dropped, not turned into _', noteTitle(text(81, '<% "PWNED" %>')) === '09-17 08.00 % PWNED %', noteTitle(text(81, '<% "PWNED" %>')));
    ok('…a path still reads as one', noteTitle(text(82, 'https://example.com/a/b', { kind: 'url' })) === '09-17 08.00 example.com_a_b');
    ok('…nothing left but symbols: just the time', noteTitle(text(83, '"<>"')) === '09-17 08.00', noteTitle(text(83, '"<>"')));
  }

  console.log('── 3.1.2: each pull says why it happens (the server counts them; nothing else changes) ──');
  {
    const { p } = await makePlugin();
    const calls = serve({ 'GET /v1/pull': pages(), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
    const whyOf = () => new URLSearchParams(calls.filter((c) => c.path.startsWith('/v1/pull')).at(-1).path.split('?')[1]).get('why');
    await p.sync(true);
    ok('by hand: manual', whyOf() === 'manual', whyOf());
    await p.sync(false, { why: 'focus' });
    ok('coming back to the window: focus', whyOf() === 'focus', whyOf());
    await p.start();
    ok('opening: open', calls.some((c) => /[?&]why=open\b/.test(c.path)), JSON.stringify(calls.map((c) => c.path)));
    await p.repull('all');
    ok('pulling again: repull', whyOf() === 'repull', whyOf());
  }

  console.log('── 3.1.2: stopped mid-sync, sending, addresses ──');
  {
    const { p, files, vault } = await makePlugin();
    const create = vault.create;
    vault.create = async (path, s) => { const r = await create(path, s); p.unloaded = true; return r; };   // turned off right after the first note
    serve({ 'GET /v1/pull': pages([text(90, 'one'), text(91, 'two'), text(92, 'three')]) });
    await p.sync(false);
    ok('turned off mid-sync: no more notes are written', [...files.keys()].length === 1, [...files.keys()].join());
    ok('…and the place reached is kept, so the next copy carries on from it', p.stored.cursor === 90, String(p.stored.cursor));
  }
  {
    const { p, vault } = await makePlugin();
    let reads = 0;
    vault.readBinary = async () => { reads++; return new ArrayBuffer(8); };
    serve({ 'POST /v1/ingest/file': () => ({ status: 413, json: { error: 'PAYLOAD_TOO_LARGE', field: 'size', limit: 5 << 20 } }) });
    notices.length = 0;
    await p.sendFiles([{ path: 'big.mov', name: 'big.mov', extension: 'mov', stat: { size: 900 << 20 } }]);
    ok('a file too large is refused before it is read into memory', reads === 0 && notices.some((n) => /big\.mov/.test(n)), `${reads} ${JSON.stringify(notices)}`);
  }
  {
    const { p } = await makePlugin({ endpoints: ['http://evil.example', 'http://127.0.0.1:8799', 'https://ok.example'] });
    const list = p.endpointList();
    ok('the key only goes to https addresses (or this machine)', !list.includes('http://evil.example') && list[0] === 'http://127.0.0.1:8799'
      && list.includes('https://ok.example'), JSON.stringify(list));
  }

  console.log('── 3.1.2: real-time never comes back faster while something is wrong ──');
  // Plugins from earlier tests are still around: count only this test's own requests (by its key)
  const ticketsOf = (token) => {
    const count = { n: 0 };
    net = async (req) => {
      const { pathname } = new URL(req.url);
      if (pathname === '/v1/ws/ticket') {
        if (req.headers?.authorization === `Bearer ${token}`) count.n++;
        return { status: 200, json: { ticket: 't', realtime_until: null } };
      }
      return { status: 200, json: { items: [], has_more: false, next_after: 0 } };
    };
    return count;
  };
  {
    globalThis.WebSocket = class { constructor(u) { this.url = String(u); this.readyState = 0; } close() { this.closed = true; } send() {} };
    const setTimeout = window.setTimeout;
    const held = [];
    window.setTimeout = (fn, ms) => { timers.push(ms); held.push({ fn, ms }); return held.length; };   // nothing fires unless the test says so
    try {
      const { p } = await makePlugin({ token: 'dk_rt1' });
      const tickets = ticketsOf('dk_rt1');
      await p.connect();
      const first = p.socket;
      ok('the connection asks to be told why it is let go (can=end)', /[?&]can=end\b/.test(first.url), first.url);
      first.readyState = 1; first.onopen();
      timers.length = 0; notices.length = 0;
      first.onmessage({ data: JSON.stringify({ type: 'end', end: 'too_many', limit: 12 }) });
      ok('told the account\'s connections are full: real-time pauses and says why, once', p.noRealtime && p.realtimeWhy === 'too_many'
        && notices.filter((n) => /paused/.test(n)).length === 1, JSON.stringify(notices));
      ok('…and tries again in about 15 minutes, not sooner', timers.length === 1 && timers[0] >= 15 * 60_000 && timers[0] <= 22.5 * 60_000, JSON.stringify(timers));
      const before = tickets.n;
      p.heartbeat(); p.heartbeat();
      ok('…the heartbeat leaves it alone meanwhile', tickets.n === before, String(tickets.n - before));
      held[p.retryTimer - 1].fn(); for (let i = 0; i < 4; i++) await settle();   // 15 minutes later
      const second = p.socket;
      ok('…then it connects again', second && second !== first, String(!!second));
      second.readyState = 1; second.onopen();
      second.onmessage({ data: JSON.stringify({ type: 'end', end: 'too_many', limit: 12 }) });
      ok('…full again: no second notice', notices.filter((n) => /paused/.test(n)).length === 1, JSON.stringify(notices));
    } finally { window.setTimeout = setTimeout; delete globalThis.WebSocket; }
  }
  {
    globalThis.WebSocket = class { constructor() { this.readyState = 0; } close() { this.closed = true; } send() {} };
    const setTimeout = window.setTimeout;
    const held = [];
    window.setTimeout = (fn, ms) => { timers.push(ms); held.push({ fn, ms }); return held.length; };
    try {
      const { p } = await makePlugin({ token: 'dk_rt2' });
      const tickets = ticketsOf('dk_rt2');
      const waits = [];
      let extra = 0;
      for (let round = 0; round < 8; round++) {
        if (!p.socket) await p.connect();
        const s = p.socket;
        s.readyState = 1; s.onopen();
        timers.length = 0;
        s.readyState = 3; s.onclose();                          // let go right after opening, over and over
        waits.push(timers.at(-1));
        const asked = tickets.n;
        p.heartbeat(); p.heartbeat();                           // a retry is on its way: the heartbeat must not start another
        for (let i = 0; i < 4; i++) await settle();
        if (tickets.n !== asked) extra++;
        held[p.reconnectTimer - 1].fn(); for (let i = 0; i < 4; i++) await settle();
      }
      ok('let go right after opening, again and again: the wait grows to a minute instead of staying at a second',
        waits[0] < 1_600 && waits.at(-1) >= 60_000, JSON.stringify(waits.map(Math.round)));
      ok('…and the heartbeat never asks while a retry is waiting (3.1.1 asked on both: twice a minute)', extra === 0 && tickets.n === waits.length + 1, `${extra} ${tickets.n}`);

      // Silent too long: let go at once and retry, without waiting for a close event that may never come
      if (!p.socket) await p.connect();
      const stale = p.socket;
      stale.readyState = 1; stale.onopen();
      p.lastBeat = Date.now() - 10 * 60_000;
      timers.length = 0;
      p.heartbeat();
      ok('a silent connection is let go at once and a retry scheduled (no waiting for onclose)', stale.closed && p.socket === null && timers.length === 1, JSON.stringify(timers));
    } finally { window.setTimeout = setTimeout; delete globalThis.WebSocket; }
  }
  {
    globalThis.WebSocket = class { constructor() { this.readyState = 0; } close() {} send() {} };
    const setTimeout = window.setTimeout;
    window.setTimeout = (fn, ms) => { timers.push(ms); return 0; };
    try {
      const { p } = await makePlugin();
      serve({ 'POST /v1/ws/ticket': () => ({ status: 503, json: { error: 'GLOBAL_CIRCUIT_OPEN', retry_after: 3600 } }), 'GET /v1/pull': pages() });
      timers.length = 0;
      await p.connect();
      ok('the server says come back in an hour: the next try waits at least that long', timers.length === 1 && timers[0] >= 3_600_000, JSON.stringify(timers));
    } finally { window.setTimeout = setTimeout; delete globalThis.WebSocket; }
  }

  // ── Proof of work when creating an account ──
  {
    const { solvePow, powChallengeOk, dkhOf } = DropitPlugin;
    const nodeCrypto = require('node:crypto');
    const vectors = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'clients', 'test', 'vectors', 'pow.json'), 'utf8'));
    const sha = (s) => nodeCrypto.createHash('sha256').update(s, 'utf8').digest();
    const zeroBits = (d) => { let n = 0; for (const b of d) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; } return n; };

    for (const c of vectors.hash.cases) {
      ok(`pow vector "${c.name}": the device key hashes to the reference`, await dkhOf(c.device_key ?? undefined) === c.dkh);
      ok(`pow vector "${c.name}": digest and leading zero bits`, zeroBits(sha(`${c.id}|${c.salt}|${c.dkh}|${c.nonce}`)) === c.leading_zero_bits
        && sha(`${c.id}|${c.salt}|${c.dkh}|${c.nonce}`).toString('hex') === c.digest_hex);
      if (c.valid) ok(`pow vector "${c.name}": the solver finds the reference nonce`, await solvePow({ id: c.id, salt: c.salt, bits: c.bits }, c.dkh) === c.nonce);
    }
    for (const c of vectors.leadingZeroBits) ok(`leading zero bits of ${c.digest_hex.slice(0, 6)}… is ${c.expect}`, zeroBits(Buffer.from(c.digest_hex, 'hex')) === c.expect);
    // Every answer must make the reference check pass, with prefixes of different lengths (one, two or three blocks)
    for (const dk of [undefined, 'extension-0123456789abcdef0123456789abcdef']) {
      const dkh = await dkhOf(dk);
      const ch = { id: 'q1w2e3r4t5y6u7i8o9p0aQ', salt: 'zXcVbNmLkJhGfDsAqWeRtY', bits: 14 };
      const n = await solvePow(ch, dkh);
      ok(`pow: an answer for ${dk ? 'a key' : 'no key'} passes the reference check`, /^(0|[1-9][0-9]*)$/.test(n) && zeroBits(sha(`${ch.id}|${ch.salt}|${dkh}|${n}`)) >= ch.bits, n);
    }
    // It hands the event loop back, and gives up after the time limit
    let pauses = 0, clock = 0;
    const none = await solvePow({ id: 'a', salt: 'b', bits: 26 }, '-', { limitMs: 50, now: () => (clock += 5), pause: async () => { pauses++; } });
    ok('pow: no answer within the limit gives null, after yielding between slices', none === null && pauses > 0, JSON.stringify([none, pauses]));

    const good = { v: 1, id: 'AAAAAAAAAAAAAAAAAAAAAA', iat: 1760000000000, exp: 1760000300000, purpose: 'accounts.create', bits: 8, salt: 'BBBBBBBBBBBBBBBBBBBBBB', used: 3, sig: 'sig' };
    ok('challenge: a valid one is accepted', powChallengeOk(good) && powChallengeOk({ ...good, bits: 26 }));
    ok('challenge: bits above 26, another version or purpose, or nothing is refused',
      !powChallengeOk({ ...good, bits: 27 }) && !powChallengeOk({ ...good, v: 2 }) && !powChallengeOk({ ...good, purpose: 'x' }) && !powChallengeOk(null) && !powChallengeOk('x'));

    const vault = (id) => { const m = new Map(); return { appId: id, loadLocalStorage: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), saveLocalStorage: (k, v) => m.set(k, JSON.stringify(v)) }; };
    const refuse = (extra) => ({ status: 403, json: { error: 'TURNSTILE_REQUIRED', retry: true, ...extra } });
    const verified = (body) => body.pow && body.pow.id === good.id && /^[0-9]+$/.test(body.pow.nonce)
      && zeroBits(sha(`${body.pow.id}|${body.pow.salt}|${body.device_key ? sha(body.device_key).toString('hex') : '-'}|${body.pow.nonce}`)) >= body.pow.bits;

    // A challenge: solved, and the same request sent once more with `pow`
    notices.length = 0;
    let c1 = await makePlugin({ token: '' }, {}, vault('powA'));
    let calls = serve({ 'POST /v1/accounts': (body) => (body.pow ? { json: { token: 'dk_pow', device_id: 'd_pow' } } : refuse({ challenge: good })), 'GET /v1/pull': pages([]) });
    await c1.p.createAccount();
    const posts = calls.filter((c) => c.path === '/v1/accounts').map((c) => JSON.parse(c.body));
    ok('challenge: the request is sent twice — the second one carries pow, the first did not', posts.length === 2 && !posts[0].pow && !!posts[1].pow, JSON.stringify(posts));
    ok('…everything else in the request is the same', posts[1].device_name === posts[0].device_name && posts[1].device_key === posts[0].device_key && /^[0-9a-f]{64}$/.test(posts[0].device_key ?? ''));
    ok('…pow is the challenge sent back unchanged, plus the nonce', Object.entries(good).every(([k, v]) => posts[1].pow[k] === v) && Object.keys(posts[1].pow).length === Object.keys(good).length + 1);
    ok('…and its nonce is a real answer for the device key sent', verified(posts[1]));
    ok('…the account was created and the user was told it is being prepared', c1.p.settings.token === 'dk_pow' && notices.some((n) => /preparing/.test(n)), JSON.stringify([c1.p.settings.token, notices]));

    // No device key at all: the answer is tied to "-"
    calls = serve({ 'POST /v1/accounts': (body) => (body.pow ? { json: { token: 'dk_pow2', device_id: 'd_pow2' } } : refuse({ challenge: good })), 'GET /v1/pull': pages([]) });
    c1 = await makePlugin({ token: '' }, {}, {});
    await c1.p.createAccount();
    const p2 = calls.filter((c) => c.path === '/v1/accounts').map((c) => JSON.parse(c.body));
    ok('no device key: the second request has no device_key and its answer is tied to "-"', p2.length === 2 && p2[1].device_key === undefined && verified(p2[1]), JSON.stringify(p2));

    // Too hard: not solved, not sent again, the usual message
    for (const [why, ch] of [['bits above the limit', { ...good, bits: 27 }], ['another version', { ...good, v: 2 }], ['another purpose', { ...good, purpose: 'x' }], ['no challenge', undefined]]) {
      calls = serve({ 'POST /v1/accounts': () => refuse(ch ? { challenge: ch } : {}) });
      c1 = await makePlugin({ token: '' }, {}, vault('powB'));
      let err;
      try { await c1.p.createAccount(); } catch (e) { err = e; }
      ok(`${why}: nothing is solved, one request, the browser message`, calls.filter((c) => c.path === '/v1/accounts').length === 1 && err?.code === 'TURNSTILE_REQUIRED' && /browser/.test(err.message), JSON.stringify([err?.message, calls.length]));
    }

    // Still refused after answering: a new challenge comes back, and it is not answered again
    calls = serve({ 'POST /v1/accounts': () => refuse({ challenge: good }) });
    c1 = await makePlugin({ token: '' }, {}, vault('powC'));
    let err2;
    try { await c1.p.createAccount(); } catch (e) { err2 = e; }
    ok('refused again after answering: exactly two requests, then the error', calls.filter((c) => c.path === '/v1/accounts').length === 2 && err2?.code === 'TURNSTILE_REQUIRED', String(calls.length));

    // A different refusal is untouched
    calls = serve({ 'POST /v1/accounts': () => ({ status: 429, json: { error: 'SIGNUP_LIMITED', challenge: good } }) });
    c1 = await makePlugin({ token: '' }, {}, vault('powD'));
    let err3;
    try { await c1.p.createAccount(); } catch (e) { err3 = e; }
    ok('another error code with a challenge is not answered', err3?.code === 'SIGNUP_LIMITED' && calls.every((c) => !c.body || !JSON.parse(c.body).pow), JSON.stringify([calls.length, err3?.code]));
  }


  // ════════════════════════════════════════════════════════════════════════
  // Auto-processing: an item goes to the person's own agent, the answer to a note beside it
  // ════════════════════════════════════════════════════════════════════════
  const nodePath = require('node:path');
  const nodeFs = require('node:fs');
  const FAKE = nodePath.join(__dirname, 'test-vectors', 'fake-agent.mjs');
  const VECTORS = JSON.parse(nodeFs.readFileSync(nodePath.join(__dirname, 'test-vectors', 'handlers.json'), 'utf8'));
  DropitPlugin = loadPlugin('en');
  const X = new Proxy({}, { get: (_, k) => DropitPlugin[k] });   // always the copy of main.js the plugins below were made from
  const sorted = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  /** A rule for the stand-in agent (a custom command: node running test-vectors/fake-agent.mjs). Never a real agent.
   *  The source is kept by default here, so an answer is a separate note; the tests of the one-note way say so. */
  const fakeRule = (extra = {}) => ({ id: 'r1', name: 'Fake', enabled: true, auto: true, agent: 'custom', argv: [process.execPath, FAKE],
    kinds: ['text', 'url', 'image'], mode: 'think', prompt: 'Do the thing.', keepSource: true, ...extra });
  const agentsOf = (rules, extra = {}) => ({ agents: { v: 1, consented: true, paused: false, handlers: rules, ...extra } });
  const LONG = 'The supplier meeting is on Thursday at three, bring last quarter quotes and send the minutes to legal before Friday.';
  const resultsIn = (files) => [...files.keys()].filter((k) => k.includes(' · '));
  const notesIn = (files) => [...files.keys()].filter((k) => k.endsWith('.md') && !k.includes(' · '));
  const answerOf = (content) => content.split('\n\n---\n\n')[1];
  const allSpawned = () => nodeLoads.filter((m) => /child_process/.test(m)).length;
  /** What detection finds on the machine in these tests: claude with its checked modes, codex and pi unchecked, two absent */
  const FOUND = [
    { id: 'claude', label: 'Claude Code', path: '/fake/bin/claude', verified: 'Claude Code 2.1.301', modes: ['think', 'files', 'web'] },
    { id: 'codex', label: 'Codex CLI', path: '/fake/bin/codex', verified: null, modes: [] },
    { id: 'grok', label: 'Grok CLI', path: null, verified: null, modes: [] },
    { id: 'gemini', label: 'Gemini CLI', path: null, verified: null, modes: [] },
    { id: 'pi', label: 'Pi', path: '/fake/bin/pi', verified: null, modes: [] },
  ];
  const ALL = ['ocr', 'audio', 'link', 'sum'];

  console.log('── The settings page points to the other clients ──');
  {
    const { p } = await makePlugin();
    ui.names.length = 0; ui.buttons.length = 0;
    p.tab.containerEl = anything();
    p.api = async (method, path) => (path === '/v1/devices' ? { devices: [] } : { plan: 'free', devices_used: 1, devices_limit: 2, bytes_used: 0, bytes_limit: 31457280 });
    p.tab.display();
    for (let i = 0; i < 10; i++) await settle();
    const T = X.STRINGS.en;
    ok('Devices keeps "Add a device" as its one action, and a quiet line (not a block) points to the install page', ui.names.includes(T.addDevice) && !ui.names.includes('Get dropit on your other devices') && /install/i.test(T.set.installLink) && /phone/i.test(T.set.install));
    ok('…the link goes to the list of clients to install, not to the home page', X.INSTALL_URL === 'https://dropit.smart-kits.xyz/#install');
    ok('…in both languages', T.set.installLink && X.STRINGS.zh.set.installLink && X.STRINGS.zh.set.install);
  }

  console.log('── Auto-processing: the embedded runner matches the shared vectors ──');
  {
    for (const c of VECTORS.plan) ok(`runner plan: ${c.name}`, same(X.planRun(c.handler, c.item), c.expect), JSON.stringify(X.planRun(c.handler, c.item)));
    for (const c of VECTORS.compose) ok(`runner compose: ${c.name}`, X.composeInput(c.handler, c.item, c.fileNames) === c.expect);
    for (const c of VECTORS.sanitize) ok(`runner sanitize: ${c.name}`, X.sanitizeAnswer(c.input) === c.expect, JSON.stringify(X.sanitizeAnswer(c.input)));
    for (const c of VECTORS.env) ok(`runner env: ${c.name}`, same(X.agentEnv(c.bin, c.base), c.expect));
    for (const c of VECTORS.fileNames) ok(`runner file name: ${JSON.stringify(c.input).slice(0, 30)}`, X.safeFileName(c.input) === c.expect);
    for (const c of VECTORS.linkHost) ok(`runner link host: ${c.input}`, X.linkHost(c.input) === c.expect);
    ok('claude is the only agent with checked settings', Object.keys(X.RUN_AGENTS.claude.modes).join() === 'think,files,web,open'
      && ['codex', 'grok', 'gemini', 'pi'].every((id) => Object.keys(X.RUN_AGENTS[id].modes).length === 0 && X.RUN_AGENTS[id].verified === null));
    // Full access: only a rule that asks for it gets it, it survives saving and upgrading, and a changed agent or command drops it
    ok('open mode: the rule keeps it through cleaning and upgrading', X.upgradeRule(X.cleanRule({ id: 'r1', name: 'a', agent: 'claude', mode: 'open', kinds: ['text'] })).mode === 'open');
    ok('open mode: a made-up mode becomes auto', X.cleanRule({ id: 'r1', name: 'a', agent: 'claude', mode: 'sudo', kinds: ['text'] }).mode === 'auto');
    ok('open mode: picking another agent starts from auto again', (() => { const r = { mode: 'open', agent: 'claude' }; X.pickAgent(r, 'claude', []); return r.mode === 'auto'; })());
    ok('open mode: a typed command is a command of the person\'s own, not open', (() => { const r = { mode: 'open', agent: 'claude' }; X.applyCommand(r, 'claude', 'mytool -x', 'claude -p', []); return r.agent === 'custom' && r.mode === 'auto'; })());
    ok('open mode: the command line shown is the one that runs', X.commandLine('claude', null, 'open') === 'claude -p --no-session-persistence');
    ok('open mode: the preview lists the environment by name only', (() => { const pv = X.previewOf({ id: 'r', name: 'a', enabled: true, auto: true, agent: 'claude', mode: 'open', kinds: ['text'], prompt: 'x' }, 'text', { base: { MY_KEY: 'secret' } }); return pv.env.MY_KEY === '…' && !JSON.stringify(pv.env).includes('secret'); })());
    // The link line learned about sites that need a login and about posts that can be read another way: a rule that still has 3.2.0's default gets today's
    for (const l of ['en', 'zh']) {
      const oldLink = l === 'en'
        ? '- Link: open the page and read it; say in one sentence what it is about, then give 3 to 5 key points and its conclusion or what is worth noting; list anything it asks you to do; if you cannot open it, say so instead of guessing from the address.'
        : '- 链接：打开页面读正文，用一句话说它讲什么，再列 3 到 5 个要点，写出它的结论或值得注意之处；页面里有需要去做的事也列出；打不开就直接说打不开，不要根据网址猜。';
      const parts = ['sum', 'link'];
      const fresh = X.composePrompt(parts, l);
      const prev = fresh.replace(fresh.split('\n').find((x) => x.startsWith(l === 'en' ? '- Link' : '- 链接')), oldLink);
      ok(`the link line: a 3.2.0 default prompt (${l}) becomes today's`, prev !== fresh && (() => { const up = X.upgradeRule({ agent: 'claude', mode: 'auto', parts, prompt: prev }).prompt; return up !== prev && up.includes('api.fxtwitter.com'); })());   // written in the language the plugin is in now, as every earlier upgrade was
      ok(`the link line: a prompt the person edited (${l}) is left alone`, X.upgradeRule({ agent: 'claude', mode: 'auto', parts, prompt: prev + ' mine' }).prompt === prev + ' mine');
    }
    ok('the agents looked for are the five, in this order', Object.keys(X.RUN_AGENTS).join() === 'claude,codex,grok,gemini,pi');
    ok('the words of the rule and the document: the same as in the command line tool', X.composePrompt(['sum', 'ocr'], 'en').split('\n').length === 4
      && same(X.kindsFor(['ocr']), ['image', 'file']) && X.modeFor({}, { kind: 'url' }) === 'web'
      && X.resultDocument({ kind: 'text', text: 'a' }, '', 'b') === '> a\n\n---\n\nb\n'
      && same(X.suggestArgv('pi', '/x/pi'), ['/x/pi', '-p', '--no-tools']));
    const src = nodeFs.readFileSync(require.resolve('./main.js'), 'utf8');
    const block = (text) => text.slice(text.indexOf('// agent-runner:begin v1'), text.indexOf('// agent-runner:end'));
    ok('the block in main.js is exactly one pair of markers', src.split('// agent-runner:begin v1').length === 2 && src.split('// agent-runner:end').length === 2 && block(src).includes('async function runHandler'));
  }

  console.log('── Auto-processing: Node is only reached for on the desktop ──');
  {
    DropitPlugin = loadPlugin('en');
    ok('loading main.js asks for no Node module at all', nodeLoads.length === 0 || nodeLoads.every((m) => m === 'obsidian'), nodeLoads.join());
    nodeLoads.length = 0;
    platform.isDesktopApp = false;
    const { p, files, fm } = await makePlugin(agentsOf([fakeRule()]));
    let detects = 0;
    p.detect = async () => { detects++; return []; };
    serve({ 'GET /v1/pull': pages([text(300, LONG)]) });
    await p.sync(false);
    await p.hookQueue;
    ok('a phone: the item still arrives as a note', files.has('Inbox/09-17 08.00 The supplier meeting is on Thursday at three.md') || [...files.keys()].some((k) => k.startsWith('Inbox/09-17 08.00')), [...files.keys()].join());
    ok('…no result note, no run, nothing started', resultsIn(files).length === 0 && p.runs.length === 0, JSON.stringify(p.runs));
    ok('…and not one Node module was asked for', nodeLoads.length === 0, nodeLoads.join());
    const res = await p.processWith(p.settings.agents.handlers[0], { seq: 1, kind: 'text', text: 'x', meta: {}, files: [], note: 'Inbox/a.md', batch: null }, { manual: true });
    ok('even by hand, a phone starts nothing', res.ok === false && res.why === 'desktop-only' && nodeLoads.length === 0, JSON.stringify([res, nodeLoads]));
    ok('the commands are not offered', p.commands.filter((c) => /process|rerun/.test(c.id)).every((c) => c.checkCallback(true) === false));
    let thrown = null;
    try { X.nodeDeps(); } catch (e) { thrown = e; }
    ok('nodeDeps refuses outright', !!thrown && nodeLoads.length === 0);
    // the settings page: a heading and one line, no controls, no look for agents
    ui.names.length = 0; ui.buttons.length = 0; ui.toggles.length = 0;
    p.tab.containerEl = anything();
    p.api = async (method, path) => (path === '/v1/devices' ? { devices: [] } : { plan: 'free', devices_used: 1, devices_limit: 2, bytes_used: 0, bytes_limit: 31457280 });
    p.tab.display();
    for (let i = 0; i < 10; i++) await settle();
    const A = X.STRINGS.en.agents;
    ok('the settings page on a phone has no AI controls', !ui.names.includes(X.STRINGS.en.set.ai) && !ui.names.includes(X.STRINGS.en.set.agent) && !ui.names.includes(X.STRINGS.en.set.command), ui.names.join('|'));
    ok('…and offers no switch and no look for agents', !ui.toggles.some((t2) => t2.name === X.STRINGS.en.set.ai) && detects === 0 && nodeLoads.length === 0 && /desktop/i.test(X.STRINGS.en.set.desktopOnly));
    platform.isDesktopApp = true;
  }

  console.log('── Auto-processing: the first time it starts a program, on the desktop ──');
  {
    DropitPlugin = loadPlugin('en');
    nodeLoads.length = 0;
    const { p, files } = await makePlugin(agentsOf([fakeRule()]));
    serve({ 'GET /v1/pull': pages([text(301, LONG)]) });
    await p.sync(false);
    await p.hookQueue;
    ok('a desktop asks for fs, path and child_process — and not for os', ['fs', 'path', 'child_process'].every((m) => nodeLoads.includes(m)) && !nodeLoads.includes('os'), nodeLoads.join());
    ok('…and there is an answer beside the note', resultsIn(files).length === 1, [...files.keys()].join());
    ok('the commands are offered', p.commands.filter((c) => /process-note|rerun-last/.test(c.id)).length === 2);
  }

  console.log('── Auto-processing: the rule and its settings ──');
  {
    const none = X.normalizeAgents(undefined);
    ok('default: version 1, not confirmed, not paused, no rule', same(none, { v: 1, consented: false, paused: false, recent: 3, handlers: [] }), JSON.stringify(none));
    ok('junk is cleaned: unknown fields dropped, kinds limited to the five, numbers repaired, the permission per item by default', (() => {
      const r = X.cleanRule({ id: 'a', name: ' N ', enabled: 1, auto: true, agent: 'claude', kinds: ['text', 'bogus', 'text', 'url'], mode: 'nonsense', prompt: 7, timeoutSec: -3, maxChars: 'x', evil: 'drop me', minChars: '' });
      return same(r, { id: 'a', name: 'N', enabled: false, auto: true, agent: 'claude', kinds: ['text', 'url'], mode: 'auto', parts: [], keepSource: false, prompt: '7', timeoutSec: 120, maxChars: 20000, maxFileMB: 10 });
    })(), JSON.stringify(X.cleanRule({ id: 'a', kinds: ['x'] })));
    ok('minChars is only kept when set', X.cleanRule({ name: 'x', minChars: '12' }).minChars === 12 && !('minChars' in X.cleanRule({ name: 'x', minChars: '' })) && !('minChars' in X.cleanRule({ name: 'x', minChars: 0 })));
    ok('a custom command keeps its argument list, and any permission the person named', (() => {
      const r = X.cleanRule({ name: 'c', agent: 'custom', argv: ['/bin/x', '', 7, '-v'], mode: 'files', kinds: ['text'] });
      return same(r.argv, ['/bin/x', '-v']) && r.mode === 'files';
    })());
    ok('only a web rule keeps a website', X.cleanRule({ name: 'w', mode: 'web', webDomain: ' Example.COM ' }).webDomain === 'example.com' && !('webDomain' in X.cleanRule({ name: 'w', mode: 'think', webDomain: 'example.com' })));
    ok('the parts keep their order and only the four; keepSource only when true', same(X.cleanRule({ name: 'p', parts: ['sum', 'nope', 'ocr'], keepSource: true }).parts, ['ocr', 'sum']) && X.cleanRule({ name: 'p', keepSource: 'yes' }).keepSource === false && X.cleanRule({ name: 'p', keepSource: true }).keepSource === true);
    ok('what was picked in the list is kept only when it is one we know', X.cleanRule({ name: 'p', pick: 'codex' }).pick === 'codex' && X.cleanRule({ name: 'p', pick: 'custom' }).pick === 'custom' && !('pick' in X.cleanRule({ name: 'p', pick: 'evil' })));
    ok('one argument per line; blank lines are no argument', same(X.argvOf('/usr/bin/env\n\n  -i \r\nx'), ['/usr/bin/env', '-i', 'x']));
    ok('a rule without a name, a kind, or (custom) a command is refused with a reason', !!X.ruleProblem(X.cleanRule({ name: '', kinds: ['text'] })) && !!X.ruleProblem(X.cleanRule({ name: 'a', kinds: [] }))
      && !!X.ruleProblem(X.cleanRule({ name: 'a', agent: 'custom', kinds: ['text'] })) && X.ruleProblem(X.cleanRule({ name: 'a', agent: 'custom', argv: ['/x'], kinds: ['text'] })) === null);
    ok('there is only ever one rule', X.normalizeAgents({ handlers: [{ name: 'a', kinds: ['text'] }, { name: 'b', kinds: ['text'] }] }).handlers.length === 1);
    ok('a record of runs is not part of what is stored', !('log' in X.normalizeAgents({ log: [{ at: 1 }] })));

    ok('recent: 3 by default, 0 and up to 1000 kept, anything else back to 3', [undefined, 0, 7, 1000, 1001, -1, 2.5, '5'].map((v) => X.normalizeAgents({ recent: v }).recent).join() === '3,0,7,1000,3,3,3,3');
    ok('a model is kept only for claude and only when it is a plain model name', X.cleanRule({ name: 'm', agent: 'claude', model: ' sonnet ' }).model === 'sonnet'
      && !('model' in X.cleanRule({ name: 'm', agent: 'claude', model: '--evil x' })) && !('model' in X.cleanRule({ name: 'm', agent: 'codex', model: 'sonnet' })) && !('model' in X.cleanRule({ name: 'm', agent: 'claude', model: '' })));
    {
      const { p: bp } = await makePlugin(agentsOf([fakeRule()], { consented: true }));
      const seen = [];
      bp.autoProcess = async (pl) => { seen.push(pl.n); };
      const notes = [];
      const list = Array.from({ length: 7 }, (_, n) => ({ n }));
      await bp.runAuto(list);
      ok('seven at once: the newest three go to the rule, in order', same(seen, [4, 5, 6]), JSON.stringify(seen));
      seen.length = 0; bp.settings.agents.recent = 0;
      await bp.runAuto(list);
      ok('recent 0: all of them', seen.length === 7);
      seen.length = 0; bp.settings.agents.recent = 3;
      await bp.runAuto(list.slice(0, 3));
      ok('three or fewer: all of them', same(seen, [0, 1, 2]));
    }

    const { p } = await makePlugin(agentsOf([fakeRule()]));
    p.settings.agents.paused = true;
    p.settings.agents.handlers[0].prompt = 'changed';
    p.settings.agents.handlers[0].parts = ['ocr', 'link'];
    p.settings.agents.handlers[0].keepSource = false;
    await p.save();
    ok('the rule, the confirmation and the pause are kept with the other settings', p.stored.agents.paused === true && p.stored.agents.consented === true
      && p.stored.agents.handlers[0].prompt === 'changed' && p.stored.token === 'dk_x' && !('log' in p.stored.agents));
    const again = await makePlugin({}, p.stored);
    ok('…and come back after a restart', again.p.settings.agents.paused === true && again.p.settings.agents.handlers[0].name === 'Fake'
      && same(again.p.settings.agents.handlers[0].parts, ['ocr', 'link']) && again.p.settings.agents.handlers[0].keepSource === false);
    const old = await makePlugin({ folder: 'In' });
    ok('settings from before this existed load with nothing set up', old.p.settings.agents.consented === false && old.p.settings.agents.handlers.length === 0 && old.p.settings.folder === 'In');
  }

  console.log('── Auto-processing: the one rule ──');
  {
    const r = X.newRule('claude', null, ALL, false, 'en');
    ok('Claude Code: its own agent, no command of its own, the permission per item, off until turned on', r.agent === 'claude' && !('argv' in r) && r.pick === 'claude' && r.mode === 'auto' && r.enabled === false && r.auto === true && r.name === 'Auto' && r.keepSource === false);
    ok('all four parts cover every kind', same(r.kinds, ['text', 'url', 'image', 'video', 'file']) && same(r.parts, ALL));
    ok('the prompt is the frame and the four lines', r.prompt === X.composePrompt(['ocr', 'audio', 'link', 'sum'], 'en'), r.prompt);
    ok('defaults: 120 s, 20000 characters, 10 MB, and no minimum length', r.timeoutSec === 120 && r.maxChars === 20000 && r.maxFileMB === 10 && !('minChars' in r));
    ok('a rule survives being stored', same(X.cleanRule(r), r));
    const cx = X.newRule('codex', ['/fake/bin/codex', 'exec'], ['sum']);
    ok('an agent with no checked settings is a command of the person\'s own, and remembers what was picked', cx.agent === 'custom' && same(cx.argv, ['/fake/bin/codex', 'exec']) && cx.pick === 'codex' && same(cx.kinds, ['text']));
    DropitPlugin = loadPlugin('zh');
    const zh = X.newRule('claude', null, ALL, false, 'zh');
    ok('made in Chinese, it carries the Chinese words', zh.name === '自动处理' && zh.prompt === X.composePrompt(['ocr', 'audio', 'link', 'sum'], 'zh'), zh.prompt);
    DropitPlugin = loadPlugin('en');
    // changing the ticks
    const q = X.newRule('claude', null, ALL, false, 'en');
    X.setParts(q, ['ocr', 'sum']);
    ok('ticking changes the kinds, and a prompt nobody edited follows', same(q.parts, ['ocr', 'sum']) && same(q.kinds, ['text', 'image', 'file']) && q.prompt === X.composePrompt(['ocr', 'sum'], 'en') && q.prompt.split('\n').length === 4);
    q.prompt = 'My own words';
    X.setParts(q, ['link']);
    ok('a prompt the person wrote stays as it is', q.prompt === 'My own words' && same(q.kinds, ['url']));
    X.setParts(q, ['sum', 'ocr', 'audio']);
    ok('the parts keep their order', same(q.parts, ['ocr', 'audio', 'sum']));
    // picking the command
    const k = X.newRule('claude', null, ALL, false, 'en');
    X.pickAgent(k, 'codex', FOUND);
    ok('picking an agent with no checked settings: a command of the person\'s own, started from its help\'s arguments', k.agent === 'custom' && k.pick === 'codex' && same(k.argv, ['/fake/bin/codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral']), JSON.stringify(k));
    X.pickAgent(k, 'pi', FOUND);
    ok('Pi starts with no tools', same(k.argv, ['/fake/bin/pi', '-p', '--no-tools']));
    X.pickAgent(k, 'claude', FOUND);
    ok('picking Claude Code again: its own agent, and the command is gone', k.agent === 'claude' && k.pick === 'claude' && !('argv' in k));
    X.pickAgent(k, 'custom', FOUND);
    ok('picking a command of one\'s own: an empty command to fill in', k.agent === 'custom' && k.pick === 'custom' && same(k.argv, []));
    const note = (pick) => { const rr = X.newRule('claude', null, ALL, false, 'en'); X.pickAgent(rr, pick, FOUND); return rr; };
    ok('the first agent found with checked settings is what a new rule starts from', same(await X.defaultPick({ detect: async () => FOUND }), ['claude', null, ALL]));
    ok('…else the first found at all, as a command of one\'s own', same(await X.defaultPick({ detect: async () => FOUND.filter((x) => x.id !== 'claude') }), ['codex', ['/fake/bin/codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral'], ALL]));
    ok('…else a command to write', same(await X.defaultPick({ detect: async () => [] }), ['custom', [], ALL]) && note('claude').agent === 'claude');
  }

  console.log('── Auto-processing: when it runs, and when it does not ──');
  {
    const run = async (agents, item = text(310, LONG), mode = 'note') => {
      const made = await makePlugin({ mode, ...agentsOf([fakeRule()]), ...(agents ? { agents: { v: 1, consented: true, paused: false, handlers: [fakeRule()], ...agents } } : {}) });
      serve({ 'GET /v1/pull': pages([item]) });
      await made.p.sync(false);
      await made.p.hookQueue;
      return made;
    };
    const base = await run({});
    ok('on, automatic, confirmed, not paused: it runs', resultsIn(base.files).length === 1);
    const notConfirmed = await run({ consented: false });
    ok('not confirmed: nothing runs, even for a rule that is on', resultsIn(notConfirmed.files).length === 0 && notConfirmed.p.runs.length === 0);
    const paused = await run({ paused: true });
    ok('paused: nothing runs', resultsIn(paused.files).length === 0 && paused.p.runs.length === 0);
    const off = await run({ handlers: [fakeRule({ enabled: false })] });
    ok('a rule that is off does not run', resultsIn(off.files).length === 0 && off.p.runs.length === 0);
    const byHandOnly = await run({ handlers: [fakeRule({ auto: false })] });
    ok('a rule that is only for by-hand does not run by itself', resultsIn(byHandOnly.files).length === 0 && byHandOnly.p.runs.length === 0);
    const wrongKind = await run({ handlers: [fakeRule({ kinds: ['url'] })] });
    ok('a kind the rule does not list is skipped, and the run says so', resultsIn(wrongKind.files).length === 0 && wrongKind.p.runs[0]?.why === 'skipped:kind', JSON.stringify(wrongKind.p.runs));
    const tooShort = await run({ handlers: [fakeRule({ minChars: 500 })] });
    ok('a minimum length the person set is honoured', resultsIn(tooShort.files).length === 0 && tooShort.p.runs[0]?.why === 'skipped:short');
    const noMin = await run({ handlers: [fakeRule()] }, text(311, 'ok'));
    ok('…and with none set, a two-letter text is processed (dropit sets no minimum)', resultsIn(noMin.files).length === 1);
    const exited = await run({ handlers: [fakeRule({ prompt: 'MODE:fail' })] });
    ok('a failing agent never stops the item arriving: the run says why', [...exited.files.keys()].some((k) => k.startsWith('Inbox/09-17 08.00')) && resultsIn(exited.files).length === 0
      && exited.p.runs[0]?.why === 'exit:3' && /boom/.test(exited.p.runs[0].detail) && exited.p.settings.cursor === 310, JSON.stringify(exited.p.runs));
    ok('…and it is said on screen, once', notices.filter((n) => /couldn’t process #310/.test(n)).length === 1, notices.join('|'));
    const missing = await run({ handlers: [fakeRule({ agent: 'claude', argv: undefined })] });
    ok('an agent that is not on this computer is a failed run, not a crash', resultsIn(missing.files).length === 0 && missing.p.runs[0]?.why === 'agent-missing');
    ok('…and nothing was started for it', missing.p.runs.length === 1);
    notices.length = 0;
    const twice = await makePlugin(agentsOf([fakeRule({ prompt: 'MODE:fail' })]));
    serve({ 'GET /v1/pull': pages([text(380, 'a'), text(381, 'b')]) });
    await twice.p.sync(false);
    await twice.p.hookQueue;
    ok('two failures in a row are one message, not two: a missing agent would fill the screen', twice.p.runs.length === 2 && notices.filter((n) => /couldn’t process/.test(n)).length === 1, notices.join('|'));
  }

  console.log('── Auto-processing: the answer, with the source kept ──');
  {
    const body = `${LONG} MODE:echo`;
    const { p, files } = await makePlugin(agentsOf([fakeRule()]));
    serve({ 'GET /v1/pull': pages([text(320, body)]) });
    await p.sync(false);
    await p.hookQueue;
    const original = [...files.keys()].find((k) => k.endsWith('.md') && !k.includes(' · '));
    const answer = resultsIn(files)[0];
    ok('named after the original and the rule, in the same folder', answer === `${original.slice(0, -3)} · Fake.md`, `${original} → ${answer}`);
    const lines = (files.get(answer) ?? '').split('\n');
    ok('what arrived quoted, a rule, a blank line, then the answer', lines[0] === `> ${body}` && lines[1] === '' && lines[2] === '---' && lines[3] === '' && /^SUMMARY \d+$/.test(lines[4]), JSON.stringify(lines));
    ok('the original is untouched: still just its front matter and the text as sent', files.get(original).endsWith(`${body}\n`) && !files.get(original).includes('SUMMARY'), files.get(original));
    ok('the run says it was done, with the item\'s number and kind', p.runs.length === 1 && p.runs[0].ok === true && p.runs[0].seq === 320 && p.runs[0].kind === 'text');
    ok('the answer note carries no front matter of ours, so a later pull never mistakes it for an item', !files.get(answer).startsWith('---'));

    const kept = files.get(answer);
    const before = p.runs.length;
    serve({ 'GET /v1/pull': pages([text(320, body)]), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
    await p.repull('all');
    await p.hookQueue;
    ok('pulling again does not process it again', resultsIn(files).length === 1 && files.get(answer) === kept && p.runs.length === before, JSON.stringify(p.runs));

    // The name is taken (by an earlier run, or by the person): skip, and leave what is there alone
    const taken = await makePlugin(agentsOf([fakeRule()]));
    taken.files.set(`Inbox/${X.noteTitle(text(321, LONG))} · Fake.md`, 'mine');
    serve({ 'GET /v1/pull': pages([text(321, `${LONG}`)]) });
    await taken.p.sync(false);
    await taken.p.hookQueue;
    const mine = [...taken.files.keys()].filter((k) => k.includes(' · '));
    ok('a name that is already taken is skipped: nothing replaced, nothing numbered, no run', mine.length === 1 && taken.files.get(mine[0]) === 'mine' && taken.p.runs[0]?.why === 'skipped:exists', JSON.stringify([mine, taken.p.runs]));

    // Notes that hold several items: each item gets its own answer, by number
    const daily = await makePlugin({ mode: 'append', appendPath: 'Inbox/dropit.md', ...agentsOf([fakeRule({ keepSource: false })]) });
    serve({ 'GET /v1/pull': pages([text(330, 'first MODE:echo'), text(331, 'second MODE:echo')]) });
    await daily.p.sync(false);
    await daily.p.hookQueue;
    ok('an appended note holds many items, so even with the source not kept each answer is its own note, named with the item\'s number', [...daily.files.keys()].filter((k) => k.includes(' · ')).sort().join() === 'Inbox/dropit · Fake (330).md,Inbox/dropit · Fake (331).md', [...daily.files.keys()].join());
    ok('…and each quotes what arrived', daily.files.get('Inbox/dropit · Fake (331).md').startsWith('> second MODE:echo\n\n---\n\n'));
    ok('…and the appended note has only what was appended', !daily.files.get('Inbox/dropit.md').includes('SUMMARY') && !daily.files.get('Inbox/dropit.md').includes('---\n\nSUMMARY'));

    // Names: safe on every system, and short
    ok('a rule name with characters a file name cannot hold is made safe', X.resultPath('Inbox/a.md', 'A/B: C*', null) === 'Inbox/a · A B C.md', X.resultPath('Inbox/a.md', 'A/B: C*', null));
    ok('a note at the top of the vault gets its answer there too', X.resultPath('a.md', 'R', null) === 'a · R.md', X.resultPath('a.md', 'R', null));

    // Chinese interface
    DropitPlugin = loadPlugin('zh');
    const zh = await makePlugin(agentsOf([fakeRule()]));
    serve({ 'GET /v1/pull': pages([text(340, 'zh MODE:echo')]) });
    await zh.p.sync(false);
    await zh.p.hookQueue;
    ok('a Chinese interface quotes the same way', zh.files.get(resultsIn(zh.files)[0]).startsWith('> zh MODE:echo\n\n---\n\n'));
    DropitPlugin = loadPlugin('en');
  }

  console.log('── Auto-processing: the source not kept — a received text or link becomes its answer ──');
  {
    const body = `${LONG} MODE:echo`;
    const rule = fakeRule({ keepSource: false });
    const made = await makePlugin(agentsOf([rule]));
    serve({ 'GET /v1/pull': pages([text(400, body, { meta: { from: { url: 'https://example.com/post', title: 'A Post' } } })]) });
    await made.p.sync(false);
    await made.p.hookQueue;
    const notes = notesIn(made.files);
    ok('one note, and no second one beside it', notes.length === 1 && resultsIn(made.files).length === 0, [...made.files.keys()].join());
    const note = made.files.get(notes[0]);
    ok('its front matter is still there, then what arrived quoted, a rule, then the answer', /^---\n[\s\S]*dropit_seq: 400[\s\S]*\n---\n\n> /.test(note) && note.includes(`\n---\n\n> ${body}\n\n---\n\nSUMMARY`), note);
    ok('…and the page it came from stays at the end', /\n\n— \[A Post\]\(<?https:\/\/example\.com\/post>?\)\n$/.test(note), note);
    ok('the run says it was done, and where', made.p.runs[0].ok === true && made.p.runs[0].seq === 400);
    const kept = note;
    serve({ 'GET /v1/pull': pages([text(400, body)]), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
    await made.p.repull('all');
    await made.p.hookQueue;
    ok('pulling again changes nothing and runs nothing', made.files.get(notes[0]) === kept && made.p.runs.length === 1, JSON.stringify(made.p.runs));

    // a failed run leaves the note as it arrived
    const failing = await makePlugin(agentsOf([fakeRule({ keepSource: false, prompt: 'MODE:fail' })]));
    serve({ 'GET /v1/pull': pages([text(401, 'plain words')]) });
    await failing.p.sync(false);
    await failing.p.hookQueue;
    const fnote = failing.files.get(notesIn(failing.files)[0]);
    ok('a failed run leaves the note exactly as it arrived', fnote.endsWith('\n\nplain words\n') && !fnote.includes('SUMMARY') && failing.p.runs[0].why === 'exit:3', fnote);

    // a link
    const link = await makePlugin(agentsOf([fakeRule({ keepSource: false, kinds: ['url'], prompt: 'MODE:echo' })]));
    serve({ 'GET /v1/pull': pages([{ seq: 402, kind: 'url', source: 'web', raw: 'https://example.com/a', created_at: AT, bytes: 21, meta: { title: 'A page' } }]) });
    await link.p.sync(false);
    await link.p.hookQueue;
    ok('a link is quoted with its title', link.files.get(notesIn(link.files)[0]).includes('> [A page](<https://example.com/a>)\n\n---\n\n'), link.files.get(notesIn(link.files)[0]));

    // notes that cannot become their answer: appended, daily, a batch, or text that came with files
    for (const mode of ['append', 'daily']) {
      const m = await makePlugin({ mode, appendPath: 'Inbox/dropit.md', ...agentsOf([fakeRule({ keepSource: false })]) });
      serve({ 'GET /v1/pull': pages([text(410, 'one MODE:echo')]) });
      await m.p.sync(false);
      await m.p.hookQueue;
      ok(`${mode}: the note stays as it is and the answer is a note beside it`, resultsIn(m.files).length === 1 && !(m.files.get(notesIn(m.files).find((k) => !m.files.get(k).startsWith('> '))) ?? '').includes('SUMMARY'), [...m.files.keys()].join());
    }
    ok('a text that came with a file is not replaced either', !made.p.canReplace(rule, { kind: 'text', batch: null, files: ['Inbox/a.png'] }) && !made.p.canReplace(rule, { kind: 'text', batch: { id: 'b' }, files: [] }) && made.p.canReplace(rule, { kind: 'url', batch: null, files: [] }) && !made.p.canReplace(rule, { kind: 'image', batch: null, files: [] }) && !made.p.canReplace({ ...rule, keepSource: true }, { kind: 'text', batch: null, files: [] }));
    // edited meanwhile: nothing is touched
    const edit = await makePlugin(agentsOf([]));
    edit.files.set('Inbox/n.md', '---\nkind: text\ndropit_seq: 9\n---\n\nI rewrote this\n');
    const left = await edit.p.replaceBody({ note: 'Inbox/n.md', text: 'what arrived' }, '> what arrived\n\n---\n\nanswer\n');
    ok('a note whose text is no longer what arrived is left alone', left === false && edit.files.get('Inbox/n.md') === '---\nkind: text\ndropit_seq: 9\n---\n\nI rewrote this\n');
    const done = await edit.p.replaceBody({ note: 'Inbox/n.md', text: 'I rewrote this' }, '> I rewrote this\n\n---\n\nanswer\n');
    ok('…and one that still holds it becomes the document, front matter kept', done === true && edit.files.get('Inbox/n.md') === '---\nkind: text\ndropit_seq: 9\n---\n\n> I rewrote this\n\n---\n\nanswer\n', edit.files.get('Inbox/n.md'));
    ok('a note that is gone is not an error', (await edit.p.replaceBody({ note: 'Inbox/gone.md', text: 'x' }, 'y')) === false);
    // something added to the note while the agent worked: the original text is still in it, but the note is no longer what the run began from
    const snap = '---\nkind: text\ndropit_seq: 10\n---\n\nwhat arrived\n';
    edit.files.set('Inbox/m.md', snap + '\nMY OWN NOTES ADDED AFTER\n');
    const keptAdd = await edit.p.replaceBody({ note: 'Inbox/m.md', text: 'what arrived' }, '> what arrived\n\n---\n\nanswer\n', snap);
    ok('an addition made while the agent worked is not overwritten, even though the original text is still there', keptAdd === false && edit.files.get('Inbox/m.md') === snap + '\nMY OWN NOTES ADDED AFTER\n');
    edit.files.set('Inbox/m.md', snap);
    const same = await edit.p.replaceBody({ note: 'Inbox/m.md', text: 'what arrived' }, '> what arrived\n\n---\n\nanswer\n', snap);
    ok('…and a note exactly as it was when the run began becomes the answer', same === true && edit.files.get('Inbox/m.md').includes('answer'));
    // by hand it never replaces
    const hand = await makePlugin(agentsOf([fakeRule({ keepSource: false })]));
    hand.files.set('Inbox/09-17 08.00 plan.md', '---\nkind: text\nsource: cli\ncreated: 2026-09-17T08:00:00.000Z\ndropit_seq: 420\n---\n\nPlan it MODE:echo\n');
    const byHand = await hand.p.processWith(hand.p.settings.agents.handlers[0], { seq: 420, kind: 'text', text: 'Plan it MODE:echo', meta: {}, files: [], note: 'Inbox/09-17 08.00 plan.md', batch: null }, { manual: true });
    ok('processed by hand, the note stays as it was and the answer is a note beside it', byHand.ok && byHand.path === 'Inbox/09-17 08.00 plan · Fake.md' && hand.files.get('Inbox/09-17 08.00 plan.md').endsWith('\n\nPlan it MODE:echo\n'), JSON.stringify(byHand));
  }

  console.log('── Auto-processing: an answer steered by the content is cleaned, and nothing private is kept ──');
  {
    const secret = 'Call Dana at 555-0143 about the unannounced merger. MODE:evil';
    const { p, files } = await makePlugin(agentsOf([fakeRule()]));
    serve({ 'GET /v1/pull': pages([text(350, secret)]) });
    await p.sync(false);
    await p.hookQueue;
    const answer = files.get(resultsIn(files)[0]) ?? '';
    ok('no remote image, no HTML, no query or template syntax in what is written', !/evil\.example/.test(answer) && !/<img/.test(answer) && !/dataviewjs/.test(answer) && !/`= /.test(answer) && !answer.includes('<%'), answer);
    const stored = JSON.stringify(p.stored);
    ok('the settings hold neither the key nor any of the item\'s text', !stored.includes('555-0143') && !stored.includes('merger') && (stored.match(/dk_x/g) ?? []).length === 1, stored);
    ok('a failure\'s detail has any key taken out', X.scrubDetail('denied: dk_abcDEF123-_x and tokenvalue', 'tokenvalue') === 'denied: dk_… and …');
    const failing = await makePlugin({ token: 'dk_secretvalue', ...agentsOf([fakeRule({ prompt: 'MODE:fail' })]) });
    serve({ 'GET /v1/pull': pages([text(351, 'a MODE:fail')]) });
    await failing.p.sync(false);
    await failing.p.hookQueue;
    ok('and a failed run carries no key', !JSON.stringify(failing.p.runs).includes('dk_secretvalue'));
    const many = await makePlugin(agentsOf([fakeRule({ kinds: ['url'] })]));
    for (let i = 1; i <= 60; i++) many.p.record({ at: i, id: 'r1', name: 'Fake', seq: i, kind: 'text', ok: true, ms: 1 });
    ok('only the last 50 runs are remembered, and only in memory', many.p.runs.length === 50 && many.p.runs[0].seq === 11 && many.p.runs.at(-1).seq === 60 && !('log' in many.p.settings.agents));
    // a quote of the original does not run as a template either
    const tp = await makePlugin({ ...agentsOf([fakeRule()]) });
    tp.p.app.plugins = { plugins: { 'templater-obsidian': { settings: { trigger_on_file_creation: true } } } };
    serve({ 'GET /v1/pull': pages([text(352, 'a <% tp.x %> b MODE:echo')]) });
    await tp.p.sync(false);
    await tp.p.hookQueue;
    ok('a <% in the quoted original is defused while Templater runs new notes', !resultsIn(tp.files).map((k) => tp.files.get(k)).join('').includes('<% tp.x'), resultsIn(tp.files).map((k) => tp.files.get(k)).join());
  }

  console.log('── Auto-processing: files, and the one an agent may read ──');
  {
    const made = await makePlugin(agentsOf([]));
    const { p, files } = made;
    const png = Buffer.from('not really a picture');
    files.set('Inbox/budget.png', png);
    files.set('Inbox/09-17 08.00 budget.md', '---\nkind: image\nsource: web\ncreated: 2026-09-17T08:00:00.000Z\ndropit_seq: 360\n---\n\n![[budget.png]]\n');
    const payload = { v: 1, seq: 360, kind: 'image', source: 'web', created: '', batch: null, text: '', meta: { filename: 'budget.png', mime: 'image/png' }, note: 'Inbox/09-17 08.00 budget.md', files: ['Inbox/budget.png'] };
    const reads = await p.readFiles(payload.files, { maxFileMB: 10 });
    ok('a file is read from the vault into a name and bytes', reads.length === 1 && reads[0].name === 'budget.png' && Buffer.compare(reads[0].data, png) === 0);
    ok('a file over the size the rule allows is not read', (await p.readFiles(payload.files, { maxFileMB: 0.00001 })) === null);

    // "read this item's files": the agent starts in an empty folder holding copies of them
    const files1 = fakeRule({ mode: 'files', prompt: 'MODE:env', id: 'f1', name: 'Files' });
    const out = await p.processWith(files1, payload, { manual: true });
    const listing = JSON.parse(answerOf(files.get(out.path)));
    ok('files: the agent sees copies of the item\'s files in an empty working folder, nothing on its command line', out.ok && same(listing.cwd, ['budget.png']) && same(listing.args, []), JSON.stringify(out));
    ok('…and only PATH, HOME and USER in its environment', listing.env.filter((k) => !['__CF_USER_TEXT_ENCODING', 'PWD', 'SHLVL', '_', 'LC_CTYPE'].includes(k)).sort().join() === 'HOME,PATH,USER', listing.env.join());
    ok('…and the answer quotes the file as an embed', files.get(out.path).startsWith('> ![[Inbox/budget.png]]\n\n---\n\n'), files.get(out.path));
    const big = await p.processWith({ ...files1, maxFileMB: 0.00001 }, payload, { manual: true });
    ok('a file over the limit: skipped, nothing started', big.ok === false && big.why === 'skipped:file-too-big' && p.runs.at(-1).why === 'skipped:file-too-big');
    const thinking = await p.processWith(fakeRule({ id: 'f2', name: 'Think', prompt: 'MODE:env' }), payload, { manual: true });
    ok('the plain permission copies no file: the folder is empty', thinking.ok && same(JSON.parse(answerOf(files.get(thinking.path))).cwd, []));
    // the permission per item: an image gets its file, a text gets none
    const auto = fakeRule({ id: 'f3', name: 'Auto', mode: 'auto', kinds: ['text', 'image'], prompt: 'MODE:env' });
    const forImage = await p.processWith(auto, payload, { manual: true });
    ok('per item: an image\'s file is handed over', forImage.ok && same(JSON.parse(answerOf(files.get(forImage.path))).cwd, ['budget.png']), JSON.stringify(forImage));
    const forText = await p.processWith(auto, { seq: 361, kind: 'text', text: 'words', meta: {}, files: [], note: 'Inbox/09-17 08.00 budget.md', batch: null }, { manual: true });
    ok('…and a text gets an empty folder', forText.ok && same(JSON.parse(answerOf(files.get(forText.path))).cwd, []), JSON.stringify(forText));
    // an image arriving by itself: the file stays where it is, the answer is a note beside it, even with the source not kept
    const img = await makePlugin(agentsOf([fakeRule({ keepSource: false, mode: 'auto', prompt: 'MODE:env' })]));
    serve({ 'GET /v1/pull': pages([{ seq: 362, kind: 'image', source: 'web', raw: '', created_at: AT, bytes: 5, url: 'https://files.test/pic.png', meta: { filename: 'pic.png', mime: 'image/png' } }]), 'GET /pic.png': () => ({ bytes: Buffer.from('png!'), status: 200 }) });
    await img.p.sync(false);
    await img.p.hookQueue;
    ok('an image on its own: its note stays as it is even with the source not kept, and the answer is a note beside it', resultsIn(img.files).length === 1 && !img.files.get('Inbox/09-17 08.00 pic.md').includes('SUMMARY') && img.p.runs[0].ok === true, [...img.files.keys()].join());
  }

  console.log('── Auto-processing: what is left when something goes wrong ──');
  {
    // The picture could not be downloaded: its note says so, and the AI is not started on nothing — in any permission
    for (const mode of ['think', 'auto']) {
      const m = await makePlugin(agentsOf([fakeRule({ keepSource: false, mode, prompt: 'MODE:env' })]));
      serve({ 'GET /v1/pull': pages([{ seq: 370, kind: 'image', source: 'android', raw: '', created_at: AT, bytes: 5, url: 'https://files.test/gone.jpg', meta: { filename: 'gone.jpg', mime: 'image/jpeg' } }]), 'GET /gone.jpg': () => ({ status: 500, json: {} }) });
      await m.p.sync(false);
      await m.p.hookQueue;
      const note = [...m.files.keys()].find((k) => k.endsWith('.md') && !k.includes(' · '));
      ok(`${mode}: a picture that did not download keeps its note with the reason, and nothing is sent to the AI`, /gone\.jpg/.test(m.files.get(note) ?? '') && /dropit_missing|没能下载|couldn't be downloaded/.test(m.files.get(note) ?? '') && resultsIn(m.files).length === 0 && m.p.runs[0]?.why === 'skipped:no-files', `${m.p.runs[0]?.why} · ${[...m.files.keys()].join()}`);
    }
    // The AI fails on a text that is meant to be turned into its answer: what arrived is still there, untouched
    const f = await makePlugin(agentsOf([fakeRule({ keepSource: false, mode: 'auto', prompt: 'MODE:fail' })]));
    serve({ 'GET /v1/pull': pages([{ seq: 371, kind: 'text', source: 'web', raw: LONG, created_at: AT, bytes: LONG.length }]) });
    await f.p.sync(false);
    await f.p.hookQueue;
    const kept = [...f.files.entries()].find(([k]) => k.endsWith('.md'));
    ok('the AI fails: the received text is still in its note, as it arrived, and no second note appears', f.p.runs[0]?.ok === false && !!kept && kept[1].includes(LONG) && !kept[1].includes('boom') && resultsIn(f.files).length === 0, `${f.p.runs[0]?.why} · ${[...f.files.keys()].join()}`);
  }

  console.log('── Auto-processing: a batch is handled once, when it is all here ──');
  {
    // The wait of a batch is a timer the test holds and fires itself; every other timer runs at once as before
    const held = [];
    const keep = { set: globalThis.window.setTimeout, clear: globalThis.window.clearTimeout };
    let nextId = 1000;
    const hold = () => {
      held.length = 0;
      globalThis.window.setTimeout = (fn, ms) => {
        if (!String(fn).includes('batchTimeout')) return keep.set(fn, ms);
        const h = { id: ++nextId, fn, ms, live: true };
        held.push(h);
        return h.id;
      };
      globalThis.window.clearTimeout = (id) => { const h = held.find((x) => x.id === id); if (h) h.live = false; };
    };
    const release = () => { globalThis.window.setTimeout = keep.set; globalThis.window.clearTimeout = keep.clear; };
    const live = () => held.filter((h) => h.live);
    const fire = async (p) => { for (const h of live()) { h.live = false; h.fn(); } for (let i = 0; i < 20; i++) await settle(); await p.hookQueue; };
    // The runs that really started an agent (a skip is not one)
    const started = (p) => p.runs.filter((r) => r.kind === 'batch' && !String(r.why ?? '').startsWith('skipped:'));
    const ID = 'bBATCH0001';
    const grp = (i, n, id = ID) => ({ group: { id, i, n } });
    const bt = (seq, raw, i, n, id) => text(seq, raw, { meta: grp(i, n, id) });
    const bi = (seq, name, i, n, id) => blob(seq, name, { meta: { filename: name, ...grp(i, n, id) } });
    const rule = (extra = {}) => fakeRule({ keepSource: false, mode: 'auto', prompt: 'MODE:stdin', ...extra });
    const link = (made) => {
      made.metadataCache.getFirstLinkpathDest = (l) => { const hit = [...made.files.keys()].find((k) => k === l || k.endsWith(`/${l}`)); return hit ? { path: hit, name: l } : null; };
    };
    const setup = async (items, settings = {}, r = rule()) => {
      const made = await makePlugin({ ...agentsOf([r]), ...settings });
      link(made);
      serve({ 'GET /v1/pull': pages(...items), 'GET /': () => ({ bytes: PNG_BYTES() }) });
      return made;
    };
    const pull = async (p) => { await p.sync(false); for (let i = 0; i < 20; i++) await settle(); await p.hookQueue; };
    // What the agent was sent, as the stand-in gives it back inside the answer
    const answerOf2 = (content) => content.split('\n\n---\n\n').slice(1).join('\n\n---\n\n');

    // ── four items, in two pulls: one run, with all four ──
    hold();
    {
      const { p, files, fm } = await setup([[bt(500, 'compare these MODE:stdin', 1, 4), bi(501, 'a.png', 2, 4)], [bi(502, 'b.png', 3, 4), bi(503, 'c.png', 4, 4)]]);
      await pull(p);
      ok('half a batch: nothing has run, it is waiting, and its clock is set for 90 s', started(p).length === 0 && resultsIn(files).length === 0
        && p.settings.batchRuns[ID]?.state === 'wait' && p.settings.batchRuns[ID].seen.length === 2 && live().length === 1 && live()[0].ms === 90_000, JSON.stringify([p.settings.batchRuns, held.map((h) => h.ms)]));
      await pull(p);
      const notes = notesIn(files);
      ok('the rest arrives: it runs at once (the clock was not needed), once, and the clock is gone', started(p).length === 1 && live().length === 0 && p.settings.batchRuns[ID].state === 'done', JSON.stringify([p.runs, p.settings.batchRuns]));
      ok('one note and no note beside it', notes.length === 1 && resultsIn(files).length === 0, [...files.keys()].join());
      const note = files.get(notes[0]);
      const answer = answerOf2(note);
      ok('the agent got all four in the one run: the words and the three files', answer.includes('compare these') && answer.includes('items="4"') && ['a.png', 'b.png', 'c.png'].every((n) => answer.includes(`file ./${n}`)), answer);
      ok('…as one message (the line we write says so)', /sent together in one message/.test(answer));
      const head = note.slice(0, note.indexOf('\n\n---\n\n'));
      ok('what arrived stays exactly as it was above the line (words, then the three files embedded)', head.endsWith('compare these MODE:stdin\n\n![[a.png]]\n\n![[b.png]]\n\n![[c.png]]'), JSON.stringify(note));
      ok('front matter is as it was: the four numbers and the batch', JSON.stringify(fm.get(notes[0]).dropit_seq) === '[500,501,502,503]' && fm.get(notes[0]).dropit_batch === ID && note.startsWith('---\n'), JSON.stringify(fm.get(notes[0])));
      const once = note;
      serve({ 'GET /v1/pull': pages([bt(500, 'compare these MODE:stdin', 1, 4), bi(501, 'a.png', 2, 4), bi(502, 'b.png', 3, 4), bi(503, 'c.png', 4, 4)]), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }), 'GET /': () => ({ bytes: PNG_BYTES() }) });
      await p.repull('all');
      for (let i = 0; i < 20; i++) await settle();
      await p.hookQueue;
      ok('pulling it all again changes nothing and runs nothing', files.get(notes[0]) === once && started(p).length === 1 && notesIn(files).length === 1, JSON.stringify(p.runs));
    }

    // ── short of its count: nothing runs until the clock says so; then with what is here; later ones are not run ──
    hold();
    {
      const { p, files } = await setup([[bt(510, 'three of four MODE:stdin', 1, 4), bi(511, 'a.png', 2, 4), bi(512, 'b.png', 3, 4)], [bi(513, 'c.png', 4, 4)]]);
      await pull(p);
      ok('three of four: it waits (nothing run, three counted)', started(p).length === 0 && p.settings.batchRuns[ID].state === 'wait' && p.settings.batchRuns[ID].seen.length === 3 && live().length === 1);
      await fire(p);
      const note = files.get(notesIn(files)[0]);
      ok('the clock ends the wait: one run, with the three that are here', started(p).length === 1 && p.settings.batchRuns[ID].state === 'done' && note.includes('items="3"') && !note.includes('file ./c.png'), note);
      ok('…and the answer went under them, in the note', /!\[\[b\.png\]\]\n\n---\n\n/.test(note) && resultsIn(files).length === 0, note);
      const answered = note;
      await pull(p);
      const after = files.get(notesIn(files)[0]);
      ok('the fourth comes late: it joins the note, is not run, and the run record says so', started(p).length === 1 && after.includes('![[c.png]]') && after.startsWith(answered.slice(0, 40))
        && p.runs.some((r) => r.why === 'skipped:late') && resultsIn(files).length === 0, JSON.stringify([p.runs, after]));
      ok('…and what was answered is still there, not written over', after.includes('items="3"') && after.includes('SUMMARY') === answered.includes('SUMMARY'));
    }

    // ── a batch whose items were sent in another order than they arrive: handed over as it was sent ──
    hold();
    {
      const { p, files } = await setup([[bi(520, 'd.png', 4, 4), bi(521, 'b.png', 2, 4), bt(522, 'the words MODE:stdin', 1, 4), bi(523, 'c.png', 3, 4)]]);
      await pull(p);
      const notes = notesIn(files);
      const note = files.get(notes[0]);
      ok('the note has them in the order they were sent (words, b, c, d), though they arrived d, b, words, c', /the words MODE:stdin\n\n!\[\[b\.png\]\]\n\n!\[\[c\.png\]\]\n\n!\[\[d\.png\]\]/.test(note), JSON.stringify(note));
      const answer = answerOf2(note);
      const at = (s) => answer.indexOf(s);
      ok('the agent gets the words, then the files in the order they were sent (b, c, d)', at('the words') >= 0 && at('file ./b.png') > at('the words') && at('file ./c.png') > at('file ./b.png') && at('file ./d.png') > at('file ./c.png'), answer);
      // With only the note left (by hand, or after a restart) the order they were sent in is still known while the record is kept
      const payload = await p.payloadOfNote({ path: notes[0], name: '', extension: 'md' });
      ok('read back from the note, a batch is in the order it was sent while it is remembered', same(payload.files, ['Inbox/b.png', 'Inbox/c.png', 'Inbox/d.png']) && payload.text === 'the words MODE:stdin' && payload.parts[0].text != null, JSON.stringify(payload.parts));
      delete p.settings.batchRuns[ID];
      const plain = await p.payloadOfNote({ path: notes[0], name: '', extension: 'md' });
      ok('…and with nothing remembered, as the note has them (the same: the note is in the order it was sent)', same(plain.files, ['Inbox/b.png', 'Inbox/c.png', 'Inbox/d.png']), JSON.stringify(plain.files));
      // A part that arrives in a later pull is put where its number says; a note whose parts cannot be found gets it at the end
      const lateOne = await setup([[bt(530, 'second part', 2, 3)], [bt(531, 'first part', 1, 3)], [bt(532, 'third part', 3, 3)]]);
      await pull(lateOne.p); await pull(lateOne.p); await pull(lateOne.p);
      const lateNote = lateOne.files.get(notesIn(lateOne.files)[0]);
      ok('parts arriving in separate pulls, as 2, 1, 3: written as 1, 2, 3', /first part\n\nsecond part\n\nthird part/.test(lateNote), JSON.stringify(lateNote));
      const lost = await setup([[bt(540, 'second', 2, 3)], [bt(541, 'first', 1, 3)]]);
      await pull(lost.p);
      lost.p.settings.batches[ID].parts = [{ i: 2, head: 'text the user rewrote' }];
      await pull(lost.p);
      ok('the place of a part cannot be found any more (the note was edited): it goes at the end, nothing is lost', /second\n\nfirst/.test(lost.files.get(notesIn(lost.files)[0])), JSON.stringify(lost.files.get(notesIn(lost.files)[0])));
    }
    {
      const { p } = await setup([[]]);
      const m = (seq, t, index) => ({ seq, kind: 'text', text: t, files: [], batch: { id: 'b', index, count: 3 }, meta: {} });
      const nums = await p.batchOf([m(90, 'B', 2), m(91, 'A', 1), m(92, 'C', 3)], { note: 'Inbox/n.md', shared: false });
      ok('by the number each carries, whatever the seq (90 does not outrank 1)', nums.text === 'A\n\nB\n\nC' && same(nums.seqs, [91, 90, 92]), JSON.stringify(nums.seqs));
      const unnumbered = await p.batchOf([m(50, 'x', undefined), m(49, 'y', undefined), m(48, 'z', 1)], { note: 'Inbox/n.md', shared: false });
      ok('items without a number are never put before or after one by comparing a seq with a number', unnumbered.parts.length === 3 && unnumbered.seqs.length === 3, JSON.stringify(unnumbered.seqs));
    }

    // ── the person edits the note while the agent works: the answer goes beside it ──
    hold();
    {
      const { p, files } = await setup([[bt(540, 'edit me MODE:stdin', 1, 2), bi(541, 'a.png', 2, 2)]]);
      const readFiles = p.readFiles.bind(p);
      let mine = null;
      p.readFiles = async (...a) => { const path = notesIn(files)[0]; mine = `${files.get(path)}\nMY OWN LINE\n`; files.set(path, mine); return readFiles(...a); };
      await pull(p);
      const notes = notesIn(files);
      ok('a note changed during the run is not touched; the answer is one note beside it', notes.length === 1 && files.get(notes[0]) === mine && resultsIn(files).length === 1, [...files.keys()].join());
      const beside = files.get(resultsIn(files)[0]);
      ok('…which holds what arrived, a line, then the answer', beside.includes('edit me MODE:stdin\n\n![[a.png]]') && /\n\n---\n\n/.test(beside) && beside.includes('items="2"'), beside);
      p.readFiles = readFiles;
    }

    // ── "keep the source" on: the note stays, and there is one note beside it ──
    hold();
    {
      const { p, files } = await setup([[bt(550, 'keep me MODE:stdin', 1, 2), bi(551, 'a.png', 2, 2)]], {}, rule({ keepSource: true }));
      await pull(p);
      const notes = notesIn(files);
      ok('the source is exactly what arrived, and one answer is beside it', notes.length === 1 && !files.get(notes[0]).includes('items=') && resultsIn(files).length === 1 && started(p).length === 1, [...files.keys()].join());
      ok('…named after the note and the rule, with no number', /^Inbox\/09-17 08\.00 keep me MODE_stdin · Fake\.md$/.test(resultsIn(files)[0]) || / · Fake\.md$/.test(resultsIn(files)[0]), resultsIn(files).join());
      ok('…and the answer is under the original, with its picture embedded', files.get(resultsIn(files)[0]).includes('keep me MODE:stdin\n\n![[a.png]]\n\n---\n\n'), files.get(resultsIn(files)[0]));
    }

    // ── a shared note (append) is never changed: one answer beside it, named by the numbers ──
    hold();
    {
      const { p, files } = await setup([[bt(560, 'shared MODE:stdin', 1, 2), bi(561, 'a.png', 2, 2)]], { mode: 'append', appendPath: 'Inbox/dropit.md' });
      await pull(p);
      const res = resultsIn(files);
      ok('append mode: one answer, named with the range of numbers, and the shared note has no answer in it', res.length === 1 && /\(560–561\)\.md$/.test(res[0]) && !files.get('Inbox/dropit.md').includes('items='), JSON.stringify([res, started(p).length]));
    }

    // ── what the rule is not ticked for is not handed over; a link is text ──
    hold();
    {
      const { p, files } = await setup([[bt(570, 'see https://x.example/p MODE:stdin', 1, 3), blob(571, 'v.mp4', { kind: 'video', meta: { filename: 'v.mp4', mime: 'video/mp4', ...grp(2, 3) } }), bi(572, 'a.png', 3, 3)]], {}, rule({ kinds: ['text', 'image'] }));
      await pull(p);
      const answer = answerOf2(files.get(notesIn(files)[0]));
      ok('a video the rule was not ticked for is left out of what the agent gets', started(p).length === 1 && answer.includes('file ./a.png') && !answer.includes('v.mp4'), answer);
      const plan = X.planRun({ ...rule(), agent: 'claude', argv: undefined }, X.narrowBatch(rule(), { kind: 'batch', parts: [{ kind: 'text', text: 'a' }, { kind: 'url', text: 'https://x.example/' }], text: 'a', files: [] }));
      ok('a link inside a batch does not open a page: no web mode', plan.run && plan.mode === 'think', JSON.stringify(plan));
    }

    // ── nothing runs by itself: nothing waits ──
    hold();
    for (const [name, agents] of [['no rule', { handlers: [] }], ['paused', { paused: true }], ['not confirmed', { consented: false }], ['rule off', { handlers: [rule({ enabled: false })] }]]) {
      const made = await makePlugin({ agents: { v: 1, consented: true, paused: false, handlers: [rule()], ...agents } });
      serve({ 'GET /v1/pull': pages([bt(580, 'x MODE:stdin', 1, 2), bi(581, 'a.png', 2, 2)]), 'GET /': () => ({ bytes: PNG_BYTES() }) });
      await pull(made.p);
      ok(`${name}: the batch is not put down to wait for, no clock is set, nothing runs`, Object.keys(made.p.settings.batchRuns).length === 0 && live().length === 0 && started(made.p).length === 0 && resultsIn(made.files).length === 0, JSON.stringify(made.p.settings.batchRuns));
    }
    {
      platform.isDesktopApp = false;
      const made = await makePlugin({ agents: { v: 1, consented: true, paused: false, handlers: [rule()] } });
      serve({ 'GET /v1/pull': pages([bt(582, 'x MODE:stdin', 1, 2), bi(583, 'a.png', 2, 2)]), 'GET /': () => ({ bytes: PNG_BYTES() }) });
      await pull(made.p);
      platform.isDesktopApp = true;
      ok('on a phone: nothing waits and nothing runs', Object.keys(made.p.settings.batchRuns).length === 0 && live().length === 0 && started(made.p).length === 0 && notesIn(made.files).length === 1);
    }
    {
      // paused before the clock rings: the run is skipped, and says so
      const { p, files } = await setup([[bt(584, 'x MODE:stdin', 1, 3), bi(585, 'a.png', 2, 3)]]);
      await pull(p);
      p.settings.agents.paused = true;
      await fire(p);
      ok('paused while it waited: nothing runs when the clock rings, and the run record says why', started(p).length === 0 && resultsIn(files).length === 0 && p.settings.batchRuns[ID].state === 'done' && p.runs.some((r) => r.why === 'skipped:disabled'), JSON.stringify(p.runs));
    }

    // ── numbers that disagree: the first item's count stands ──
    hold();
    {
      const { p, files } = await setup([[bt(590, 'count MODE:stdin', 1, 2), bi(591, 'a.png', 2, 5)]]);
      await pull(p);
      ok('the first item\'s count is the one used: two of two runs at once', p.settings.batchRuns[ID].count === 2 && started(p).length === 1 && live().length === 0 && resultsIn(files).length === 0);
    }

    // ── an item whose download failed counts as here (no waiting for it), and is said to the agent ──
    hold();
    {
      const made = await setup([[bt(600, 'one is lost MODE:stdin', 1, 2), bi(601, 'gone.png', 2, 2)]]);
      serve({ 'GET /v1/pull': pages([bt(600, 'one is lost MODE:stdin', 1, 2), bi(601, 'gone.png', 2, 2)]), 'GET /601': () => new Error('no network') });
      await pull(made.p);
      const note = made.files.get(notesIn(made.files)[0]);
      ok('a file that did not come: the run is not held back, and the agent is told how many did not come', started(made.p).length === 1 && live().length === 0 && answerOf2(note).includes('1 file could not be fetched'), note);
      serve({ 'GET /v1/pull': pages([bi(601, 'gone.png', 2, 2)]), 'GET /601': () => ({ bytes: PNG_BYTES() }), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
      await made.p.repull('all').catch(() => {});
      for (let i = 0; i < 20; i++) await settle();
      await made.p.hookQueue;
      ok('fetching it later does not run the batch again', started(made.p).length === 1, JSON.stringify(made.p.runs));
    }

    // ── the limits on words are for the words: a long text does not get its files skipped ──
    hold();
    {
      const long = 'LONGWORDS '.repeat(8);
      const { p, files } = await setup([[bt(630, `${long} MODE:stdin`, 1, 2), bi(631, 'a.png', 2, 2)]], {}, rule({ maxChars: 20 }));
      await pull(p);
      const note = files.get(notesIn(files)[0]);
      ok('words over the longest, with a picture: the batch still runs, on the picture', started(p).length === 1 && answerOf2(note).includes('file ./a.png') && p.settings.batchRuns[ID].state === 'done', JSON.stringify(p.runs));
      ok('…the agent is not given the long words, and is told they were left out', !answerOf2(note).includes('LONGWORDS') && answerOf2(note).includes('1 text was too long and left out'), note);
      ok('…and the note keeps them, as it arrived', note.includes('LONGWORDS'), note);
    }
    hold();
    {
      const { p, files } = await setup([[bt(640, 'a short one MODE:stdin', 1, 2), bi(641, 'a.png', 2, 2)]], {}, rule({ minChars: 500 }));
      await pull(p);
      ok('words under the shortest, with a picture: the batch runs (the shortest is for a text on its own)', started(p).length === 1 && resultsIn(files).length === 0 && /file \.\/a\.png/.test(files.get(notesIn(files)[0])), JSON.stringify(p.runs));
    }
    hold();
    {
      const { p } = await setup([[bt(650, 'only words, and too long', 1, 2), bt(651, 'more words', 2, 2)]], {}, rule({ maxChars: 5 }));
      notices.length = 0;
      await pull(p);
      ok('a batch of words alone that is past the longest is not run, and the run record says why', started(p).length === 0 && p.runs.some((r) => r.kind === 'batch' && r.why === 'skipped:long'), JSON.stringify(p.runs));
      ok('…and it is not silent: one notice says so, naming the rule', notices.filter((n) => /batch of words/.test(n) && /longest/.test(n)).length === 1, JSON.stringify(notices));
    }

    // ── a failed run leaves the note, is said once, and is not tried again ──
    hold();
    {
      const { p, files } = await setup([[bt(610, 'x', 1, 2), bi(611, 'a.png', 2, 2)]], {}, rule({ prompt: 'MODE:fail' }));
      await pull(p);
      const note = files.get(notesIn(files)[0]);
      ok('the note is as it arrived (no line, no answer in it), and no note beside it', !/\n---\n\n/.test(note.replace(/^---\n[\s\S]*?\n---\n/, '')) && resultsIn(files).length === 0, note);
      ok('…one failed run is recorded and the batch is done: no second try', p.runs.filter((r) => r.why === 'exit:3').length === 1 && p.settings.batchRuns[ID].state === 'done');
    }

    // ── a pile of batches after being away: whole batches are counted, the newest few are run ──
    hold();
    {
      const items = [];
      for (let b = 0; b < 5; b++) items.push(bt(700 + b * 2, `pile ${b} MODE:stdin`, 1, 2, `bPILE000${b}`), bi(701 + b * 2, `p${b}.png`, 2, 2, `bPILE000${b}`));
      const { p, files } = await setup([items], { agents: { v: 1, consented: true, paused: false, handlers: [rule()], recent: 3 } });
      await pull(p);
      const ran = notesIn(files).filter((k) => files.get(k).includes('items="2"'));
      ok('five whole batches arrive at once, the newest three are run (not three items)', ran.length === 3 && started(p).length === 3 && ran.every((k) => !/pile 0|pile 1/.test(files.get(k).split('\n\n---\n\n')[0])), JSON.stringify([notesIn(files), p.runs.length]));
      ok('…and the two that were not run leave no record of waiting', ['bPILE0000', 'bPILE0001'].every((id) => !(id in p.settings.batchRuns)), Object.keys(p.settings.batchRuns).join());
    }

    // ── restarted while waiting: the wait starts again, and then the note is all there is ──
    hold();
    {
      const first = await setup([[bt(620, 'restart me MODE:stdin', 1, 3), bi(621, 'a.png', 2, 3)]]);
      await pull(first.p);
      const stored = JSON.parse(JSON.stringify(first.p.stored));
      ok('what waits is saved with the settings', stored.batchRuns?.[ID]?.state === 'wait' && stored.batchRuns[ID].seen.length === 2, JSON.stringify(stored.batchRuns));
      hold();
      const clone = (o) => JSON.parse(JSON.stringify(o));
      const again = await makePlugin(undefined, clone(stored));
      for (const [k, v] of first.files) again.files.set(k, v);
      for (const [k, v] of first.fm) again.fm.set(k, v);
      link(again);
      again.p.batchResume();
      await settle();
      ok('after a restart it waits again, in full, and has not run', started(again.p).length === 0 && live().length === 1 && live()[0].ms === 90_000, JSON.stringify(held));
      // Text that came in the batch links to a file of the vault: the restart hands over what was saved for the batch, not that
      const notePath = notesIn(again.files)[0];
      again.files.set('Private/secret.md', 'SECRET OF THE VAULT');
      again.files.set(notePath, `${again.files.get(notePath).trimEnd()}\n\n![[Private/secret.md]]\n`);
      await fire(again.p);
      const note = again.files.get(notePath);
      ok('when the clock rings it runs from the note, once, with the words and the file', started(again.p).length === 1 && answerOf2(note).includes('restart me') && answerOf2(note).includes('file ./a.png') && again.p.settings.batchRuns[ID].state === 'done', note);
      ok('…and a file the text of the note links to is not handed over', !note.includes('SECRET OF THE VAULT') && !answerOf2(note).includes('secret.md'), note);
      // what was running when Obsidian closed is not run again
      const mid = await makePlugin(undefined, clone({ ...stored, batchRuns: { [ID]: { ...stored.batchRuns[ID], state: 'running' } } }));
      mid.p.batchResume();
      ok('a batch that was running when it closed is counted done, not run again, and the run record says so', mid.p.settings.batchRuns[ID].state === 'done' && live().length === 0 && started(mid.p).length === 0
        && mid.p.runs.some((r) => r.why === 'skipped:restart' && r.seq === Math.min(...stored.batchRuns[ID].seen)), JSON.stringify(mid.p.runs));
      // a shared note cannot be taken apart again
      const shared = await makePlugin(undefined, clone({ ...stored, batchRuns: { [ID]: { ...stored.batchRuns[ID], note: null } } }));
      shared.p.batchResume();
      ok('a batch in a shared note is let go on restart, and the run record says so', shared.p.settings.batchRuns[ID].state === 'done' && live().length === 0 && shared.p.runs.some((r) => r.why === 'skipped:restart'));
    }
    release();
  }

  console.log('── Auto-processing: a batch note that was answered before ──');
  {
    const ID = 'bAGAIN0001';
    const made = await makePlugin(agentsOf([fakeRule({ enabled: false, auto: false, mode: 'auto', prompt: 'MODE:stdin' })]));
    const { p, files, fm, metadataCache } = made;
    metadataCache.getFirstLinkpathDest = (link) => (files.has(`Inbox/${link}`) ? { path: `Inbox/${link}`, name: link } : null);
    files.set('Inbox/a.png', Buffer.from('png'));
    files.set('Inbox/late.png', Buffer.from('png'));
    const FRONT = `---\nkind: batch\nsource: web\ncreated: 2026-09-17T08:00:00.000Z\ndropit_batch: ${ID}\ndropit_seq: [801, 802]\n---\n`;
    const original = '\nthe words\n\n![[a.png]]\n';
    const answered = `${FRONT}${original}\n---\n\nFIRST RESULT line one\n\n---\n\nFIRST RESULT after its own rule\n\n— [A Post](https://example.com/post)\n`;
    const path = 'Inbox/09-17 08.00 again.md';
    files.set(path, answered);
    fm.set(path, { kind: 'batch', source: 'web', created: '2026-09-17T08:00:00.000Z', dropit_batch: ID, dropit_seq: [801, 802] });
    const file = { path, name: '09-17 08.00 again.md', extension: 'md' };
    const d = await p.payloadOfNote(file);
    ok('a batch note: handed over as a batch with all its files (not as text)', d.kind === 'batch' && same(d.files, ['Inbox/a.png']) && d.batch.id === ID && d.batch.count === 2 && d.seq === 801, JSON.stringify(d));
    ok('an answer written into it before is not part of what arrived: only what is above the line', d.text === 'the words' && !JSON.stringify(d).includes('FIRST RESULT'), JSON.stringify(d));
    ok('…and the page it came from stays with it', d.meta.from?.url === 'https://example.com/post' && d.original.includes('— [A Post]') && !d.original.includes('FIRST RESULT'), JSON.stringify(d.original));
    const hand = await p.processWith(p.settings.agents.handlers[0], d, { manual: true });
    for (let i = 0; i < 5; i++) await settle();
    const beside = resultsIn(files);
    ok('by hand it writes one new note beside it, and does not touch the note', hand.ok && beside.length === 1 && files.get(path) === answered, JSON.stringify([hand, beside]));
    const out = files.get(beside[0]);
    ok('…whose original is what arrived, not the answer from before', out.split('\n\n---\n\n')[0].includes('the words\n\n![[a.png]]') && !out.split('\n\n---\n\n')[0].includes('FIRST RESULT'), out);
    ok('…and the agent was handed the words and the picture, and not the answer from before', out.includes('items="2"') && out.includes('file ./a.png') && !out.includes('FIRST RESULT'), out);
    // a file that came after the answer (a late item) is still part of the batch; a note never answered is whole
    files.set(path, answered.replace('\n\n— [A Post]', '\n\n![[late.png]]\n\n— [A Post]'));
    const late = await p.payloadOfNote(file);
    ok('a file embedded after the answer (it came late) still goes with the batch', same(late.files, ['Inbox/a.png', 'Inbox/late.png']) && !JSON.stringify(late).includes('FIRST RESULT'), JSON.stringify(late.files));
    files.set(path, `${FRONT}${original}`);
    const fresh = await p.payloadOfNote(file);
    ok('a note that was never answered is read whole', fresh.text === 'the words' && same(fresh.files, ['Inbox/a.png']) && fresh.original === 'the words\n\n![[a.png]]', JSON.stringify(fresh));
    // by hand again: a second answer gets a number, never replaces the first
    await p.processWith(p.settings.agents.handlers[0], fresh, { manual: true });
    ok('a second time by hand is a second note with a number', resultsIn(files).length === 2 && resultsIn(files).some((k) => / 2\.md$/.test(k)), resultsIn(files).join());
  }

  console.log('── Auto-processing: the invisible line that marks where an answer starts ──');
  {
    const ID = 'bMARK00001';
    const NONCE = 'n0123456789abcdef01234567';
    const MARK = `<!-- dropit:answer ${NONCE} -->`;
    const made = await makePlugin(agentsOf([fakeRule({ enabled: false, auto: false, mode: 'auto', prompt: 'MODE:stdin' })]));
    const { p, files, fm, metadataCache } = made;
    metadataCache.getFirstLinkpathDest = (link) => (files.has(`Inbox/${link}`) ? { path: `Inbox/${link}`, name: link } : null);
    files.set('Inbox/a.png', Buffer.from('png'));
    const HEAD = `---\nkind: batch\nsource: web\ncreated: 2026-09-17T08:00:00.000Z\ndropit_batch: ${ID}\n`;
    const FRONT = `${HEAD}dropit_answered: false\ndropit_nonce: "${NONCE}"\ndropit_seq: [811, 812]\n---\n`;
    const path = 'Inbox/09-17 08.00 marked.md';
    fm.set(path, { kind: 'batch', source: 'web', created: '2026-09-17T08:00:00.000Z', dropit_batch: ID, dropit_answered: false, dropit_nonce: NONCE, dropit_seq: [811, 812] });
    const file = { path, name: '09-17 08.00 marked.md', extension: 'md' };
    const ownText = 'part one\n\n---\n\npart two after its own rule';
    const before = `${FRONT}\n${ownText}\n\n![[a.png]]\n`;
    files.set(path, before);
    // a batch note with no answer yet is all what arrived, whatever rules the person's own text has
    const unanswered = await p.payloadOfNote(file);
    ok('a note that says it has no answer yet is read whole: the text after its own rule is not cut off', unanswered.text === ownText && same(unanswered.files, ['Inbox/a.png']) && unanswered.original === `${ownText}\n\n![[a.png]]`, JSON.stringify(unanswered));
    ok('appendAnswer writes the rule, the marker line with the note\'s number, then the answer; the front matter says it is answered', await p.appendAnswer(path, 'THE ANSWER\n\n---\n\nsecond part', before)
      && files.get(path) === `${before.replace('dropit_answered: false', 'dropit_answered: true').trimEnd()}\n\n---\n\n${MARK}\n\nTHE ANSWER\n\n---\n\nsecond part\n`, files.get(path));
    const answeredNote = files.get(path);
    const d = await p.payloadOfNote(file);
    ok('what the person wrote has a rule of its own: it is all still what arrived, and the answer is not', d.text === ownText && same(d.files, ['Inbox/a.png']) && !JSON.stringify(d).includes('THE ANSWER') && !JSON.stringify(d).includes('second part\\n'), JSON.stringify(d));
    ok('…its original ends where the person ended it, with no rule dropit added', d.original === `${ownText}\n\n![[a.png]]`, JSON.stringify(d.original));
    // a note from before there were numbers: no number, no flag
    const LEGACY = `${HEAD}dropit_seq: [811, 812]\n---\n`;
    files.set(path, `${LEGACY}\nthe words\n\n![[a.png]]\n\n---\n\nOLD ANSWER\n\n---\n\nmore of it\n`);
    const old = await p.payloadOfNote(file);
    ok('a note from before (no flag, no marker) is cut at its first rule, as before', old.text === 'the words' && same(old.files, ['Inbox/a.png']) && !JSON.stringify(old).includes('OLD ANSWER') && !JSON.stringify(old).includes('more of it'), JSON.stringify(old));
    files.set(path, `${LEGACY}\nthe words\n\n![[a.png]]\n\n---\n\n<!-- dropit:answer -->\n\nOLDER ANSWER\n`);
    const older = await p.payloadOfNote(file);
    ok('…and one answered by the version that wrote the plain marker is cut at it', older.text === 'the words' && !JSON.stringify(older).includes('OLDER ANSWER'), JSON.stringify(older));
    // answering a note from before gives it its number and its flag
    const legacyBefore = `${LEGACY}\nthe words\n\n![[a.png]]\n`;
    files.set(path, legacyBefore);
    ok('a note from before is answered too: it gets the flag and a number of its own', await p.appendAnswer(path, 'LEGACY ANSWER', legacyBefore)
      && /\ndropit_answered: true\ndropit_nonce: "n[0-9a-f]{24}"\n---\n/.test(files.get(path)) && /\n\n---\n\n<!-- dropit:answer n[0-9a-f]{24} -->\n\nLEGACY ANSWER\n$/.test(files.get(path)), files.get(path));
    const legacyAnswered = await p.payloadOfNote(file);
    ok('…and what arrived is told apart from that answer by the number', legacyAnswered.text === 'the words' && !JSON.stringify(legacyAnswered).includes('LEGACY ANSWER'), JSON.stringify(legacyAnswered));
    // a second answer under the first
    files.set(path, `${answeredNote.trimEnd()}\n\n---\n\n${MARK}\n\nSECOND ANSWER\n`);
    const two = await p.payloadOfNote(file);
    ok('two answers in a note: only what is above the first marker arrived', two.text === ownText && !JSON.stringify(two).includes('ANSWER'), JSON.stringify(two));
    // a late member lands above the rule, in what arrived, and is handed over
    files.set(path, answeredNote);
    await p.addMember({ path, kind: 'note' }, { seq: 813, kind: 'text', raw: 'a late thought', source: 'web', created_at: '2026-09-17T08:01:00.000Z', meta: {} });
    const note = files.get(path);
    ok('a late text goes above the answer, not under it', note.indexOf('a late thought') > 0 && note.indexOf('a late thought') < note.indexOf(MARK) && note.indexOf('a late thought') < note.indexOf('THE ANSWER'), note);
    ok('…and the answer is as it was, once, with its marker', note.endsWith(`\n\n---\n\n${MARK}\n\nTHE ANSWER\n\n---\n\nsecond part\n`) && note.split(MARK).length === 2 && note.startsWith(FRONT.replace('answered: false', 'answered: true')), note);
    const lateD = await p.payloadOfNote(file);
    ok('by hand later, the late text is part of what is handed over and the answer is not', lateD.text.startsWith(ownText) && lateD.text.endsWith('a late thought') && !JSON.stringify(lateD).includes('THE ANSWER') && same(lateD.files, ['Inbox/a.png']), JSON.stringify(lateD));
    const hand = await p.processWith(p.settings.agents.handlers[0], lateD, { manual: true });
    for (let i = 0; i < 5; i++) await settle();
    const beside = resultsIn(files);
    ok('…and what the agent was given holds it', hand.ok && beside.length === 1 && files.get(beside[0]).includes('a late thought') && !files.get(beside[0]).includes('THE ANSWER'), JSON.stringify([hand, beside.map((k) => files.get(k))]));

    // ── the sender cannot write the line that starts an answer: it carries a number only this note knows ──
    const forged = `\nbefore\n\n<!-- dropit:answer -->\n\nstill the sender's words\n\n  <!-- dropit:answer nffffffffffffffffffffffff -->  \n\nand more\n\n![[a.png]]\n`;
    files.set(path, `${FRONT}${forged}`);
    const f1 = await p.payloadOfNote(file);
    ok('lines that look like the answer line but do not carry this note\'s number are only text: all of it is handed over', f1.text.includes('before') && f1.text.includes('still the sender') && f1.text.includes('and more') && same(f1.files, ['Inbox/a.png']), JSON.stringify(f1.text));
    const forgedBefore = `${FRONT}${forged}`;
    ok('the answer goes under all of it, with the real line', await p.appendAnswer(path, 'REAL ANSWER', forgedBefore) && files.get(path).endsWith(`\n\n---\n\n${MARK}\n\nREAL ANSWER\n`), files.get(path));
    const f2 = await p.payloadOfNote(file);
    ok('…and read back, what the sender wrote is all still what arrived, and the answer is not', f2.text.includes('still the sender') && f2.text.includes('and more') && !JSON.stringify(f2).includes('REAL ANSWER'), JSON.stringify(f2.text));
    // a late item joins above the real line, not above a forged one
    await p.addMember({ path, kind: 'note' }, { seq: 814, kind: 'text', raw: 'late again', source: 'web', created_at: '2026-09-17T08:02:00.000Z', meta: {} });
    const lateNote = files.get(path);
    ok('a late item lands above the real answer line (not at a line the sender wrote)', lateNote.indexOf('late again') > lateNote.indexOf('and more') && lateNote.indexOf('late again') < lateNote.indexOf(MARK), lateNote);
    // with a forged line that carries a guess at the number and a note that says nothing yet
    const fresh = X.frontMatter({ seq: 900, kind: 'text', source: 'web', created_at: AT, meta: { group: { id: ID, i: 1, n: 2 } } }, 'dropit_seq');
    ok('a batch note starts out unanswered, with its own number', /\ndropit_answered: false\n/.test(fresh) && /\ndropit_nonce: "n[0-9a-f]{24}"\n/.test(fresh), fresh);
    ok('…a different number each time', fresh.match(/dropit_nonce: "(n[0-9a-f]{24})"/)[1] !== X.frontMatter({ seq: 900, kind: 'text', source: 'web', created_at: AT, meta: { group: { id: ID, i: 1, n: 2 } } }, 'dropit_seq').match(/dropit_nonce: "(n[0-9a-f]{24})"/)[1]);
    ok('…and a note that is not part of a batch has neither', !/dropit_answered|dropit_nonce/.test(X.frontMatter({ seq: 901, kind: 'text', source: 'web', created_at: AT, meta: null }, 'dropit_seq')));
  }

  console.log('── Auto-processing: a batch note made by a sync is unanswered, then answered ──');
  {
    const made = await makePlugin();
    const { p, files } = made;
    const g = (i) => ({ group: { id: 'bFLAG00001', i, n: 2 } });
    serve({ 'GET /v1/pull': pages([text(950, 'first', { meta: g(1) }), text(951, 'second\n\n---\n\nafter its own rule', { meta: g(2) })]) });
    await p.sync(false);
    const note = [...files.keys()].find((k) => k.endsWith('.md'));
    ok('the note a batch starts has the flag and a number in its front matter', /\ndropit_answered: false\n/.test(files.get(note)) && /\ndropit_nonce: "n[0-9a-f]{24}"\n/.test(files.get(note)), files.get(note));
    const read = await p.payloadOfNote({ path: note, name: '', extension: 'md' });
    ok('…and it is read whole, the text after a rule that a member brought included', read.kind === 'batch' && read.text.includes('first') && read.text.includes('after its own rule'), JSON.stringify(read.text));
  }

  console.log('── Auto-processing: only the files dropit saved are handed over ──');
  {
    const ID = 'bLINKS0001';
    const NONCE = 'n0123456789abcdef01234567';
    const made = await makePlugin(agentsOf([fakeRule({ enabled: false, auto: false, mode: 'auto', prompt: 'MODE:stdin' })]));
    const { p, files, fm, metadataCache } = made;
    metadataCache.getFirstLinkpathDest = (link) => (files.has(link) ? { path: link, name: link.split('/').pop() } : files.has(`Inbox/${link}`) ? { path: `Inbox/${link}`, name: link } : null);
    files.set('Inbox/a.png', Buffer.from('png'));
    files.set('Inbox/b.png', Buffer.from('png'));
    files.set('Private/x.md', 'PRIVATE NOTE');
    files.set('.obsidian/app.json', '{"secret":1}');
    const FRONT = `---\nkind: batch\nsource: web\ncreated: 2026-09-17T08:00:00.000Z\ndropit_batch: ${ID}\ndropit_answered: false\ndropit_nonce: "${NONCE}"\ndropit_seq: [821, 822]\n---\n`;
    const path = 'Inbox/09-17 08.00 links.md';
    files.set(path, `${FRONT}\nthe words\n\n![[a.png]]\n\n![[Private/x.md]]\n\n![[.obsidian/app.json]]\n`);
    fm.set(path, { kind: 'batch', source: 'web', created: '2026-09-17T08:00:00.000Z', dropit_batch: ID, dropit_answered: false, dropit_nonce: NONCE, dropit_seq: [821, 822] });
    const file = { path, name: '09-17 08.00 links.md', extension: 'md' };
    const d = await p.payloadOfNote(file);
    ok('by hand, a note hands over the files in the place dropit saves them, and no file of the vault it links to', same(d.files, ['Inbox/a.png']) && !JSON.stringify([d.files, d.parts]).match(/Private|app\.json/) && !JSON.stringify(d).includes('PRIVATE'), JSON.stringify(d));
    const hand = await p.processWith(p.settings.agents.handlers[0], d, { manual: true });
    for (let i = 0; i < 5; i++) await settle();
    const out = files.get(resultsIn(files)[0] ?? '') ?? '';
    ok('…so the agent is given the picture, and neither of the others', hand.ok && out.includes('file ./a.png') && !out.includes('file ./x.md') && !out.includes('file ./app.json') && !out.includes('PRIVATE NOTE') && !out.includes('"secret"'), out);
    // a single received note: the same
    const one = 'Inbox/09-17 08.00 one.md';
    files.set(one, `---\nkind: image\nsource: web\ncreated: 2026-09-17T08:00:00.000Z\ndropit_seq: 823\n---\n\n![[Private/x.md]]\n`);
    fm.set(one, { kind: 'image', source: 'web', created: '2026-09-17T08:00:00.000Z', dropit_seq: 823 });
    const single = await p.payloadOfNote({ path: one, name: 'one.md', extension: 'md' });
    ok('a single note that links a file elsewhere in the vault has no file to hand over', same(single.files, []), JSON.stringify(single));
    // a batch that is remembered: its own list, nothing the text says
    const rec = await p.payloadOfNote(file, { recorded: ['Inbox/b.png', 'Inbox/gone.png'] });
    ok('with the files recorded for the batch, those are the files (the ones that are still there), whatever the note embeds', same(rec.files, ['Inbox/b.png']) && rec.parts.filter((x) => x.file).length === 1, JSON.stringify(rec.files));
    p.settings.batchRuns[ID] = { at: Date.now(), first: Date.now(), count: 2, seen: [821, 822], note: path, state: 'wait', resumed: true,
      order: [{ seq: 821, i: 1, text: true, files: [] }, { seq: 822, i: 2, text: false, files: ['Inbox/b.png'] }] };
    const resumed = await p.batchPayload(ID, p.settings.batchRuns[ID]);
    ok('a batch run again after a restart takes the recorded files, not those the note links to', same(resumed.files, ['Inbox/b.png']) && !resumed.files.includes('Private/x.md'), JSON.stringify(resumed.files));
    p.settings.batchRuns[ID].order = [];
    const none = await p.batchPayload(ID, p.settings.batchRuns[ID]);
    ok('…and with nothing recorded, no file at all', same(none.files, []), JSON.stringify(none.files));
  }

  console.log('── Memory: files being sent, files fetched ahead ──');
  {
    const gate = X.byteGate(10);
    const order = [];
    const r1 = await gate.acquire(6);
    const w2 = gate.acquire(6).then((rel) => { order.push('second'); return rel; });
    const w3 = gate.acquire(3).then((rel) => { order.push('third'); return rel; });
    await settle();
    ok('a gate holds back what would not fit, and keeps the order of asking (a small one does not pass a big one)', order.length === 0 && gate.used === 6, JSON.stringify([order, gate.used]));
    r1(); r1();
    const r2 = await w2;
    const r3 = await w3;
    ok('…and lets them in as room is given back (giving back twice gives back once)', same(order, ['second', 'third']) && gate.used === 9, JSON.stringify([order, gate.used]));
    r2(); r3();
    const big = await gate.acquire(50);
    ok('one bigger than the whole goes alone', gate.used === 50);
    let small = false;
    const ws = gate.acquire(1).then((rel) => { small = true; return rel; });
    await settle();
    ok('…and nothing goes beside it', !small);
    big();
    (await ws)();
    ok('…until it is done', small && gate.used === 0);

    const { p, files } = await makePlugin({ device_id: 'd_me' });
    p.meCache = { m: { item_bytes_limit: 100 << 20 }, at: Date.now() };
    let running = 0, peak = 0;
    const calls = serve({ 'POST /v1/ingest/file': async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 15)); running--; return { json: { seq: 77 } }; } });
    const uploads = () => calls.filter((c) => c.path.startsWith('/v1/ingest/file'));   // not the real-time ticket asks that go on beside
    const mk = (name, mb) => { files.set(`B/${name}`, Buffer.from('x')); return { path: `B/${name}`, name, extension: 'bin', stat: { size: mb << 20 } }; };
    await p.sendFiles([mk('a.bin', 40), mk('b.bin', 40), mk('c.bin', 40)]);
    ok('three files of 40 MB are sent one after the other (no more than about 64 MB in memory at once)', peak === 1 && uploads().length === 3, JSON.stringify([peak, uploads().length]));
    peak = 0;
    await p.sendFiles([mk('d.bin', 20), mk('e.bin', 20), mk('f.bin', 20)]);
    ok('three of 20 MB go together, as before', peak === 3, String(peak));
    ok('nothing stays held when they are done', p.sendMemory.used === 0);
    // the account's own limit for one item, as last read, is checked before the file is read
    calls.length = 0;
    p.meCache = { m: { item_bytes_limit: 5 << 20 }, at: Date.now() };
    let readOne = false;
    const readBinary = p.app.vault.readBinary;
    p.app.vault.readBinary = async (f) => { readOne = true; return readBinary(f); };
    notices.length = 0;
    await p.sendFiles([mk('g.bin', 6)]);
    ok('a file over what the account allows for one item is refused before it is read or sent, saying how much', uploads().length === 0 && !readOne && notices.some((n) => n.includes('Over the 5 MB limit')), JSON.stringify([uploads().length, readOne, notices]));
    await p.sendFiles([mk('h.bin', 4)]);
    ok('…one under it goes', uploads().length === 1 && readOne);
    p.app.vault.readBinary = readBinary;
    // a failed request still gives its memory back
    serve({ 'POST /v1/ingest/file': () => ({ status: 500, json: { error: 'SERVER' } }) });
    await p.sendFiles([mk('i.bin', 20)]);
    ok('a send that fails gives its bytes back', p.sendMemory.used === 0);

    // fetched ahead: a window of bytes, the first one always
    const fa = await makePlugin({ device_id: 'd_me' });
    const started = [];
    fa.p.download = (item) => { started.push(item.seq); return Promise.resolve({ status: 200 }); };
    const dl = (seq, mb) => ({ seq, url: `https://files.example/${seq}`, bytes: mb << 20, device_id: 'd_other' });
    fa.p.fetchAhead([dl(1, 20), dl(2, 20), dl(3, 20)], 0);
    ok('what is fetched ahead stays within a window of bytes: 20 + 20 fit, the third waits', same(started, [1, 2]) && fa.p.fetched.size === 2, JSON.stringify(started));
    fa.p.fetchAhead([dl(1, 20), dl(2, 20), dl(3, 20)], 0);
    ok('…and what already goes is not started twice', same(started, [1, 2]));
    fa.p.dropFetched();
    started.length = 0;
    fa.p.fetchAhead([dl(4, 100), dl(5, 1), dl(6, 1)], 0);
    ok('the one needed now is fetched whatever its size, and nothing is fetched beside it while it fills the window', same(started, [4]), JSON.stringify(started));
    // let go: the answer of a download that is let go is thrown away
    serve({ 'GET /': () => ({ bytes: PNG_BYTES() }) });
    fa.p.dropFetched();
    const live = Object.getPrototypeOf(fa.p).download.call(fa.p, { url: 'https://files.example/9' });   // the real one: above it was replaced by a stub
    fa.p.fetched.set(9, live);
    const outcome = live.then(() => 'kept', () => 'dropped');
    fa.p.dropFetched();
    ok('letting go empties the list, and a download let go does not keep its answer', fa.p.fetched.size === 0 && (await outcome) === 'dropped');
    // turned off: nothing is held, nothing is started
    fa.p.batchTimers.set('b', 1);
    fa.p.batchMembers.set('b', []);
    fa.p.fetched.set(10, Promise.resolve({}));
    for (const fn of fa.p.cleanups ?? []) fn();
    ok('turning the plugin off empties the batch timers, the waiting members and the downloads ahead', fa.p.batchTimers.size === 0 && fa.p.batchMembers.size === 0 && fa.p.fetched.size === 0 && fa.p.unloaded === true);
    started.length = 0;
    fa.p.fetchAhead([dl(11, 1)], 0);
    ok('…and no download is started after that', started.length === 0);
  }

  console.log('── The account is read once at a start, not at every start ──');
  {
    const { p } = await makePlugin({ token: 'dk_x', momentsCheckedAt: 0, lastPlan: 'free', lastPaidUntil: 0 });
    p.sync = async () => 0; p.connect = () => {}; p.refreshEndpoints = () => {};
    const calls = serve({ 'GET /v1/me': () => ({ json: { plan: 'free', devices_used: 1, devices_limit: 2 } }) });
    await p.start();
    ok('the time of the check is kept even when nothing in the account changed', p.settings.momentsCheckedAt > 0 && p.stored.momentsCheckedAt === p.settings.momentsCheckedAt && calls.filter((c) => c.path === '/v1/me').length === 1, JSON.stringify([p.stored.momentsCheckedAt, calls.map((c) => c.path)]));
    const again = await makePlugin(undefined, JSON.parse(JSON.stringify(p.stored)));
    again.p.sync = async () => 0; again.p.connect = () => {}; again.p.refreshEndpoints = () => {};
    const calls2 = serve({ 'GET /v1/me': () => ({ json: { plan: 'free' } }) });
    await again.p.start();
    ok('…so the next start does not read the account again', calls2.filter((c) => c.path === '/v1/me').length === 0, JSON.stringify(calls2.map((c) => c.path)));
  }

  console.log('── Auto-processing: by hand ──');
  {
    const { p, files, fm, metadataCache } = await makePlugin(agentsOf([fakeRule({ enabled: false, auto: false })]));
    metadataCache.getFirstLinkpathDest = (link) => (files.has(`Inbox/${link}`) ? { path: `Inbox/${link}`, name: link } : null);
    files.set('Inbox/budget.png', Buffer.from('png'));
    const write = (path, content) => { files.set(path, content); const m = /^---\n([\s\S]*?)\n---/.exec(content); const o = {}; for (const l of m[1].split('\n')) { const [k, ...v] = l.split(': '); const val = v.join(': '); o[k] = /^\d+$/.test(val) ? Number(val) : /^\[.*\]$/.test(val) ? JSON.parse(val) : val; } fm.set(path, o); return { path, name: path.split('/').pop(), extension: 'md' }; };
    const textNote = write('Inbox/09-17 08.00 plan.md', `---\nkind: text\nsource: cli\ncreated: 2026-09-17T08:00:00.000Z\ndropit_seq: 370\n---\n\nPlan the launch MODE:echo\n\n— [A Post](https://example.com/post/1)\n`);
    const urlNote = write('Inbox/09-17 08.00 link.md', `---\nkind: url\nsource: web\ncreated: 2026-09-17T08:00:00.000Z\ndropit_seq: 371\n---\n\n[A page](https://example.com/a)\n\n> what it says\n`);
    const imgNote = write('Inbox/09-17 08.00 pic.md', `---\nkind: image\nsource: web\ncreated: 2026-09-17T08:00:00.000Z\ndropit_seq: 372\n---\n\n![[budget.png]]\n`);
    const batchNote = write('Inbox/09-17 08.00 batch.md', `---\nkind: batch\nsource: web\ncreated: 2026-09-17T08:00:00.000Z\ndropit_batch: bXXXX\ndropit_seq: [373, 374]\n---\n\nthe words\n\n![[budget.png]]\n`);
    files.set('Inbox/plain.md', 'no front matter at all');
    const plain = { path: 'Inbox/plain.md', name: 'plain.md', extension: 'md' };

    const a = await p.payloadOfNote(textNote);
    ok('a received note becomes an item from its front matter: seq, kind, source, the text without the source line', a.seq === 370 && a.kind === 'text' && a.source === 'cli' && a.text === 'Plan the launch MODE:echo' && a.note === textNote.path && a.meta.from.url === 'https://example.com/post/1' && a.meta.from.title === 'A Post', JSON.stringify(a));
    const b = await p.payloadOfNote(urlNote);
    ok('a link note: the address as the text, its title and description as meta', b.kind === 'url' && b.text === 'https://example.com/a' && b.meta.title === 'A page' && b.meta.description === 'what it says', JSON.stringify(b));
    const c = await p.payloadOfNote(imgNote);
    ok('a file note: no text, its file, its name and type', c.kind === 'image' && c.text === '' && same(c.files, ['Inbox/budget.png']) && c.meta.filename === 'budget.png' && c.meta.mime === 'image/png', JSON.stringify(c));
    const d = await p.payloadOfNote(batchNote);
    ok('a batch note: its words, its file, its first number — one batch, so the picture goes to the agent too', d.kind === 'batch' && d.text === 'the words' && d.seq === 373 && same(d.files, ['Inbox/budget.png']) && d.batch.id === 'bXXXX' && d.batch.count === 2 && d.parts.length === 2, JSON.stringify(d));
    ok('a note that did not come through dropit is not processed', (await p.payloadOfNote(plain)) === null);

    // process-note: the rule is run on the open note — a rule that is off and by-hand-only still runs on purpose
    p.app.workspace.getActiveFile = () => textNote;
    const cmd = p.commands.find((x) => x.id === 'process-note');
    ui.opened.length = 0;
    cmd.checkCallback(false);
    await settle(); await settle();
    const picker = ui.opened.find((m) => m.onChooseItem);
    ok('"Process this note with…" offers the rule', !!picker && picker.getItems().length === 1 && picker.getItemText(picker.getItems()[0]) === 'Fake');
    p.settings.agents.consented = false;
    picker.onChooseItem(picker.getItems()[0]);
    await settle();
    // not confirmed yet: it asks first, and nothing has started
    const consent = ui.opened.find((m) => m instanceof X.ConsentModal);
    ok('the first time, it asks for confirmation before anything starts', !!consent && p.runs.length === 0 && resultsIn(files).length === 0);
    ok('…the confirmation is not remembered if it is closed without a yes', (consent.close(), p.settings.agents.consented === false) && p.runs.length === 0);
    p.settings.agents.consented = true;
    picker.onChooseItem(picker.getItems()[0]);
    for (let i = 0; i < 50 && !resultsIn(files).length; i++) await new Promise((r) => setTimeout(r, 20));
    const made = resultsIn(files);
    ok('a note processed by hand gets its answer beside it, quoting what it holds', made.join() === 'Inbox/09-17 08.00 plan · Fake.md' && files.get(made[0]).startsWith('> Plan the launch MODE:echo\n\n---\n\n'), made.join());
    ok('…and the original is as it was', files.get(textNote.path).endsWith('Plan the launch MODE:echo\n\n— [A Post](https://example.com/post/1)\n') && !files.get(textNote.path).includes('SUMMARY'));
    ok('…and a notice says where it went', notices.at(-1)?.includes('plan · Fake'), notices.at(-1));
    // again: on purpose, so a number rather than a skip
    await p.rerunLast();
    ok('"Re-run the last handler" runs it again, on the same item, into a numbered note', resultsIn(files).sort().join() === 'Inbox/09-17 08.00 plan · Fake 2.md,Inbox/09-17 08.00 plan · Fake.md', resultsIn(files).join());
    const none = await makePlugin(agentsOf([fakeRule()]));
    notices.length = 0;
    await none.p.rerunLast();
    ok('with nothing run yet, it says so', notices.at(-1) === X.STRINGS.en.agents.nothingToRerun, notices.at(-1));
    p.app.workspace.getActiveFile = () => plain;
    notices.length = 0;
    await p.processNote(plain);
    ok('on a note that is not from dropit, it says so', notices.at(-1) === X.STRINGS.en.agents.notDropitNote, notices.at(-1));
    const latest = await p.latestPayload();
    ok('the latest item is found from the notes when nothing was received this session', latest?.kind === 'text' || latest?.kind === 'image' || latest?.kind === 'url', JSON.stringify(latest));
  }

  console.log('── Auto-processing: the settings page ──');
  {
    const A = X.STRINGS.en.agents;
    const U = X.STRINGS.en.set;
    const { p } = await makePlugin();
    p.detect = async () => FOUND;
    p.tab.containerEl = anything();
    p.api = async (method, path) => (path === '/v1/devices' ? { devices: [] } : { plan: 'free', devices_used: 1, devices_limit: 2, bytes_used: 0, bytes_limit: 31457280 });
    const reset = () => { ui.names.length = 0; ui.buttons.length = 0; ui.toggles.length = 0; ui.dropdowns.length = 0; ui.opened.length = 0; };
    const draw = async () => { reset(); thenCalls = 0; p.tab.display(); for (let i = 0; i < 10; i++) await settle(); };
    await draw();
    ok('a desktop with no rule: one switch to turn it on, and nothing more to set yet', ui.toggles.some((x) => x.name === U.ai && x.value === false) && !ui.names.includes(U.agent) && !ui.names.includes(U.command) && thenCalls < 50, ui.names.join('|'));
    ok('the pairing code box says where the new device gets dropit, in both languages, around a link', [X.STRINGS.en, X.STRINGS.zh].every((l) => Array.isArray(l.codeInstall) && l.codeInstall.length === 2 && l.codeInstall[0].length > 15) && /^https:\/\/dropit\.smart-kits\.xyz\/#install$/.test(X.INSTALL_URL));
    ok('…the groups: receiving (with "after it arrives" as its second part), devices (with where a send goes by default), advanced — each with a name', ['receiving', 'after', 'devices', 'advanced'].every((k) => U[k] && X.STRINGS.zh.set[k]));
    const turnOn = ui.toggles.find((x) => x.name === U.ai);
    const turning = turnOn.change(true);
    await settle(); await settle();
    const consent = ui.opened.find((m) => m instanceof X.ConsentModal);
    ok('turning it on shows what will happen first, and writes nothing yet', !!consent && p.settings.agents.handlers.length === 0 && p.settings.agents.consented === false);
    const sink = [];
    consent.contentEl.createEl = (tag, o) => { sink.push(o?.text); return anything(); };
    consent.onOpen();
    ok('…all matching items go to the agent, dropit does not handle or keep them; the full command is shown; a received text or link becomes one note',
      sink.some((x) => /handed to the agent you chose/.test(x ?? '') && /does not handle it or keep it/.test(x ?? '')) && sink.some((x) => x === A.consentRuns) && /becomes one note/.test(A.consentResult) && /生成|变成一篇笔记/.test(X.STRINGS.zh.agents.consentResult));
    ui.buttons.filter((b) => b.text === A.consentGo).at(-1).click();
    await turning;
    for (let i = 0; i < 6; i++) await settle();
    const rule = p.settings.agents.handlers[0];
    ok('confirming writes consented and makes the rule from what is on this computer: Claude Code, all four parts, the source not kept, turned on',
      p.settings.agents.consented === true && p.settings.agents.handlers.length === 1 && rule.enabled === true && rule.agent === 'claude' && rule.pick === 'claude' && rule.name === 'Auto'
      && same(rule.parts, ALL) && rule.keepSource === false && rule.mode === 'auto', JSON.stringify(p.settings.agents));
    ok('…and it was saved', p.stored.agents.consented === true && p.stored.agents.handlers.length === 1);

    await draw();
    ok('with the rule: the agent, its command, what to handle, keep the original, try it — and the Obsidian command under them', [U.agent, U.handle, U.runCommand].every((n) => ui.names.includes(n)) && ui.buttons.some((x) => x.text === U.tryButton), ui.names.join('|'));
    ok('…the Obsidian command is a row of its own, beside the AI switch (not one of its options): both can be on', ui.names.includes(U.ai) && ui.names.includes(U.runCommand) && /either, both, or neither/.test(U.runCommandTip) && /都开/.test(X.STRINGS.zh.set.runCommandTip));
    ok('…its part inside Receiving is named for when it happens', X.STRINGS.zh.set.after === '收到之后');
    rule.enabled = false;
    await draw();
    ok('switched off: the AI\'s rows fold away (no agent, command, boxes, try) while the Obsidian command stays', ui.toggles.some((x) => x.name === U.ai && x.value === false) && ![U.agent, U.handle].some((n) => ui.names.includes(n)) && !ui.buttons.some((x) => x.text === U.tryButton) && ui.names.includes(U.runCommand), ui.names.join('|'));
    rule.enabled = true;
    await draw();
    ok('…and none of the old blocks: no "what each kind gets", no "see what would happen", no example item', !ui.names.some((n) => /each kind gets|would happen|Example item/i.test(n)));
    ok('…no pause switch, no list of rules, no record of runs', !ui.names.some((n) => /pause|Recent runs|Rules/i.test(n)));
    ok('…the AI limits are one row under the AI, and the exact command is a button on the command row: neither is in Advanced', !ui.names.includes(U.showCommand) && ui.buttons.some((b) => b.text === U.showButton) && Object.keys(U.lim).length === 5 && Object.keys(X.STRINGS.zh.set.lim).length === 5);
    ok('…the other order of things: the AI comes before the Obsidian command', ui.names.indexOf(U.ai) < ui.names.indexOf(U.runCommand));
    const dd = ui.dropdowns.find((d) => d.name === U.agent);
    ok('the agent list has what was found here, and a command of one\'s own: not what is missing', same(Object.keys(dd.options), ['claude', 'codex', 'pi', 'custom']) && dd.value === 'claude', JSON.stringify(dd));

    // what to handle: the boxes
    X.toggleHandle(rule, 'ocr', false);
    ok('unticking a part takes its kinds out and rewrites the prompt', same(rule.parts, ['audio', 'link', 'sum']) && same(rule.kinds, ['text', 'url', 'video', 'file']) && !rule.prompt.includes('Image or PDF'));
    X.toggleHandle(rule, 'ocr', true);
    ok('ticking it again puts it back', same(rule.parts, ALL) && rule.prompt.includes('Image or PDF'));
    rule.prompt = 'My own words';
    X.toggleHandle(rule, 'audio', false);
    ok('a prompt the person wrote is not rewritten by ticking', rule.prompt === 'My own words' && !rule.kinds.includes('video'));
    X.toggleHandle(rule, 'audio', true);
    ok('the boxes are in the order text, links, images, audio — the labels say what each does', same(X.ORDER_UI ?? ['sum', 'link', 'ocr', 'audio'], ['sum', 'link', 'ocr', 'audio']) && U.handleOpts.sum === 'Text' && X.STRINGS.zh.set.handleOpts.audio === '语音和视频');

    await draw();
    rule.keepSource = true; await p.save();
    ok('keep the original is kept (a box at the end of the row of what to handle)', rule.keepSource === true && p.stored.agents.handlers[0].keepSource === true && U.keepOriginal && X.STRINGS.zh.set.keepOriginal);

    // a rule saved by an earlier version
    {
      const old = { id: 'r1', name: 'x', enabled: true, auto: true, agent: 'claude', pick: 'claude', kinds: ['text', 'url', 'image'], mode: 'think', parts: ['ocr', 'audio', 'link', 'sum'], prompt: '先判断这条内容是什么（文章、截图、待办、联系方式、收据……）。然后用内容所用的语言：给出 3 点以内的要点。' };
      const up = X.normalizeAgents({ handlers: [old] }).handlers[0];
      ok('an old default prompt becomes today\'s, and a fixed no-tools mode becomes "by the item" (so links are opened and pictures read)', up.prompt === X.composePrompt(ALL, 'en') || up.prompt === X.composePrompt(ALL, 'zh'), up.prompt.slice(0, 40));
      ok('…the mode is auto', up.mode === 'auto');
      const mine = X.normalizeAgents({ handlers: [{ ...old, prompt: 'My own words', mode: 'auto' }] }).handlers[0];
      ok('a prompt the person wrote is left alone', mine.prompt === 'My own words');
      const prev = X.normalizeAgents({ handlers: [{ ...old, mode: 'auto', parts: ['sum'], prompt: 'Something arrived from another device. Work out what it is, then handle it by type:\n- Text: tidy it into a few clear sentences; if it holds things to do, list them at the end.\nOutput only the result, no greeting.' }] }).handlers[0];
      ok('the previous default (any ticked parts) is brought up too', prev.prompt === X.composePrompt(['sum'], 'en') || prev.prompt === X.composePrompt(['sum'], 'zh'));
      const own = X.normalizeAgents({ handlers: [{ ...old, agent: 'custom', argv: ['x'], mode: 'think', prompt: 'mine' }] }).handlers[0];
      ok('a command of one\'s own keeps its mode', own.mode === 'think');
    }

    // the command line
    ok('the command is always shown: for Claude the checked default, written out, not hidden behind "custom"', X.shownCommand(rule, 'claude') === 'claude -p --safe-mode --tools "" --strict-mcp-config --no-session-persistence' && !X.isEdited(rule, 'claude'), X.shownCommand(rule, 'claude'));
    X.applyCommand(rule, 'claude', 'claude -p --model haiku --tools ""', X.commandLine('claude'), FOUND);
    ok('editing it makes it the person\'s own command, run exactly as written; the preset is not used any more', rule.agent === 'custom' && same(rule.argv, ['claude', '-p', '--model', 'haiku', '--tools', '']) && X.isEdited(rule, 'claude'), JSON.stringify(rule));
    ok('…and what is shown is what was written', X.shownCommand(rule, 'claude') === 'claude -p --model haiku --tools ""', X.shownCommand(rule, 'claude'));
    X.applyCommand(rule, 'claude', 'claude -p --safe-mode --tools "" --strict-mcp-config --no-session-persistence', X.commandLine('claude'), FOUND);
    ok('typing the default line back brings the checked preset back', rule.agent === 'claude' && !('argv' in rule) && !X.isEdited(rule, 'claude'));
    X.applyCommand(rule, 'claude', 'claude -p --x', X.commandLine('claude'), FOUND);
    X.pickAgent(rule, 'claude', FOUND);
    ok('Reset does the same', rule.agent === 'claude' && !('argv' in rule));

    // picking another agent
    await draw();
    await ui.dropdowns.find((d) => d.name === U.agent).change('codex');
    ok('picking Codex: a command of one\'s own, started from the arguments its help suggests, and saved', rule.agent === 'custom' && rule.pick === 'codex' && same(rule.argv, ['/fake/bin/codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral']) && p.stored.agents.handlers[0].pick === 'codex', JSON.stringify(rule));
    await draw();
    ok('…and the page shows the command to edit', ui.buttons.some((b) => b.text === U.reset) && ui.dropdowns.find((d) => d.name === U.agent).value === 'codex');
    ok('…it is not "edited" until the person changes it, and its default can be brought back', !X.isEdited(rule, 'codex', '/fake/bin/codex') && (X.applyCommand(rule, 'codex', 'codex exec --yolo', X.commandLine('codex', '/fake/bin/codex'), FOUND), X.isEdited(rule, 'codex', '/fake/bin/codex')));
    await ui.dropdowns.find((d) => d.name === U.agent).change('custom');
    ok('picking one\'s own command keeps what was there', rule.agent === 'custom' && rule.pick === 'custom' && rule.argv.length >= 2);
    await ui.dropdowns.find((d) => d.name === U.agent).change('claude');
    ok('and picking Claude Code is its own agent again', rule.agent === 'claude' && !('argv' in rule));

    // turning it off and on again: no second confirmation, no second rule
    await draw();
    await ui.toggles.find((x) => x.name === U.ai).change(false);
    ok('off: the rule stays, switched off', p.settings.agents.handlers.length === 1 && rule.enabled === false);
    await draw();
    ui.opened.length = 0;
    await ui.toggles.find((x) => x.name === U.ai).change(true);
    ok('on again: no second confirmation and no second rule', !ui.opened.some((m) => m instanceof X.ConsentModal) && p.settings.agents.handlers.length === 1 && rule.enabled === true);
    // a rule that exists but was never confirmed asks first
    const fresh = await makePlugin(agentsOf([fakeRule({ enabled: false })], { consented: false }));
    fresh.p.detect = async () => FOUND;
    fresh.p.tab.containerEl = anything();
    fresh.p.api = p.api;
    reset();
    fresh.p.tab.display();
    for (let i = 0; i < 10; i++) await settle();
    const sw = ui.toggles.find((x) => x.name === U.ai);
    const asking = sw.change(true);
    await settle();
    ok('switching it on before the confirmation asks first, and leaves it off', ui.opened.some((m) => m instanceof X.ConsentModal) && fresh.p.settings.agents.handlers[0].enabled === false && fresh.p.settings.agents.consented === false);
    ui.opened.find((m) => m instanceof X.ConsentModal).close();
    await asking;
    ok('…declining changes nothing', fresh.p.settings.agents.consented === false && fresh.p.settings.agents.handlers[0].enabled === false);
    const draws = (() => { thenCalls = 0; fresh.p.tab.display(); return thenCalls; })();
    ok('the page draws without a promise adopting a Setting', draws < 50);
    ok('the page says only {{kind}} means anything in a prompt', /\{\{kind\}\}/.test(U.promptTip) && /\{\{kind\}\}/.test(X.STRINGS.zh.set.promptTip));
  }

  console.log('── The command line: words in, words out ──');
  {
    const same2 = (line, argv) => same(X.splitCommand(line), argv) && X.splitCommand(X.joinCommand(argv)).every((w, i) => w === argv[i]) && X.splitCommand(X.joinCommand(argv)).length === argv.length;
    ok('plain words', same2('claude -p', ['claude', '-p']));
    ok('an empty argument survives a round trip (the default has one: --tools "")', same2('claude --tools "" -p', ['claude', '--tools', '', '-p']));
    ok('quotes keep a word with spaces together, single or double', same(X.splitCommand('a "b c" \'d e\' f'), ['a', 'b c', 'd e', 'f']));
    ok('a backslash keeps the next character; inside single quotes it is just a backslash', same(X.splitCommand('a\\ b "c\\"d" \'e\\f\''), ['a b', 'c"d', 'e\\f']));
    ok('extra spaces and a blank line are nothing', same(X.splitCommand('  a   b  '), ['a', 'b']) && same(X.splitCommand(''), []));
    ok('what needs quoting is quoted when shown, and read back the same', same2('x "a b" "q\\"r"', ['x', 'a b', 'q"r']));
    ok('nothing is ever handed to a shell: a $ or ; is only a character', same(X.splitCommand('echo $HOME; rm -rf /'), ['echo', '$HOME;', 'rm', '-rf', '/']));
  }

  console.log('── Auto-processing: see what would happen (runs nothing) ──');
  {
    const A = X.STRINGS.en.agents;
    const claude = { ...X.newRule('claude', null, ALL, false, 'en'), enabled: true };
    const pv = X.previewOf(claude, 'text', { bin: '/opt/homebrew/bin/claude', base: { PATH: '/x', HOME: '/h', USER: 'u', SECRET_KEY: 's' } });
    ok('the final command: the program, then the arguments, no content in them', same(pv.argv, ['/opt/homebrew/bin/claude', '-p', '--safe-mode', '--tools', '', '--strict-mcp-config', '--no-session-persistence']) && !pv.argv.join(' ').includes('supplier'), JSON.stringify(pv.argv));
    ok('the whole input: the prompt, the warning, then the content block', pv.input.startsWith(claude.prompt) && /untrusted data/.test(pv.input) && pv.input.includes('<content kind="text">') && pv.input.includes(A.sampleText));
    ok('the environment: PATH, USER and HOME and nothing else', same(Object.keys(pv.env).sort(), ['HOME', 'PATH', 'USER']) && pv.env.PATH.startsWith('/opt/homebrew/bin:'), JSON.stringify(pv.env));
    ok('on, automatic: the verdict says it would run, with the permission in words', /Would run Claude Code, permission “Read the text only”/.test(pv.notes.join('\n')), pv.notes.join('|'));
    ok('only {{kind}} is filled in; any other variable is dropped from the input', X.previewOf({ ...claude, prompt: 'A {{kind}} B {{text}} C {{title}}' }, 'url').input.startsWith('A url B  C'), X.previewOf({ ...claude, prompt: 'A {{kind}} B {{text}} C' }, 'url').input.slice(0, 20));
    ok('paused: the verdict says nothing will run by itself', X.previewOf(claude, 'text', { paused: true }).notes[0] === A.pvPaused);
    ok('off: the verdict says it will not run by itself', X.previewOf({ ...claude, enabled: false }, 'text').notes[0] === A.pvOff);
    ok('a kind the rule does not list: skipped, with the reason, and no command', (() => { const r = X.previewOf({ ...claude, kinds: ['url'] }, 'text'); return r.argv === null && r.notes.at(-1) === A.pvSkip(X.STRINGS.en.agents.why['skipped:kind']); })());
    ok('a minimum length the person set shows up for a short text', X.previewOf({ ...claude, minChars: 50 }, 'short').argv === null && X.previewOf({ ...claude, minChars: 5 }, 'short').argv !== null);
    const image = X.previewOf(claude, 'image');
    ok('per item: an image is given its file, so the argument list names the read permission and the input lists the file', image.argv.includes('Read(./**)') && image.input.includes('files in the working directory: ./budget.png') && !image.notes.includes(A.pvMetaOnly), JSON.stringify(image.argv));
    const web = X.previewOf(claude, 'url');
    ok('per item: a link may open its own site and no other', web.argv.includes('WebFetch(domain:example.com)') && !web.notes.includes(A.pvNoWeb), JSON.stringify(web.argv));
    ok('a rule that names the plain permission: an image shows only its name and type', X.previewOf({ ...claude, mode: 'think' }, 'image').notes.includes(A.pvMetaOnly) && X.previewOf({ ...claude, mode: 'think' }, 'url').notes.includes(A.pvNoWeb));
    ok('a custom command: exactly the list the person typed, and the first item is the program', same(X.previewOf(fakeRule(), 'text', {}).argv, [process.execPath, FAKE]));
    ok('commandOf finds the command a rule would start, for the first-time confirmation', same(X.commandOf(claude, { bin: '/c/claude' }).argv.slice(0, 2), ['/c/claude', '-p']) && X.commandOf({ ...claude, kinds: [] }, {}).argv === null);
  }


  console.log('── Sending: who a send goes to by default ──');
  {
    const T = X.STRINGS.en;
    const U = T.set;
    const Z = X.STRINGS.zh;
    const devs = [
      { device_id: 'd_me', name: 'My Mac', scope: 'full', last_seen_at: Date.now() },
      { device_id: 'd_a', name: 'Pixel', scope: 'full', last_seen_at: Date.now() - 180_000 },
      { device_id: 'd_b', name: 'Linux', scope: 'full', last_seen_at: Date.now() - 86_400_000 },
      { device_id: 'd_c', name: 'Shortcut', scope: 'ingest_only', last_seen_at: Date.now() },
    ];
    const ME = { plan: 'free', devices_used: 4, devices_limit: 10, bytes_used: 0, bytes_limit: 31457280 };
    const receiversOf = X.receivers(devs, 'd_me');

    // the pure parts: who can be picked, and what is left of a saved default
    ok('who can be picked: full access, not removed, not this vault — a send-only device and this vault are left out', same(receiversOf.map((d) => d.device_id), ['d_a', 'd_b'])
      && X.receivers([...devs, { device_id: 'd_x', name: 'Old', scope: 'full', revoked_at: 1 }], 'd_me').length === 2);
    ok('a saved default is cleaned: only ids, no repeats, anything else is nothing', same(X.cleanTargets(['d_a', 'd_a', '', 5, null]), ['d_a']) && same(X.cleanTargets('d_a'), []) && same(X.cleanTargets(undefined), []));
    ok('the saved default meets the devices that are there: the part that still exists is kept', same(X.reconcileTargets(['d_a', 'd_gone'], receiversOf), { ids: ['d_a'], gone: 1 }));
    ok('…none of it left: back to all (empty), and it says how many went', same(X.reconcileTargets(['d_gone', 'd_old'], receiversOf), { ids: [], gone: 2 }));
    ok('…a chosen set that names every device stays a chosen set (a device added later is not in it); nothing saved is nothing lost', same(X.reconcileTargets(['d_b', 'd_a'], receiversOf), { ids: ['d_b', 'd_a'], gone: 0 }) && same(X.reconcileTargets([], receiversOf), { ids: [], gone: 0 }));
    ok('…one of the chosen gone, the rest naming every device that is left: still the rest, and it says one went', same(X.reconcileTargets(['d_a', 'd_b', 'd_gone'], receiversOf), { ids: ['d_a', 'd_b'], gone: 1 }));
    ok('the default in a few words: All, or how many of the devices there now', X.defaultLabel([], receiversOf) === 'All' && X.defaultLabel(['d_a'], receiversOf) === '1 device'
      && X.defaultLabel(['d_a', 'd_b'], receiversOf) === '2 devices' && X.defaultLabel(['d_gone'], receiversOf) === 'All' && X.defaultLabel([], null) === 'All');
    ok('…in Chinese too (全部 / N 台), and the heading, the column and the folded line have words in both', Z.set.allDevices === '全部' && Z.set.deviceN(3) === '3 台' && Z.set.defaultHead === '这台电脑默认投给：' && Z.set.defaultIs('全部') === '默认投给全部'
      && U.defaultHead === 'This computer sends to by default:' && U.defaultIs('All') === 'Default: All' && !('selectAll' in U) && !('delivery' in U) && !('selectAll' in Z.set));

    // every slot in use: which device the new one replaces
    const full = { plan: 'free', devices_used: 4, devices_limit: 4 };
    ok('slots: room left, nothing is picked', X.slotPlan(ME, devs, 'd_me').pick === null && X.slotPlan(ME, devs, 'd_me').full === false);
    ok('slots: full, the one idle longest is picked — a send-only device counts, this vault never does', X.slotPlan(full, devs, 'd_me').pick?.device_id === 'd_b' && X.slotPlan(full, devs, 'd_me').others.every((d) => d.device_id !== 'd_me'));
    ok('slots: a chosen device is honoured, an unknown choice falls back to the idle one', X.slotPlan(full, devs, 'd_me', 'd_a').pick?.device_id === 'd_a' && X.slotPlan(full, devs, 'd_me', 'd_zzz').pick?.device_id === 'd_b');
    ok('slots: a removed device is not offered', X.slotPlan(full, [...devs, { device_id: 'd_x', name: 'Old', last_seen_at: 1, revoked_at: 5 }], 'd_me').pick?.device_id === 'd_b');
    ok('slots: full with nothing else to replace — no pick (no code is made)', (() => { const r = X.slotPlan({ devices_used: 1, devices_limit: 1 }, [devs[0]], 'd_me'); return r.full && r.pick === null; })());
    ok('slots: an account that could not be read is treated as having room', X.slotPlan(null, devs, 'd_me').pick === null);
    ok('slots: words in both languages (name in quotes, a way to change it, nothing to pick, upgrade)', T.slotFull(2, 'Linux').includes('Linux') && Z.slotFull(2, 'Linux').includes('「Linux」') && !!T.slotChange && !!Z.slotChange && !!T.slotNone && !!Z.slotNone && !!T.slotUpgrade && !!Z.slotUpgrade);

    // the settings page
    const mk = async (settings, list = devs) => {
      const r = await makePlugin({ device_id: 'd_me', ...settings });
      const p = r.p;
      p.tab.containerEl = anything();
      p.detect = async () => FOUND;
      r.apiCalls = [];
      p.api = async (method, path) => {
        r.apiCalls.push(`${method} ${path}`);
        return path === '/v1/devices' ? (method === 'GET' ? { devices: list } : {}) : ME;
      };
      r.groups = [];
      const origGroup = p.tab.group;
      p.tab.group = function (key, title, summary) {
        const g = origGroup.call(this, key, title, summary);
        const rec = { key, title, summary };
        r.groups.push(rec);
        const set = g.setSummary;
        g.setSummary = (x) => { rec.summary = x; set(x); };
        return g;
      };
      r.draw = async () => {
        for (const k of ['names', 'buttons', 'toggles', 'dropdowns', 'opened', 'checks', 'links']) ui[k].length = 0;
        r.groups.length = 0;
        p.tab.display();
        for (let i = 0; i < 12; i++) await settle();
        r.warn = [];
        if (p.tab.targetsWarn) p.tab.targetsWarn.setText = (x) => { r.warn.push(x); };
      };
      return r;
    };

    {
      const { p, draw, groups } = await mk({});
      await draw();
      ok('the groups, in this order: Receiving, Devices, Advanced (no Sending group: the default lives in Devices)', same(groups.map((g) => g.key), ['receiving', 'devices', 'advanced']) && groups.map((g) => g.title).join() === 'Receiving,Devices,Advanced', JSON.stringify(groups));
      const at = (n) => ui.names.indexOf(n);
      ok('Receiving holds how it is written, then (after the "After it arrives" part) the AI, the Obsidian command, and Pull again last', at(U.writeAs) < at(U.ai) && at(U.ai) < at(U.runCommand) && at(U.runCommand) < at(T.repull) && at(T.repull) < at(T.addDevice), ui.names.join('|'));
      ok('Devices: add a device, then the default line, then the rows (this computer first; they are drawn when the list comes from the service, after Advanced)', at(T.addDevice) < at(T.serverAddress) && at(U.defaultHead) < at('My Mac') && at('My Mac') < at('Pixel') && at('Pixel') < at('Linux'), ui.names.join('|'));
      ok('Advanced is only the server address; there is no Unpair row any more, and Pull again is one row', ui.names.filter((n) => n === T.serverAddress).length === 1 && ui.names.filter((n) => n === T.repull).length === 1 && !ui.names.includes('Unpair') && !ui.names.includes('解除配对'));
      ok('"Pull again" is one row, in Receiving: it is drawn before the Devices rows', ui.sliders.some((d) => d.row.name === T.repull) && at(T.repull) < at(T.addDevice));
      const ends = ui.buttons.filter((b) => [T.signOut, T.remove].includes(b.text));
      ok('the end of each row: Sign out on this computer, Remove on every other device (the send-only one too)', ends.map((b) => `${b.name}:${b.text}`).join() === 'My Mac:Sign out,Pixel:Remove,Linux:Remove,Shortcut:Remove', JSON.stringify(ends));
      ok('"Select all" is gone', ui.links.length === 0);
      ok('one row per other device that can receive, each a native checkbox, all ticked by default: this vault and a send-only device are not offered', ui.checks.map((c) => c.name).join() === 'Pixel,Linux' && ui.checks.every((c) => c.type === 'checkbox' && c.checked), JSON.stringify(ui.checks.map((c) => [c.name, c.checked])));
      ok('…the folded line says how many devices and that the default is all', groups.find((g) => g.key === 'devices').summary === '4 devices · Default: All' && p.settings.targets.length === 0, groups.find((g) => g.key === 'devices').summary);
    }

    {
      const r = await mk({});
      const { p } = r;
      await r.draw();
      const [pixel, linux] = ui.checks;
      pixel.checked = false;
      pixel.on.change(); await settle(); await settle();
      ok('unticking one saves at once, to data.json: only that device is left', same(p.settings.targets, ['d_b']) && same(p.stored.targets, ['d_b']), JSON.stringify(p.stored.targets));
      ok('…and the folded line becomes one device', r.groups.find((g) => g.key === 'devices').summary === '4 devices · Default: 1 device');
      linux.checked = false;
      linux.on.change(); await settle(); await settle();
      ok('the last one cannot be unticked: it stays ticked, nothing is saved, and the line says to keep one (or tick them all)', linux.checked === true && same(p.stored.targets, ['d_b']) && r.warn.at(-1) === U.keepOne && /tick them all/.test(U.keepOne) && /1 台/.test(Z.set.keepOne) && /全部勾上/.test(Z.set.keepOne), JSON.stringify(r.warn));
      pixel.checked = true;
      pixel.on.change(); await settle(); await settle();
      ok('ticking every box again is "all": nothing is stored, the warning is cleared', p.settings.targets.length === 0 && p.stored.targets.length === 0 && r.warn.lastIndexOf('') > r.warn.lastIndexOf(U.keepOne) && r.groups.find((g) => g.key === 'devices').summary === '4 devices · Default: All');
      pixel.checked = false; pixel.on.change(); await settle(); await settle();
      ok('(one left again)', same(p.settings.targets, ['d_b']) && linux.checked === true && pixel.checked === false);
      // two of three: how many
      const three = await mk({}, [...devs, { device_id: 'd_z', name: 'Tablet', scope: 'full' }]);
      await three.draw();
      ui.checks[2].checked = false; ui.checks[2].on.change(); await settle(); await settle();
      ok('two of three others: the folded line says how many, and the saved list names exactly those two', three.groups.find((g) => g.key === 'devices').summary === '5 devices · Default: 2 devices' && same(three.p.settings.targets, ['d_a', 'd_b']));
    }

    {
      const gone = await mk({ targets: ['d_a', 'd_gone'] });
      notices.length = 0;
      await gone.draw();
      ok('a device removed since last time comes off the default when the page opens, with one Notice, and is saved', same(gone.p.settings.targets, ['d_a']) && same(gone.p.stored.targets, ['d_a']) && notices.filter((n) => n === T.targetsPruned(1, false)).length === 1, JSON.stringify([notices, gone.p.settings.targets]));
      ok('…the rows show what is left: Pixel ticked, Linux not, and the folded line says one device', gone.groups.find((g) => g.key === 'devices').summary === '4 devices · Default: 1 device' && same(ui.checks.map((c) => [c.name, c.checked]), [['Pixel', true], ['Linux', false]]));
      notices.length = 0;
      await gone.draw();
      ok('…and the next time nothing is said again', notices.length === 0);
      const none = await mk({ targets: ['d_gone'] });
      notices.length = 0;
      await none.draw();
      ok('every saved device gone: back to all, and the Notice says so', none.p.settings.targets.length === 0 && notices.includes(T.targetsPruned(1, true)) && /all devices/.test(T.targetsPruned(1, true)) && /全部设备/.test(Z.targetsPruned(1, true)) && ui.checks.every((c) => c.checked));
    }

    {
      const alone = await mk({}, [devs[0], devs[3]]);
      await alone.draw();
      ok('no other device that can receive: no title line, no ticks — the whole default is absent', ui.checks.length === 0 && !ui.names.includes(U.defaultHead) && alone.groups.find((g) => g.key === 'devices').summary === '2 devices', JSON.stringify(ui.names));
      const one = await mk({ targets: ['d_a'] }, [devs[0], devs[1]]);
      await one.draw();
      ok('one other device that can receive: still no default (nothing to choose); a stale one is cleared so a device that joins later is included', ui.checks.length === 0 && !ui.names.includes(U.defaultHead) && one.p.settings.targets.length === 0 && one.p.stored.targets.length === 0);
      ok('…the rows are still there, with Sign out and Remove', ui.buttons.filter((b) => [T.signOut, T.remove].includes(b.text)).map((b) => b.text).join() === 'Sign out,Remove');
      const sendOnly = await mk({}, [...devs, { device_id: 'd_z', name: 'Tablet', scope: 'full' }]);
      await sendOnly.draw();
      ok('a send-only device has no tick, and this computer has none either: ticks only for the devices that can receive', ui.checks.map((c) => c.name).join() === 'Pixel,Linux,Tablet');
    }

    {
      // unpaired: setup, and the server address (it has to be changeable before pairing)
      const { p, draw, groups } = await mk({ token: '' });
      await draw();
      ok('not paired: the setup rows and Advanced with the server address — no default, no devices, no Sign out', same(groups.map((g) => g.key), ['advanced']) && ui.names.includes(T.haveCode) && ui.names.includes(T.serverAddress)
        && ![U.defaultHead, T.addDevice, T.signOut, T.repull, U.writeAs].some((n) => ui.names.includes(n)) && ui.checks.length === 0 && p.settings.token === '', ui.names.join('|'));
    }

    // Sign out asks first
    {
      const r = await mk({ targets: ['d_a'] });
      const { p } = r;
      await r.draw();
      const button = ui.buttons.find((b) => b.text === T.signOut);
      ok('Sign out is the button at the end of this computer\'s row', !!button && button.name === 'My Mac');
      button.click();
      const ask = ui.opened.find((m) => m instanceof X.Confirm);
      ok('pressing it asks first: nothing is sent to the service, this vault is still paired', !!ask && !r.apiCalls.some((c) => c.startsWith('DELETE')) && p.settings.token === 'dk_x');
      ok('…the question says what stays and what goes, in both languages', ask.message === T.signOutAsk && ask.title === 'Sign out of this device?' && ask.yes === 'Sign out'
        && /notes already in your vault and your settings stay/.test(ask.message) && /join again with a pairing code/.test(ask.message) && /default devices are cleared/.test(ask.message)
        && Z.signOutTitle === '退出这台设备？' && Z.signOut === '退出' && /已写入的笔记和插件设置会保留/.test(Z.signOutAsk) && /配对码重新加入/.test(Z.signOutAsk) && !/解除配对|Unpair/i.test(JSON.stringify([T, Z]).replace(/unpaired|not paired/gi, '')));
      ask.close();
      await settle();
      ok('closing it (Cancel) changes nothing', !r.apiCalls.some((c) => c.startsWith('DELETE')) && p.settings.token === 'dk_x' && same(p.settings.targets, ['d_a']));
      ask.onYes();
      for (let i = 0; i < 6; i++) await settle();
      ok('confirming signs out: this device is removed from the account, the sign-in and the default are forgotten here', r.apiCalls.includes('DELETE /v1/devices/d_me') && p.settings.token === '' && p.settings.targets.length === 0 && p.stored.targets.length === 0, JSON.stringify(r.apiCalls));
    }

    // sending: with and without `to`
    {
      const { p, files } = await makePlugin({ device_id: 'd_me' });
      const calls = serve({ 'POST /v1/ingest/file': () => ({ json: { seq: 91 } }), 'POST /v1/ingest': () => ({ json: { seq: 90 } }) });
      files.set('Notes/idea.md', '# Idea');
      files.set('Pics/a.png', PNG);
      const note = { path: 'Notes/idea.md', name: 'idea.md', extension: 'md' };
      const pic = { path: 'Pics/a.png', name: 'a.png', extension: 'png' };
      await p.sendText('hello');
      await p.sendFiles([note, pic]);
      ok('the default (all): no `to` anywhere — not in a text, not in a note, not in an upload', calls.length === 3 && calls.every((c) => !('to' in (c.body && typeof c.body === 'string' ? JSON.parse(c.body) : {})) && !/[?&]to=/.test(c.path)), JSON.stringify(calls.map((c) => c.path)));
      calls.length = 0;
      p.settings.targets = ['d_a', 'd_b'];
      await p.sendText('hello again');
      await p.sendFiles([note, pic]);
      const bodies = calls.filter((c) => c.path === '/v1/ingest').map((c) => JSON.parse(c.body));
      const upload = calls.find((c) => c.path.startsWith('/v1/ingest/file?'));
      ok('a chosen default: every text and note carries `to` with exactly those devices', bodies.length === 2 && bodies.every((b) => same(b.to, ['d_a', 'd_b'])), JSON.stringify(bodies.map((b) => b.to)));
      ok('…and a file upload carries them in the address, with its name and batch beside them', new URL(`https://x${upload.path}`).searchParams.get('to') === 'd_a,d_b' && new URL(`https://x${upload.path}`).searchParams.get('name') === 'a.png');
      ok('…a link and a selection go the same way (one path for all sends)', await (async () => { calls.length = 0; await p.sendText('https://example.com/x'); return same(JSON.parse(calls[0].body).to, ['d_a', 'd_b']) && JSON.parse(calls[0].body).kind === 'url'; })());
      ok('the send commands and the menus all end in sendText / sendFiles', ['send-note', 'send-selection'].every((id) => p.commands.some((c) => c.id === id)));
    }

    // the devices it was for are gone
    {
      const { p } = await makePlugin({ device_id: 'd_me', targets: ['d_a'] });
      const calls = serve({ 'POST /v1/ingest': () => ({ status: 400, json: { error: 'TARGET_UNAVAILABLE', reason: 'gone', gone: ['d_a'] } }) });
      notices.length = 0;
      await p.sendText('hello');
      ok('TARGET_UNAVAILABLE: the default goes back to all, saved, with one Notice that says so — not a second error line', p.settings.targets.length === 0 && p.stored.targets.length === 0 && notices.length === 1 && notices[0] === T.targetsGone(true), JSON.stringify(notices));
      ok('…and it did not send again by itself, to everyone: one request only', calls.length === 1 && 'to' in JSON.parse(calls[0].body));
      ok('…in Chinese too', /默认已改回投给全部/.test(Z.targetsGone(true)) && /已从默认里去掉/.test(Z.targetsGone(false)) && /不能接收/.test(Z.errors.TARGET_UNAVAILABLE));
    }
    {
      const { p, files } = await makePlugin({ device_id: 'd_me', targets: ['d_a'] });
      const calls = serve({ 'POST /v1/ingest': () => ({ status: 400, json: { error: 'TARGET_UNAVAILABLE', reason: 'gone', gone: ['d_a'] } }) });
      const list = [1, 2, 3].map((n) => { files.set(`N/${n}.md`, `note ${n}`); return { path: `N/${n}.md`, name: `${n}.md`, extension: 'md' }; });
      notices.length = 0;
      await p.sendFiles(list);
      ok('a batch whose devices are gone: one Notice for all of it, and none of the later ones went to everyone (the default is read once per batch)', notices.length === 1 && notices[0] === T.targetsGone(true) && calls.length === 3 && calls.every((c) => same(JSON.parse(c.body).to, ['d_a'])) && p.settings.targets.length === 0, JSON.stringify([notices, calls.length]));
    }
    {
      const { p } = await makePlugin({ device_id: 'd_me', targets: ['d_a', 'd_gone'] });
      serve({ 'POST /v1/ingest': () => ({ json: { seq: 5, dropped: ['d_gone'] } }) });
      notices.length = 0;
      await p.sendText('hello');
      ok('a send that reached some of them: the ones the service dropped come off the default, with a Notice', same(p.settings.targets, ['d_a']) && same(p.stored.targets, ['d_a']) && notices.includes(T.targetsGone(false)) && notices.includes('dropit: sent'), JSON.stringify(notices));
    }
    {
      const old = await makePlugin({ device_id: 'd_me' }, { token: 'dk_x', mode: 'note', folder: 'In' });
      ok('settings from before this existed load with the default at all', same(old.p.settings.targets, []));
      const odd = await makePlugin({ device_id: 'd_me' }, { token: 'dk_x', targets: 'd_a' });
      ok('a damaged value in data.json is read as all', same(odd.p.settings.targets, []));
      const pair = await makePlugin({ device_id: 'd_me', targets: ['d_a'] });
      serve({ 'POST /v1/pair/claim': () => ({ json: { token: 'dk_new', device_id: 'd_new' } }), 'GET /v1/pull': pages([]) });
      await pair.p.claimCode('abc123');
      ok('pairing to an account starts at all: the old ids mean nothing there', same(pair.p.settings.targets, []));
    }
  }

  // ── the sentences for the limits, and the way past the ones the paid plan lifts ──
  {
    const { errorText, apiError, errorNotice, safeLink, STRINGS } = DropitPlugin;
    for (const [u, want] of [["https://dropit.example/upgrade?u=1", "https://dropit.example/upgrade?u=1"], ["http://127.0.0.1:8799/upgrade", "http://127.0.0.1:8799/upgrade"], ["http://localhost:8780/x", "http://localhost:8780/x"], ["javascript:alert(1)", null], ["data:text/html,<b>x</b>", null], ["file:///etc/passwd", null], ["obsidian://open?vault=x", null], ["http://evil.example/up", null], ["//evil.example/x", null], ["", null], [null, null]]) ok(`a link from the service: ${String(u).slice(0, 40)}`, safeLink(u) === want, String(safeLink(u)));
    const en = STRINGS.en, zh = STRINGS.zh;
    const at = new Date(2026, 9, 4, 22, 15).getTime();
    ok('too large: the limit from the answer', errorText('PAYLOAD_TOO_LARGE', { field: 'size', limit: 5242880 }, 413, en) === 'Over the 5 MB limit for one item');
    ok('too large, zh, fractional', errorText('PAYLOAD_TOO_LARGE', { field: 'size', limit: 1572864 }, 413, zh) === '超过了单条上限 1.5 MB');
    ok('today\'s sends: when it is back', errorText('RATE_LIMITED', { window: 'day', retry_after: 7200 }, 429, en, at) === "Today's sends are used up — back at 00:15");
    ok('signup limit: how many and when it opens again, zh too, and the plain sentence without a time', /5 accounts/.test(errorText('SIGNUP_LIMITED', { retry_after: 1800, limit: 5 }, 429, en, at)) && /5 个账号/.test(errorText('SIGNUP_LIMITED', { retry_after: 1800, limit: 5 }, 429, zh, at)) && errorText('SIGNUP_LIMITED', {}, 429, en, at) === en.errors.SIGNUP_LIMITED);
    ok('today\'s uploads and downloads have their own sentences', errorText('RATE_LIMITED', { window: 'day', field: 'uploads', retry_after: 90 }, 429, en, at) === "Today's file uploads are used up — back at 22:16"
      && errorText('RATE_LIMITED', { window: 'day', field: 'downloads', retry_after: 90 }, 429, zh, at) === '今天的下载次数用完了，22:16 恢复');
    ok('this hour', errorText('RATE_LIMITED', { window: 'hour' }, 429, en) === en.rateHour);
    ok('older service: the plain sentence', errorText('RATE_LIMITED', { retry_after: 30 }, 429, en) === en.errors.RATE_LIMITED);
    ok('space full: when room frees up', errorText('QUOTA_EXCEEDED', { field: 'bytes', frees_in: 7200 }, 507, en) === 'Your space is full — the oldest item expires in about 2 hours and frees up room');
    ok('queue full, zh: when room frees up', errorText('QUOTA_EXCEEDED', { field: 'items', frees_in: 90000 }, 507, zh) === '排队等收的内容太多了，最早的一条约 25 小时后到期，到时自动腾出位置');
    ok('space full without a time: the plain sentence', errorText('QUOTA_EXCEEDED', { field: 'bytes' }, 507, en) === en.quotaBytes);
    ok('a code with no special case: the table, then HTTP', errorText('INVALID_TOKEN', {}, 401, en) === en.errors.INVALID_TOKEN && errorText('NOPE', {}, 502, en) === en.httpFailed(502));
    const err = apiError(429, { error: 'RATE_LIMITED', window: 'day', retry_after: 90, upgrade_url: 'https://x.test/up', why: 'per_day' });
    ok('an ApiError keeps the code, the status and the whole answer', err.code === 'RATE_LIMITED' && err.status === 429 && err.data.upgrade_url === 'https://x.test/up' && /used up/.test(err.message));
    for (const why of ['per_day', 'queue', 'space', 'file_size', 'devices', 'realtime', 'uploads', 'downloads', 'kept']) {
      ok(`an upgrade line for why=${why}, both languages`, en.upgradeFor(why) !== en.upgradeFor('?') && zh.upgradeFor(why) !== zh.upgradeFor('?'));
    }
    // the Notice: the sentence alone, or the sentence and a link one click away
    errorNotice('dropit: Sending too fast', { data: {} });
    ok('no link from the service: a plain Notice', typeof lastNotice.m === 'string' && lastNotice.m === 'dropit: Sending too fast', JSON.stringify(lastNotice));
    errorNotice('dropit: Sending too fast', { data: { upgrade_url: 'javascript:alert(1)', why: 'per_day' } });
    ok('a link that is not one to open: a plain Notice, nothing to click', typeof lastNotice.m === 'string', JSON.stringify(lastNotice));
    errorNotice('dropit: Sending too fast', err);
    ok('a link from the service: the sentence and the way past it, and it stays long enough to click', lastNotice.m.text[0] === 'dropit: Sending too fast'
      && lastNotice.m.links[0].text === en.upgradeFor('per_day') && lastNotice.m.links[0].href === 'https://x.test/up?src=obsidian' && lastNotice.ms >= 12_000, JSON.stringify([lastNotice.m.text, lastNotice.m.links, lastNotice.ms]));
  }

  console.log('── Round 1022: an address the user chose is never replaced by the built-in one ──');
  {
    const hosts = (calls) => [...new Set(calls.filter((c) => c.auth === 'Bearer dk_x').map((c) => c.host))];
    // Chosen in the settings (flag set): the address is the only one, and nothing — token included — goes anywhere else
    const own = (await makePlugin({ endpoints: ['https://mine.example'], ownEndpoint: true })).p;
    ok('a chosen address is the only one tried', JSON.stringify(own.endpointList()) === '["https://mine.example"]', JSON.stringify(own.endpointList()));
    const calls = serve({ 'GET /v1/me': () => new Error('getaddrinfo ENOTFOUND') });
    let err = null;
    try { await own.api('GET', '/v1/me'); } catch (e) { err = e; }
    ok('it is down: the error says it cannot be reached, and the built-in address saw nothing', err && /Can't reach/.test(err.message) && !hosts(calls).includes('dropit.smart-kits.xyz') && own.settings.endpoints[0] === 'https://mine.example', JSON.stringify(hosts(calls)));
    const learn = serve({ 'GET /v1/endpoints': () => ({ json: { endpoints: ['https://dropit.smart-kits.xyz'] } }) });
    await own.refreshEndpoints();
    ok('nothing is learned from a chosen address (the list stays as it was, no request)', learn.length === 0 && JSON.stringify(own.settings.endpoints) === '["https://mine.example"]', JSON.stringify(own.settings.endpoints));
    // An address that is not safe to send the key to: still nothing goes to the built-in one
    const unsafe = (await makePlugin({ endpoints: ['http://evil.example'], ownEndpoint: true })).p;
    const c2 = serve({ 'GET /v1/me': () => ({ json: {} }) });
    let e2 = null;
    try { await unsafe.api('GET', '/v1/me'); } catch (e) { e2 = e; }
    ok('an unsafe chosen address: refused, nothing sent at all', e2 && c2.length === 0, String(c2.length));
    // Set up before the flag existed: addresses on this machine only count as chosen
    const local = (await makePlugin({ endpoints: ['http://127.0.0.1:8790'] })).p;
    const c3 = serve({ 'GET /v1/me': () => new Error('ECONNREFUSED') });
    await local.api('GET', '/v1/me').catch(() => {});
    ok('an older vault pointing at this machine: no fallback either', hosts(c3).join() === '127.0.0.1:8790' && local.endpointList().length === 1, JSON.stringify(hosts(c3)));
    // The default setup keeps healing itself (the flag is off, or never set)
    const dflt = (await makePlugin({ endpoints: ['https://old.example.com'], ownEndpoint: false })).p;
    ok('not chosen: the built-in address stays last', dflt.endpointList().at(-1) === 'https://dropit.smart-kits.xyz', JSON.stringify(dflt.endpointList()));
  }

  console.log('── Round 1022: refusal sentences ──');
  {
    const { errorText, STRINGS: S } = DropitPlugin;
    const text1 = errorText('PAYLOAD_TOO_LARGE', { field: 'raw', limit: 1 << 20 }, 413, S.en);
    ok('a text too long says it is a text and the limit, not the plan', /text/i.test(text1) && /1 MB/.test(text1) && !/plan/i.test(text1), text1);
    ok('…and in Chinese', /文字/.test(errorText('PAYLOAD_TOO_LARGE', { field: 'raw', limit: 1 << 20 }, 413, S.zh)) && /1 MB/.test(errorText('PAYLOAD_TOO_LARGE', { field: 'raw', limit: 1 << 20 }, 413, S.zh)));
    ok('the plain table sentence no longer blames the plan', !/plan|套餐/i.test(S.en.errors.PAYLOAD_TOO_LARGE) && !/套餐/.test(S.zh.errors.PAYLOAD_TOO_LARGE));
    const pairing = errorText('RATE_LIMITED', { window: 'day', field: 'pairings', retry_after: 90 }, 429, S.en);
    ok('too many devices joined today: says so, not "sends are used up"', /devices/.test(pairing) && !/sends/.test(pairing), pairing);
    ok('…and in Chinese', /设备/.test(errorText('RATE_LIMITED', { window: 'day', field: 'pairings', retry_after: 90 }, 429, S.zh)));
    ok('a send over the day is still about sends', /sends/.test(errorText('RATE_LIMITED', { window: 'day', retry_after: 90 }, 429, S.en)));
  }

  console.log('── Round 1022: the ways to Paid ──');
  {
    const { upgradeLink, withWhy } = DropitPlugin;
    const me = { upgrade_url: 'https://x.test/upgrade?u=1&s=2&why=account&buy=year' };
    ok('the account link, said to be about devices: why is rewritten, buy= taken off, the rest kept, tagged once',
      upgradeLink(me, 'devices') === 'https://x.test/upgrade?u=1&s=2&why=devices&src=obsidian', upgradeLink(me, 'devices'));
    ok('without a why the link is as the service gave it (minus any buy=)', upgradeLink(me).includes('why=account'));
    ok('a link with no why gets one', withWhy('https://x.test/u?a=1#f', 'devices') === 'https://x.test/u?a=1&why=devices#f');
    // A free account sending a file over its limit: stopped before it is read, told what Paid takes, with the link
    const free = (await makePlugin()).p;
    free.meCache = { at: Date.now(), m: { plan: 'free', item_bytes_limit: 10 << 20, upgrade_url: 'https://x.test/upgrade?u=1&s=2&why=account&buy=year' } };
    free.plansCache = { at: Date.now(), plans: { limits: { paid: { fileMB: 100 } } } };
    let reads = 0;
    free.app.vault.readBinary = async () => { reads++; return new ArrayBuffer(8); };
    notices.length = 0;
    await free.sendFiles([{ path: 'big11.pdf', name: 'big11.pdf', extension: 'pdf', stat: { size: 11 << 20 } }]);
    ok('a free account, a file over 10 MB: the limit, what Paid takes, and the link (why=file_size, tagged once)',
      reads === 0 && /big11\.pdf/.test(notices[0]) && /10 MB/.test(notices[0]) && /100 MB/.test(notices[0])
      && lastNotice.m.links?.[0]?.href === 'https://x.test/upgrade?u=1&s=2&why=file_size&src=obsidian' && lastNotice.m.links[0].text === DropitPlugin.STRINGS.en.upgradeFor('file_size'), JSON.stringify([notices, lastNotice.m.links]));
    notices.length = 0;
    await free.sendFiles([{ path: 'huge.mov', name: 'huge.mov', extension: 'mov', stat: { size: 150 << 20 } }]);
    ok('a file past what Paid takes too: the reason only', typeof lastNotice.m === 'string' && !/Paid takes/.test(notices[0]), JSON.stringify(notices));
    const paid = (await makePlugin()).p;
    paid.meCache = { at: Date.now(), m: { plan: 'paid', item_bytes_limit: 100 << 20 } };
    notices.length = 0;
    await paid.sendFiles([{ path: 'a.mov', name: 'a.mov', extension: 'mov', stat: { size: 150 << 20 } }]);
    ok('a paid account gets no Paid suggestion', typeof lastNotice.m === 'string' && !/Paid/.test(notices[0]), JSON.stringify(notices));
  }

  console.log('── Round 1022: joining a full account stays on the page ──');
  {
    const { p } = await makePlugin({ token: '' }, { token: '' });
    const lines = [];
    const note = { empty() { lines.length = 0; }, createDiv: (o) => { lines.push(o.text); return el(); }, createEl: (tag, o) => { lines.push(o); return { addEventListener() {} }; } };
    p.tab.joinNote = note;
    serve({ 'POST /v1/pair/claim': () => ({ status: 403, json: { error: 'DEVICE_LIMIT_REACHED', limit: 2, upgrade_url: 'https://x.test/upgrade?u=1&s=2&why=devices&buy=year', why: 'devices' } }),
      'GET /v1/plans': () => ({ json: { limits: { paid: { devices: 10 } } } }) });
    notices.length = 0;
    await p.tab.join('K7M2QX');
    const link = lines.find((l) => typeof l === 'object');
    ok('refused for devices: a line stays under the field (no Notice), with the reason', notices.length === 0 && /Device limit/.test(lines[0]), JSON.stringify([notices, lines]));
    ok('…and a link that says how many Paid allows, with why=devices', link && link.text === DropitPlugin.STRINGS.en.slotUpgradeN(10) && /why=devices/.test(link.href) && /Up to 10|up to 10/.test(link.text), JSON.stringify(link));
    serve({ 'POST /v1/pair/claim': () => ({ status: 400, json: { error: 'PAIRING_CODE_INVALID' } }) });
    await p.tab.join('K7M2QX');
    ok('another refusal is a Notice as before, and the line is cleared', notices.length === 1 && lines.length === 0, JSON.stringify([notices, lines]));
  }

  console.log('── Round 1022: arrivals ──');
  {
    const { p } = await makePlugin();
    serve({ 'GET /v1/pull': pages([text(301, 'one')]) });
    notices.length = 0;
    await p.sync(false);
    serve({ 'GET /v1/pull': pages([text(302, 'two'), text(303, 'three')]) });
    await p.sync(false);
    ok('items arriving one sync after another: the Notice counts them all instead of stacking', notices.at(-1).includes('received 3 items'), JSON.stringify(notices));
    const hidden = [];
    const keep = p.arrival.notice; keep.hide = () => hidden.push(1);
    serve({ 'GET /v1/pull': pages([text(304, 'four')]) });
    await p.sync(false);
    ok('…and the earlier one is taken down', hidden.length === 1 && notices.at(-1).includes('received 4 items'), JSON.stringify([hidden, notices]));
    // Pulling again is not an arrival
    serve({ 'GET /v1/pull': pages([text(301, 'one'), text(305, 'five')]), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
    notices.length = 0;
    await p.repull('all');
    ok('Pull again says how many came back, not that something was received', notices.length === 1 && /pulled back 1 item/.test(notices[0]) && !/received/.test(notices[0]), JSON.stringify(notices));
    ok('…in Chinese too', /拉回了 3 条/.test(DropitPlugin.STRINGS.zh.pulledBack(3)));
  }

  console.log('── Round 1022: note names ──');
  {
    const { noteTitle } = DropitPlugin;
    ok('text that starts with --- is named after its first line that says something', noteTitle(text(310, '---\ntitle: Plan for May\n---\nbody')) === '09-17 08.00 title_ Plan for May', noteTitle(text(310, '---\ntitle: Plan for May\n---\nbody')));
    ok('a divider and blank lines first, then a Chinese line', noteTitle(text(311, '---\n\n***\n会议纪要\n')) === '09-17 08.00 会议纪要', noteTitle(text(311, '---\n\n***\n会议纪要\n')));
    ok('only dividers: the time alone, as before', noteTitle(text(312, '---\n---')) === '09-17 08.00', noteTitle(text(312, '---\n---')));
  }

  console.log('── Round 1022: keyboard ──');
  {
    const made = [];
    const host = { createSpan: () => { const i = { attrs: {}, on: {}, setAttribute(k, v) { i.attrs[k] = v; }, addEventListener(ev, fn) { i.on[ev] = fn; } }; made.push(i); return i; } };
    const { p } = await makePlugin();
    p.tab.tip({ nameEl: host }, 'what it does');
    const i = made[0];
    notices.length = 0;
    i?.on.keydown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
    ok('the (i) can be Tabbed to and opened with Enter', i?.attrs.tabindex === '0' && i.attrs.role === 'button' && notices.includes('what it does'), JSON.stringify([i?.attrs, notices]));
  }

  console.log('── Round 1022b: the account line, tab order, pulling again, accounts, plan change ──');
  {
    // OBS-NEW-1: the answer goes to the line that is on the page when it comes
    const { p } = await makePlugin();
    const row = () => { const r = { descs: [], setDesc(d) { r.descs.push(d); return r; }, descEl: null, setName() {}, settingEl: {} }; return r; };
    const first = row(); const second = row();
    let answer;
    p.api = () => new Promise((r) => { answer = r; });
    p.refreshUpsell = () => {}; p.accountMoments = async () => {};
    const tab = p.tab;
    tab.stateSetting = first; tab.onStatus = () => {};
    tab.loadAccount();
    tab.stateSetting = second;                 // the page is drawn again while the first read is on its way
    tab.loadAccount();                         // …and its own read waits for the first
    answer({ plan: 'free', devices_used: 1, devices_limit: 2 });
    await settle();
    ok('the page was drawn again: the answer lands on the line that is there now', second.descs.length === 1 && first.descs.length === 0 && !/Loading|正在读取/.test(second.descs[0]), JSON.stringify([first.descs, second.descs]));
    ok('…and is kept, so a line drawn later shows it at once', tab.accountRead?.plan === 'free');
    // OBS-NEW-6: a read that shows Paid lifts a stop that was for the trial
    const q = (await makePlugin()).p;
    let connected = 0;
    q.connect = () => { connected++; };
    Object.assign(q, { noRealtime: true, realtimeWhy: 'trial_over', realtimeUntil: 123 });
    q.planSeen({ plan: 'free' });
    ok('still free: nothing changes', q.noRealtime === true && connected === 0);
    q.planSeen({ plan: 'paid' });
    ok('Paid seen: the stop is lifted and the connection is tried at once', q.noRealtime === false && q.realtimeWhy === null && q.realtimeUntil === null && connected === 1, JSON.stringify([q.noRealtime, connected]));
    // OBS-NEW-2: rows and boxes are not Tab stops
    const marked = [];
    p.tab.containerEl = { querySelectorAll: () => [{ setAttribute: (k, v) => marked.push([k, v]) }, { setAttribute: (k, v) => marked.push([k, v]) }] };
    p.tab.tabOrder();
    ok('rows and boxes are taken out of the Tab order', marked.length === 2 && marked.every(([k, v]) => k === 'tabindex' && v === '-1'), JSON.stringify(marked));
  }
  {
    // OBS-NEW-4: pulling again writes the notes and hands nothing to the AI rules
    const { p } = await makePlugin();
    const handed = [];
    p.runAuto = async (list) => { handed.push(list.length); };
    serve({ 'GET /v1/pull': pages([text(401, 'a'), text(402, 'b')]) });
    await p.sync(false);
    await p.hookQueue;
    serve({ 'GET /v1/pull': pages([text(401, 'a'), text(402, 'b'), text(403, 'c')]), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
    handed.length = 0;
    await p.repull('all');
    await p.hookQueue;
    for (let i = 0; i < 5; i++) await settle();
    ok('Pull again: nothing is handed to the rules', handed.every((n) => n === 0), JSON.stringify(handed));
    serve({ 'GET /v1/pull': pages([text(404, 'd')]) });
    handed.length = 0;
    await p.sync(false);
    await p.hookQueue;
    for (let i = 0; i < 5; i++) await settle();
    ok('a normal arrival afterwards is handed over as before', handed.includes(1), JSON.stringify(handed));
  }
  {
    // OBS-NEW-5: a note of another account is not this account's item with the same number
    const { p, files, fm } = await makePlugin();
    p.settings.accountTag = 'aaaa1111';
    serve({ 'GET /v1/pull': pages([text(10, 'from the first account')]) });
    await p.sync(false);
    const note = [...files.keys()].find((k) => k.includes('first account'));
    ok('a new note carries the account mark (8 hex), not the account itself', /^---[\s\S]*?\ndropit_account: "?aaaa1111"?\n/.test(files.get(note)), files.get(note));
    p.settings.accountTag = 'bbbb2222';
    serve({ 'GET /v1/pull': pages([text(10, 'from the second account')]) });
    p.settings.cursor = 0;
    await p.sync(false);
    ok('the same vault, another account, the same number: written, not taken for existing', [...files.keys()].some((k) => k.includes('second account')), [...files.keys()].join());
    // a note without the mark (from before) still counts, by number alone
    const old = (await makePlugin()).p;
    const o = await makePlugin();
    o.p.settings.accountTag = 'cccc3333';
    serve({ 'GET /v1/pull': pages([text(20, 'old note')]) });
    await o.p.sync(false);
    const oldPath = [...o.files.keys()].find((k) => k.includes('old note'));
    o.files.set(oldPath, o.files.get(oldPath).replace(/dropit_account: .*\n/, ''));
    const meta = o.fm.get(oldPath); if (meta) delete meta.dropit_account;
    serve({ 'GET /v1/pull': pages([text(20, 'old note')]), 'POST /v1/cursor/reset': () => ({ json: { ok: true, to_seq: 0 } }) });
    await o.p.repull('all');
    ok('a note with no mark counts as before: not written twice', [...o.files.keys()].filter((k) => k.includes('old note')).length === 1, [...o.files.keys()].join());
    void old;
  }

  console.log('── Round 1022c: consent lines at joining and creating ──');
  {
    const { p } = await makePlugin({ token: '' }, { token: '' });
    const got = [];
    p.tab.containerEl = { createDiv: () => { const l = { text: '', links: [], appendText(x) { l.text += x; }, createEl: (tag, o) => { l.links.push(o); return { addEventListener() {} }; } }; got.push(l); return l; } };
    const S = DropitPlugin.STRINGS;
    p.tab.consentLine(S.en.consentJoin);
    ok('a line says what joining sends, with the privacy page of the service in use', /fingerprint hash/.test(got[0].text) && got[0].links[0].text === 'Privacy' && got[0].links[0].href === 'https://dropit.smart-kits.xyz/privacy', JSON.stringify(got[0]));
    p.settings.endpoints = ['https://mine.example'];
    p.settings.ownEndpoint = true;
    p.tab.consentLine(S.zh.consentCreate);
    ok('…with a server address typed in, its own privacy page', got[1].links[0].href === 'https://mine.example/privacy' && S.zh.privacyLink === '隐私说明' && /设备指纹摘要/.test(got[1].text), JSON.stringify(got[1]));
    ok('both lines, both languages', ['consentJoin', 'consentCreate', 'privacyLink'].every((k) => S.en[k] && S.zh[k]));
    const real = await makePlugin({ token: '' }, { token: '' });
    let lines = 0;
    const orig = real.p.tab.consentLine; real.p.tab.consentLine = function (x) { lines++; return orig.call(this, x); };
    real.p.tab.containerEl = anything();
    real.p.tab.display();
    ok('the not-paired page has one under Join and one under Create', lines === 2, String(lines));
  }

  console.log('── Round 1022d: an account mark that looks like a number ──');
  {
    const { sameAccountMark } = DropitPlugin;
    ok('a mark compares as the number YAML made of it, and as text otherwise', sameAccountMark(5092591, '05092591') && sameAccountMark(100000, '1e5') && sameAccountMark('a1b2c3d4', 'a1b2c3d4') && sameAccountMark('05092591', '05092591')
      && !sameAccountMark(5092592, '05092591') && !sameAccountMark('b1b2c3d4', 'a1b2c3d4') && !sameAccountMark(5, 'a1b2c3d4') && sameAccountMark(parseInt('01234567', 8), '01234567'));
    for (const [label, tag, legacy] of [['digits with a leading 0', '05092591', 5092591], ['the form 1e5', '1e5', 100000], ['digits and letters', 'c0ffee11', 'c0ffee11']]) {
      const { p, files, fm } = await makePlugin();
      p.settings.accountTag = tag;
      const notes = () => [...files.keys()].filter((k) => k.startsWith('Inbox/'));
      serve({ 'GET /v1/pull': pages([text(610, 'a note about ' + label)]), 'POST /v1/cursor/reset': () => ({ json: { to_seq: 0 } }) });
      await p.sync(false);
      const path = notes()[0];
      ok(`${label}: the note is written with the mark in quotes`, files.get(path).includes(`dropit_account: "${tag}"`), files.get(path));
      // a note from before the fix: the mark was not in quotes, so it was read back as a number
      fm.get(path).dropit_account = legacy;
      for (let k = 0; k < 2; k++) {
        serve({ 'GET /v1/pull': pages([text(610, 'a note about ' + label)]), 'POST /v1/cursor/reset': () => ({ json: { to_seq: 0 } }) });
        await p.repull('all');
      }
      ok(`${label}: pulling again twice writes nothing more`, notes().length === 1, notes().join());
      // with the mark as the new notes have it (text)
      fm.get(path).dropit_account = tag;
      serve({ 'GET /v1/pull': pages([text(610, 'a note about ' + label)]), 'POST /v1/cursor/reset': () => ({ json: { to_seq: 0 } }) });
      await p.repull('all');
      ok(`${label}: …and with the mark read as text`, notes().length === 1, notes().join());
      // another account, the same number: written
      p.settings.accountTag = 'ffffffff';
      serve({ 'GET /v1/pull': pages([text(610, 'a note about ' + label)]), 'POST /v1/cursor/reset': () => ({ json: { to_seq: 0 } }) });
      await p.repull('all');
      ok(`${label}: another account's item with the same number is written`, notes().length === 2, notes().join());
    }
  }

  console.log('── Round 1022d: the plan changes while the status shows the old one ──');
  {
    const { p } = await makePlugin();
    const states = [];
    p.statusEl = { setText: (x) => states.push(x), setAttribute() {} };
    p.state = 'live';
    p.realtimeUntil = Date.now() + 14 * 86_400_000;
    p.tab.stateSetting = { setDesc() {}, descEl: null };
    const painted = [];
    p.tab.paintAccount = (row, m) => painted.push(m.plan);
    const before = { plan: 'free', paid_until: null, realtime_until: p.realtimeUntil };
    p.meCache = { m: before, at: Date.now() };
    const until = Date.now() + 365 * 86_400_000;
    p.api = async () => ({ plan: 'paid', paid_until: until, realtime_until: null });
    await p.accountNow(true);
    ok('a read that shows Paid: the trial countdown is gone and the status bar is drawn again at once', p.realtimeUntil === null && p.trialLeft() === null && states.length > 0, JSON.stringify([p.realtimeUntil, states]));
    ok('…and the account card in the settings is painted with it', painted.join() === 'paid', JSON.stringify(painted));
    states.length = 0; painted.length = 0;
    await p.accountNow(true);
    ok('the same plan read again changes nothing', states.length === 0 && painted.length === 0);
  }

  console.log(`\n${fail === 0 ? '✅' : '🛑'}  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
