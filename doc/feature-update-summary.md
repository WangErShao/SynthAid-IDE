# SynthAid-IDE 状态对比与功能更新总结

> 生成时间：2026-08-26
> 对比基准：`synthaid/main`（GitHub: WangErShao/SynthAid-IDE）与 `origin/main`（GitHub: Digital-EDA/Digital-IDE）

---

## 1. 当前项目状态

| 项 | 值 |
|----|----|
| 分支 | `main` |
| 本地 HEAD | `f125b3e` 🐛 fix: 工具链切换后 ope 不重建 — Gowin 工程误启动 Vivado |
| 已提交版本（HEAD） | 0.1.2 |
| 工作区版本（package.json） | 0.1.2-1（未提交） |
| 工作区改动 | 12 个文件已修改，1 个新模块（`src/function/json-assist/`）+ 9 张 doc 截图未跟踪 |

---

## 2. 与 GitHub 的对比

- **`synthaid/main`（WangErShao/SynthAid-IDE）**：与本地 HEAD **完全一致**（`f125b3e`）。说明近 14 个提交已全部推送到该仓库。
- **`origin/main`（Digital-EDA/Digital-IDE）**：本地领先 **14 个提交**（尚未推送）。
- **工作区**：还有一批**未提交**的改动（Gowin 相关修复 + JSON 编辑辅助 + schema 文档化），尚未推送任何远端。

即：已提交功能已同步 GitHub，未提交的本次改动需 commit + push 后才能上线。

---

## 3. 已提交的新功能（相对 origin/main 的 14 个提交）

### 3.1 AI 助手与诊断（0.1.1，`d52720b`）
- AI 聊天面板（ChatPanel），支持在 Vivado 会话中执行 TCL 工具调用（`run_vivado_tcl`）
- 综合/实现日志自动分析 + 报告面板（`function/log-analysis`）
- 交互式 TCL 控制台（`function/tcl-console`）
- IP 目录（IP Catalog）：常用 IP 创建面板、工程文件同步
- Lint 自动修复管线（`function/lint-fix`）：verible/Vivado 诊断 + LLM 自动修复（`synthaid-ide.lintFix.*` 配置）

### 3.2 Gowin（高云）FPGA 工具链支持（`5839157` / `3f2ab2a` / `edab353`）
- **Phase 1**：`ToolChainType` 新增 `gowin`；`GowinOperation`（launch / synth / impl / build）；`PL/index.ts` 按 toolChain 分发操作类
- **Phase 2**：Gowin 日志深度解析（`GowinSynthAnalyzer`，资源利用率来自 `*_syn_rsc.xml`）；`programmer_cli` 烧录 `.fs` 位流
- `property-schema.json` 增加 6 款 Gowin 器件枚举

### 3.3 仿真与波形（`087872c` → `2637ccc`）
- Simulate CLI 回显仿真 log、batch 模式、Vivado 2018.3 兼容（`-scripts_only` 回退）、VCD 自动打开波形
- VCD 波形查看器修复：webview 读取、自动显示波形、修复资源双重嵌套根因
- clk_wiz IP 输入频率参数修复（`d15d572`：`REF_CLK_FREQ` → `PRIM_IN_FREQ`）

### 3.4 工具链切换修复（`f125b3e`）
- PlManage 单例下 Xilinx ↔ Gowin 工程切换时重建操作类（`ensureToolchain`），修复 Gowin 工程误启动 Vivado

---

## 4. 工作区未提交的新功能/修复（本次改动）

### 4.1 Gowin 启动与烧录修复
- **启动方式修正**（`src/manager/PL/gowin.ts`）：`gw_sh.exe -tcl <file>` 实测无效（脚本不执行），改为交互式启动 + stdin `source <launch.tcl>`，修复 `PJ0001: No available design files` 报错
- **器件短名修正**（`extractDeviceShortName`）：`GW1N-LV9LQ144C6/I5 → GW1N-9C`，`GW1NSR-... → GW1NSR-4C`（补齐速度等级后缀，修复 GW1NSR 系列无法解析）
- **工具链切换全面化**（`src/manager/PL/index.ts`）：`synth/impl/build/simulate/program/gui/refresh/addFiles/delFiles` 等入口全部前置 `ensureToolchain()`，保证 Gowin 器件下综合走 `run syn`、实现走 `run pnr`、烧录用 `programmer_cli`
- **文件监控接入 Gowin**（`monitor/propery.ts`、`monitor/ignore.ts`）：HDL 文件增删同步转发到 Gowin 会话（`add_file` / `rm_file`）

### 4.2 property-schema 缓存合并修复（`src/manager/prj.ts`）
- 原逻辑：用户缓存 schema 整体覆盖扩展 schema → 新版选项（如 `toolChain: gowin`）被旧缓存顶掉
- 现逻辑：以扩展 schema 为基准，仅合并缓存中用户自定义的 `device`，并同步补齐 `markdownEnumDescriptions`（避免长度不匹配导致说明失效）

### 4.3 JSON 编辑辅助（新增模块 `src/function/json-assist/`）
- 光标点进 `property.json` 空字符串值（`"toolChain": ""` 等）时**自动弹出补全**，无需输入字符或快捷键（绕开 Ctrl+Space 被输入法占用问题）
- 支持字段：`toolChain` / `device` / `core` / `bd` / `os` / `app` / `PL` / `PS`
- PL/PS 提供示例工程名补全（led / counter / fifo_ex / top / traffic_light / uart_rx / pwm_led）

### 4.4 property-schema 全面文档化
- 所有枚举字段补充 `markdownEnumDescriptions`：下拉补全项显示"作用 + JSON 示例"
- 所有配置项补充 `markdownDescription`：鼠标悬停显示解释 + 示例（与 PL 一致）
- 覆盖：toolChain、prjName/PL/PS、arch 及其子项、library/state/common/custom、IP_REPO、soc/core/bd/os/app、enableShowLog、device

### 4.5 波形查看器：外部 Surfer 后端（`src/function/dide-viewer/index.ts`）
- 新增配置 `digital-ide.waveviewer.program`（builtin / surfer）与 `digital-ide.waveviewer.surferPath`
- `program=surfer` 时用外部 Surfer 程序打开波形；未安装时提示安装与配置方法

### 4.6 版本号与文档
- `package.json` 版本 0.1.2 → **0.1.2-1**
- `doc/` 新增 9 张波形查看器截图（wave_*.png / csp_test.png / full_sim.png）

---

## 5. 文件改动清单

### 已修改（12 个）
| 文件 | 改动 |
|------|------|
| `package.json` | 版本 0.1.2-1；waveviewer program/surferPath 配置 |
| `package.nls.json` / `package.nls.zh-cn.json` | 新增 waveviewer 配置文案 |
| `project/property-schema.json` | Gowin 器件枚举、全部配置项 hover 说明与下拉枚举说明 |
| `src/extension.ts` | 注册 `activateJsonAssist` |
| `src/function/dide-viewer/index.ts` | Surfer 外部波形查看后端 |
| `src/global/propertySchema.ts` | `Enum<T>` 增加可选 `markdownEnumDescriptions` |
| `src/manager/PL/gowin.ts` | 交互式 launch + device 短名修复 |
| `src/manager/PL/index.ts` | 全部工具入口前置 `ensureToolchain` |
| `src/manager/prj.ts` | schema 缓存"基准+合并"逻辑 |
| `src/monitor/ignore.ts` / `src/monitor/propery.ts` | Gowin 文件增删转发 |

### 新增
- `src/function/json-assist/index.ts` — JSON 编辑自动补全辅助
- `doc/*.png`（9 张波形截图）

---

## 6. 建议后续操作

1. 校验并 **commit** 工作区改动（描述本次 Gowin 修复 + JSON 辅助 + schema 文档化）
2. **push** 到 `synthaid`（WangErShao/SynthAid-IDE）；如需同步到 Digital-EDA 仓库再 push `origin`
3. 可选：将 14 个已提交 commit 也推送 `origin/main`
