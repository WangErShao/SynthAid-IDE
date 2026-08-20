# SynthAid-IDE 教程：Lint 自动修复

> 对 Verilog / SystemVerilog 提供「诊断 + 一键修复」：错误处点灯泡 💡，即可用
> 确定性规则或 LLM 自动修复，无需手动逐行改。

## 1. 功能概述

```
诊断来源                   修复路由
─────────                  ─────────
Verible(存盘触发)  ──►  💡  ──►  ① 本地确定性规则（毫秒级）
                                    │  修不了
                                    ▼
                              ② LLM（可选，默认关闭推理 ≈1s）
```

- **本地确定性规则**：`parameter/localparam` 列表缺分号、`end` 缺分号、行尾空格等常见问题，
  毫秒级完成，不调外部工具。
- **Verible autofix**：风格类规则（对齐 / 空白 / 命名）由 verible 原生修复。
- **LLM 兜底**：复杂 / 非常规错误交给 LLM（OpenAI 兼容 API，默认 DeepSeek）。

## 2. 环境要求

- **verible**：诊断与 autofix 依赖 `verible-verilog-lint`。
  在设置中配置路径（目录或 exe）：
  ```
  digital-ide.prj.verible.install.path   ← 目录，如 D:\tools\verible\bin
  # 或精确到可执行文件：
  synthaid-ide.lintFix.verible.path      ← D:\tools\verible\bin\verible-verilog-lint.exe
  ```
- **LLM 修复**（可选）：配置 `digital-ide.assistant.apiKey` / `model`。

## 3. 使用流程

1. **打开 / 保存** Verilog 文件（存盘自动触发 verible lint）
2. 出错行会显示波浪线，点 **💡 灯泡**：
   - **使用 Verible 修复**：风格类规则，直接应用
   - **使用 SynthAid 修复**：本地规则优先；若走 LLM 则弹出 diff 预览，点「应用」写入
3. 修复后自动重新 lint 验证，错误即时更新

### 调试命令

若修复异常，用命令面板运行 **`Debug Lint Fix`**（`Ctrl+Shift+P` → 输入 `Debug Lint Fix`）：
对当前文件完整跑一遍「lint → 修复 → 应用 → 重 lint」，每步弹窗报告结果，
详细日志见 **View → Output → SynthAid LintFix** 面板。

## 4. 配置项

| 配置 | 默认 | 说明 |
|------|------|------|
| `synthaid-ide.lintFix.enable` | true | 总开关（💡 + 存盘 lint）|
| `synthaid-ide.lintFix.agentEnabled` | true | 允许 LLM 修复（无 key 自动降级为纯规则）|
| `synthaid-ide.lintFix.thinking` | **false** | LLM 修复是否开推理。默认关闭 ≈1s；开启 5~17s 但对复杂错误更稳 |
| `synthaid-ide.lintFix.verible.path` | "" | verible-verilog-lint 可执行文件路径 |
| `synthaid-ide.lintFix.vivadoOnSave` | false | 存盘自动跑 Vivado（未实现，预留）|
| `digital-ide.assistant.thinking` | true | AI 聊天是否开推理（聊天默认开以保质量）|

> **速度权衡**：lint 修复默认关闭 LLM 推理（`thinking=false`）。推理模型
> （`deepseek-v4-*`）的 `reasoning_content` 是主要耗时来源——关闭后从 5~17s 降到 ~1s。
> 需要更强的复杂错误修复能力时再临时开启。

## 5. 常见问题

### 为什么点了修复没反应 / 命令 not found？
- 确认已重装最新 vsix 并 **Reload Window**（扩展运行时是打包产物，源码改动不会热更新）
- 运行 `Debug Lint Fix` 查看 Output 面板 `SynthAid LintFix` 日志定位环节

### 本地规则会不会改错？
不会——规则很保守：只处理明确的「参数列表缺分号（把末尾逗号替换为 `;`，在行内
`//` 注释之前）、`end` 缺分号、行尾空格」，未命中就返回，交给 LLM / 不做修改。
修复前可先 Ctrl+Z 撤销。

### 分号修到注释里去了？
早期版本有该 bug，现已在行内 `//` 注释**之前**替换逗号为分号：
```
GRAY = 16'hD69A,   //灰色   →   GRAY = 16'hD69A;   //灰色
```

### LLM 修复偶发失败？
DeepSeek 偶发连接重置会触发自动重试（3 次，间隔 400ms）。仍失败时：
- 确认 `digital-ide.assistant.apiKey` 已配置
- 网络波动时稍后再试
- 输出面板查看 `[synthaid-lint]` 日志中的 `fix failed: no result`
