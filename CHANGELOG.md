# Changelog

> 1.7.1 is a fork release. Everything below is specific to
> [lixy1998/codian](https://github.com/lixy1998/codian); upstream is
> [BCS1037/codian](https://github.com/BCS1037/codian).

## 1.7.7 — 2026-10-30

- **Stitch split conversations back together.** When the CLI fails to resume a session it starts a
  new one, and the earlier turns stay behind in the old file. Because Codian records only the latest
  id, a conversation could look like it had lost its beginning — one observed case was spread over
  three provider sessions (10 + 8 + 2 messages), of which only the last was visible.
  - `NativeAcpChatRuntime` now appends the previous id to `providerState.sessionChain` whenever the
    session changes, so the link is never lost again.
  - `CodebuddyConversationHistoryService` hydrates every session in that chain, oldest first.
  - Deliberately **no time-based guessing**: provider sessions carry no parent link, and two
    conversations in one vault can overlap minute by minute, so inferring the chain from timestamps
    would splice one conversation's history into another.
  - Verified: the split conversation went from 2 visible messages to 20 (with 106 tool calls), while
    a neighbouring conversation kept its own 2 and was not contaminated.

## 1.7.6 — 2026-10-30

- **Restore reasoning too, collapsible.** The transcript now rebuilds the full turn structure —
  reasoning, prose and tool calls — in the order they happened, instead of only the prose.
  - Everything lands in `contentBlocks` (`thinking` / `text` / `tool_use`), which is what the
    renderer walks; text has to be in there too or the prose disappears.
  - Thinking blocks and tool cards both render collapsed by default (`isExpanded: false`), so a
    long transcript stays scannable with detail one click away. Measured on one conversation:
    8 messages, 51 thinking blocks, 71 tool calls, 0 expanded.

## 1.7.5 — 2026-10-30

- **Hydrate tool calls, not just text.** 1.7.4 restored the conversational turns but dropped
  `function_call` / `function_call_result` records, so a transcript that used 71 tools showed
  replies like "patch applied" and "pushed" with no visible steps behind them. Tool calls are now
  paired by `callId`, attached to the assistant turn that issued them, and carry their output and
  status. One restored conversation went from 8 messages / 0 tools to 12 messages / 71 tools.

## 1.7.4 — 2026-10-30

- **Fix: conversations open empty after a restart.** CodeBuddy was registered without a
  `conversationHistoryService`. Every other provider ships one, and Codian stores only metadata —
  the transcript belongs to the CLI. Without the service, `hydrateConversationHistory` had nothing
  to call, so a restored conversation rendered as an empty welcome screen and clicking it in the
  history list appeared to do nothing.
  - The new service reads `~/.codebuddy/projects/<slug>/<sessionId>.jsonl`. It locates the file by
    session id across project folders rather than recomputing the cwd slug, whose rules are easy to
    get wrong (`d:\Documents\TNote` → `d-Documents-TNote`).
  - Only conversational turns are hydrated; reasoning, tool calls and generated titles are skipped.
- **Fix: `sessionId` was overwritten with null.** `NativeAcpChatRuntime.buildSessionUpdates`
  wrote `this.sessionId` directly, which is null until the CLI has loaded a session. Any save
  before that point persisted null over the stored id, permanently detaching the conversation from
  its provider transcript. It now falls back to the persisted id, matching the other providers.

## 1.7.3 — 2026-10-30

- **Fix history rows that looked unresponsive**: the click handler was bound to
  `.codian-history-item-content` only, so clicking the leading status icon or the padding around
  the row did nothing — the row appeared dead unless you hit the title text. The handler now sits on
  the row itself; the pin / archive / more / delete buttons on the right already stop propagation.
  A row that is already the active conversation still does nothing by design, since there is
  nothing to switch to.

## 1.7.2 — 2026-10-30

- **Fix `HierarchyRequestError` when selecting chat text**: the selection toolbar was created with
  `ownerDocument.createDiv`, which attaches the element straight to the document — a document only
  tolerates one element, so selecting text twice threw `Only one element on document allowed` and the
  toolbar silently failed to appear. It is now built detached and appended to the body once.

## 1.7.1 — 2026-10-30

- **New provider: CodeBuddy** (`codebuddy`), driven over ACP:
  - Registers through the shared native-ACP module, so no provider logic is duplicated. Verified against a live CLI: 16 models with effort options, a 960k context window, and 7 permission modes (`default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`, `fullAccess`).
  - Ships the official mark and the teal brand accent (`#00BC90`). Without `getProviderIcon` the header used to fall back to another provider's logo, which made a CodeBuddy session look like a Claude one.
  - Sanitises the child-process environment before spawn. Inherited `CODEBUDDY_*` switches (for example `CODEBUDDY_FORCE_LITE_WB_BUNDLE`) make `--acp` exit with code 0 and no output; `CODEBUDDY_API_KEY` / `CODEBUDDY_AUTH_TOKEN` and user-configured values survive. `CODEBUDDY_INTERNET_ENVIRONMENT` defaults to `internal`.
  - Model ids gain a `codebuddy/` prefix so selections stay provider-scoped when several providers are enabled.
- **Skills: read what is already on disk**:
  - Listing no longer applies the creation-only naming rules. Non-ASCII folder names (Chinese, etc.) are accepted, and a stale frontmatter `name` is resolved in favour of the folder instead of hiding the package. Creating and renaming keep the strict portable-name rule.
  - Measured on a 62-package vault: 49 skills listed with 12 rejected, versus 60 listed with 1 rejected (`ppt-master` is a multi-skill bundle whose `SKILL.md` sits one level deeper — a structural difference, not a naming one).
- **CodeBuddy reasoning tiers**: the effort submenu now offers only the tiers the CLI accepts (`enabled` / `high`). The previous Low/High/Max fallback produced options that silently did nothing, because ACP exposes a single session-level `thought_level` switch and the richer per-model `_meta.effortOptions` have no reliable apply channel.
- **Distribution**: released at a version above upstream and documented for [BRAT](https://github.com/TfTHacker/obsidian42-brat) updates (`lixy1998/codian`), so the community updater cannot overwrite the fork.

## 1.7.0 — 2026-10-21

- **Multi-Provider Inline Edit & Model Selection**:
  - Expanded the inline edit composer to support all enabled providers (Codex, DeepSeek, Grok, OpenCode, Pi, Claude), grouping models cleanly under their respective provider with official logos.
  - Dynamically initializes and switches the active provider's `InlineEditService` when selecting a model from a different provider, updating theme accents and slash commands in real time.
  - Automatically resolves inline edit defaults from the active conversation or draft tab, and persists user choices to `inlineEditModel` settings.
- **Discrete Reasoning Effort Controls**:
  - Replaced continuous sliders with Codian's sidebar-consistent discrete reasoning effort options (`Low`, `Medium`, `High`, `Max`).
  - Added an effort flyout submenu (`›`) on each adaptive reasoning model in the model dropdown for one-step model and effort selection.
  - Displayed a dedicated `ThinkingSelector` gear menu beside the model button, enabling fast effort level adjustments on the fly.
- **Shared Architecture & Robustness**:
  - Unified toolbar components into canonical shared `ModelSelector` and `ThinkingSelector` modules, eliminating redundant code across chat toolbars and inline editors.
  - Resolved CodeMirror floating dropdown containment clipping using CSS custom properties via `setCssProps`.

## 1.6.2 — 2026-10-21

- **Instant Settings Tab Switching & Navigation**:
  - Retained rendered tab DOM in memory across switches between General, Providers, Workspace, and About tabs, completely eliminating repeated full-page "Loading resources…" delays and UI flickering.
  - Memoized MCP server catalogs in memory for Codex and Claude, preventing repetitive 5+ second external CLI executions during routine settings navigation.
  - Refactored provider cards and workspace segmented tabs to update active states and detail sections incrementally without destroying parent containers.
- **Workspace Resource Refresh & Sync**:
  - Added a dedicated **Refresh** button in the Workspace capabilities toolbar to synchronize external additions or modifications made via CLI or configuration files on demand.
  - Added an informative hint in the MCP section clarifying that server lists are cached in memory and can be refreshed manually when external configuration changes occur.
  - Added full localization for refresh actions and hints across all 10 supported locales.

## 1.6.1 — 2026-10-19

- **Community Plugin Compliance & Review Hardening**:
  - Synchronized `bun.lock` with latest dependencies to ensure seamless dependency resolution in review and installation environments.
  - Replaced native `createEl('span')` and `createEl('div')` invocations with Obsidian's recommended DOM helpers (`createSpan` and `createDiv`).
  - Strengthened strict typing in composer live-preview input bridge, replacing `any` casts with `EdgeRowNavigableElement`.
  - Refactored conversation history and renaming styles to eliminate `:has()` selectors and `!important` declarations, adhering to Obsidian performance guidelines.

## 1.6.0 — 2026-10-19

- **DeepSeek Provider Integration**: Added first-class support for the DeepSeek Provider:
  - DeepSeek reasoning and chat models with configurable reasoning effort and token settings.
  - Native permission modes with granular access control (`Workspace write` and `Full access`).
  - Integrated DeepSeek auxiliary services for inline edits, title generation, instruction refinement, and custom command/skill scanning.
  - Dedicated DeepSeek configuration panel in settings with secure credential handling and connection diagnostics.
- **Responsive Chat Toolbar & Compact Brain Icon**:
  - Dynamically collapses the model selector into a clean brain icon button when the sidebar or chat pane width is constrained.
  - Prevents toolbar wrapping and misalignments when long model names are displayed, keeping model selection, file context, and permission toggles cleanly aligned on a single row.
  - Full model name remains easily accessible via hover tooltip and interactive dropdown selection.

## 1.5.1 — 2026-10-17

- **Streamlined Conversation Menu**: Cleaned up redundant commands in the conversation "More options" (`...`) dropdown and right-click context menus:
  - Removed redundant **Pin** and **Archive** items since dedicated action buttons are already directly accessible on hover within the conversation list.
  - Removed redundant **Switch to session** item since clicking the conversation row directly activates the tab.
  - Removed **Close tab** item to keep the context menu lightweight and focused on essential session actions (Rename, Mark as unread/read, Open in new tab, and Delete).

## 1.5.0 — 2026-10-17

- **Configurable Tab Limit Overflow**: Added a new setting to choose how Codian handles opening conversations beyond the maximum tab limit:
  - **Temporary Tab (Default)**: Opens the conversation in a temporary preview tab replacing the current tab without closing it in history. Interacting or sending a message promotes it to a permanent tab (evicting the oldest non-current tab if needed).
  - **Auto-Close Oldest**: Automatically closes the least recently used tab and opens the new conversation seamlessly.
  - **Strict Limit**: Preserves the strict limit notice and prevents opening more tabs than configured.
- **Clean Session History Styling**: Refined the conversation history list by removing redundant gray card backgrounds and red left lines from open tabs and pinned items. Rows stay clean and transparent by default, reserving the active accent styling exclusively for the current conversation.
- **Dependency Updates**: Upgraded `@anthropic-ai/claude-agent-sdk` to 0.3.296 and updated development dependencies.

## 1.4.1 — 2026-10-17

- **Dual-Pane Tab Visibility**: Enabled the chat tab bar in wide dual-pane mode, providing direct visual access, switching, and management for up to 5 concurrent tabs right above the composer.
- **Session List & Open Tab Badging**: Redesigned session history items into compact, single-line rows; prioritized active and open tabs at the top of the sidebar with distinct pill badges (`[Tab 1]`～`[Tab 5]`) and quick tab-close buttons.
- **Hover Actions & Inline Rename**: Optimized conversation list interactions with smooth hover action reveals, localized close-tab tooltips across all 10 locales, and seamless inline title renaming without layout shift.

## 1.4.0 — 2026-10-16

- **Inline Edit**: Streamlined the composer into a compact card with diff statistics, status indicators, and keyboard shortcuts.
- **Chat Workspace & Dual Pane**: Enhanced wide and dual-pane chat layouts with smoother tab switching and reliable historical session restoration.
- **Rendering & Code Blocks**: Added support for third-party plugin code-block rendering and optimized stored tool output performance.
- **Environment & Editor Context**: Improved login shell discovery across macOS/Linux and expanded context selection to non-Markdown file views.
- **Reliability & Stability**: Hardened tab state machines and asynchronous rendering guards against background UI deadlocks.

## 1.3.3 — 2026-08-20

- Fixed Codex memory citation metadata leaking into visible chat responses and history replay.
- Improved Codex compatibility with streamed and persisted assistant messages.
- Updated Obsidian, Provider, build, and release dependencies and settings type compatibility.

## 1.3.2 — 2026-08-20

- Improved Provider workspace and Codex resource handling.
- Added clearer chat navigation, model-tier feedback, and tab attention indicators.
- Tightened permission prompts, plan approvals, and runtime cleanup.

## 1.3.1 — 2026-08-19

- Added pin/archive controls and filtering for conversation history.
- Added read-only Codex CLI MCP discovery with safe config fallback.

## 1.3.0 — 2026-08-18

- Updated selected provider runtime, history, and compatibility behavior.
- Improved Claude-compatible cancellation and tab-switch recovery.
- Added regression coverage for cross-provider runtime changes.

## 1.2.9 — 2026-08-08

### Marketplace and runtime compatibility

- Synchronized the Bun lockfile with the published dependency graph for Community scanner validation.
- Replaced native DOM factory paths with Obsidian DOM APIs and fixed provider SVG construction during view startup.
- Fixed a blank Codian chat view caused by provider icon creation attaching an SVG root to the document.

### Documentation

- Refreshed the README preview image.

## 1.2.8 — 2026-08-06

### Prompt and context safety

- Hardened prompt context encoding with safe XML attributes, CDATA content, invalid-character normalization, and backward-compatible context parsing.
- Unified editor, browser, canvas, linked-note, chat-selection, and Codex prompt context formatting.

### Models and thinking

- Added Pi `max` thinking effort support with model-aware fallback handling.
- Added opt-in Codex `ultra` reasoning effort support; existing defaults remain unchanged.
- Added title-generation language selection, including interface-language follow mode, across supported Providers.

### Tools, agents, and history

- Normalized task-management tools into stable Todo snapshots across live Claude streams and history replay.
- Improved ACP diff preservation, Pi web-tool rendering, Codex subagent lifecycle handling, Grok tool-result normalization, and provider-native diff replay.
- Restored Pi Skill command replay from persisted history.

### Chat rendering

- Coordinated streaming Markdown renders with snapshot coalescing, visibility-aware throttling, final flushes, and improved thinking-block rendering performance.

### Dependencies and security

- Updated Claude Agent SDK, MCP SDK, development tooling, and release-attestation dependencies, including security maintenance updates.

## 1.2.7 — 2026-07-30

### Kimi Code

- Fixed Kimi Code session start error caused by provider model ID prefix decoding and missing fallback on stale session load.
- Supported dynamic ACP thinking levels (`Low` / `High` / `Max`), automatically adapting the toolbar selector.
- Omitted redundant `(on)` label from the model selector when a model has a single non-configurable effort state.
- Added opt-in diagnostic logging (`.codian/kimi-diagnostics.log`) under Kimi Code settings for remote debugging.

## 1.2.6 — 2026-07-30

### Claude-compatible services

- Kept managed Claude-compatible services on persistent transport from the first turn for more reliable session behavior.
- Stop interrupted Claude turns immediately, discard late provider output, and rebuild the connection for the next message.
- Prevent Claude Code user-setting behavior flags from overriding Codian-managed third-party service configurations.
- Request thinking output from managed third-party services when the endpoint supports it.

### Claude settings and chat feedback

- Removed the redundant manual custom-model input from Claude settings; configured service models remain available in the picker.
- Replaced random waiting messages with clear model and tool progress states.
- Show a slow-service notice when a provider has not responded after 45 seconds.

## 1.2.5 — 2026-07-29

### Claude-compatible chat

- Complete first replies from compatible services, including DeepSeek, when their stream omits Claude Code's final result event.
- Start a new compatible-service conversation through a reliable first-turn path before reusing its provider session.

## 1.2.4 — 2026-07-28

### Chat layout

- Keep the provider header and chat tabs aligned to the start of the pane.
- Keep the composer fixed at the pane bottom while messages scroll independently.

## 1.2.3 — 2026-07-28

### Chat

- Select text in a completed AI reply, then copy it or add it as removable chat context for a follow-up prompt.
- Preserve selected-reply context across all built-in Providers and show compact context chips in the conversation.

## 1.2.1 — 2026-07-27

- Logo refresh.
- About copy update.

## 1.2.0 — 2026-07-27

### Claude models

- Show models configured in Claude Code settings, including global, project, and local model overrides.
- Show built-in Claude models only after native Claude authentication is confirmed.

### Codex MCP

- Read Codex MCP server definitions from `~/.codex/config.toml` and show them in Codian.
- Mark Codex MCP controls as display-only and direct server changes to `codex mcp`.

### OpenCode and agent status

- Keep OpenCode slash-command menus usable when ACP command metadata is delayed or absent.
- Show a running tool card when ACP reports an in-progress tool update before its start event.

## 1.1.4 — 2026-07-27

### Chat and commands

- Made provider slash-command menus load reliably, refresh when chat context changes, and show a retry path when discovery fails.
- Added Codex `/fast` to switch its fast-mode setting directly from chat.
- Improved provider-specific command visibility, cancellation handling, and chat-tab state persistence.

### Models, settings, and history

- Improved model, Provider settings, and command catalog refresh behavior across supported Providers.
- Preserved Claude conversation history after a Claude environment change while preventing accidental resume against the changed service.

## 1.1.3 — 2026-07-26

### Chat navigation

- Fixed conversation-dot preview cards opening at the chat-pane top. Cards now align with the dot being hovered.

## 1.1.2 — 2026-07-26

### Marketplace compliance

- Removed the redundant platform name from plugin and marketplace descriptions to satisfy Community Plugins manifest validation.
- Replaced the altered root license text with the complete canonical GNU AGPL-3.0 text and added a verification guard so repository license detection cannot regress.

## 1.1.1 — 2026-07-26

### Polish and marketplace metadata

- Aligned every About-page section, heading, paragraph, and sponsorship link with the slogan card's left edge.
- Rewrote Codian's public description around its multi-provider agent workspace and updated the Community Plugins listing copy.
- Made the English README the primary project entry point, moved Simplified Chinese documentation to `README_ZH.md`, and retained a compatibility redirect at `README_EN.md`.
- Restored the canonical AGPL-3.0 license file header so GitHub and Obsidian Community Plugins can recognize the repository license; upstream Claudian MIT attribution remains in `NOTICE`.

## 1.1.0 — 2026-07-26

### Chat experience

- Added a compact conversation-dot navigator. It previews each prompt and reply, jumps directly to the prompt, highlights the latest turn with the Obsidian accent color, and leaves clear space for message content.
- Added a General-setting switch between conversation-dot navigation and the original navigation buttons.
- Added the MIT-licensed thinking-orbs `solving` animation to every empty chat tab, with reduced-motion and light/dark-theme support.

### Models and providers

- Unified chat model menus by provider. Claude's configured and third-party models now appear together; unconfigured fallback Claude candidates stay hidden.
- Moved supported model effort choices into the model submenu and display the active effort beside the selected model.
- Added explicit Claude model management with aliases, plus a DeepSeek preset for Anthropic-compatible Claude Code connections.

### Workspace and settings

- Added shared Skill discovery for vault `.agents/skills` entries, including managed symlinks, and show the Providers that support each shared Skill.
- Removed duplicated Workspace resource headings and descriptions.
- Added an About tab with Codian's slogan, feedback guidance, and an Afdian sponsorship link for 维客.

## 1.0.2 — 2026-07-23

- Updated `bun.lock` dependency lockfile for Obsidian Community Store automated review compatibility.

## 1.0.1 — 2026-07-23

- Changed the Obsidian plugin ID from `codian` to `codianz` for Community plugins directory compatibility. The displayed plugin name remains Codian.
- Migrates legacy `.obsidian/plugins/codian/data.json` into an empty `codianz` data store without deleting or overwriting old data.
- Keeps vault-level `.codian/` settings and conversation metadata unchanged.

## 1.0.0 — 2026-07-23

First public source version of Codian.

### Included

- Local coding-agent sidebar and inline-edit workflows for Obsidian.
- Claude, Codex, OpenCode, Pi, Grok, and Kimi provider integrations.
- Conversation history, resume, fork, rewind, search, and multi-tab workflows.
- Skills, slash commands, MCP, subagents, tool approval, and Plan modes.
- MIT-licensed Codian source with retained Claudian attribution.
