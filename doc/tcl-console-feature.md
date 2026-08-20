# Feature: Vivado TCL Console（交互式 TCL 控制台）

> 目标：提供一个交互式 TCL 控制台，直接连接插件托管的常驻 Vivado TCL 进程，用于手工执行
> `read_hdl` / `report_utilization` / `report_timing_summary` 等调试命令，并实时回显输出。

---

## 1. 背景与需求

- 用户想给 Vivado 进程一个交互式 TCL 入口，方便调试时手工敲命令、看输出。
- 最初设想放在 OUTPUT / TERMINAL 底部区域，但：
  - OUTPUT 通道只能追加输出，不能输入。
  - TERMINAL 终端只能跑独立进程，把 Vivado 改成终端进程会破坏现有自动化架构
    （哨兵检测、stdout 解析、进度反馈都依赖 `spawn` + pipe 流）。
- 因此选用 **Webview 交互控制台**（扩展生态标准做法，与本扩展波形/网表查看器一致）。

## 2. 已确认决策

| 项 | 决策 |
|---|---|
| 实现形态 | Webview 交互控制台 |
| 默认位置 | 编辑器区右侧（`ViewColumn.Two`），与日志分析面板一致 |
| 可拖动 | 是（VSCode webview 标签可自由拖动到任意编辑器组） |
| 单例复用 | 是——再点 TCL Console 只 `reveal()` 聚焦，不重复开新标签 |
| 历史命令 | 支持 `↑` / `↓` 翻历史；通过 `vscode.setState` 在会话内持久化 |
| 入口 | HARD 树新增顶层节点 **TCL Console**（Refresh 与 Build 之间）；命令 `digital-ide.tool.tcl-console` 亦自动出现在命令面板 |
| 复用进程 | 直接使用现有常驻 Vivado 进程：回车写 `stdin`，stdout/stderr 实时回显到控制台 |

## 3. 实现步骤

### 步骤 1：`src/manager/PL/xilinx.ts` —— 输出转发钩子

给 `PLContext` 增加 `onOutput?: (text: string) => void`，在 `launch()` 的 stdout / stderr 处理器中调用：

```ts
vivadoProcess.stdout.on('data', async data => {
    const text = data.toString();
    context.onOutput?.(text);          // 新增：转发给 TCL 控制台
    ...
});

vivadoProcess.stderr.on('data', async data => {
    context.onOutput?.(data.toString()); // 新增
    ...
});
```

### 步骤 2：新增 `src/function/tcl-console/index.ts` —— Webview 控制台面板

`TclConsolePanel` 类，单例由 `PlManage` 持有：

- `reveal()`：无面板则 `createWebviewPanel('digital-ide.tcl-console', t('tcl-console.title'), ViewColumn.Two, {enableScripts, retainContextWhenHidden})`；有则 `reveal()` 聚焦。
- 前端：滚动输出区 + 输入框 + 发送/清空按钮。
  - 回车 → `postMessage({command:'send', text})`；扩展侧写 `stdin` 并回显 `> cmd`。
  - `↑`/`↓` 翻历史（`vscode.setState` 持久化）。
  - 收到 `{command:'append', text}` → 追加到输出区。
- 扩展侧消息：`send` → 回调 `onCommand(text)`；面板销毁 → 回调 `onDispose()`。

### 步骤 3：`src/manager/PL/index.ts` —— 接线

```ts
private tclConsole?: TclConsolePanel;

constructor() {
    ...
    // 构造后注册：stdout/stderr → 控制台
    this.context.onOutput = text => this.tclConsole?.appendOutput(text);
}

public openTclConsole() {
    if (!this.tclConsole) {
        this.tclConsole = new TclConsolePanel();
        this.tclConsole.onCommand = text => this.sendTclCommand(text);
        this.tclConsole.onDispose = () => { this.tclConsole = undefined; };
    }
    this.tclConsole.reveal();
}

private sendTclCommand(text: string) {
    const process = this.context.process;
    if (process === undefined) {
        this.tclConsole?.appendOutput(t('tcl-console.not-launched') + '\n');
        return;
    }
    if (this.busyRun.size > 0) {
        this.tclConsole?.appendOutput(t('tcl-console.busy-hint') + '\n');
    }
    this.tclConsole?.appendOutput('> ' + text + '\n');
    process.stdin.write(wrapCommand(text) + '\n');
}
```

### 步骤 4：`src/manager/PL/index.ts` —— TCL 命令自动包装

**问题**：Vivado 通过管道 stdin（非终端）运行时，TCL shell **不会自动回显命令结果**，
只输出显式 `puts` 的内容（扩展自己的哨兵都用 `puts`，正是因为这个）。
所以 `get_runs` 执行了但结果不回显 → 控制台空。

**方案**：发送命令前自动包装成 `catch + puts`，显式打印结果或错误：

```tcl
set __dide_rc [catch { <用户命令> } __dide_res]
if {$__dide_rc} { puts "ERROR: $__dide_res" } elseif {$__dide_res ne ""} { puts $__dide_res }
unset __dide_rc __dide_res
```

```ts
function wrapCommand(text: string): string {
    return [
        `set __dide_rc [catch { ${text} } __dide_res]`,
        `if {$__dide_rc} { puts "ERROR: $__dide_res" } elseif {$__dide_res ne ""} { puts $__dide_res }`,
        `unset __dide_rc __dide_res`
    ].join('\n');
}
```

效果：
- `get_runs` → 打印 `synth_1 impl_1`。
- 命令出错 → 打印 `ERROR: ...`。
- 无返回值命令（如 `set_property`）→ 正常执行，不打印多余内容。

**限制**：包装只适合**单行命令**（控制台输入框为单行）；多行脚本与不平衡花括号的命令不适用
（此时会看到 Vivado 的语法错误回显）。

### 步骤 5：`src/manager/index.ts` —— 注册命令

```ts
vscode.commands.registerCommand('digital-ide.tool.tcl-console', () => plManage.openTclConsole());
```

### 步骤 6：`src/function/treeView/command.ts` —— HARD 树节点

在 `HardwareTreeProvider` 的 config 中，`Refresh` 与 `Build` 之间插入：

```ts
'TCL Console': {
    cmd: 'digital-ide.tool.tcl-console',
    icon: 'cmd',
    tip: 'Open an interactive Vivado TCL console'
},
```

### 步骤 7：`package.json` —— 命令声明

```json
{
    "command": "digital-ide.tool.tcl-console",
    "title": "%digital-ide.tool.tcl-console.title%",
    "category": "Digital-IDE"
}
```

### 步骤 8：i18n

- `package.nls.*.json`：`digital-ide.tool.tcl-console.title`（5 个文件）。
- `l10n/bundle.l10n.{en,zh-cn,zh-tw,de}.json`：`tcl-console.title` / `.placeholder` / `.send` / `.clear` / `.not-launched` / `.busy-hint`。

## 4. 注意事项

1. **运行期间命令排队**：`wait_on_run` 阻塞时 Vivado 解释器忙，命令会排队到 run 结束后才执行，
   控制台会提示"运行进行中，命令将排队"（不改阻塞模型）。
2. **输出与自动命令混流**：控制台与插件自动命令共用同一进程，stdout 会混合显示（属正常）。
3. **单例**：控制台面板关闭后 `tclConsole` 置空，下次点击重新创建。
4. **命令自动包装**：Vivado 管道 stdin 模式不回显结果，发送前包装为 `catch + puts`（步骤 4）。
   仅适合单行命令；多行脚本/不平衡花括号不适用。

## 5. 测试与验证

1. `npm run compile` + `npx eslint src --ext ts`（0 error）。
2. 手动 E2E：
   - HARD → **TCL Console** → 右侧弹出控制台。
   - 未 Launch 时输入命令 → 提示"Vivado 未启动"。
   - Launch 后输入 `puts "hello"` → 显示 hello；输入 `get_runs` → **显示 `synth_1 impl_1`**（包装生效）。
   - 输入一个出错命令（如 `get_runs -badopt`）→ 显示 `ERROR: ...`。
   - `↑`/`↓` 翻历史；关闭面板后再点 → 复用单例、历史仍在。
   - 再点 TCL Console → 只聚焦，不重复开新标签。
