# SynthAid-IDE 教程（零）：快速上手与安装

SynthAid-IDE 是面向 FPGA / 数字逻辑开发的 VSCode 插件，基于开源 Digital IDE 0.4.6 创建，当前版本 0.1.0。

## 1. 环境要求

- **VS Code** 1.85 或更高版本
- **Windows**（当前主要支持平台；Vivado 工具链需单独安装）
- 不需要额外安装语言服务器（Rust LSP 已内置，无需联网下载）

## 2. 安装插件

### 方式一：VSIX 安装（推荐）

1. 到 [GitHub Releases](https://github.com/WangErShao/SynthAid-IDE/releases) 下载 `synthaid-ide-0.1.0.vsix`
2. 安装：
   - **图形界面**：VS Code → 扩展面板 → 右上角 `...` → **从 VSIX 安装** → 选择文件
   - **命令行**：
     ```
     code --install-extension synthaid-ide-0.1.0.vsix
     ```

### 方式二：等待上架 VS Code 市场后搜索安装（后续开放）

> 安装后请**完全关闭并重开 VS Code**，确保扩展激活。

## 3. 一分钟快速上手

1. **打开工程文件夹**：File → Open Folder，选择你的 FPGA 工程目录
2. **生成配置**：命令面板（`Ctrl+Shift+P`）运行 `SynthAid-IDE: 生成 property.json`（生成 `.vscode/property.json`；已有则跳过）
3. **侧边栏**：左侧出现 **architecture / HARD / SOFT / SMART Options** 四个视图
4. **启动 Vivado**：HARD 树 → 双击 **Launch**
5. **综合 / 实现**：HARD 树 → 双击 **Build → Synth / Impl**（注意是**双击**触发）
6. **看结果**：综合/实现结束后自动弹出**日志分析**报告（资源、时序、错误/警告）
7. **更多功能**：
   - SMART Options → **AI Chat**：与 LLM 对话（需先配置 API Key）
   - HARD → **TCL Console**：手工敲 Vivado TCL 命令
   - 打开 `.v / .sv / .vhd` 文件：编辑器标题栏**文档图标**查看 HDL 文档

## 4. 常见问题

| 问题 | 处理 |
|---|---|
| 命令都点了没反应？ | HARD/SOFT 树是**双击**触发；单击只是选中 |
| 启动报 "library 路径无效"？ | 输出通道有警告即可忽略（不影响功能） |
| 启动一直卡在「初始化 1/90」？ | 多为 Rust LSP 卡住。新版已加超时自动跳过（约 5s 后继续加载）；若仍卡，重启窗口，或查看开发者控制台 `[hdlParser]` 日志确认卡在哪个文件 |
| AI Chat 提示未配置 Key？ | 设置里配 `digital-ide.assistant.apiKey` |
| TCL 控制台无输出？ | 先 HARD → **Launch** 启动 Vivado |
| 想卸载？ | 扩展面板 → 右键 SynthAid-IDE → 卸载 |

## 5. 相关链接

- 下载：https://github.com/WangErShao/SynthAid-IDE/releases
- 源码与反馈：https://github.com/WangErShao/SynthAid-IDE
- 教程：TCL 控制台 / AI 助手（见同目录其他教程文档）
