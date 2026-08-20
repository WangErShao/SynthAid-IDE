# Verilog Lint 自动修复 — 设计方案

> 整合 **Verible**、**Vivado (synth_design -rtl)** 和 **LLM** 的统一诊断与修复系统。
> 核心：一个**统一诊断管理器**接收多工具结果，合并展示；一个**修复路由器**把修复任务分发给 Verible（确定性）或 LLM（智能）。

---

## 0. 现状与前提

SynthAid-IDE 已有基础设施：

| 已有模块 | 作用 | 本方案如何复用 |
|---------|------|---------------|
| **Rust LSP** (`src/function/lsp/`) | Verilog/VHDL 补全、诊断、格式化 | 保持不动，实时诊断仍由它发布 |
| **LinterManager** (`src/function/lsp/linter/manager.ts`) | 管理 iverilog/vivado/modelsim/verible/verilator | **扩展它**，把 lint 结果转 Diagnostic + CodeAction |
| **assistant** (`src/function/assistant/`) | LLM 聊天 + 工具调用（apiKey/model 已配置） | 复用 `getAssistantConfig()` 做 LLM 修复 |

**关键架构决策**：**不引入第二个 LSP**（如 verible-verilog-ls）——两个语言服务器会对同一文件抢诊断源、互相覆盖。Verible 走命令行，通过现有 LinterManager 模式跑。

---

## 1. 四层架构

```
┌─────────────────────────────────────────────────────────┐
│ ④ 用户交互与工作流                                        │
│    错误处 💡 → [使用 Verible 修复] / [使用 AI 修复]         │
├─────────────────────────────────────────────────────────┤
│ ③ LLM 智能修复层                                         │
│    复杂问题 → LLM → diff 预览 → 确认 → 应用 → 重新 lint     │
├─────────────────────────────────────────────────────────┤
│ ② 诊断聚合与展示层                                        │
│    统一诊断管理器：合并多来源，标来源，去重，VSCode 问题面板   │
├─────────────────────────────────────────────────────────┤
│ ① Lint 结果收集层                                        │
│    Verible(命令行, 实时)   Vivado(批量, 手动/按需)          │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 第一层：Lint 结果收集层

### 2.1 Verible（命令行，实时）

- **工具**：`verible-verilog-lint`（SynthAid-IDE 的 `SupportLinterName` 已含 verible）
- **运行**：通过现有 `LinterManager` 模式，用 `workspace/executeCommand` 触发（复用 `publishDiagnostics`）
- **解析**：verible 输出 `文件:行:列: 规则名: 描述` → 转成 VS Code `Diagnostic` + `code`
- **实时性**：存盘触发，毫秒级，作为主要实时诊断源
- **auto-fix**：风格类规则（对齐/空白/分号/命名）verible 原生支持，直接生成 TextEdit

### 2.2 Vivado（批量，手动/按需）

- **工具**：`vivado -mode batch -source <script.tcl>`，脚本内 `synth_design -rtl`
- **触发**：**手动命令**「Lint with Vivado」或存盘后**防抖 + 后台**（避免几十秒综合卡死界面）
- **解析**：正则提取 `文件:行号: 错误等级: 描述` → 转 Diagnostic，来源标记 `[Vivado]`
- **定位**：只做 `-rtl`（RTL 级综合，不做布局布线），控制在秒级

### 2.3 标准化输出

统一诊断结构：

```ts
interface LintDiagnostic {
    source: 'verible' | 'vivado' | 'lsp';   // 来源
    code: string;                            // 诊断码/规则名
    severity: 'error' | 'warning' | 'info';
    range: vscode.Range;                     // 位置
    message: string;                         // 描述
    fixable: 'verible' | 'llm' | 'none';     // 修复路由
}
```

---

## 3. 第二层：诊断聚合与展示层

### 3.1 统一诊断管理器（新增）

```
src/function/lint-fix/diagnosticManager.ts
```

职责：
- 接收 Verible / Vivado / LSP 三方结果
- 合并 + 按来源标记（`[Verible]` / `[Vivado]` / `[LSP]`）
- **去重**（同文件同行同码只留一条）
- 写入 `vscode.languages.createDiagnosticCollection` → 自动出现在"问题"面板

### 3.2 与现有 LinterManager 的关系

**扩展而非重建**：
- 现有 `LinterManager.publishDiagnostics` 已负责把 linter 结果推给 LSP 客户端
- 新增 `DiagnosticManager` 在其上层：收集 `Diagnostic`，统一合并、标来源、路由修复
- 复用 `asyncConsumer`（受限并发）跑多文件检查

### 3.3 诊断来源展示

问题面板每条带前缀标记：
```
[Verible]  line 5 端口对齐 (port-alignment)  建议: 对齐
[Vivado]   line 12 未声明信号 (ELAB-123)      
[LSP]      line 20 语法错误
```

---

## 4. 第三层：LLM 智能修复层

### 4.1 触发

注册 `vscode.codeActionProvider`——用户对某诊断项点 💡 时：
- 若 `fixable === 'verible'` → 显示「使用 Verible 修复」（确定性，直接应用）
- 若复杂/verible 修不了 → 显示「使用 AI 修复」（走 LLM）

### 4.2 上下文构建（Prompt）

```
错误: [code] [message]
相关代码:
```verilog
<诊断行附近的完整语句/模块片段>
```
涉及的信号/模块: <从 Rust LSP 的 hdlParam 提取>
请只修改这个错误，返回修复后的代码片段。
```

关键：**复用 Rust LSP 已解析的 `hdlParam`**（模块/端口/信号定义），让 LLM 基于事实修复，不用自己猜设计结构。

### 4.3 修复执行策略

| 策略 | 说明 | 何时用 |
|------|------|--------|
| **直接替换** | LLM 返回完整修正代码段，替换原文 | 简单错误 |
| **补丁模式** | LLM 返回 diff，解析后应用 | 多行/复杂修改 |

参考框架：RTLFixer / AutoVeriFix（研究项目）的思路——但不抄，做成轻量 diff 解析。

### 4.4 结果验证 + 自动迭代

```
应用 LLM 修复 → 重新运行该文件 lint
   ├─ 通过 → 完成
   └─ 仍报错 → 把新错误喂回 LLM → 再修（≤ N 轮）
```

N 默认 3，防止死循环。这是差异化核心：**从"问答"跨到"能改代码的 agent"**。

### 4.5 LLM 修复：是否写独立 Agent？（设计决策）

**结论：第一版不写独立 agent，写单次 LLM 修复函数 + 有限迭代重试。但接口按"可插拔策略"设计，让 agent 将来无缝替换。**

#### 两种实现深度

| 方案 | 说明 | 适用 |
|------|------|------|
| **A. 函数（v1）** | 单次调用：错误+代码 → LLM → 返回修复 → 应用 → 重 lint | 第一版 |
| **B. 真 Agent（Phase 3）** | LLM 自己决策：查上下文？改代码？再验证？循环直到修好/放弃 | 开放任务（"给顶层加 UART"）|

#### 为什么 v1 不需要 agent

1. **场景单一**：错误 + 代码 → 修复，单次调用 + diff 确认 + 重 lint 足够
2. **agent 是 Phase 3 的事**：真正需要 agent 的是 `assistant-chat-feature.md` 规划的开放任务，不是单点修复
3. **迭代不是 agent**：文档 4.4 的"重 lint → 再喂"是**有限重试**（≤N 轮），agent 是"自己决定下一步"，两者不同

#### 关键：接口可插拔

```
fixer/router.ts         ← 路由: verible / llm（不关心实现是函数还是 agent）
  └─ llmFix.ts          ← v1: 单次调用（函数）
       └─ (Phase 3) llmAgent.ts  ← 真正的 agent，实现同一接口
```

`llmFix.ts` 与将来的 `llmAgent.ts` 实现**同一接口**：

```ts
interface LintFixer {
    fix(diagnostic: LintDiagnostic, ctx: FixContext): Promise<FixResult>;
}
```

router 只依赖接口，不绑定实现 → agent 化时**不动架构，只换实现**。

### 4.6 安全边界

- **必须 diff 预览**：LLM 结果先在 diff 视图展示，用户点「应用」才写盘
- **只改当前文件**：不做跨文件修改
- **可撤销**：应用前记录原内容，支持 undo
- **可选限制**：只允许改工程 `user/` 目录（配置开关）

---

## 5. 第四层：用户交互与工作流

### 5.1 💡 交互

错误行自动出现 VS Code 原生灯泡（CodeAction）：
- 点开 → 「使用 Verible 修复」「使用 AI 修复」两个选项
- Verible 修复 → 直接应用 TextEdit，diff 高亮
- AI 修复 → 打开 diff 预览 Webview → [应用] [取消]

### 5.2 命令

| 命令 | 作用 |
|------|------|
| `synthaid-ide.lintFix.vivado` | 手动触发 Vivado synth_design -rtl 深度检查 |
| `synthaid-ide.lintFix.ai-fix` | 对当前诊断用 LLM 修复 |
| `synthaid-ide.lintFix.apply` | 应用 diff 预览 |

> **命令前缀约定**：本项目新功能统一使用 **`synthaid-ide.*`** 前缀（与 SynthAid-IDE 产品名一致）。
> 现有代码保留 `digital-ide.*` 前缀（向后兼容），新功能不混用。后续可规划整体迁移。

### 5.3 配置项

```
synthaid-ide.lintFix.enable        默认 true    💡 开关
synthaid-ide.lintFix.vivadoOnSave  默认 false   存盘自动跑 Vivado(防抖)
synthaid-ide.lintFix.agentEnabled  默认 true    启用 LLM 修复(无 key 自动降级)
synthaid-ide.lintFix.maxIterations 默认 3       LLM 自动迭代轮数
synthaid-ide.lintFix.onlyUserDir   默认 false   LLM 只改 user/ 目录
synthaid-ide.lintFix.verible.path               verible 路径
synthaid-ide.lintFix.vivado.path                vivado 路径
synthaid-ide.lintFix.thinking      默认 false   lint 修复关闭 LLM 推理（提速 4~16 倍）
digital-ide.assistant.thinking     默认 true    AI 聊天启用模型推理（关闭可提速但更简略）
```

---

## 6. 模块结构

```
src/function/lint-fix/
├── index.ts               # 入口：注册 CodeActionProvider + 命令
├── diagnosticManager.ts   # ② 统一诊断管理器（合并/去重/标来源）
├── collector/
│   ├── verible.ts         # ① Verible 命令行检查 + 解析
│   └── vivado.ts          # ① Vivado synth_design -rtl + 解析
├── fixer/
│   ├── router.ts          # 修复路由器：verible / llm / none
│   ├── veribleFix.ts      # Verible 确定性修复（TextEdit）
│   └── llmFix.ts          # LLM 修复（调 assistant/llm.ts）
├── diffView.ts            # diff 预览 Webview
└── common.ts              # LintDiagnostic 类型、上下文构建
```

复用：`src/function/lsp/linter/manager.ts`（诊断收集）、`src/function/assistant/`（LLM 配置与调用）、`src/hdlFs`（文件操作）。

---

## 7. 实施路径

### MVP（先做，价值最大化）

1. **Verible 诊断**：命令行跑 verible-verilog-lint → DiagnosticCollection
2. **💡 + Verible 修复**：CodeActionProvider + verible auto-fix
3. **LLM 修复**：diff 预览 + 确认 + 应用 + 重新 lint 验证

### Phase 2

4. **Vivado 深度检查**：synth_design -rtl 手动触发
5. **LLM 自动迭代**：修复→重 lint→再修（≤N 轮）

### 参考项目

- `mshr-h.veriloghdl` — linter 聚合思路（看诊断合并，不抄架构）
- `xvlog-linter` — Vivado 命令行 lint 解析
- Verible 官方 — auto-fix 规则

---

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| 规则修复改错代码 | 只修 verible 确定性规则；diff 预览；可撤销 |
| LLM 乱改 | diff 确认 + 单文件 + 可选 user/ 限定 + 迭代轮数上限 |
| 两个 LSP 抢诊断 | **不引入第二个 LSP**，Verible 走命令行 |
| Vivado 综合卡界面 | 手动触发 / 防抖 + 后台，绝不在实时路径跑 |
| 与现有 LinterManager 冲突 | 在其上层扩展，不改造核心 |

---

## 9. 实现排障记录（2026-08）

> 针对实际用户文件（缺分号的语法错误）排查「SynthAid 无法修复」的根因，修复了两处致命 bug，
> 并将 LLM 修复提速 **4~16 倍**。以下均为真实 API 复现验证过的结论。

### 9.1 现象

`vga_pic.v` 第 49 行参数列表末尾缺分号（`GRAY = 16'hD69A,`），Verible 报出 **56 行起 12 条级联
`syntax error at token "always"/"else"`**。`syntax-error` 无确定性修复（`fixable='llm'`），只能走
LLM 修复，但每次点击都提示「SynthAid 修复失败」。

### 9.2 根因（两个致命 bug）

#### Bug 1：axios 响应体积计算 bug

`llmFix.ts` 的 `axios.post` 未设置 `maxContentLength`/`maxBodyLength`。axios 1.7.7 对 DeepSeek 的
chunked / 压缩响应体会抛：

```
maxContentLength size of -1 exceeded
```

每次调用在 HTTP 层直接失败，重试 3 次仍失败。

> 注意：`Infinity` 也不行（报 `size of Infinity exceeded`），**必须用大有限值**（200MB）。

#### Bug 2：`max_tokens` 对推理模型太小

`deepseek-v4-*` 是推理模型，`reasoning_content` 单次能吃掉 **5000+ token**。原 `max_tokens: 8192`
频繁触发 `finish_reason: length` + 空 `content`，被 `llmFix.ts` 的守卫判定为失败。

### 9.3 修复

| 文件 | 改动 |
|------|------|
| `fixer/llmFix.ts` | `max_tokens: 8192 → 16384`；axios 增加 `maxContentLength/maxBodyLength: 200MB` |
| `assistant/llm.ts` | `chatOnce` 同样增加 `maxContentLength/maxBodyLength`（AI 聊天有相同 bug）|

### 9.4 提速：关闭推理

实测 DeepSeek API（同一 prompt）：

| 模式 | 耗时 | 备注 |
|------|------|------|
| 默认（开推理） | **17.5s** | reasoning_content ~6583 字符 |
| `thinking: {type:'disabled'}` | **1.1~4.6s** | 无推理，**约 4~16 倍加速** |
| `reasoning_effort: 'low'` | 6.1s | 中间档 |
| `reasoning: false` | 8.2s | 该字段被忽略，无效 |

结论：lint 修复多为机械性改动，默认关闭推理。无推理模式下对 `vga_pic.v` 修复正确（补上分号），
重 lint 语法错误清零。

新增配置：

```
synthaid-ide.lintFix.thinking  默认 false    lint 修复关闭推理（默认，最快）
digital-ide.assistant.thinking 默认 true    AI 聊天保留推理（提升质量，可手动关闭提速）
```

> 权衡：lint 修复默认关闭推理——机械性修复（补分号、改命名等）无需推理，关闭后单次
> LLM 修复从 5~17s 降到 ~1.1s。推理模型（`deepseek-v4-*`）带 `reasoning_content`，
> 是主要耗时来源。复杂错误可在设置 `synthaid-ide.lintFix.thinking=true` 临时开启。

请求体写法：`body.thinking = { type: 'disabled' }`（仅对支持该字段的推理模型有效）。

### 9.5 进一步提速方向

**已实现（2026-08 二轮优化）：**

- **语法错误本地确定性修复优先**（`veribleFix.ts`）：
  - 新增 `parameter/localparam` 列表缺分号规则——扫描诊断行上方的参数列表，
    若以逗号结尾且无 `;` 则把**末尾逗号替换成分号**（必须在行内 `//` 注释之前，
    否则分号会被注释吞掉；先剥离注释再定位逗号位置）。
  - 路由器对语法错误先走本地规则，修不了才调 LLM（`router.ts`）。
  - 本地规则修复直接应用，跳过 diff 确认（`index.ts`）。
  - 实测：`vga_pic.v` 12 条级联语法错误，任意一条点 💡 都毫秒级补上第 49 行分号，
    全部消除。
- **重试间隔** 1s → 400ms（`llmFix.ts`），降低 DeepSeek 偶发连接 abort 带来的卡顿。
- **构建修复**：`vscode:prepublish` 原为 `webpack --mode production`，但 webpack 打的
  `out-js/` 是 8/7 的旧编译产物，导致**打包进 vsix 的运行时代码一直是旧版本**，所有
  改动都不生效。已改为 `tsc -p tsconfig.build.json && webpack --mode production`
  （新增 `tsconfig.build.json`，`outDir: out-js`），先重新编译再打包。
- **调试命令**：`synthaid-ide.lintFix.debug`（"Debug Lint Fix"）逐步骤输出到
  Output 面板 `SynthAid LintFix`，用于定位修复管线各环节。

**未实现：**

- **结果缓存**：按「文件 hash + 诊断码」缓存 LLM 修复结果，重复修复零延迟。
- **换非推理模型**：如 `deepseek-chat`，全链路提速。
- **Vivado 深度检查**（Phase 2）：`synth_design -rtl` 手动触发。
