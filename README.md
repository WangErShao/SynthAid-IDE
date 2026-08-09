# SynthAid-IDE

> 面向 FPGA / 数字逻辑开发的 VSCode 一体化插件 —— 基于 **Digital IDE 0.4.6** 创建，当前版本 **0.1.0**。

**SynthAid-IDE** 深度集成 Xilinx Vivado 工具链，提供从 HDL 编写、解析、仿真、综合实现，
到日志分析、AI 助手、波形/网表可视化的完整工作流。

本插件基于开源的 [Digital IDE 0.4.6](https://github.com/Digital-EDA/Digital-IDE) 二次开发并持续增强。

---

## 功能特性

### 1. 语言服务（Rust 解析器）
- 支持 **Verilog / VHDL / SystemVerilog**，由 Rust 编写的解析器与语言服务器提供：
  - 自动补全（模块例化、端口、参数）
  - 格式化（Verilog 多风格：kr/ansi/gnu；VHDL 可配置）
  - 语法诊断（linter 可选：iverilog / Vivado / ModelSim / Verilator / Verible）
- 语法高亮与工程图标覆盖 `.v / .sv / .vhd / .xdc / .tcl / .vvp / .vcd` 等

### 2. 综合 / 实现日志分析
- 综合（Synth）、实现（Impl）结束后**自动弹出分析报告**：
  - 运行状态（成功 / 失败）+ 错误 / 严重警告 / 警告统计（按 ID 聚合去重，显示次数）
  - **资源利用率**（从 `utilization_*.rpt` 解析：LUT / Reg / DSP / BRAM 等）
  - **时序信息**（WNS / TNS / WHS / THS、时钟汇总表、每时钟域 WNS/TNS、违例路径数）
  - 性能（运行耗时 / 峰值内存）
  - 消息详情支持点击 `文件:行号` 跳转
- 支持手动右键任意 `.log` 文件分析

### 3. AI 助手（SMART Options）
- **AI 聊天面板**：与 LLM 对话，支持任意 OpenAI 兼容 API（默认 DeepSeek）
- **RTL 上下文注入**：自动把离线解析的设计结构（工程 / 顶层 / 各模块端口 / 参数 / 例化）注入给 LLM，
  直接基于事实回答结构性问题
- **工具调用**：LLM 可在当前 Vivado 会话中执行 TCL 查询（`get_cells`、`report_utilization`、`report_timing_summary` 等）
- 支持历史对话、清空、设置面板

### 4. Vivado TCL 控制台
- 交互式 TCL 控制台，直连常驻 Vivado 进程
- 命令结果自动回显（`catch + puts` 包装），`↑/↓` 翻历史
- 运行中命令自动排队提示

### 5. 工程与工具链（侧边栏）
- 标准工程结构（`user/src`、`user/sim`、`user/data`）+ Xilinx 工程结构转换
- 侧边栏 **HARD / SOFT / SMART Options**：
  - **Launch** 启动 Vivado、**Synth**、**Impl**、**Build**、**BitStream**、**Program** 一键操作
  - **双击触发**，防止误触
  - **运行状态保护**：运行中禁止重复操作 + 进度提示 + 进程退出兜底

### 6. 可视化
- **HDL 文档**：当前文件模块 / 端口 / 参数 / 依赖文档，支持导出 **HTML / Markdown / PDF**，Wavedrom 注释渲染为波形图
- **VCD 波形查看器**：拖拽分组、多选、进制切换、模拟量渲染
- **网表渲染器**（支持 Yosys 脚本）、**FSM 状态机查看器**

### 7. 仿真与生成
- Icarus Verilog 仿真（单文件 / 工程）
- 模块**例化模板**自动生成（`Alt+I`）、**testbench** 自动生成（`Alt+T`）
- VHDL → Verilog 翻译

---

## 快速开始

1. 安装插件，打开工程文件夹（需包含 `.vscode/property.json`，可用命令 `SynthAid-IDE: 生成 property.json`）
2. HARD 树 → **Launch** 启动 Vivado → **Synth / Impl / Build** 构建，自动弹出日志分析
3. SMART Options → **AI Chat** 打开 AI 助手（先在设置 `digital-ide.assistant.*` 配置 API Key / 模型）

## 下载与发布

- 当前版本：**0.1.0**
- VSIX 发布到 [GitHub Releases](https://github.com/WangErShao/SynthAid-IDE/releases)
- 源码仓库：https://github.com/WangErShao/SynthAid-IDE

## 说明

- Rust 语言服务器（LSP）随插件内置，无需联网下载
- 基于 MIT 协议的 [Digital IDE 0.4.6](https://github.com/Digital-EDA/Digital-IDE) 创建，保留原作者版权声明
