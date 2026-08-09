# Feature: PL 运行状态跟踪 / 进度反馈 / 防重入

> 目标：解决点击 HARD → Build → **Synth / Impl** 后，Vivado 启动与出报告之间有 5–10 秒"界面无反应"窗口，导致用户重复点击、产生重复综合/实现操作的问题。

---

## 1. 背景与问题

用户反馈：

> 点击 Build 下的 Synth 或 Impl，有 5 到 10 秒时间在等待 Vivado 工具启动然后打印报告，这一段时界面没有任何反应，这种情况容易导致用户点击多次，导致不必要的重复操作，浪费时间。

### 现象
1. 点击 **Synth / Impl** 后，5–10 秒内界面零反馈（Vivado 正在初始化工程/run，尚未输出）。
2. 用户不确定点击是否生效，重复点击 → **重复综合/实现**。
3. 未先点击 **HARD → Launch** 时，Synth / Build 会**静默无效**（`process` 为 `undefined`），用户只会反复点。

## 2. 根因分析

### 2.1 命令是"即发即弃"，无运行状态
`XilinxOperation.synth() / impl() / build()`（`src/manager/PL/xilinx.ts`）只是：

```ts
context.process?.stdin.write(script + '\n');
```

没有任何"进行中"状态，也没有返回值，界面无法得知运行已开始。

### 2.2 无重入保护
TCL 脚本排入 Vivado 的 stdin 队列顺序执行。第一次 `wait_on_run synth_1` 尚未结束，第二份
`reset_run; launch_runs; wait_on_run` 会紧随其后执行 → **重复跑一次**。

### 2.3 `process` 为空时静默无操作
`synth()` / `build()` 未检查 `context.process`，`process?.stdin.write(...)` 直接跳过，无任何提示。

## 3. 方案设计

核心思想：**运行状态机 + 立即反馈 + 防重入**，放在 `PlManage`（已持有 `onRunComplete` 回调）。

### 3.1 运行状态跟踪（`PlManage`）
- 新增 `busyRun: Set<'synth' | 'impl'>`。
- 各命令期望的 run 集合：
  - `synth()` → `['synth']`
  - `impl()`  → `['impl']`
  - `build()` → `['synth', 'impl']`
- 发起时：
  - `busyRun` 非空 → 弹警告「正在运行中，请等待完成」并 **return（拒绝）**。
  - 否则：登记期望 run → 启动进度提示。
- 哨兵 `DIDE_RUN_DONE:*` 到达时：
  - 从 `busyRun` 删除对应 run → 调用 `analyzeRunLog(run)`。
  - `busyRun` 清空 → **结束进度提示**。

### 3.2 立即反馈
用 `vscode.window.withProgress`（通知栏）包住整个 run：

```ts
vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: label, cancellable: false },
    () => new Promise(resolve => { this._runProgressResolve = resolve; })
);
```

通知栏出现 spinner 进度条，直到 run 完成才关闭；不阻塞其他交互。

### 3.3 兜底安全网
- 监听 Vivado 进程 `close / exit / disconnect`，进程退出时强制清空 `busyRun`（防止 TCL 中途报错、哨兵永远不来导致状态卡死）。
- `synth() / build()` 在 `process === undefined` 时提示「请先点击 HARD → Launch 启动 Vivado」。

## 4. 详细实现步骤

### 步骤 1：`src/manager/PL/index.ts`（核心改动）

在 `PlManage` 类中新增字段：

```ts
// 当前正在进行的 run，空集合表示空闲
private busyRun: Set<'synth' | 'impl'> = new Set();
// withProgress 的完成回调，用于提前关闭进度条
private _runProgressResolve?: () => void;
```

重写 `synth / impl / build`：

```ts
public synth() {
    if (!this.tryStartRun(['synth'])) { return; }
    this.context.ope.synth(this.context);
}

public impl() {
    if (this.context.process === undefined) { return null; }
    if (!this.tryStartRun(['impl'])) { return null; }
    this.context.ope.impl(this.context);
}

public build() {
    if (!this.tryStartRun(['synth', 'impl'])) { return; }
    this.context.ope.build(this.context);
}
```

新增辅助方法：

```ts
private tryStartRun(runs: ('synth' | 'impl')[]): boolean {
    if (this.busyRun.size > 0) {
        vscode.window.showWarningMessage(t('warn.pl.already-running'));
        return false;
    }
    if (this.context.process === undefined) {
        vscode.window.showWarningMessage(t('warn.pl.launch-first'));
        return false;
    }

    this.busyRun = new Set(runs);

    this.context.onRunComplete = run => {
        this.busyRun.delete(run);
        this.analyzeRunLog(run);
        if (this.busyRun.size === 0) {
            this.finishRunProgress();
        }
    };

    const label = runs.includes('impl')
        ? t('info.pl.progress.build')
        : (runs[0] === 'impl' ? t('info.pl.progress.impl') : t('info.pl.progress.synth'));

    this.startRunProgress(label);
    return true;
}

private startRunProgress(label: string) {
    vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: label, cancellable: false },
        () => new Promise<void>(resolve => { this._runProgressResolve = resolve; })
    );
}

private finishRunProgress() {
    this._runProgressResolve?.();
    this._runProgressResolve = undefined;
}
```

保留现有 `analyzeRunLog(run)` 不变（上一次功能已实现）。

### 步骤 2：`src/manager/PL/xilinx.ts`（兜底清理）

在 `launch()` 中挂进程退出兜底。现有代码已有：

```ts
vivadoProcess.on('close',    () => onVivadoClose());
vivadoProcess.on('exit',     () => onVivadoClose());
vivadoProcess.on('disconnect', () => onVivadoClose());
```

扩展 `onVivadoClose`（或在其内追加）——让 Vivado 进程退出时通知上层清空 busy 状态。

方案：给 `PLContext` 增加可选回调 `onProcessExit?: () => void`，在进程退出时调用：

```ts
interface PLContext {
    // ...
    onRunComplete?: (run: 'synth' | 'impl') => void;
    onProcessExit?: () => void;   // 新增：进程退出兜底
}
```

```ts
const onVivadoClose = debounce(() => {
    context.onProcessExit?.();
    context.process = undefined;   // 进程已退出，清空引用（否则重复 Launch 被误判为"已在运行"）
    _this.onVivadoClose();
}, 100);
```

### 步骤 3：`src/manager/PL/index.ts` 接线兜底

在 `PlManage` 中注册 `onProcessExit`，强制清空 busy：

```ts
// 可放在 tryStartRun 内，或 PlManage 构造后统一注册一次：
this.context.onProcessExit = () => {
    this.busyRun.clear();
    this.finishRunProgress();
};
```

注意：`context` 在构造函数中创建，建议把 `onProcessExit` 的注册放在构造函数里（进程每次 launch 会复用同一 context，回调始终有效）。

### 步骤 4：i18n 文案

新增 key（`l10n/bundle.l10n.{en,zh-cn,zh-tw,de}.json`，ja 为旧编码暂不动）：

| key | en | zh-cn |
|---|---|---|
| `info.pl.progress.synth` | `Synthesis in progress...` | `正在综合...` |
| `info.pl.progress.impl` | `Implementation in progress...` | `正在实现...` |
| `info.pl.progress.build` | `Building in progress...` | `正在构建...` |
| `warn.pl.already-running` | `A run is already in progress, please wait.` | `已有运行在进行中，请等待完成。` |
| `warn.pl.launch-first` | `Please click HARD → Launch to start Vivado first.` | `请先点击 HARD → Launch 启动 Vivado。` |

### 步骤 5：移除无意义的一次性弹窗

`XilinxOperation.synth/impl/build`（`src/manager/PL/xilinx.ts`）开头的
`vscode.window.showInformationMessage("Xilinx: Synth/Impl/Build", ...)` 属于无意义弹窗：
信息量为零、不能防重复点击、还需手动点掉。已删除，统一由进度通知（步骤 1 的 `withProgress`）
替代。

### 步骤 6：Launch 状态保护

`launch()` 本身**没有** `showInformationMessage` 弹窗（不同于 synth/impl/build），无需删除；
但存在"重复点 Launch 会重复 `spawn` 多个 Vivado 进程"的问题，需加状态保护。

- `PlManage.launch()`：若 `context.process !== undefined`（Vivado 已在运行）→ 弹警告 `warn.pl.already-launched` 并拒绝。
- `XilinxOperation.launch()` 的 `onVivadoClose`：进程退出时 `context.process = undefined`，否则 Exit 后无法再次 Launch。

```ts
public launch() {
    if (this.context.process !== undefined) {
        vscode.window.showWarningMessage(t('warn.pl.already-launched'));
        return;
    }
    this.context.ope.launch(this.context);
}
```

新增 i18n：`warn.pl.already-launched`（`Vivado is already running, no need to launch again.` / `Vivado 已在运行中，无需重复启动。`）。

> 注：`XilinxOperation.gui()` 内部仅当 `process === undefined` 时才调用 `launch`，因此不受此保护影响；运行中需要"重新同步工程源"应使用 **Refresh** 而非再次 Launch。

### 步骤 7：测试与验证

1. `npm run compile` + `npx eslint src --ext ts`（0 error）。
2. 手动 E2E：
   - 未 Launch 时点 **Synth** → 应弹「请先点击 HARD → Launch」。
   - Launch 后点 **Synth** → 通知栏出现「正在综合...」spinner，运行期间再点 Synth / Impl / Build → 弹「已有运行在进行中」并拒绝。
   - 综合结束 → 弹日志分析面板，进度条关闭。
   - **Build**：synth 与 impl 两个阶段进度条都不提前关闭，两次日志分析都触发。
   - 运行中途把 Vivado 进程杀掉 → busy 状态自动清空，可再次发起新 run。

## 5. 已确认决策

以下问题已与用户确认，按此实现：

1. **进度提示位置**：通知栏 spinner（`vscode.ProgressLocation.Notification`），非阻塞。
2. **运行中重复点击行为**：弹警告「已有运行在进行中」并拒绝。
3. **范围**：仅 **Synth / Impl / Build**。BitStream 暂不纳入（无完成哨兵，需额外加哨兵才能结束进度条，留待后续）。
4. **未 Launch 时 Synth/Build 静默无效**：一并修复——弹提示「请先点击 HARD → Launch 启动 Vivado」。
5. **无意义一次性弹窗**：删除 synth/impl/build 开头的 `showInformationMessage("Xilinx: ...")`（见步骤 5）。
6. **Launch 状态保护**：已确认——Launch 无 info 弹窗无需删；重复 Launch 时拒绝并提示；进程退出时清空 `process` 引用（见步骤 6）。
7. **树节点状态特效 / 状态栏提示**：已确认**暂不实现**。理由：
   - VSCode 树节点（`TreeItem`）无原生"按下/运行中/完成"状态，实现需刷新整棵树，会重置折叠/选中态，体验反而变差。
   - "正在运行"已由通知栏进度条覆盖；"运行完成"已由自动弹出的日志分析面板承担。
   - 若后续需要，可只加状态栏 `setStatusBarMessage` 提示（低成本），不做树节点图标特效。

## 6. 相关现状速查

- `src/manager/PL/index.ts`：`PlManage` 类，持有 `context: PLContext`，现有 `synth/impl/build` + `analyzeRunLog(run)`。
- `src/manager/PL/xilinx.ts`：
  - `PLContext` 接口（`process`、`ope`、`onRunComplete`）。
  - `synth/impl/build` 发送 TCL；`launch()` 的 stdout 检测 `DIDE_RUN_DONE:synth|impl` 哨兵并触发 `onRunComplete`；`close/exit/disconnect` 已有 `onVivadoClose`。
  - `getRunLogPath(run)` 返回 `<prj>/xilinx/<name>.runs/{synth_1|impl_1}/runme.log`。
- 哨兵与日志分析链路（上一功能）已就绪，本 feature 只在其上叠加状态机。
