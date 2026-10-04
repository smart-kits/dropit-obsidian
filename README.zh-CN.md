# dropit for Obsidian

[English](./README.md) · **简体中文**

**在手机、浏览器、终端里投的东西，几秒后就成了你 vault 里的笔记 ——
有标题、图片嵌在里面、出处带着链接。反过来，vault 里的任何东西，右键就能发出去。**

桌面端和移动端都能用。它是 [dropit](https://github.com/smart-kits/dropit-client) 的一部分：一条只连着你自己设备的私人管道。

## 用起来是什么感觉

| 你在别处… | 几秒后，vault 里 |
|---|---|
| 在 iPhone 上分享一张照片 | 一篇叫 `10-04 15.30 IMG_2041` 的笔记，照片嵌在里面，存在你的附件文件夹 |
| 在 Chrome 里投一个网页 | `[文章标题](链接)`，作者写的简介作为引用 —— 不是光秃秃一串网址 |
| 在浏览器里选中一段话投过来 | 这段话，下面一行 `— [页面标题](链接)`，永远知道它从哪来 |
| 一次投一段文字加三张截图 | **一篇**笔记：文字在上，三张图在下 |
| 在终端里敲 `dropit send "给银行打电话"` | 一篇写着「给银行打电话」的笔记 |
| 合上笔记本过了个周末 | 一打开 Obsidian，这期间投的全部到齐 —— 不缺一条，也不重复 |

反过来也一样：在文件列表里右键一篇笔记、一个 PDF 或几张图 →「发到 dropit」，手机上就有了。

## 落在哪里

在「设置 → dropit → 收到的内容写到」里选一次：

| 选项 | 效果 |
|---|---|
| **每次新建一篇笔记**（默认） | 每次投递一篇笔记，放在你指定的文件夹（`Inbox`），按时间和内容命名 |
| **追加到一篇指定笔记** | 全部追加进同一篇笔记（`Inbox/dropit.md`），每条带一行时间 |
| **追加到今天的日记** | 追加到今天的日记 —— 文件夹、日期格式和模板都用「日记」核心插件的设置；Templater 模板交给 Templater 处理 |

文件 —— 图片、视频、PDF —— 存在 Obsidian 放附件的地方（「设置 → 文件与链接」），
按你自己的链接风格嵌进笔记，wikilink 或 Markdown 链接都行。

### 每次新建一篇笔记

```markdown
---
kind: url
source: chrome-extension
created: 2026-10-04T07:30:00.000Z
dropit_seq: 42
---

[How Airmail Worked](https://example.com/airmail)

> A short history of the red-and-blue envelope.
```

文件名是时间加内容：`10-04 15.30 How Airmail Worked`。没有标题的链接变成 `example.com/airmail`，
文字取第一行，文件用它自己的名字。一起投的东西合成一篇 —— 文字在上，文件嵌在下面。

### 追加到一篇指定笔记，或今天的日记

```markdown
**10-04 15:30** · ios-shortcut
![[IMG_2041.jpeg]]

**10-04 15:42** · chrome-extension
一段值得留下的话。

— [页面标题](https://example.com/page)
```

注意：日记指的是内容**写进来那天**的日记。离线几天后补拉到的内容，会写进今天的日记，而不是投递那天的。

## 从 vault 发出去

| 在哪里 | 发出去的是 |
|---|---|
| 在笔记里选中文字 → 右键 →「发到 dropit」 | 选中的文字（整段只是一个链接时按链接发） |
| 在文件列表里右键一个文件 →「发到 dropit」 | 笔记按 Markdown 文字发；其他文件按文件本身发 |
| 选中几个文件 → 右键 →「把这 N 个文件发到 dropit」 | 最多 16 个，对方收到的是一整份 |
| 命令面板：「dropit: 发送当前笔记」·「dropit: 发送选中的内容」 | 同上，用键盘 —— 可以在「设置 → 快捷键」里绑上快捷键 |

笔记按它的文字发出，包括 frontmatter；嵌在里面的图片不会跟着走 —— 想一起发，就在文件列表里把它们也选上。
从这个 vault 发出去的东西，不会再写回这个 vault。

## 状态栏

看一眼就知道状态；点它立即同步。

| 显示 | 意思 |
|---|---|
| `● dropit` | 实时接收中（悬停可以看体验期还剩几天） |
| `◌ dropit` | 正在连接 |
| `↻ dropit` | 正在同步 |
| `○ dropit` | 你的套餐现在没有实时推送：打开或回到 Obsidian 时同步 |
| `○ dropit · 已断开` | 断开了，正在自己重连 |
| `⚠ dropit` | 出了问题 —— 悬停看原因；它会自己重试（5 秒、15 秒，之后每分钟） |
| `dropit · 未配对` | 点它开始设置 |

收到内容时，弹一条提示告诉你收到了几条 —— 点它直接打开最后那篇。

## 不漏一条，也不重复

- **回来就补齐。** 打开 Obsidian 或切回它，这期间到的内容就写进来。
- **网络不稳也扛得住。** 路上被断开的连接（代理、时好时坏的 Wi-Fi）会先重试，同步失败了也会自己再来。
- **一个文件下载不下来，不会堵住后面的。** 它的位置留一行说明：
  `⚠️ report.pdf（820 KB）没能下载下来：……。设置 → dropit → 重新拉取 会再试一次。`
- **重新拉取**（「设置 → dropit」）：全部、最近 N 条，或最近 N 天。vault 里已有的跳过，之前下载失败的重新下载。
  在「每次新建一篇笔记」模式下，你删掉的笔记会被重新生成；另外两种模式下，删掉的就不会回来。
- 新加入的设备只收加入之后投的内容；以前的用「重新拉取」拿回来 —— 能拿回多久，取决于你的套餐保留多久。

## 每收到一条，运行你自己的命令

「设置 → dropit → 收到后运行的命令」可以选任意一个 Obsidian 命令 —— QuickAdd 宏、Templater 脚本、
别的插件的动作。每一条内容写进 vault **之后**，它运行一次。

- **送达从不依赖它。** 先写入，再运行，只运行一次，不重试。
- **一次一条**，间隔一秒。
- **格式由 dropit 定，脚本归你。** 插件对内容除了写进去，什么都不做。

你的脚本从 `app.plugins.plugins.dropit.received` 读当前这一条：

```js
{
  v: 1,                      // 格式版本
  seq: 42,                   // 这一条的序号，递增
  kind: 'image',             // 'text' · 'url' · 'image' · 'video' · 'file' · …
  source: 'web',             // 从哪里投的
  created: '2026-09-29T07:30:00.000Z',
  batch: { id: 'b3k9x0', index: 2, count: 3 },   // 单独投的为 null
  text: '',                  // 文字或链接；文件为 ''
  meta: { filename: 'budget.png', mime: 'image/png' },   // 链接还有 title / description；
                             // from: { url, title? }，投递时所在的页面（浏览器扩展）
  note: 'Inbox/09-29 15.30 Slides for the 3pm meeting.md',   // 写到了哪篇
  files: ['Inbox/budget.png'],                   // 为它存进 vault 的文件
}
```

`app.plugins.plugins.dropit.recent` 保存最近 20 条。在别的插件或启动脚本里，也可以直接监听 ——
每一条都会触发，不用设置命令：

```js
app.workspace.on('dropit:received', (item) => { /* 同一个对象 */ });
```

比如一个 QuickAdd 宏的用户脚本：

```js
module.exports = async ({ app }) => {
  const item = app.plugins.plugins.dropit.received;
  if (item.kind !== 'url') return;
  // ……你自己的处理
};
```

> **把内容当作不可信的输入。** 任何拿着你账号「只能投递」钥匙的东西 —— 一部旧手机、一个泄露的快捷指令 ——
> 都能往里放任何内容。别 `eval` 它，也永远别用它拼 shell 命令行：通过 **stdin** 或文件交给程序。
> 这个对象是冻结的，一个脚本改不了下一个脚本看到的内容。

## 装好它

1. **安装。** 还没进社区插件市场。从 [dropit.smart-kits.xyz](https://dropit.smart-kits.xyz) 下载，
   解压到 `<你的 vault>/.obsidian/plugins/`；或者直接 clone 到那里：

   ```bash
   git clone https://github.com/smart-kits/dropit-obsidian.git "<你的 vault>/.obsidian/plugins/dropit"
   ```

   然后「设置 → 第三方插件」→ 启用 **dropit**。
2. **加入。** 「设置 → dropit」打开就是「用配对码加入」。在一台已经在用的设备上调出配对码
   （网页收件箱的「设备」页；终端里 `dropit code`），输入这 6 位，点「加入」。
   这是你的第一台设备？「第一次用 dropit？→ 创建新账号」。
3. **其他设备从这里加。** 「设置 → dropit → 添加设备 → 生成配对码」：在新设备上输入，
   或者用它的相机扫二维码。配对码已经帮你复制好了，新设备加入后页面会自己发现。

用 AI 编程助手（Claude Code、Codex、Cursor……）？把下面这段贴给它，它会帮你装好：

```text
Install the dropit plugin into my Obsidian vault by following
https://raw.githubusercontent.com/smart-kits/dropit-obsidian/main/AGENTS.md
Ask me which vault and before creating an account, and never show or commit my token.
```

## 设置

| 设置 | 作用 |
|---|---|
| （最上面一行） | 连接状态和你的账号：套餐 · 设备 · 空间 · 投递后保留多久。旁边是「立即同步」 |
| 收到的内容写到 · 文件夹 · 笔记 | 落在哪里（见上文） |
| 收到后运行的命令 | 你的命令，或者不运行 |
| 重新拉取 | 全部 · 最近 N 条 · 最近 N 天 |
| 添加设备 | 配对码和它的二维码 |
| 设备 | 账号里的每一台设备；「移除」会让它立刻停止收发 |
| 反馈 | 「反馈问题」（新建一个公开的 issue，版本号已填好）·「源代码」 |
| 高级 → 服务地址 | 只有拿到了别的地址才需要改；内置地址永远排在最后兜底 |
| 高级 → 解除配对 | 清掉这个 vault 的登录；你的设置保留 |

界面跟随 Obsidian 的语言：默认英文，Obsidian 设为中文时显示简体中文。

## 出问题时

| 你看到 | 意思是 | 怎么办 |
|---|---|---|
| `⚠ dropit` ·「连不上服务器」 | 网络或代理在断连接 | 一般不用管 —— 它会重试。一直这样的话，检查代理，或者让它直连 dropit |
| 「token 无效」·「这台设备已被移除」 | 这个 vault 被从账号里移除了 | 用新的配对码重新加入 |
| 「设备数已达上限」 | 套餐的设备名额用完了 | 移除一台不用的设备（「设置 → dropit → 设备」） |
| 「配对码已过期」 | 配对码 5 分钟有效，只能用一次 | 重新生成一个 |
| 「实时推送体验已结束」 | 新账号有一段实时推送体验期；之后改为打开或回到 Obsidian 时同步 | 不用修 —— 随时点状态栏就能同步 |
| 笔记里出现 `⚠️ ……没能下载下来` | 这次文件没下下来 | 「设置 → dropit → 重新拉取」 |

## 隐私

- 登录信息存在 vault 里这个插件的 `data.json` 中。**如果你同步或公开 vault，请排除
  `.obsidian/plugins/dropit/data.json`。** 「解除配对」会清掉它。
- 每台设备有自己的钥匙，可以单独移除；移除后名额立刻释放。

## 开发

```bash
ln -s "$(pwd)" "<你的 vault>/.obsidian/plugins/dropit"   # 在这里改，到 Obsidian 里重新加载
node test.cjs                                              # 没有依赖
brew install gitleaks && git config core.hooksPath .githooks   # 防止把 token 提交进去
```

提交信息用英文。文档成对 —— 请同时更新 `README.md` 和 `README.zh-CN.md`。

## 许可证

[MIT](./LICENSE)
