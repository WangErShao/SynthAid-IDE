# Feature: IP Catalog（IP 创建与树视图）

> 目标：在 SynthAid-IDE 内可视化创建 Xilinx 常用 IP，并把生成的 IP 文件同步到
> 工程中、在独立树视图中查看 IP 与其文件/输出文件。

---

## 1. 背景与需求

- 用户希望不打开 Vivado GUI，通过 TCL 在插件托管的常驻 Vivado 进程中创建常用 IP
  （clk_wiz / fifo_generator / blk_mem_gen / ila / vio ...）。
- 创建后 IP 必须能立刻在工程与树视图中可见，而不是靠「Exit Vivado + Reload」才同步。
- 现状：architecture 树的 IP 模块节点只显示「例化位置」，不显示 IP 自身的文件
  （.xci / .v / .veo / .xdc）与生成物，且无例化的 IP 节点不可展开。
- 决策：**新增独立 IP Catalog 树视图**（不污染 architecture 树），并复用既有
  `PlManage.executeTcl()` → `TclExecutor` 帧化执行链路。

## 2. 已确认决策

| 项 | 决策 |
|---|---|
| 创建入口 | Webview 表单（`IpCatalogPanel`，命令 `digital-ide.ip-catalog.show`） |
| IP 参数 | 人工维护 schema（`src/function/ip-catalog/schema.ts`），webview 按 schema 动态渲染表单 |
| TCL 执行 | 复用 `PlManage.executeTcl()`（`TclExecutor` 帧化：结果写临时文件 + `__DIDE_DONE__` 标记） |
| 创建位置 | 当前已 launch 的 Vivado 工程（`create_ip` 自动注册进工程） |
| 同步策略 | 创建成功后把 IP 文件夹 **复制** 到树扫描位置 `resolve(hardware.src,'../ip')`，并刷新树 |
| 树视图 | 独立 `digital-ide-treeView-ip`，分两部分：可通过 SynthAid 创建的 IP / 当前项目中例化的 IP |
| 输出文件 | 只列 IP 根目录直接文件，**不展开子目录**（doc/、synth/） |
| 图标 | 复用现有 svg，不新增资产 |

## 3. 已实现（Webview 创建 + 自动同步）

### 3.1 参数 schema（schema.ts）

- `IpSchema` / `IpParam`：类型 `enum | number | text | bool`，含默认值与选项。
- `buildIpCreateTcl()` 生成命令序列：
  ```tcl
  create_ip -name <id> -vendor <vendor> -library <library> -version <version> -module_name <module>
  set_property -dict [list CONFIG.<p1> "v1" CONFIG.<p2> "v2" ...] [get_ips <module>]
  generate_target all [get_files <module>.xci]
  get_files -quiet <module>.xci        ;# 结果回传 xci 绝对路径
  ```
- 自动逻辑：启用某路输出时同步置 `CLKOUT<n>_USED true`。

### 3.2 关键踩坑（Vivado 2018.3 实测）

1. **`create_ip -name` 是 VLNV 的 IP 名**（如 `clk_wiz`），实例名才是 `-module_name`。
2. **`get_ipdefs` 位置参数匹配不可靠**（`clk*` 都匹配不到），必须用
   `get_ipdefs -filter {NAME =~ "*xxx*"}` 或 `VLNV =~ "*xxx*"`。
3. **clk_wiz 没有 `CLKIN1_FREQ`**，输入频率参数是 **`REF_CLK_FREQ`**（可设置），
   输入抖动才是 `CLKIN1_JITTER_PS`。
4. 启用 `CLKOUT<n>_REQUESTED_OUT_FREQ` 需同时置 `CLKOUT<n>_USED true`。
5. 中文 Windows 下 Vivado 按 GBK 读 `.tcl`，UTF-8 中文会乱码 → 用 `source -encoding utf-8`。

### 3.3 自动同步（syncIpToProjectTree）

- 树扫描位置 = `resolve(hardware.src, '../ip')`，与 `getXilinxIPs`（prj.ts:176）一致。
- 而 `create_ip` 生成的 IP 在 Vivado 工程工作目录
  `prj/xilinx/<plName>.srcs/sources_1/ip/<module>/`，二者仅在 Vivado 关闭时由
  `onVivadoClose`（xilinx.ts:307）move 同步。
- 因此创建成功后：`cpdir(源IP文件夹, 树ip根, true)` → `hdlParam.initializeIPsPath()` 重扫
  （`Map.set` 按路径去重，重复解析安全）→ `refreshArchTree()` / `refreshIpCatalogTree()`。
- 用「复制」而非「移动」，避免破坏运行中工程的 .xci 引用。

## 4. 计划：IP Catalog 树视图

### 4.1 树结构

```
IP Catalog                 ← digital-ide-treeView-ip
├─ 可通过 SynthAid 创建       ← 基于 ipSchemas，按 category 分组
│  └─ 时钟与复位
│     └─ clk_wiz (Clocking Wizard)   ← 点击打开创建 webview
└─ 当前项目中例化的 IP         ← 扫描 resolve(hardware.src,'../ip')
   ├─ clk_wiz_0
   │  ├─ 定义文件
   │  │  └─ clk_wiz_0.xci
   │  └─ 输出文件              ← 仅根目录直接文件，不展开子目录
   │     ├─ clk_wiz_0.v
   │     ├─ clk_wiz_0.veo
   │     ├─ clk_wiz_0.xdc
   │     └─ ...
   └─ ...
```

### 4.2 改动清单

| # | 文件 | 内容 |
|---|------|------|
| 1 | 新增 `src/function/treeView/ipCatalog.ts` | `IpCatalogTreeProvider`；节点 `kind`：available-* / project-ip / file-group / file；`getChildren` 惰性读盘；文件图标 `getLanguageId`→verilog/vhdl 否则 file；可用 IP 节点 → 打开创建 webview；文件节点 → `openFile`；含 `refresh()` |
| 2 | `src/function/treeView/index.ts` | 导出 `ipCatalogTreeProvider` + `refreshIpCatalogTree()` |
| 3 | `src/function/index.ts` | `registerTreeViewDataProvider` 注册 `digital-ide-treeView-ip` |
| 4 | `package.json` | `views.TreeView` 追加 `{ id:"digital-ide-treeView-ip", name:"IP Catalog", icon:"images/svg/view.svg" }` |
| 5 | `src/function/ip-catalog/index.ts` | `syncIpToProjectTree` 成功后调用 `refreshIpCatalogTree()` |
| 6 | `l10n/bundle.l10n.en.json` + zh-cn | 「可通过 SynthAid 创建」「当前项目中例化的 IP」「定义文件」「输出文件」 |

### 4.3 设计细节

- 项目 IP 判定复用 `isValidXilinxIP`（目录内含同名 `.xci`）。
- 输出文件 `readdirSync(ipFolder)` 只取 `isFile()`，跳过子目录。
- 组/目录节点无 command（纯展开）；文件节点打开真实文件。
- 节点 contextValue = `IP`，避免出现 arch 树的 setSrcTop/仿真等菜单。
- 不改动 architecture 树 / ModuleTreeProvider。

## 5. i18n

- `package.nls.*.json`：`digital-ide.ip-catalog.show.title`。
- `l10n/bundle.l10n.{en,zh-cn}.json`：`ip-catalog.title/.create/.create-ok/.create-fail/.err-no-module-name/.synced/.sync-fail`，
  以及树节点文案。

## 6. 测试与验证

1. `tsc --noEmit` + `eslint src --ext ts`（0 error）。
2. 打包 VSIX 覆盖安装（`vsce package` + `code --install-extension --force`）。
3. 手动 E2E：
   - 命令面板 → **IP Catalog** → 打开 clk_wiz 表单。
   - 填输入频率 `REF_CLK_FREQ` / 输出频率 → 创建 → 底部提示 `IP 已同步到 <路径>`。
   - 新 **IP Catalog 树**：可用 IP 分组可见；项目 IP 展开可见 `.xci` 与生成文件。
   - 无需 Exit Vivado / Reload 即可看到新 IP。
