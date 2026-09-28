# dropit for Obsidian

[English](./README.md) · **简体中文**

你投进 dropit 的一切 —— 来自手机、浏览器或终端 —— 都会实时落成 vault 里的笔记。
它只做这一件事：不整理、不打标签、不渲染。

## 特性

- **实时。** 投出去几秒，笔记就出现在 vault 里。
- **自动补齐。** Obsidian 关了两天？这期间投的内容，下次启动全部补上。
- **一条不丢。** 只有笔记写成功才推进进度。中途崩溃最多重复一条 —— 而重复会被跳过，因为每个文件名都带着内容的序号。
- **文件也能收。** 图片、PDF 等文件会以原文件名存在笔记旁边。
- **不会卡住。** 某个文件下载失败时，会写一条占位笔记说明是什么、为什么，后面的内容照常送达。
- **不打扰。** 后台同步从不弹提示，只有手动同步才会显示结果。
- **桌面和移动端都能用。** 无构建步骤，纯 CommonJS。

## 让你的 AI 来装

在用 AI 编程助手（Claude Code、Codex、Cursor……）？把下面这段贴给它：

```text
按照 https://raw.githubusercontent.com/smart-kits/dropit-obsidian/main/AGENTS.md
帮我把 dropit 插件装进 Obsidian vault。先问我装进哪个 vault、创建账号之前也先问我；
任何时候都不要显示或提交我的 token。
```

它会找到你的 vault、安装并启用插件，再告诉你配对时具体点哪里。
给 AI 的说明在 [AGENTS.md](./AGENTS.md)。

## 安装

还没有进入社区插件市场，请手动安装：

```bash
git clone https://github.com/smart-kits/dropit-obsidian.git \
  "<你的 vault>/.obsidian/plugins/dropit"
```

或者把 `main.js` 和 `manifest.json` 下载到 `<你的 vault>/.obsidian/plugins/dropit/`。

然后：设置 → 第三方插件 → 启用 **dropit**。

## 第一次使用

打开「设置 → dropit」，打开的是「用配对码加入」：

- **已经在用 dropit** → 在「配对码」里填入另一台设备上生成的 6 位配对码 → 加入
- **是第一台** → 第一次用 dropit？ → 创建新账号

要添加更多设备，在「配对码」→「生成」。配对码会自动复制到剪贴板，5 分钟内有效。

## 内容落在哪

| 内容 | 保存为 |
|---|---|
| 文本或链接 | `Inbox/YYYY-MM-DD-<seq>.md` |
| 文件 | `Inbox/YYYY-MM-DD-<seq>-<原文件名>` |
| 下载失败的文件 | `Inbox/YYYY-MM-DD-<seq>.md`，带 `download_failed: true` |

每条笔记开头都有可查询的 front matter：

```yaml
---
dropit_seq: 42
kind: url
source: ios-shortcut
created: 2026-09-25T08:00:00.000Z
---
```

## 设置项

| 设置 | 作用 |
|---|---|
| 服务地址 | dropit 的服务地址，没有特别说明就不用改 |
| 落地文件夹 | 内容写到哪里，vault 内的相对路径（默认 `Inbox`） |
| 配对码 | 给新设备生成配对码 |
| 重新拉取 | 显示已经收到哪一条，并能从指定位置重新拉取：**全部**、**从第 N 条起**、或**最近 N 天**。vault 里已有的笔记会保留；之前下载失败的文件会重新下载，并替换掉那条占位笔记 |
| 解除配对 | 清空这台设备上的设置。你的内容和其他设备都不受影响 |

随时可以手动同步：点侧栏的**收件箱**图标，或者运行命令「dropit: 立即拉取」。

## 怎么保持连接

- 每 60 秒发一次心跳，能发现「看起来连着、其实收不到」的死连接（睡眠唤醒后很常见），并以 1 秒到 60 秒的退避重连。
- 如果当前套餐不含实时推送（新账号有 14 天体验期），插件会提示一次，然后不再反复申请；它会在启动时和你手动同步时补齐，手动同步时也会再试一次实时推送。
- 没有轮询定时器，心跳是唯一的定时器。

## 出错了怎么办

| 提示 | 含义 | 怎么办 |
|---|---|---|
| `token 无效` / `设备已被移除` | token 失效，或这台设备被吊销了 | 解除配对，再用新的配对码加入 |
| `设备数已达上限` | 设备数到上限了 | 在别的设备上吊销一台不用的（`dropit revoke <id>`） |
| `请求失败 HTTP …` 或网络错误 | 连不上服务 | 检查网络和服务地址 |

后台同步的失败只记在开发者控制台里（前缀 `[dropit]`）。

## 隐私

- token 保存在 vault 里这个插件的 `data.json` 中。**如果你同步或公开 vault，请排除 `.obsidian/plugins/dropit/data.json`。**
- 解除配对会把它从这台设备上清掉。

## 开发

```bash
ln -s "$(pwd)" "<你的 vault>/.obsidian/plugins/dropit"   # 在这里改，回 Obsidian 重新加载
node test.cjs                                            # 零依赖
brew install gitleaks && git config core.hooksPath .githooks   # 防止 token 被提交
```

提交信息用英文。文档成对维护 —— 改 `README.md` 请同步 `README.zh-CN.md`。

## 已知限制

- 只收不投。投递请用[命令行、浏览器扩展或 iOS 快捷指令](https://github.com/smart-kits/dropit-client/blob/main/README.zh-CN.md)。
- 界面语言跟随 Obsidian：默认英文，Obsidian 设为中文时显示简体中文。

## 许可

[MIT](./LICENSE)
