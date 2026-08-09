# Feature: AI 助手聊天（webview 聊天界面 + 现有 stdin/stdout 桥）

> 目标：在 Digital-IDE 里新增第 5 个视图（SMART Options），含一个"AI Chat"节点（双击打开），
> 打开一个 **webview 聊天面板**，与 LLM 对话；LLM 可通过工具调用在**当前 Vivado 进程**里执行
> TCL 查询设计（复用现有 stdin/stdout 桥，**不引入 TCP server**）。
>
> 参考：`D:\work_files\AI_prj\SynthAid_demo_v3_version-1\assistant_plugin`（SynthAid）。

---

## 1. 背景与需求

- 用户希望有一个 AI 助手，能针对当前 FPGA 工程问答、分析设计。
- 参考项目 SynthAid 在 Vivado 内部跑一个 TCP server + Python tkinter 聊天窗。
- 我们的扩展**已经托管 Vivado 进程**（stdin/stdout），无需 TCP，直接复用现有桥。

## 2. 已确认决策

| 项 | 决策 |
|---|---|
| 与 Vivado 通信 | **复用现有 stdin/stdout 桥**，不用 TCP server |
| 新视图 | 在现有 "TreeView" activity bar 容器里新增**第 5 个 view**：**SMART Options**（显示名；内部 id `digital-ide-treeView-assistant`） |
| 节点 | 树内一个 **AI Chat** 节点（双击打开，沿用 `digital-ide.treeView.dispatch` 双击机制）；后续可追加更多节点 |
| 聊天界面 | **webview 面板**（与日志分析/网表/波形一致） |
| LLM 后端 | **扩展内 Node + axios**（axios 已是依赖）调 OpenAI 兼容 Chat Completions |
| 工具调用 | LLM 可调 `run_vivado_tcl` 工具，经扩展 → stdin 在 Vivado 执行并捕获结果 |
| RTL 上下文 | 启动聊天时用 `hdlParam`（Rust LSP 已解析）构建 **RTL 设计结构**注入 system prompt（等效 SynthAid 的 pyslang，零 Python 依赖） |
| 配置 | 扩展 `configuration`（apiBase / apiKey / model / systemPrompt / temperature / maxTokens / maxToolRounds / injectRtlContext）+ 聊天内 Settings 按钮跳转设置页 |

## 3. 架构

```
VSCode 扩展（Node）
┌─────────────────────────────────────────────────────────┐
│ 树视图 digital-ide-treeView-assistant                    │
│   └─ AI Chat 节点（双击）──► digital-ide.assistant.open-chat│
│                                                          │
│ ChatPanel（webview）                                     │
│  ┌─────────────────────────────────────┐                 │
│  │ 消息区 / 输入框 / Send / Clear / ⚙  │                 │
│  └─────────────────────────────────────┘                 │
│        │ postMessage(send/append)                       │
│        ▼                                                  │
│  llm.ts ── axios ──► OpenAI 兼容 API（如 deepseek）        │
│    · runConversation：消息 + 工具调用循环                   │
│    · run_vivado_tcl 工具 → executeTcl()                  │
│                         │                                 │
│                         ▼                                 │
│  PlManage.executeTcl() ── 帧化 TCL 写 stdin                │
│                         │ Vivado 执行，结果写入临时文件     │
│                         ▼                                 │
│  TclExecutor.onData() ── 检测 __DIDE_DONE__:<id> 哨兵     │
│                         └── 读临时文件 → 返回结果           │
└─────────────────────────────────────────────────────────┘
```

## 4. 实现步骤

### 步骤 1：`package.json` —— 新增视图 / 配置 / 命令

```jsonc
// contributes.views.TreeView 追加：
{
    "id": "digital-ide-treeView-assistant",
    "name": "SMART Options",
    "icon": "images/svg/view.svg"
},

// contributes.commands 追加：
{
    "command": "digital-ide.assistant.open-chat",
    "title": "%digital-ide.assistant.open-chat.title%",
    "category": "Digital-IDE"
},

// contributes.configuration 追加（digital-ide.assistant.*）：
"digital-ide.assistant.apiBase":  { "type": "string", "default": "https://api.deepseek.com/v1" },
"digital-ide.assistant.apiKey":   { "type": "string", "default": "" },
"digital-ide.assistant.model":    { "type": "string", "default": "deepseek-v4-pro" },
"digital-ide.assistant.systemPrompt": { "type": "string", "default": "You are an expert FPGA design assistant..." },
"digital-ide.assistant.temperature":  { "type": "number", "default": 0.7 },
"digital-ide.assistant.maxTokens":    { "type": "number", "default": 4096 },
"digital-ide.assistant.maxToolRounds":{ "type": "number", "default": 10 }
```

### 步骤 2：`src/function/treeView/assistant.ts` —— 第 5 个视图的树 provider

仿照 `BaseCommandTreeProvider`：根节点 **AI Chat**（`cmd: 'digital-ide.assistant.open-chat'`），
节点命令走 `digital-ide.treeView.dispatch`（双击触发）。配置用数组/对象，**后续追加节点即可扩展**。

### 步骤 3：`src/function/assistant/config.ts` —— 读取扩展设置

```ts
export function getAssistantConfig(): AssistantConfig {
    const cfg = vscode.workspace.getConfiguration('digital-ide.assistant');
    return {
        apiBase: cfg.get('apiBase', 'https://api.deepseek.com/v1'),
        apiKey: cfg.get('apiKey', ''),
        model: cfg.get('model', 'deepseek-v4-pro'),
        systemPrompt: cfg.get('systemPrompt', ''),
        temperature: cfg.get('temperature', 0.7),
        maxTokens: cfg.get('maxTokens', 4096),
        maxToolRounds: cfg.get('maxToolRounds', 10)
    };
}
```

### 步骤 4：`src/function/assistant/tclExecutor.ts` —— Vivado 工具调用桥（帧化 + 临时文件）

问题：stdout 是共享流，多行结果无法用行哨兵可靠截断。方案：**命令结果写入临时文件**，
stdout 只回一个 `__DIDE_DONE__:<id>` 标记，扩展读到后读文件。

```tcl
set __dide_f "<临时文件路径>"
if {[catch { <用户/LLM 命令> } __dide_res]} {
  set fp [open $__dide_f w]; puts $fp "ERROR: $__dide_res"; close $fp
} else {
  set fp [open $__dide_f w]; puts $fp $__dide_res; close $fp
}
puts "__DIDE_DONE__:<uuid>"
unset __dide_f __dide_res
```

`TclExecutor`：
- `execute(command, timeout): Promise<string>`：生成 uuid + 临时文件 → 写帧化命令到 stdin →
  注册 pending（含 resolve/reject/超时计时器/文件路径）。
- `onData(text)`：扫描 `__DIDE_DONE__:<id>`，命中 → 读临时文件 → resolve → 清理。

### 步骤 5：`src/function/assistant/llm.ts` —— LLM 后端（Node + axios，非流式 v1）

- `chatOnce(config, messages)`：POST `${apiBase}/chat/completions`，带 `tools: [RUN_VIVADO_TCL_TOOL]`。
- `runConversation(config, messages, executeTcl, callbacks)`：工具调用循环（≤ maxToolRounds）：
  1. 调 API；若返回 `tool_calls` →
  2. push assistant(tool_calls) → 逐个执行 `run_vivado_tcl`（调 `executeTcl`，回调 `onToolCall/onToolResult` 供 UI 显示）→ push tool 结果
  3. 回到 1；无 tool_calls 时返回最终文本。
- 工具定义 `RUN_VIVADO_TCL_TOOL`：描述 + `command` 参数（仿参考项目），提醒 `-return_string`。

### 步骤 6：`src/function/assistant/panel.ts` —— 聊天 webview（单例）

- `ChatPanel.reveal()`：打开/聚焦 webview；消息区 + 多行输入 + Send/Clear/⚙Settings。
- 发送：`postMessage send` → 扩展侧 `runConversation`（后台执行）→ `postMessage append`（
  user / assistant / tool / error 分 tag 显示）；处理中禁用输入并显示 Thinking。
- Settings 按钮：`workbench.action.openSettings` → `digital-ide.assistant`。
- 会话历史：**v1 存内存**（面板单例，VSCode 运行期间保留）；持久化留作后续。

### 步骤 7：`src/manager/PL/index.ts` —— 桥接 executeTcl + 持有 ChatPanel 单例

```ts
private assistant?: ChatPanel;
private tclExecutor = new TclExecutor();

constructor() {
    ...
    // stdout 同时转发给 TCL 控制台 与 工具调用结果分发
    this.context.onOutput = text => {
        this.tclConsole?.appendOutput(text);
        this.tclExecutor.onData(text);
    };
}

public openAssistantChat() {
    if (!this.assistant) {
        this.assistant = new ChatPanel({
            executeTcl: (cmd, timeout) => this.executeTcl(cmd, timeout)
        });
        this.assistant.onDispose = () => { this.assistant = undefined; };
    }
    this.assistant.reveal();
}

public executeTcl(command: string, timeout = 30000): Promise<string> {
    return this.tclExecutor.execute(command, () => this.context.process, timeout);
}
```

### 步骤 8：`src/manager/index.ts` —— 注册命令

```ts
vscode.commands.registerCommand('digital-ide.assistant.open-chat', () => plManage.openAssistantChat());
```

### 步骤 9：`src/function/index.ts` —— 注册第 5 个视图

```ts
vscode.window.registerTreeDataProvider('digital-ide-treeView-assistant', treeView.assistantTreeProvider);
```

### 步骤 10：i18n

- `package.nls.*.json`：`digital-ide.assistant.open-chat.title`。
- `l10n/bundle.l10n.{en,zh-cn,zh-tw,de}.json`：`assistant.*`（title/placeholder/send/clear/settings/
  thinking/not-configured/not-running/tool-call/tool-result/error/max-rounds）。

### 步骤 11：RTL 结构上下文注入（等效 SynthAid 的 pyslang）

新增 `src/function/assistant/context.ts` 的 `buildRtlContext()`：遍历 `hdlParam`（Rust LSP 启动时已解析），
生成工程名/顶层模块 + 每个模块的端口/参数/例化清单文本。

- `llm.ts` `runConversation` 增加 `options.designContext`：追加到 system prompt。
- `panel.ts` 发送时若 `injectRtlContext` 开启则调用 `buildRtlContext()` 传入。
- 配置项：`digital-ide.assistant.injectRtlContext`（默认 `true`）。

这样 LLM 可直接基于模块层级/端口/例化事实回答结构性问题，不需要每次都查 Vivado。

## 5. 注意事项

1. **运行期间工具调用排队**：Vivado 忙于 `wait_on_run` 时，LLM 的 TCL 工具调用会排队到 run 结束后
   才执行，可能超时（executeTcl 默认 30s）→ LLM 收到错误可自行调整策略。
2. **输出与自动命令混流**：工具调用输出与插件自动命令/TCL 控制台共用 stdout，属正常。
3. **非流式 v1**：LLM 响应为整段返回（Thinking → 完整文本/工具调用），流式留作后续。
4. **API 无 key**：未配置 apiKey 时聊天提示去设置；工具调用需 Vivado 已 Launch。
5. **保留名称**：帧化 TCL 使用 `__dide_f / __dide_res / __dide_done`，用户命令避免同名。
6. **RTL 上下文来源**：`buildRtlContext()` 读取 `hdlParam`（Rust LSP 启动时解析）。工程未打开/未解析
   时上下文为空（有兜底提示）；文件改动后需触发重新解析（或重启窗口）以更新上下文。

## 6. 后续可扩展（本期不做）

- 流式输出（SSE 解析）
- 会话历史持久化（JSON 到 dideHome）
- 自动注入最近综合/实现日志分析结果（利用已实现的 `SynthAnalysisResult`）作为上下文
- 树里追加更多节点（如"分析当前设计"一键入口）

## 7. 测试与验证

1. `npm run compile` + `npx eslint src --ext ts`（0 error）。
2. 手动 E2E：
   - 左侧出现第 5 个 view **SMART Options**，内含 **AI Chat** 节点；双击 → 打开聊天 webview。
   - 未配置 apiKey → 发送提示去设置；打开 Settings 配置 apiBase/apiKey/model。
   - 输入"介绍一下当前工程的顶层模块" → LLM 通过 `run_vivado_tcl` 执行 `get_property top ...`，结果回显。
   - 输入"查看资源利用率" → LLM 执行 `report_utilization -return_string`，大段结果正确回显（临时文件方案验证）。
   - 未 Launch Vivado 时工具调用 → 提示"Vivado 未运行"。
   - 关闭面板再打开 → 复用单例。
   - **RTL 上下文注入**：打开 hdmi_ex 工程（等解析完成）→ 问"当前工程顶层模块是什么？有哪些端口？谁例化了谁？"→ LLM 应直接基于注入的结构作答，且基本不再调用 `run_vivado_tcl`。`injectRtlContext=false` 时可关闭该行为。
