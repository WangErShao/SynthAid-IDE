# SynthAid-IDE 0.1.1

基于 Digital IDE 0.4.6 二次开发，支持 Verilog/VHDL/SystemVerilog 的补全/格式化/语法诊断，AI 助手、Vivado TCL 控制台、HDL 文档、VCD 波形查看、FSM 状态机、Icarus 仿真。

## 0.1.1 新增

### ✨ 新功能
- **Lint 自动修复**：Verible 命令行诊断（存盘触发），错误处 💡 提供「Verible 修复 / AI 修复」，diff 预览确认后应用
- **AI 助手（聊天面板）**：RTL 上下文注入 + `run_vivado_tcl` 工具调用，可在当前 Vivado 会话执行查询
- **Vivado TCL 控制台**：交互式命令窗口，命令结果自动回显，↑/↓ 翻历史
- **日志分析**：综合/实现后自动弹出资源/时序/警告统计报告，支持点击跳转
- **IP 目录**：常用 IP 创建面板（参数化配置）
- **Vivado 网表查看器**：vivado_nl.tcl 采集 + Webview 渲染

### ⚙️ 配置
- 新增 `synthaid-ide.*` 前缀配置项（lint 修复相关）

## 安装

从 VSIX 安装：扩展面板 → 从 VSIX 安装 → 选择 `synthaid-ide-0.1.1.vsix`

## 说明
- 基于 MIT 协议的 Digital IDE 0.4.6 创建
- Rust 语言服务器随插件内置，无需联网下载
