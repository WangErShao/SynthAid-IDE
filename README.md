# SynthAid-IDE

> 面向 FPGA / 数字逻辑开发的 VSCode 一体化插件 —— 支持 **Xilinx Vivado** 与 **Gowin（高云）** 双工具链，
> 基于开源的 [Digital IDE 0.4.6](https://github.com/Digital-EDA/Digital-IDE) 二次开发，当前版本 **0.1.2-1**。

**SynthAid-IDE** 提供从 HDL 编写、解析、仿真、综合实现，到日志分析、AI 助手、波形/网表可视化的完整工作流，
覆盖 Verilog / VHDL / SystemVerilog，无论你是新手还是老手，都能在 VS Code 里一站式完成 FPGA 开发。

---

## ✨ 功能特性

### 1. 语言服务（Rust 解析器）
- 支持 **Verilog / VHDL / SystemVerilog**，由 Rust 编写的解析器与语言服务器提供：
  - 自动补全（模块例化、端口、参数）
  - 格式化（Verilog 多风格：kr/ansi/gnu；VHDL 可配置）
  - 语法诊断（linter 可选：iverilog / Vivado / ModelSim / Verilator / Verible）
- 语法高亮与工程图标覆盖 `.v / .sv / .vhd / .xdc / .tcl / .vvp / .vcd` 等

### 2. FPGA 工具链：Xilinx Vivado
- **HARD 树一键流程**：Launch 启动 Vivado → Synth / Impl / Build → BitStream → Program 烧录
- **Vivado TCL 控制台**：交互式命令窗口，命令结果自动回显，↑/↓ 翻历史
- **网表查看器**：vivado_nl.tcl 采集 + Webview 渲染
- **IP 目录**：常用 IP 创建面板（参数化配置），Xilinx IP / BD 工程支持

### 3. FPGA 工具链：Gowin（高云）
- **全流程支持**：`toolChain: "gowin"` 下，HARD 树 Launch（`gw_sh` 会话）→ 综合（`run syn`）→ 实现（`run pnr`）→ Build（`run all`）
- **日志深度解析**：Gowin 综合/实现日志，资源利用率从 `*_syn_rsc.xml` 解析
- **烧录**：自动识别器件短名（如 `GW1N-9C`），调用 Gowin Programmer 烧录 `.fs` 位流
- 工程内文件增删自动同步到 Gowin 会话

### 4. 综合 / 实现日志分析
- 综合 / 实现结束后**自动弹出分析报告**：
  - 运行状态 + 错误 / 严重警告 / 警告统计（按 ID 聚合去重）
  - **资源利用率**（LUT / Reg / DSP / BRAM 等）
  - **时序信息**（WNS / TNS / WHS / THS、时钟汇总、违例路径）
  - 性能（运行耗时 / 峰值内存）
  - 消息详情支持点击 `文件:行号` 跳转
- 支持手动右键任意 `.log` 文件分析

### 5. AI 助手（SMART Options）
- **AI 聊天面板**：与 LLM 对话，支持任意 OpenAI 兼容 API（默认 DeepSeek）
- **RTL 上下文注入**：自动把离线解析的设计结构注入给 LLM，基于事实回答问题
- **工具调用**：LLM 可在当前 Vivado 会话执行 TCL 查询（`get_cells`、`report_utilization` 等）

### 6. 可视化
- **HDL 文档**：当前文件模块 / 端口 / 参数 / 依赖文档，导出 **HTML / Markdown / PDF**，Wavedrom 注释渲染波形
- **VCD 波形查看器**：拖拽分组、多选、进制切换；可选 **内置查看器** 或 **外部 Surfer** 后端
- **网表渲染器**（支持 Yosys 脚本）、**FSM 状态机查看器**

### 7. 仿真与生成
- Icarus Verilog 仿真（单文件 / 工程）；Vivado Simulate CLI / GUI
- 模块**例化模板**自动生成（`Alt+I`）、**testbench** 自动生成（`Alt+T`）
- VHDL → Verilog 翻译

### 8. Lint 自动修复
- 存盘自动跑 **Verible** lint，出错行 💡 一键修复
- **本地确定性规则**（毫秒级）+ **LLM 兜底**（复杂错误交给 DeepSeek）
- `Debug Lint Fix` 命令可逐环节诊断修复管线

### 9. 配置编辑辅助
- `property.json` 全量配置项 **hover 说明 + 下拉枚举说明**（作用 + 示例，新手友好）
- 光标点进空引号**自动弹出补全**（toolChain / device / core / PL 等），无需快捷键

---

## 📥 安装教程

### 环境要求
- **VS Code** 1.85 或更高版本
- **Windows**（当前主要支持平台）
- 按需安装工具链：Xilinx **Vivado**（如 2018.3+）或 **Gowin EDA**（含 `gw_sh.exe`）
- 无需额外安装语言服务器（Rust LSP 已内置，免联网下载）

### 方式一：VSIX 安装（推荐）

**下载最新版：**

> 🔗 https://github.com/WangErShao/SynthAid-IDE/releases/latest/download/synthaid-ide-0.1.2-1.vsix

所有历史版本见 [GitHub Releases](https://github.com/WangErShao/SynthAid-IDE/releases)。

**图形界面安装：**
1. 下载上面的 `.vsix` 文件
2. VS Code → 左侧**扩展**面板 → 右上角 `...` → **从 VSIX 安装** → 选择下载的文件
3. 安装完成后**完全关闭并重开 VS Code**，确保扩展激活

**命令行安装：**
```
code --install-extension synthaid-ide-0.1.2-1.vsix
```

### 方式二：源码构建安装
```bash
git clone https://github.com/WangErShao/SynthAid-IDE.git
cd SynthAid-IDE
npm install
npx vsce package        # 生成 synthaid-ide-0.1.2-1.vsix
```
再用方式一的步骤安装生成的 VSIX。

### 安装后验证
- 打开任意工程文件夹后，侧边栏应出现 **architecture / HARD / SOFT / SMART Options** 视图
- 若未激活，确认工程根目录存在 `.vscode/property.json`（可用命令 `SynthAid-IDE: 生成 property.json`）

---

## 🚀 基本使用

### 1. 创建 / 打开工程
1. **File → Open Folder** 打开你的 FPGA 工程目录
2. 若没有 `.vscode/property.json`：命令面板（`Ctrl+Shift+P`）运行 **`SynthAid-IDE: 生成 property.json`**
3. 编辑 `property.json`（配置项都有 hover 说明与下拉枚举，光标点进空引号会自动弹出备选）：

```jsonc
{
    "toolChain": "gowin",          // 可选 xilinx / gowin
    "prjName": { "PL": "led" },    // FPGA 工程名
    "soc": { "core": "none" },     // 纯 FPGA 用 none
    "device": "GW1N-LV9LQ144C6/I5" // 器件型号
}
```

### 2. 侧边栏结构
| 视图 | 作用 |
|------|------|
| **architecture** | 工程文件树（src / sim / data）与模块层级 |
| **HARD Options** | FPGA 流程：Launch / Simulate / Refresh / Build / Program / GUI / Exit |
| **SOFT Options** | SOC 软件流程（Launch / Build / Download） |
| **SMART Options** | AI 助手、IP 目录、TCL 控制台、工具 |

> ⚠️ **注意**：HARD / SOFT 树上的操作是**双击**触发，单击只是选中。

### 3. Vivado 流程
1. 设置 Vivado 路径：配置 `digital-ide.prj.vivado.install.path`（如 `C:/Xilinx/Vivado/2018.3/bin`）
2. HARD 树 → 双击 **Launch** 启动 Vivado
3. 双击 **Build → Synth / Impl** 或 **Build** 一键全流程
4. 双击 **BitStream** 生成位流，双击 **Program** 烧录
5. 综合/实现结束自动弹出**日志分析报告**

### 4. Gowin 流程
1. 设置 Gowin 路径：配置 `digital-ide.prj.gowin.install.path`（指向 `gw_sh.exe` 所在目录，如 `C:/Gowin/Gowin_V1.9.9.03_Education_x64/IDE/bin`）
2. `property.json` 中 `toolChain` 设为 `gowin`，`device` 选 Gowin 器件
3. HARD 树 → 双击 **Launch**（自动创建工程并加入源文件）
4. 双击 **Synth / Impl / Build** 综合、布局布线、生成位流
5. 双击 **Program** 调用 Gowin Programmer 烧录

### 5. 仿真
- **Icarus**：编辑器中右键 `.v` 文件 / 工程 → 运行 Icarus 仿真
- **Vivado**：HARD → **Simulate → CLI / GUI**

### 6. 日志分析
- 综合 / 实现后自动弹出报告；也可右键任意 `.log` 文件 → **分析日志**

### 7. AI 助手
1. 配置 `digital-ide.assistant.apiKey`（与模型 `digital-ide.assistant.model`）
2. SMART Options → **AI Chat** 打开面板即可对话

### 8. 波形查看
- 双击 `.vcd` / `.view` 文件用内置查看器打开
- 如需外部工具，设置 `digital-ide.waveviewer.program` 为 `surfer` 并配置 `surferPath`

---

## ⚙️ 常用配置

| 配置项 | 说明 |
|--------|------|
| `digital-ide.prj.vivado.install.path` | Vivado bin 目录 |
| `digital-ide.prj.gowin.install.path` | Gowin EDA `gw_sh.exe` 所在目录 |
| `digital-ide.prj.iverilog.install.path` | Icarus Verilog 路径 |
| `digital-ide.assistant.apiKey` / `model` | AI 助手 API Key 与模型（默认 DeepSeek） |
| `digital-ide.waveviewer.program` | 波形后端：`builtin`（内置）/ `surfer`（外部） |
| `digital-ide.waveviewer.surferPath` | Surfer 可执行文件路径 |
| `digital-ide.function.lsp.linter.*` | 各语言诊断器选择（iverilog/vivado/modelsim/verilator/verible） |
| `digital-ide.function.simulate.*` | 仿真相关（gtkwave 路径、是否终端运行等） |
| `synthaid-ide.lintFix.*` | Lint 自动修复开关与行为 |

---

## 📖 教程与文档

- [快速上手与安装](doc/tutorial-quickstart.md)
- [Vivado TCL 控制台使用](doc/tutorial-tcl-console.md)
- [AI 助手聊天使用](doc/tutorial-ai-chat.md)
- [Lint 自动修复](doc/tutorial-lint-fix.md)
- [功能变更记录（CHANGELOG）](CHANGELOG.md)
- [版本发布说明 0.1.2-1](release_notes_0.1.2-1.md)

---

## 🔧 开发 / 构建

```bash
npm install          # 安装依赖
npm run compile      # tsc 编译 src → out（开发调试用）
npm run watch        # 增量编译
npm run lint         # eslint
npx vsce package     # 打包 vsix（自动执行 vscode:prepublish）
```

> **构建注意**：`vscode:prepublish` 为 `tsc -p tsconfig.build.json && webpack --mode production`
> ——先编译 `src → out-js`，再 webpack 打成单文件 `out/extension.js`（运行时入口，含打包的
> node_modules）。**改源码后必须重新打包 vsix 才生效**，仅 `npm run compile` 不会更新运行时。

---

## ⬇️ 下载与版本历史

- **最新版本**：**0.1.2-1**
- **最新版下载**：[synthaid-ide-0.1.2-1.vsix](https://github.com/WangErShao/SynthAid-IDE/releases/latest/download/synthaid-ide-0.1.2-1.vsix)
- **全部版本**：[GitHub Releases](https://github.com/WangErShao/SynthAid-IDE/releases)
- **功能变更**：[CHANGELOG.md](CHANGELOG.md)（按版本维护）
- **源码仓库**：https://github.com/WangErShao/SynthAid-IDE

---

## 📄 说明与许可

- Rust 语言服务器（LSP）随插件内置，无需联网下载
- 基于 MIT 协议的 [Digital IDE 0.4.6](https://github.com/Digital-EDA/Digital-IDE) 二次开发，保留原作者版权声明
