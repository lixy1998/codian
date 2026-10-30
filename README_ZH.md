# Codian

[简体中文](README_ZH.md) | [English](README.md)

[![Release](https://img.shields.io/github/v/release/BCS1037/codian)](https://github.com/BCS1037/codian/releases)
[![License](https://img.shields.io/github/license/BCS1037/codian)](LICENSE)
[![Obsidian Version](https://img.shields.io/badge/Obsidian-v1.11.4%2B-purple)](https://obsidian.md)

![Codian preview](assets/Preview.png)

**Codian** 是面向 Obsidian 的多 Provider AI Agent 工作区。它不把 Vault 当作一次性上下文，而是让笔记、文件夹、会话、Skills 和本地工具围绕同一个问题持续协作。你可以在侧边栏对话或选区编辑中调用已安装的 Agent；各 Provider 的认证、会话与权限边界保持原生，思考、执行和结果留在自己的 Vault 中。

---

## ✨ 特性亮点

- 💬 **连续对话工作流**：支持多 Tab、会话自动保存、历史搜索、恢复/Fork/Rewind 与 Provider 原生历史回放；对话圆点导航可预览并直达每轮提问。
- ✏️ **嵌入式编辑器 (Inline Edit)**：在编辑器中选中文本直接输入指令，实时查看词级 Diff 预览并一键应用修改。
- 📝 **Live Markdown 实时预览输入框**：基于 CodeMirror 6 构建，支持 `@笔记` 和 `@文件夹` 自动补全、拖拽 Vault 文件/目录添加上下文、图片粘贴，以及文件列表右键“添加到 Codian”。
- 🌐 **Provider 原生连接**：支持 6 个本地 CLI Provider（`claude`, `codex`, `kimi`, `grok`, `opencode`, `pi`）；模型、会话、认证和权限遵循 Provider 原生能力，不假设功能完全相同。
- ⚙️ **共享工作区资源**：管理 Skills、MCP、Subagents 与命令；Vault `.agents/skills` 中的软链接 Skill 可被支持它的 Provider 发现。
- 🔧 **模型与 Claude 服务配置**：按 Provider 组织模型菜单；Claude 支持自定义模型、别名，以及中科院云、阿里百炼、火山引擎、DeepSeek 和自定义 Anthropic 兼容 Endpoint。密钥使用 Obsidian `SecretStorage` 保存。
- ✨ **专注的进入体验**：空会话显示可降低动态效果的 thinking-orbs 动画；需要时可切回传统导航按钮。
- 🛡️ **安全与隐私保障**：直接调用本地安装的 Provider CLI 运行，不包含任何第三方遥测（Telemetry）或数据收集服务。

---

## 📦 环境要求

- **Obsidian**：桌面端 Version 1.11.4 或更高版本（支持 macOS, Linux, Windows）。
- **Provider CLI**：本地系统中已安装并在 `$PATH` 中可用的 Provider CLI：
  - [Claude Code](https://code.claude.com/docs/en/overview) (`claude`)
  - [Codex](https://github.com/openai/codex) (`codex`)
  - [Kimi Code](https://moonshotai.github.io/kimi-code/) (`kimi`)
  - [Grok](https://docs.x.ai/docs/grok-code-fast-1) (`grok`)
  - [OpenCode](https://opencode.ai/) (`opencode`)
  - [Pi](https://github.com/badlogic/pi-mono) (`pi`)
  - [CodeBuddy](https://www.npmjs.com/package/@tencent-ai/codebuddy-code) (`codebuddy`) —— 仅本 fork 支持，见下文
- **Node.js**：Node.js 24（仅从源码编译时需要）。

---

## 🚀 快速安装

### 方式一：Obsidian 社区插件市场（推荐）
1. 打开 Obsidian **设置** -> **社区插件**。
2. 搜索 **Codian**（插件 ID 为 `codianz`）。
3. 点击 **安装** 并 **启用**。

### 方式二：手动 Release 安装（预构建产物）
1. 前往最新 [GitHub Release 页面](https://github.com/BCS1037/codian/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 打开 Vault 的插件目录：`<vault>/.obsidian/plugins/codianz/`（如 `codianz` 文件夹不存在请手动新建）。
3. 将下载的 3 个文件复制到该目录下。
4. 重新加载 Obsidian 或在社区插件设置中启用 **Codian**。

### 方式三：源码编译安装（开发者）
```bash
git clone https://github.com/BCS1037/codian.git
cd codian
npm ci
npm run build
```
编译完成后，将生成的 `main.js`、`manifest.json` 与 `styles.css` 复制到 Vault 的 `.obsidian/plugins/codianz/` 目录中。

---

## 🍴 关于本 fork

本仓库是 [BCS1037/codian](https://github.com/BCS1037/codian) 的个人 fork。**沿用上游插件 ID（`codianz`）**，因此安装目录一致，可就地替换与升级。

### 本 fork 新增了什么

- **CodeBuddy 提供商**（`codebuddy`）：经共享 native-ACP 层驱动 `codebuddy --acp`，使用官方图标与青绿品牌色（`#00BC90`）。CLI 提供 16 个模型、96 万上下文、7 种权限模式。为了让它能跑通，做了两件必要的事：
  - **启动前清洗子进程环境**。CodeBuddy 会读取数十个 `CODEBUDDY_*` 开关，其中一部分改变的是"运行哪个 bundle"而非认证。从 IDE 或 agent 宿主继承下来的残留（如 `CODEBUDDY_FORCE_LITE_WB_BUNDLE`）会让 `--acp` **以退出码 0 静默结束、零输出**，与"集成坏了"完全无法区分。`CODEBUDDY_API_KEY` / `CODEBUDDY_AUTH_TOKEN` 以及你自己配置的变量会被保留。
  - `CODEBUDDY_INTERNET_ENVIRONMENT` 默认补齐为 `internal`（中国区），除非你显式设置。
- **支持非 ASCII 技能名**。上游只列出目录名匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`、且 frontmatter `name` 与目录名完全一致的技能包，中文名技能因此**从不出现在面板里**（且不报错，只是静默消失）。本 fork 对**已存在的**技能包放宽这两条（以目录名为包身份），创建与重命名仍保持严格。
- **思考档位如实呈现**。CodeBuddy 的 ACP 只有一个会话级 `thought_level` 开关，取值恒为 `enabled` 与 `high`。模型下拉只提供这两个，而不再给出猜测的 Low/High/Max——那些选项点了不会生效。

### 如何更新本 fork

社区索引指向的是上游，而 Obsidian 的更新源无法改写。请改用 [BRAT](https://github.com/TfTHacker/obsidian42-brat)：

1. 安装并启用 **BRAT**；
2. 打开 BRAT → **Add Beta plugin** → 填 `lixy1998/codian`；
3. 之后从本仓库的 release 更新。

每次发布的版本号都会**高于上游**（当前为 `1.7.1`），因此社区源的"有更新"提示不会出现，也就无法悄悄覆盖这些改动。若你之前装的是上游版，直接在 BRAT 里添加本仓库即可——它写入同一个 `codianz` 目录，原有设置会保留。

### 许可证

上游为 AGPL-3.0，本 fork 继续沿用。源码公开于此；若你分发构建产物，需同时提供对应源码。

---

## ⚙️ 配置与第三方 Endpoint

在 Obsidian 设置中的 **Codian** 选项卡可以进行 Provider 独立配置：

- **第三方 Claude Profiles**：在 Claude 选项卡中，可直接添加中科院云、阿里百炼、火山引擎等 Anthropic 兼容 Endpoint。
- **SecretStorage 密钥安全**：所有的 API Key 与 Token 均存储于 Obsidian 原生 `SecretStorage` 中，不会明文保存在插件配置文件中。
- **提供商连接与路径**：可在 **设置** -> **提供商** -> 选择对应的 Provider -> **连接** 选项卡中，配置 CLI 可执行文件路径或独立环境变量。

---

## ❓ 常见问题排查 (FAQ)

### 1. 新发布的模型为什么没有出现在 Codian？

Codian 的模型选项来自各 Provider 当前提供的模型目录和配置。模型已经公开发布或 API 已能调用，不代表 Codian 连接的 CLI 会报告它。模型目录可能受 CLI 版本、账号和运行环境影响。

1. 按需更新 Provider CLI 或应用，并确认 Codian 使用的同一套安装和账号能看到这个模型。
2. 打开 Obsidian **设置 → Codian → 提供商**，选中对应 Provider，核对 CLI 路径、环境变量、登录状态和连接配置是否指向正确的安装与账号。
3. 在 **模型 → 浏览模型** 中点击 **发现模型** 或 **刷新**，重新请求当前模型目录。
4. 勾选该模型，将它加入 Codian 对话的模型菜单。已有对话不会自动切换模型；要使用新模型，可在当前对话中切换，或新建对话后选择它。

刷新后仍未出现，说明该 Provider 连接尚未把模型报告给 Codian。检查 CLI 版本、登录和配置。不要手动修改已安装的 `main.js` 或其他插件构建文件来添加模型；插件更新会覆盖这些修改，手改构建文件也不受支持。

### 2. 提示 "CLI not detected" 无法找到本地 CLI 命令？
macOS 图形界面应用（通过 Finder 或 Dock 启动）默认不会加载终端 Shell（如 `~/.zshrc` 或 `~/.bash_profile`）中设置的环境变量。
- **解决方法**：前往 Codian **设置** -> **提供商** -> 选择对应的 Provider（如 Claude、Codex、Kimi 等）-> 在 **连接** 选项卡下的 **CLI 路径** 中，直接填入该 CLI 在你本机上的绝对路径（例如 `/usr/local/bin/claude` 或 `/opt/homebrew/bin/codex`）。

### 3. Kimi Code CLI 提示初始化错误？
Kimi Code CLI 在使用前需要在终端完成首次认证。
- **解决方法**：打开终端运行 `kimi` 命令，按照提示完成登录与模型配置。配置完成后，Codian 即可正常识别并开启 ACP 会话。

### 4. 为什么插件文件夹是 `codianz`，但在 Obsidian 里显示叫 `Codian`？
`codianz` 是提交给 Obsidian 社区插件市场的内部唯一标识（Plugin ID），而 **Codian** 是在界面上呈现给用户的显示名称。安装时请务必保证插件文件夹名称为 `codianz`。

---

## 🛠️ 本地开发与代码验证

```bash
# 安装依赖
npm ci

# 执行类型检查、代码 Lint 与单元测试
npm run verify

# 运行依赖许可证与代码安全扫描
npm run security:audit
```

在提交 Pull Request 之前，请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全漏洞请参照 [SECURITY.md](SECURITY.md) 进行私密通报。

---

## 💖 支持与赞助

如果你觉得 Codian 对你的工作与学习有所帮助，并希望支持项目的持续维护、更新与新特性开发，欢迎通过 [爱发电](https://ifdian.net/a/bcs1037) 给予支持。

非常感谢你的支持与鼓励！🙏

---

## 🙏 致谢

Codian 基于 [Yishen Tu](https://github.com/YishenTu) 开发的开源项目 [Claudian](https://github.com/YishenTu/claudian) 衍生开发。我非常感谢 Yishen Tu 及 Claudian 开源社区贡献者们在将 AI 编码 Agent 引入 Obsidian 领域所做出的开创性工作与灵感启发。

同时我也感谢所有使得 Codian 成为可能的开源项目与社区开发者。

---

## 📄 许可证

Codian 修改与衍生源码遵循 [AGPL-3.0 许可证](LICENSE)。
上游 Claudian 源码保持遵循 MIT 许可证。
上游 Claudian 声明参见 [NOTICE](NOTICE)，第三方组件声明参见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

## 📢 反馈与关注

有问题欢迎 [提 Issue](https://github.com/BCS1037/codian/issues) 或关注微信公众号「维客笔记」反馈。致力于探索解决问题的极简方式！

- **X (Twitter)**：[https://x.com/bcs1037](https://x.com/bcs1037)
