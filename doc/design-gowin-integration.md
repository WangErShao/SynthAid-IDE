# Gowin FPGA 工具链集成到 SynthAid-IDE — 设计方案

> 目标：在 SynthAid-IDE 中支持国产高云（Gowin）FPGA 工具链，让用户像用 Vivado 一样，
> 在 VS Code 里完成 Gowin 工程的创建、综合、布局布线、位流生成。
>
> 基础：现有 `gowin_mcp` 项目已验证 Gowin Tcl 桥（gw_sh.exe）可用，本方案将其能力整合进 SynthAid-IDE。

---

## 0. 调研结论（已验证）

在集成前，对 Gowin 工具链做了实测验证：

| 项 | 结果 |
|----|------|
| `gw_sh.exe` 存在 | ✅ `C:/Gowin/Gowin_V1.9.9.03_Education_x64/IDE/bin/gw_sh.exe` |
| Tcl 交互会话 | ✅ 启动 + 哨兵通信正常 |
| `create_project` | ✅ `-device_version C` 创建成功 |
| `add_file` | ✅ 添加 Verilog / SDC |
| `run syn` | ✅ GowinSynthesis 综合完整执行（rc:0）|

**关键参数发现**：
- `create_project -device_version <版本>`：值是 **`C`**（速度等级），不是 `NA`/`gw1n9c-017`
- 命令集：`create_project` / `add_file` / `run syn|pnr|all`
- **没有 `open_project`**（此版本 Gowin 是"创建式"流程）
- 器件版本可从 `IDE/data/device/device_info.csv` 查（如 `gw1n9c-017` ↔ `GW1N-LV9LQ144C6/I5`）

**复用的现成资产**：`gowin_mcp/src/gowin_mcp/` 已实现：
- `gowin/session.py` — `GowinSession`（gw_sh 交互 + 哨兵协议）
- `gowin/tcl_utils.py` — 命令包装、输出清理、防注入
- `gowin/config.py` — gw_sh 路径探测
- `tools/flow_tools.py` — `run_flow` / `get_flow_progress`
- `doc/SUG1220` — Gowin Tcl 命令参考

---

## 1. 现状与架构差距

SynthAid-IDE 当前**深度绑定 Xilinx**：

```
src/manager/PL/index.ts:
  this.context.ope = new XilinxOperation()   ← 写死 Xilinx
  if (toolChain === Xilinx) { ... }           ← 只处理 Xilinx
  // 注释: 目前只支持 Xilinx
```

**改造点**：`PL/index.ts` 按 `toolChain` 分发到不同的操作类（XilinxOperation / GowinOperation）。

### 工具链枚举

`ToolChainType`（`src/global/enum.ts`）已有 `xilinx | intel | custom`，需加 **`gowin`**。

### 配置项

新增 Gowin 路径配置（对齐现有 `digital-ide.prj.xilinx.*` 风格）：
- `digital-ide.prj.gowin.install.path` — gw_sh.exe 路径

---

## 2. 整体架构

```
SynthAid-IDE
┌──────────────────────────────────────────────┐
│ PlManage (src/manager/PL/index.ts)            │
│   context.ope = 按 toolChain 分发             │
│   ├─ XilinxOperation（现有）                  │
│   └─ GowinOperation（新增）                   │
└──────────────┬───────────────────────────────┘
               │ Tcl 桥（哨兵协议，参考 gowin_mcp）
               ▼
        ┌──────────────┐
        │  gw_sh.exe   │  Gowin Tcl Shell
        │  (子进程)     │
        └──────────────┘
```

### 模块划分

```
src/manager/PL/gowin.ts        # GowinOperation：launch/synth/pnr/bitstream
src/manager/PL/gowinTcl.ts     # GowinSession 移植（gw_sh 交互 + 哨兵）
src/function/log-analysis/gowin.ts  # Gowin 日志解析（可选，Phase 2）
```

复用：`gowin_mcp` 的 `session.py` / `tcl_utils.py` 移植为 TS。

---

## 3. GowinOperation 设计

### 接口（对齐 XilinxOperation 的方法签名）

```ts
class GowinOperation {
    // 启动 gw_sh 会话，创建工程（若没有）
    async launch(context: PLContext): Promise<string | undefined>;

    // 综合: run syn
    async synth(context: PLContext): Promise<...>;

    // 布局布线: run pnr
    async pnr(context: PLContext): Promise<...>;

    // 位流（run all 已含）或单独生成
    async bitstream(context: PLContext): Promise<...>;

    // 查询流程进度（探测 impl/pnr 输出文件）
    async getFlowProgress(context: PLContext): Promise<...>;
}
```

### Tcl 流程（已验证的命令）

```tcl
# 创建工程（device_version 用速度等级，如 C）
create_project -name <prj> -dir <dir> -pn <part> -device_version C -force

# 添加源文件
add_file <src.v>
add_file <constraints.sdc>

# 综合
run syn

# 布局布线
run pnr

# 全流程（综合+布局布线+位流）
run all
```

### 关键差异（vs Xilinx）

| 维度 | Xilinx | Gowin |
|------|--------|-------|
| 进程 | `vivado -mode tcl` | `gw_sh.exe` |
| 工程 | 打开已有 `.xpr` | **创建式**（`create_project`）|
| 流程命令 | `launch_runs synth_1` | `run syn / pnr / all` |
| device_version | 无需 | 必须（速度等级 `C` 等）|
| 路径配置 | `digital-ide.prj.vivado.install.path` | `digital-ide.prj.gowin.install.path` |

---

## 4. 工程结构适配

Gowin 工程结构（和 Xilinx 的 `user/src`、`user/sim` 不同）：

```
工程目录/
├── src/          # 源文件（.v / .vhd / .sdc）
├── impl/         # 综合/布局布线输出
│   ├── gwsynthesis/   # 综合产物
│   └── pnr/           # 布局布线产物（.rpt / .bin）
└── *.gprj        # Gowin 工程文件
```

**需要适配**：`prj.ts` 的工程结构检测需识别 Gowin 工程（`*.gprj`），或为 Gowin 生成标准结构。

---

## 5. 集成步骤

### Phase 1（MVP，最小可用）

1. **`ToolChainType` 加 `gowin`**
2. **新增配置** `digital-ide.prj.gowin.install.path`
3. **移植 `GowinSession`**（gowin_mcp session.py → TS gowinTcl.ts）
4. **实现 `GowinOperation`**：launch / synth / pnr / bitstream
5. **`PL/index.ts` 按 toolChain 分发**操作类
6. **日志解析**：Gowin 综合日志 → 基本错误/警告提取

### Phase 2（增强）

7. **Gowin 工程结构检测**（`*.gprj`）
8. **program 设备**（Gowin Programmer）
9. **引脚/约束可视化**（复用 `IDE/data/device/*.json` 引脚布局数据）
10. **日志深度分析**（资源/时序报告）

---

## 6. 测试计划

1. **`create_project` 创建 Gowin 工程**（用 fifo_ex 示例）
2. **`add_file` + `run syn`** 综合（已验证）
3. **`run pnr`** 布局布线（待验证）
4. **`run all`** 全流程（待验证）
5. 在 SynthAid-IDE 里选 toolChain=gowin，走 HARD 树流程

---

## 7. 风险与对策

| 风险 | 对策 |
|------|------|
| Gowin 不同版本命令差异 | 参数化 device_version；参考 SUG1220 指南 |
| 无 `open_project`（创建式）| launch 时判断工程是否存在，不存在则 create |
| 日志格式与 Vivado 不同 | 单独写 Gowin 日志解析，不混用 |
| 个人开发工作量 | 复用 gowin_mcp 已验证逻辑，MVP 只做核心流程 |

---

## 8. 复用的现有资产清单

| 资产 | 位置 | 用途 |
|------|------|------|
| GowinSession | `gowin_mcp/gowin/session.py` | gw_sh 交互（移植 TS）|
| tcl_utils | `gowin_mcp/gowin/tcl_utils.py` | 命令包装/清理（移植 TS）|
| run_flow | `gowin_mcp/tools/flow_tools.py` | 流程命令（参考）|
| SUG1220 | `gowin_mcp/doc/` | Tcl 命令参考 |
| fifo_ex 示例 | `gowin_mcp/example/` | 测试用工程 |
| device_info.csv | `Gowin/IDE/data/device/` | 器件→版本映射 |
