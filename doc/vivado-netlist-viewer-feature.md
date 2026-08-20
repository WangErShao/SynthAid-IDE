# Feature Plan: Vivado 真实网表视图（Netlist View）

> 目标：在 SynthAid-IDE 中显示 **Vivado 综合/实现后的真实网表**（cell/net/pin 层级图），
> 复用现有 `dide-netlist` 的 webview 渲染链路，替换其 Yosys 数据源为 Vivado TCL。

---

## 1. 背景与现状

现有 `dide-netlist` 的完整链路：

```
RTL/顶层模块
   → worker 线程跑 Yosys(wasm)（read_verilog → proc/synth → write_json）
   → <prjPath>/netlist/<module>.json          (Yosys JSON: modules/ports/cells/netnames)
   → NetlistRender webview（index.html + dide.skin）渲染 + save-svg/save-pdf/goto-definition
```

**局限**：
- 数据来自 **Yosys 独立综合**，与 Vivado 的实际综合/实现结果**不一致**（时序、器件原语、层次、优化都不一样）。
- 无法反映 `synth_design`/`place_design` 之后真实存在的单元、网表、约束。

**目标**：展示 Vivado 工程里**真实**的网表结构（基于综合后或实现后的 checkpoint）。

## 2. 方案设计

### 2.1 整体架构（复用渲染，换数据源）

```
Vivado 工程(已 launch)
   → TCL 遍历网表(get_cells/get_nets/get_pins)
   → <prjPath>/netlist_v/<module>.json        (自定义统一 schema 或 Yosys 兼容 schema)
   → 复用 NetlistRender webview 渲染 + 交互
```

改动点集中在**数据生成**层；渲染端尽量复用。

### 2.2 数据来源（两个候选，推荐 A）

**方案 A：`synth_design -rtl` + TCL 遍历（推荐）**
- 命令：`synth_design -rtl -name <top>` 生成**未映射**的 RTL 级网表（保持模块/实例层次，贴近 RTL）。
- 遍历：
  ```tcl
  get_cells -hierarchical -filter {PRIMITIVE_GROUP == "BLACK_BOX" || ...}   ;# 实例
  get_nets -hierarchical                                                    ;# 网线
  get_pins -of_objects [get_nets ...]                                       ;# 引脚
  ```
- 优点：层次清晰、贴近源码、数据量可控、`goto-definition` 容易对应到 RTL 实例。
- 缺点：是"综合前"视角，不含 LUT/FF 映射。

**方案 B：`synth_design`（完整）+ 遍历，或 `write_edif` 解析**
- 完整综合后 `get_cells -filter {PRIMITIVE_GROUP ne "LUT" ...}`，或 `write_edif <file>` 后解析 EDIF。
- 优点：真实映射后网表（含 LUT/FF/CARRY 等原语）。
- 缺点：单元数量巨大（万级），全量渲染慢；EDIF 解析工作量大；goto-definition 难以映射回 RTL 行。

> 建议：**首版做方案 A**（RTL 级实例网表，可读性最好）；后续可选 B 作为"实现后模式"。

### 2.3 JSON Schema（渲染端适配）

现有渲染器读 Yosys `write_json` 格式（`modules/cells/netnames/ports`）。**view/ 渲染产物不在仓库**
（是本地私有资产，`make_package.py` 从 `./resources/dide-netlist/view` 拷入，git 未跟踪），因此无法复用。

> 决策（2026-08 落地）：**新增自研极简渲染器**，不依赖私有 `view/`。

统一 schema（已实现）：
```jsonc
{
  "top": "netlist_demo",
  "ports": [ { "name": "clk_in", "dir": "IN", "width": 1 } ],
  "cells": [
    { "name": "u_clk", "type": "clk_wiz_0", "primitive": 0 },
    { "name": "u_sub1/u_sub2", "type": "nl_sub2", "primitive": 0 }
  ],
  "nets": [
    { "name": "clk_50m", "pins": [ { "pin": "u_clk/clk_out1", "cell": "u_clk", "dir": "OUT" } ], "ports": [] }
  ]
}
```

### 2.4 触发入口

- 命令：`digital-ide.netlist.vivado`（命令面板 + HARD 树/右键菜单）
- 传参：`<顶层模块名 or 当前选中模块>`、`模式(rtl/impl)`
- 复用现有 `digital-ide.netlist.treeview` 的右键入口，新增一个分支走 Vivado 数据源

### 2.5 goto-definition（风险点）

- Yosys 版：cell → RTL 实例，`api.ts gotoDefinition` 跳源码。
- Vivado 版：`get_cells` 的实例名可拼出 RTL 文件/行（`get_property` 无直接源码行），需：
  - RTL 级（方案 A）：用模块名 + 实例名在 `hdlParam` 里查实例定义位置（现有架构支持）。
  - 实现后（方案 B）：只能定位到 cell（无 RTL 行），交互退化为"高亮/导出"。

## 3. 实施步骤

| # | 内容 | 产出 |
|---|---|---|
| 1 | 探明现有渲染器 `view/` 的 JSON schema（从构建产物提取） | schema 确认文档 |
| 2 | `src/manager/PL/xilinx.ts`：新增 `exportNetlist(module, mode)` TCL 生成（synth_design -rtl + get_cells/get_nets/get_pins → 写 JSON） | TCL 生成函数 |
| 3 | 新增 `src/function/dide-netlist/vivado.ts`：把 TCL 返回的数据转成渲染 schema；管理进度/错误 | JSON 转换 + 入口 |
| 4 | `index.ts` 扩展 `NetlistRender` 或新增渲染入口，复用现有 view | 渲染接入 |
| 5 | 命令/菜单注册 + i18n | 入口 |
| 6 | 大设计性能：按层次惰性展开（默认只拉顶层一层） | 性能 |
| 7 | 验证 + 打包 | 文档 |

## 4. 关键技术点与风险

1. **渲染 schema 未知**：必须先取出 `view/` 确认，决定"转换 or 新增渲染页"。
2. **性能**：全量 `get_nets`/`get_cells` 在万级单元下很慢；首版限定**单模块一层 + 惰性展开**。
3. **goto-definition 降级**：实现后 netlist 难以映射回 RTL 行，交互需降级。
4. **依赖 Vivado 已 launch**：与 TclExecutor/`executeTcl` 复用，未 launch 时提示。
5. **`synth_design -rtl` 会改当前设计**：执行后需 `reset_target`/`close_design` 或提示用户，避免污染后续 build 流程。

## 5. 验证

1. `tsc --noEmit` + `eslint`（0 error）。
2. 打包 VSIX 覆盖安装。
3. 手动 E2E：
   - Launch Vivado 工程 → 对顶层执行 `digital-ide.netlist.vivado` → webview 出现层次网表图
   - 点 cell → goto 到 RTL 实例
   - 大模块只拉一层，展开子模块按需加载
4. 对比：与 Vivado 自带 Schematic 结果一致（抽样核对 cell/net）。

## 6. 已确认决策（落地）

- [x] 数据源：**方案 A（RTL 级，synth_design -rtl）**，在**独立 batch 进程**中执行（不污染主 Vivado 会话）
- [x] 渲染端：**自研极简树渲染器**（`dide-netlist/vivadoView.ts`），不依赖私有 `view/`；后续可平滑升级为图布局
- [x] 入口：命令 `digital-ide.netlist.vivado` + arch 树模块右键
- [x] IP 黑盒：扫描 hdlParam IP 模块自动生成 stub，`synth_design -rtl` 不再报 module not found
- [x] **图渲染**：自绘力导向布局 + SVG（`vivadoView.ts`），拖拽平移/滚轮缩放/点击 cell 高亮网线/过滤原语
  （已用 Edge 无头渲染验证：10 cells → 10 rect、30 line、20 text）
- [ ] 待办：按层惰性展开、goto-definition 跳源码、net 连线走端口锚点、真实图库（cytoscape）替换自绘布局
