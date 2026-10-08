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
const timers = [];                             // every timeout the plugin schedules
console.error = () => {};                      // the plugin logs expected failures; keep the output readable
let net = async () => { throw new Error('no network in this test'); };

/** Just enough of Obsidian's HTMLElement helpers for the plugin's status bar and notices */
const el = () => ({
  setText() {}, addClass() {}, setAttribute() {}, addEventListener() {}, createDiv: () => el(), createEl: () => el(),
  appendText() {}, empty() {}, toggle() {},
});
globalThis.createFragment = (fn) => { const f = el(); f.text = []; f.createDiv = ({ text }) => { f.text.push(text); return el(); }; fn?.(f); return f; };
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
/** Like Obsidian's: chainable, with a then(cb) that calls back with itself — which makes every Setting a thenable */
class Setting {
  constructor() { this.settingEl = anything(); }
  setName(n) { this.name = n; return this; }
  setDesc(d) { this.desc = d; return this; }
  setHeading() { return this; }
  addButton(cb) { cb(anything()); return this; }
  addExtraButton(cb) { cb(anything()); return this; }
  addDropdown(cb) { cb(anything()); return this; }
  addText(cb) { cb(anything()); return this; }
  then(cb) { if (++thenCalls < 1000) cb(this); return this; }   // past 1000, stop the loop so the test can say so
}
const fakeMoment = () => ({ format: (f) => ({ 'YYYY-MM-DD': '2026-09-29', 'HH:mm': '10:30', 'dddd': 'Tuesday' }[f] ?? f) });

Module._load = (req, ...rest) => (req === 'obsidian'
  ? {
      Plugin: class {
        constructor(app) { this.app = app; this.commands = []; this.manifest = { id: 'dropit' }; }
        addCommand(c) { this.commands.push(c); }
        addRibbonIcon() {} addSettingTab() {} addStatusBarItem() { return el(); }
        registerDomEvent() {} registerEvent() {} registerInterval() {} register() {}
        async loadData() { return this.stored; }
        async saveData(d) { this.stored = JSON.parse(JSON.stringify(d)); }
      },
      PluginSettingTab: class { constructor(a, p) { this.plugin = p; } },
      Modal: class {}, FuzzySuggestModal: class {}, Setting,
      Notice: class { constructor(m) { notices.push(typeof m === 'string' ? m : m.text.join(' ')); } },
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
    for (const line of m[1].split('\n')) { const [k, ...v] = line.split(': '); o[k] = v.join(': '); }
    fm.set(path, o);
  };
  const vault = {
    configDir: '.obsidian',
    adapter: { read: async () => { throw new Error('none'); } },
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
  await p.onload();
  return { p, ...v, events, ran };
}

/** Route stub requests: `routes` maps "METHOD /path-prefix" to a handler returning {status?, json?, bytes?} */
function serve(routes) {
  const calls = [];
  net = async (req) => {
    const method = req.method ?? 'GET';
    const { pathname, search, host } = new URL(req.url);
    calls.push({ method, path: pathname + search, host, body: req.body, contentType: req.contentType });
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
    ok('the note is named after the title', noteTitle(rich) === '09-17 08.00 A _great_ page', noteTitle(rich));
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
        files.get('Inbox/09-17 08.00 A _great_ page.md')?.endsWith('---\n\n[A great page](https://example.com/a/b)\n\n> line one\n> line two\n'), JSON.stringify(files.get('Inbox/09-17 08.00 A _great_ page.md')));
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
    window.setTimeout = (fn, ms) => { timers.push(ms); if (ms !== 5_000) setImmediate(fn); else held = fn; return 0; };
    let held = null;
    timers.length = 0;
    await q.sync(false);
    ok('a failed sync shows the error and schedules a retry in 5 s', q.state === 'error' && timers.includes(5_000) && held, `${q.state} · ${JSON.stringify(timers)}`);
    down = false;
    held();
    for (let i = 0; i < 5; i++) await settle();
    window.setTimeout = (fn, ms) => { timers.push(ms); setImmediate(fn); return 0; };
    ok('…which heals it once the network is back', q.state !== 'error' && q.syncFails === 0, `${q.state} · ${q.syncFails}`);
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
      'POST /v1/ingest/blob/': () => ({ json: { seq: 71 } }),
      'POST /v1/ingest/blob': () => ({ json: { seq: -5, upload_url: 'https://dropit.smart-kits.xyz/v1/ingest/blob/-5/upload?sig=x' } }),
      'PUT /v1/ingest/blob/-5/upload': () => ({ json: { seq: 71 } }),
      'POST /v1/ingest': () => ({ json: { seq: 70 } }),
    });
    await p.sendText('https://example.com/x');
    ok('a link goes as kind url, from obsidian', JSON.parse(calls[0].body).kind === 'url' && JSON.parse(calls[0].body).source === 'obsidian');
    files.set('Notes/idea.md', '# Idea\nbody');
    files.set('Pics/a.png', PNG);
    calls.length = 0;
    await p.sendFiles([{ path: 'Notes/idea.md', name: 'idea.md', extension: 'md' }, { path: 'Pics/a.png', name: 'a.png', extension: 'png' }]);
    const [note, start, put, done] = calls;
    ok('a note goes as its text', JSON.parse(note.body).raw === '# Idea\nbody' && JSON.parse(note.body).kind === 'text');
    const g1 = JSON.parse(note.body).meta.group;
    const g2 = JSON.parse(start.body).group;
    ok('both in one batch', g1.id === g2.id && g1.n === 2 && g1.i === 1 && g2.i === 2, JSON.stringify([g1, g2]));
    ok('the image is uploaded: start, PUT its bytes, done', JSON.parse(start.body).kind === 'image' && JSON.parse(start.body).size === 4
      && put.method === 'PUT' && put.contentType === 'image/png' && done.path === '/v1/ingest/blob/-5/done', JSON.stringify(calls.map((c) => c.method + c.path)));
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
      'GET /v1/me': () => ({ json: { plan: 'free', devices_used: 1, devices_limit: 3, bytes_used: 0, bytes_limit: 31457280 } }),
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

  console.log('── Settings page: pull again keeps a number per mode ──');
  {
    // Picking "the last N items" filled in 20, and switching to "the last N days" kept 20 instead of 7
    const { p } = await makePlugin();
    p.tab.containerEl = anything();
    p.api = async (m, path) => (path === '/v1/devices' ? { devices: [] } : {});
    const asked = [];
    p.repull = async (mode, n) => { asked.push([mode, n]); };
    const row = {};
    const { addDropdown, addText, addButton } = Setting.prototype;
    const isRepull = (s) => s.name === DropitPlugin.STRINGS.en.repull;
    Setting.prototype.addDropdown = function (cb) {
      if (!isRepull(this)) return addDropdown.call(this, cb);
      const d = anything();
      d.onChange = (fn) => { row.pick = fn; return d; };
      cb(d);
      return this;
    };
    Setting.prototype.addText = function (cb) {
      if (!isRepull(this)) return addText.call(this, cb);
      const x = anything();
      x.setValue = (v) => { row.value = v; return x; };
      x.onChange = (fn) => { row.type = (v) => { row.value = v; fn(v); }; return x; };
      cb(x);
      return this;
    };
    Setting.prototype.addButton = function (cb) {
      if (!isRepull(this)) return addButton.call(this, cb);
      const b = anything();
      b.onClick = (fn) => { row.go = fn; return b; };
      cb(b);
      return this;
    };
    try {
      p.tab.display();
      row.pick('last');
      const lastDefault = row.value;
      row.pick('days');
      ok('the last N items starts at 20, the last N days at 7', lastDefault === '20' && row.value === '7', `${lastDefault} · ${row.value}`);
      row.type('3');
      row.pick('last');
      const backToLast = row.value;
      row.type('50');
      row.pick('days');
      ok('switching back and forth keeps what was typed for each', backToLast === '20' && row.value === '3', `${backToLast} · ${row.value}`);
      row.pick('last');
      await row.go();
      ok('pull again uses the number of the chosen mode', JSON.stringify(asked) === '[["last",50]]', JSON.stringify(asked));
    } finally {
      Object.assign(Setting.prototype, { addDropdown, addText, addButton });
    }
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
      if (path === '/v1/me') { if (fails) throw new Error('offline'); return { plan: 'free', devices_used: 1, devices_limit: 3, bytes_used: 0, bytes_limit: 31457280 }; }
      return path === '/v1/devices' ? { devices: [] } : {};
    };
    window.setTimeout = (fn, ms) => { timers.push(ms); return 0; };    // hold the retry timer
    q.tab.display();
    await settle();
    fails = false;
    q.setStatus('live');
    await settle();
    window.setTimeout = (fn, ms) => { timers.push(ms); setImmediate(fn); return 0; };
    ok('the connection coming back re-reads the account at once', /^Free · 1 of 3 devices/.test(q.tab.stateSetting.desc), q.tab.stateSetting.desc);
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
    p.api = async (m, path) => {
      if (path === '/v1/ws/ticket') { asked++; throw Object.assign(new Error('paid'), { code: 'WS_REQUIRES_PAID' }); }
      return {};
    };
    notices.length = 0;
    await p.connect();
    ok('asks for a ticket once', asked === 1, String(asked));
    ok('remembers that real-time is not included', p.noRealtime === true && p.state === 'manual', p.state);
    ok('says so once, mentioning the 10-day trial', notices.length === 1 && /10/.test(notices[0]), JSON.stringify(notices));
    p.heartbeat(); p.heartbeat();
    await settle();
    ok('heartbeats stop asking (every one used to)', asked === 1, String(asked));
    p.noRealtime = false;
    await p.connect();
    ok('asking again later does not repeat the notice', notices.length === 1, JSON.stringify(notices));
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

  console.log(`\n${fail === 0 ? '✅' : '🛑'}  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
