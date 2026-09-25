/**
 * Branch tests for the plugin's write().
 *
 * The plugin has no build step, so neither do the tests: `obsidian` and the vault are
 * stubbed and the real main.js runs. Just `node test.cjs`.
 */
const Module = require('node:module');
const orig = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian'
  ? { Plugin: class {}, PluginSettingTab: class { constructor(a, p) { this.plugin = p; } },
      Setting: class {}, Notice: class {}, normalizePath: (p) => p }
  : orig(req, ...rest));

const DropitPlugin = require('./main.js');

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
  console.log('── 文本 ──');
  {
    const { p, files } = makePlugin(null);
    ok('写成 .md', await p.write(textItem) === true);
    const body = files.get('Inbox/2026-09-17-7.md');
    ok('frontmatter 带 seq/kind/source/created', /dropit_seq: 7[\s\S]*kind: text[\s\S]*source: cli[\s\S]*created: 2026-09-17T08:00:00.000Z/.test(body), body);
    ok('正文是原内容', body.trimEnd().endsWith('一行字'), body);
    ok('重复写跳过', await p.write(textItem) === false);
  }

  console.log('── 二进制 · 下载成功 ──');
  {
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    const { p, files } = makePlugin(async () => ({ ok: true, arrayBuffer: async () => bytes }));
    ok('写成文件', await p.write(blobItem) === true);
    const name = 'Inbox/2026-09-17-8-截图 _a_b.png';
    ok('文件名清洗掉 / 和 :', files.has(name), [...files.keys()].join());
    ok('落的是二进制原文', Buffer.compare(files.get(name), bytes) === 0);
    ok('没有留空笔记', !files.has('Inbox/2026-09-17-8.md'));
    ok('重复写跳过', await p.write(blobItem) === false);
  }

  console.log('── 二进制 · 下载失败 ──');
  {
    const { p, files } = makePlugin(async () => { throw new Error('网络不可用'); });
    ok('不抛异常、不卡队列', await p.write(blobItem) === true);
    const note = files.get('Inbox/2026-09-17-8.md');
    ok('落一条说明性笔记', !!note, [...files.keys()].join());
    ok('写清楚文件名和原因', note.includes('截图 /a:b.png') && note.includes('网络不可用'), note);
    ok('标了 download_failed 便于事后筛', note.includes('download_failed: true'));
    ok('告诉用户去哪儿还能拿到', note.includes('dropit watch') || note.includes('Web 收件箱'));
    ok('重复写跳过（占位也算写过）', await p.write(blobItem) === false);
  }

  console.log('── HTTP 错误码 ──');
  {
    const { p, files } = makePlugin(async () => ({ ok: false, status: 403 }));
    await p.write(blobItem);
    ok('403 也走占位而不是抛', files.get('Inbox/2026-09-17-8.md')?.includes('HTTP 403'), files.get('Inbox/2026-09-17-8.md'));
  }

  console.log(`\n${fail === 0 ? '✅' : '🛑'}  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
