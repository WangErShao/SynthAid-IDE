# SynthAid-IDE 0.1.2-1

基于 Digital IDE 0.4.6 二次开发，支持 Verilog/VHDL/SystemVerilog 的补全/格式化/语法诊断，AI 助手、Vivado/Gowin TCL 控制台、HDL 文档、VCD 波形查看、FSM 状态机、Icarus 仿真。

## 0.1.2 新增

### 🚀 Gowin（高云）FPGA 工具链支持
- **Phase 1**：`toolChain` 支持 `gowin`，HARD 树全流程（Launch / Synth / Impl / Build / Program）
- **Phase 2**：综合/实现日志深度解析（资源利用率 `*_syn_rsc.xml`）、Gowin Programmer 烧录 `.fs` 位流
- **修复**：gw_sh 交互式启动（解决 `PJ0001` 无设计文件）、器件短名解析（`GW1N-9C` / `GW1NSR-4C`）、工具链切换全面化、文件监控接入 Gowin

### 🧪 仿真与波形
- **Simulate CLI**：回显仿真 log、batch 模式、兼容 Vivado 2018.3（`-scripts_only` 回退）
- **VCD 波形查看器修复**：webview 读取、自动显示波形、资源树双重嵌套修复
- **Surfer 波形后端**：`digital-ide.waveviewer.program` 可选内置查看器或外部 Surfer

### 🛠 配置与编辑体验
- `property.json` 全量 hover 说明 + 下拉枚举说明（作用 + 示例，新手友好）
- 光标点进空引号自动弹出补全（`toolChain` / `device` / `core` / `PL` 等），PL/PS 提供示例工程名
- schema 缓存改为"基准+合并"，修复旧缓存顶掉新选项（如 `gowin`）

### 🐛 其他修复
- clk_wiz 输入频率参数（`REF_CLK_FREQ` → `PRIM_IN_FREQ`）
- 工具链切换后操作类不重建（Gowin 工程误启动 Vivado）

## 安装

- 最新版下载：https://github.com/WangErShao/SynthAid-IDE/releases/latest/download/synthaid-ide-0.1.2-1.vsix
- 扩展面板 → 从 VSIX 安装 → 选择 `synthaid-ide-0.1.2-1.vsix`

## 说明

- 基于 MIT 协议的 Digital IDE 0.4.6 创建
- Rust 语言服务器随插件内置，无需联网下载
- 详细功能变更见 [CHANGELOG.md](CHANGELOG.md)
