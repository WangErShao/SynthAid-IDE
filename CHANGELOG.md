# Change Log

All notable changes to **SynthAid-IDE** will be documented in this file.

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。版本按时间倒序排列。

## [0.1.2-1] - 2026-08-26

### ✨ 新增
- **Gowin 启动修复**：`gw_sh` 改为交互式启动 + stdin `source`，修复 `create_project` 无效导致 `PJ0001: No available design files` 报错
- **Gowin 器件短名解析修复**：`GW1N-LV9LQ144C6/I5 → GW1N-9C`、`GW1NSR-… → GW1NSR-4C`（programmer_cli 烧录所需）
- **工具链切换全面化**：`synth/impl/build/simulate/program/gui` 等入口统一校验 toolChain，Xilinx ↔ Gowin 切换即时生效
- **文件监控接入 Gowin**：工程内 HDL 文件增删自动同步到 Gowin 会话（`add_file` / `rm_file`）
- **JSON 编辑辅助**（`json-assist`）：光标点进 `property.json` 空引号自动弹出补全；PL/PS 提供示例工程名
- **property-schema 文档化**：所有配置项 hover 说明 + 下拉枚举说明（作用 + 示例）
- **property-schema 缓存合并修复**：以扩展 schema 为基准合并用户自定义 device，避免旧缓存顶掉新选项

### 🐛 修复
- Gowin schema 缓存被旧版本覆盖导致 `toolChain: gowin` 下拉缺失
- Surfer 波形后端：`digital-ide.waveviewer.program` / `surferPath` 配置

### 📦 其他
- 版本号 0.1.2 → 0.1.2-1
- 文档：README 重写（详细安装 + 基本使用）、CHANGELOG 维护、波形查看器截图

## [0.1.2] - 2026-08-24

### ✨ 新增
- **Gowin（高云）工具链 Phase 1**：`ToolChainType` 支持 `gowin`，`GowinOperation`（launch / synth / impl / build），`PL/index.ts` 按 toolChain 分发操作类
- **Gowin（高云）工具链 Phase 2**：综合/实现日志深度解析（资源利用率来自 `*_syn_rsc.xml`）；Gowin Programmer 烧录 `.fs` 位流
- property-schema 增加 6 款 Gowin 器件枚举

### 🐛 修复
- **Simulate CLI 系列**：回显仿真 log、batch 模式、兼容 Vivado 2018.3（`-scripts_only` 回退）、VCD 自动打开波形
- **VCD 波形查看器**：webview 读取、自动显示波形、修复资源树双重嵌套
- **clk_wiz IP**：输入频率参数错误（`REF_CLK_FREQ` → `PRIM_IN_FREQ`）
- **工具链切换**：切换后操作类不重建导致 Gowin 工程误启动 Vivado

## [0.1.1] - 2026-08-20

### ✨ 新增
- **Lint 自动修复**：Verible 命令行诊断（存盘触发），错误处 💡 提供「Verible 修复 / AI 修复」，diff 预览确认后应用
- **AI 助手（聊天面板）**：RTL 上下文注入 + `run_vivado_tcl` 工具调用，可在当前 Vivado 会话执行查询
- **Vivado TCL 控制台**：交互式命令窗口，命令结果自动回显，↑/↓ 翻历史
- **日志分析**：综合/实现后自动弹出资源/时序/警告统计报告，支持点击跳转
- **IP 目录**：常用 IP 创建面板（参数化配置）
- **Vivado 网表查看器**：vivado_nl.tcl 采集 + Webview 渲染

### ⚙️ 配置
- 新增 `synthaid-ide.*` 前缀配置项（lint 修复相关）

## [0.1.0] - 2026-08-09

### ✨ 首发版本
- 基于 [Digital IDE 0.4.6](https://github.com/Digital-EDA/Digital-IDE) 二次开发
- Verilog / VHDL / SystemVerilog 语言服务（Rust LSP 内置，自动补全 / 格式化 / 诊断）
- HDL 文档、VCD 波形查看、FSM 状态机、网表渲染
- Icarus 仿真、模块例化 / testbench 自动生成、VHDL → Verilog 翻译
- Vivado 工程流程（Launch / Synth / Impl / Build / Program）

---

发布说明：见 [GitHub Releases](https://github.com/WangErShao/SynthAid-IDE/releases) 与各 `release_notes_*.md` 文件。
