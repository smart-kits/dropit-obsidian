/**
 * Branch tests for the plugin's write().
 *
 * The plugin has no build step, so neither do the tests: `obsidian` and the vault are
 * stubbed and the real main.js runs. Just `node test.cjs`.
 */
const Module = require('node:module');
const orig = Module._load;
let language;                                  // what the stubbed getLanguage() reports
Module._load = (req, ...rest) => (req === 'obsidian'
  ? { Plugin: class {}, PluginSettingTab: class { constructor(a, p) { this.plugin = p; } },
      Setting: class {}, Notice: class {}, normalizePath: (p) => p, getLanguage: () => language }
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

function makePlugin(fetchImpl) {
  const files = new Map();
  const vault = {
    getFolderByPath: () => true,
    createFolder: async () => {},
    getFileByPath: (p) => (files.has(p) ? {} : null),
    create: async (p, content) => files.set(p, content),
    createBinary: async (p, buf) => files.set(p, Buffer.from(buf)),
  };
  const p = Object.create(DropitPlugin.prototype);
  p.app = { vault };
  p.settings = { folder: 'Inbox' };
  globalThis.fetch = fetchImpl;
  return { p, files };
}

const AT = Date.parse('2026-09-17T08:00:00Z');
const textItem = { seq: 7, kind: 'text', source: 'cli', raw: '一行字', created_at: AT, bytes: 9 };
const blobItem = { seq: 8, kind: 'image', source: 'cli', raw: '', url: 'https://files.example/x', bytes: 2048,
                   created_at: AT, meta: { filename: '截图 /a:b.png', mime: 'image/png' } };

(async () => {
  console.log('── Text ──');
  {
    const { p, files } = makePlugin(null);
    ok('written as .md', await p.write(textItem) === true);
    const body = files.get('Inbox/2026-09-17-7.md');
    ok('front matter has seq/kind/source/created', /dropit_seq: 7[\s\S]*kind: text[\s\S]*source: cli[\s\S]*created: 2026-09-17T08:00:00.000Z/.test(body), body);
    ok('body is the original content', body.trimEnd().endsWith('一行字'), body);
    ok('second write is skipped', await p.write(textItem) === false);
  }

  console.log('── Binary · download succeeds ──');
  {
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    const { p, files } = makePlugin(async () => ({ ok: true, arrayBuffer: async () => bytes }));
    ok('written as a file', await p.write(blobItem) === true);
    const name = 'Inbox/2026-09-17-8-截图 _a_b.png';
    ok('file name has / and : cleaned', files.has(name), [...files.keys()].join());
    ok('file holds the original bytes', Buffer.compare(files.get(name), bytes) === 0);
    ok('no empty note left behind', !files.has('Inbox/2026-09-17-8.md'));
    ok('second write is skipped', await p.write(blobItem) === false);
  }

  console.log('── Binary · download fails ──');
  {
    const { p, files } = makePlugin(async () => { throw new Error('网络不可用'); });
    ok('does not throw or block the queue', await p.write(blobItem) === true);
    const note = files.get('Inbox/2026-09-17-8.md');
    ok('writes an explanatory note', !!note, [...files.keys()].join());
    ok('note names the file and the reason', note.includes('截图 /a:b.png') && note.includes('网络不可用'), note);
    ok('note is tagged download_failed', note.includes('download_failed: true'));
    ok('note says where else to get it', note.includes('dropit watch'));
    ok('second write is skipped (placeholder counts)', await p.write(blobItem) === false);
  }

  console.log('── HTTP errors ──');
  {
    const { p, files } = makePlugin(async () => ({ ok: false, status: 403 }));
    await p.write(blobItem);
    ok('403 writes a placeholder instead of throwing', files.get('Inbox/2026-09-17-8.md')?.includes('HTTP 403'), files.get('Inbox/2026-09-17-8.md'));
  }

  console.log('── Language ──');
  {
    const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]);
    const { en, zh } = DropitPlugin.STRINGS;
    const [ke, kz] = [keys(en), keys(zh)];
    ok('same keys in en and zh', ke.length === kz.length && ke.every((k) => kz.includes(k)),
      `only en: ${ke.filter((k) => !kz.includes(k))} · only zh: ${kz.filter((k) => !ke.includes(k))}`);

    const noteIn = async (lang) => {
      DropitPlugin = loadPlugin(lang);
      const { p, files } = makePlugin(async () => { throw new Error('boom'); });
      await p.write(blobItem);
      return files.get('Inbox/2026-09-17-8.md');
    };
    ok('English by default', /couldn't be downloaded/.test(await noteIn(undefined)));
    ok('Chinese when Obsidian is set to zh', /没能下载下来/.test(await noteIn('zh')));
    ok('Chinese for zh-TW too', /没能下载下来/.test(await noteIn('zh-TW')));
    ok('English for other languages', /couldn't be downloaded/.test(await noteIn('de')));
  }

  console.log(`\n${fail === 0 ? '✅' : '🛑'}  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
