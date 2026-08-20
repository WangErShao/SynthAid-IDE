# SynthAid-IDE 教程（一）：Vivado TCL 控制台

Vivado TCL 控制台是一个**交互式 TCL 命令窗口**，直连插件托管的常驻 Vivado 进程，让你像在 Vivado Tcl Console 里一样手工敲命令、看结果。

## 1. 打开方式

- 侧边栏 **HARD 树** → 双击 **TCL Console** 节点
- 或命令面板（`Ctrl+Shift+P`）输入 `SynthAid-IDE: 打开 Vivado TCL 控制台`

> 前提：先点击 HARD 树 → **Launch** 启动 Vivado，控制台才能连接。

## 2. 界面与基本操作

- **上方**：滚动输出区（实时回显 Vivado 输出）
- **下方**：输入框 + `发送` / `清空` 按钮
- 输入命令后按 **回车** 发送；**↑/↓** 翻历史命令；**清空** 清掉输出区

## 3. 命令结果自动回显

Vivado 通过管道运行时不会自动回显命令结果，插件会自动把每条命令包装为 `catch + puts`，所以：

- `get_runs` → 直接打印 `synth_1 impl_1`
- 命令出错 → 打印 `ERROR: ...`
- 无返回值命令（如 `set_property`）→ 正常执行，不打印多余内容

## 4. 常用命令示例

```tcl
# 查看当前工程信息
current_project
get_property PART [current_project]

# 查看运行
get_runs

# 查询设计
get_cells -hierarchical
get_nets -hierarchical
get_property top [current_fileset]

# 生成报告（务必加 -return_string 才能返回文本）
report_utilization -return_string
report_timing_summary -return_string
report_drc -return_string
report_clock_networks -return_string

# 简单输出
puts "hello"
```

## 5. 注意事项

1. **运行期间命令排队**：Vivado 正在综合/实现（`wait_on_run` 阻塞）时，控制台会提示"命令将排队"，要等 run 结束后才执行。
2. **单行命令**：输入框为单行，适合单条 TCL 命令；多行脚本/含不平衡花括号的命令可能报语法错误。
3. **与自动命令共用进程**：插件自动命令（Synth/Impl 等）和控制台的输出会混在同一个进程里，属正常。
