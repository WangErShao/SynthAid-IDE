/**
 * PL: program logic
 * Hardware Programming
 */
import * as vscode from 'vscode';
import * as fs from 'fs';

import { PLContext, XilinxOperation } from './xilinx';
import { GowinOperation } from './gowin';
import { BaseManage } from '../common';
import { opeParam } from '../../global';
import { ToolChainType } from '../../global/enum';
import { hdlFile, hdlPath } from '../../hdlFs';
import { moduleTreeProvider, ModuleDataItem } from '../../function/treeView/tree';
import { HdlFileProjectType } from '../../hdlParser/common';
import { PropertySchema } from '../../global/propertySchema';
import { HardwareOutput, MainOutput, ReportType } from '../../global/outputChannel';
import { AbsPath } from '../../global';
import { t } from '../../i18n';
import { analyzeSynthLogAndShow } from '../../function/log-analysis';
import { TclConsolePanel } from '../../function/tcl-console';
import { ChatPanel } from '../../function/assistant/panel';
import { IpCatalogPanel } from '../../function/ip-catalog';
import { ipSchemas } from '../../function/ip-catalog/schema';
import { TclExecutor } from '../../function/assistant/tclExecutor';

class PlManage extends BaseManage {
    context: PLContext;
    // 当前正在进行的运行（synth / impl），空集合表示空闲
    private busyRun: Set<'synth' | 'impl'> = new Set();
    // withProgress 的完成回调，用于提前关闭运行中的进度条
    private _runProgressResolve?: () => void;
    // 交互式 TCL 控制台（单例）
    private tclConsole?: TclConsolePanel;
    // AI 助手聊天面板（单例）
    private assistant?: ChatPanel;
    // 常用 IP 创建面板（每个 IP 一个独立标签，schemaId -> panel）
    private readonly ipCatalogs = new Map<string, IpCatalogPanel>();
    // Vivado 工具调用桥（帧化请求/响应）
    private readonly tclExecutor = new TclExecutor();

    constructor() {
        super();

        // 按工具链分发操作类（当前支持 Xilinx / Gowin）
        const toolChain = opeParam.prjInfo.toolChain;
        const ope = toolChain === ToolChainType.Gowin ? new GowinOperation() : new XilinxOperation();

        this.context = {
            tool: toolChain,
            path: '',
            ope,
            terminal: undefined,
            process: undefined
        };

        const curToolChain = this.context.tool;
        if (curToolChain === ToolChainType.Xilinx) {
            this.context.path = (this.context.ope as XilinxOperation).updateVivadoPath();
        } else if (curToolChain === ToolChainType.Gowin) {
            this.context.path = (this.context.ope as GowinOperation).updateGowinPath();
        }

        // Vivado 进程退出时，兜底清理运行状态，防止状态卡死
        this.context.onProcessExit = () => {
            this.busyRun.clear();
            this.finishRunProgress();
            this.tclExecutor.abortAll();
        };

        // 进程 stdout/stderr 转发到 TCL 控制台（若已打开）与工具调用结果分发
        this.context.onOutput = text => {
            this.tclConsole?.appendOutput(text);
            this.tclExecutor.onData(text);
        };
    }

    /**
     * @description 检测 toolChain 是否变化（如从 Xilinx 工程切到 Gowin 工程）。
     * PlManage 是单例（插件激活时创建一次），ope 按首次 toolChain 创建；
     * 切换工程后 toolChain 变了但 ope 仍是旧的，会启动错误工具链（如 Gowin 工程启动 Vivado）。
     * 此方法检测到变化时重建 ope 并清理旧工具链进程。
     */
    private ensureToolchain() {
        const current = opeParam.prjInfo.toolChain;
        if (this.context.tool === current) {
            return;
        }
        // 清理旧工具链进程（如 Vivado），避免残留
        if (this.context.process !== undefined) {
            try {
                this.context.ope.exit?.(this.context);
            } catch { /* ignore */ }
            this.context.process = undefined;
        }
        // 按新 toolChain 重建操作类
        this.context.ope = current === ToolChainType.Gowin
            ? new GowinOperation()
            : new XilinxOperation();
        this.context.tool = current;
        if (current === ToolChainType.Xilinx) {
            this.context.path = (this.context.ope as XilinxOperation).updateVivadoPath();
        } else if (current === ToolChainType.Gowin) {
            this.context.path = (this.context.ope as GowinOperation).updateGowinPath();
        }
        HardwareOutput.report(`工具链切换为 ${current}`, { level: ReportType.Info });
    }

    public launch() {
        // toolChain 变化时重建操作类（Xilinx ↔ Gowin）
        this.ensureToolchain();
        // 状态保护：工具链进程已在运行时不重复启动
        if (this.context.process !== undefined) {
            vscode.window.showWarningMessage(t('warn.pl.already-launched'));
            return;
        }
        this.context.ope.launch(this.context);
    }

    /**
     * @description 打开交互式 TCL 控制台（单例，已打开则聚焦）
     */
    public openTclConsole() {
        if (!this.tclConsole) {
            this.tclConsole = new TclConsolePanel();
            this.tclConsole.onCommand = text => this.sendTclCommand(text);
            this.tclConsole.onDispose = () => {
                this.tclConsole = undefined;
            };
        }
        this.tclConsole.reveal();
    }

    /**
     * @description 发送一条 TCL 命令到 Vivado 进程
     *
     * Vivado 管道 stdin 模式不回显命令结果，发送前包装为 catch + puts 显式打印结果或错误
     * @param text 用户输入的命令
     */
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
        process.stdin.write(wrapTclCommand(text) + '\n');
    }

    /**
     * @description 打开 AI 助手聊天面板（单例，已打开则聚焦）
     */
    public openAssistantChat() {
        if (!this.assistant) {
            this.assistant = new ChatPanel({
                executeTcl: (command, timeout) => this.executeTcl(command, timeout)
            });
            this.assistant.onDispose = () => {
                this.assistant = undefined;
            };
        }
        this.assistant.reveal();
    }

    /**
     * @description 打开指定 IP 的创建面板（每个 IP 独立标签）；未指定则弹选择器
     */
    public openIpCatalog(schemaId?: string) {
        if (!schemaId) {
            this.pickAndOpenIpCatalog();
            return;
        }

        let panel = this.ipCatalogs.get(schemaId);
        if (!panel) {
            panel = new IpCatalogPanel({
                schemaId,
                executeTcl: (command, timeout) => this.executeTcl(command, timeout)
            });
            panel.onDispose = () => {
                this.ipCatalogs.delete(schemaId);
            };
            this.ipCatalogs.set(schemaId, panel);
        }
        panel.reveal();
    }

    /**
     * @description 弹出可用 IP 选择器，选中后打开对应创建面板
     */
    private async pickAndOpenIpCatalog() {
        const items = Object.values(ipSchemas).map(schema => ({
            label: schema.id,
            description: schema.displayName,
            schemaId: schema.id
        }));
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: t('ip-catalog.pick-placeholder')
        });
        if (picked) {
            this.openIpCatalog(picked.schemaId);
        }
    }

    /**
     * @description 在 Vivado 进程中执行一条 TCL 命令并返回结果（供 AI 助手工具调用）
     * @param command TCL 命令
     * @param timeout 超时毫秒
     */
    public executeTcl(command: string, timeout?: number): Promise<string> {
        return this.tclExecutor.execute(command, () => this.context.process, timeout);
    }

    public simulate() {
        if (this.context.process === undefined) {
            return;
        }
        this.context.ope.simulate(this.context);
    }

    public simulateCli() {
        this.context.ope.simulateCli(this.context);
    }

    public simulateGui() {
        this.context.ope.simulateGui(this.context);
    }

    public refresh() {
        if (this.context.process === undefined) {
            return;
        }
        this.context.ope.refresh(this.context);
    }

    public build() {
        if (!this.tryStartRun(['synth', 'impl'])) {
            return;
        }
        this.context.ope.build(this.context);
    }

    public synth() {
        if (!this.tryStartRun(['synth'])) {
            return;
        }
        this.context.ope.synth(this.context);
    }

    public impl() {
        if (!this.tryStartRun(['impl'])) {
            return;
        }
        this.context.ope.impl(this.context);
    }

    /**
     * @description 尝试开始一次运行（synth / impl / build）
     *
     * - 若已有运行在进行中，弹警告并拒绝，防止重复操作
     * - 若 Vivado 进程未启动，提示用户先 Launch
     * - 成功后登记期望的 run 集合，并启动进度提示
     * @param runs 本次运行完成后会到达的哨兵 run 集合
     * @returns 是否成功开始
     */
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

    /**
     * @description 启动运行中的进度提示（右下角通知栏 spinner）
     */
    private startRunProgress(label: string) {
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: label,
                cancellable: false
            },
            () => new Promise<void>(resolve => {
                this._runProgressResolve = resolve;
            })
        );
    }

    /**
     * @description 结束运行中的进度提示
     */
    private finishRunProgress() {
        this._runProgressResolve?.();
        this._runProgressResolve = undefined;
    }

    /**
     * @description 分析对应运行的日志并展示报告
     * @param run synth / impl
     */
    private async analyzeRunLog(run: 'synth' | 'impl') {
        const ope = this.context.ope as any;
        const getRunLogPath = ope?.getRunLogPath as ((run: 'synth' | 'impl') => AbsPath | undefined) | undefined;
        const logPath = getRunLogPath?.call(ope, run) as AbsPath | undefined;

        if (!logPath) {
            MainOutput.report(t('warn.synth-report.unsupported-toolchain'), {
                level: ReportType.Warn
            });
            return;
        }

        if (!hdlFile.isFile(logPath)) {
            MainOutput.report(t('warn.synth-report.log-not-found', logPath), {
                level: ReportType.Warn
            });
            return;
        }

        MainOutput.report(t('info.synth-report.start', logPath), {
            level: ReportType.Run
        });

        const result = await analyzeSynthLogAndShow(logPath);
        if (result === undefined) {
            MainOutput.report(t('warn.synth-report.log-not-found', logPath), {
                level: ReportType.Warn
            });
        }
    }

    public bitstream() {
        this.context.ope.generateBit(this.context);
    }

    public program() {
        this.context.ope.program(this.context);
    }

    public gui() {
        this.context.ope.gui(this.context);
    }

    public async exit() {
        if (this.context.process === undefined) {
            return;
        }
        HardwareOutput.show();        
        this.context.ope.exit(this.context);
    }

    public setSrcTop(item: ModuleDataItem) {        
        this.context.ope.setSrcTop(item.name, this.context);
        const type = moduleTreeProvider.getItemType(item);
        
        if (type === HdlFileProjectType.Src) {
            moduleTreeProvider.setFirstTop(HdlFileProjectType.Src, item.name, item.path);
            moduleTreeProvider.refreshSrc();
        }
    }

    public setSimTop(item: ModuleDataItem) {
        this.context.ope.setSimTop(item.name, this.context);
        const type = moduleTreeProvider.getItemType(item);
        if (type === HdlFileProjectType.Sim) {
            moduleTreeProvider.setFirstTop(HdlFileProjectType.Sim, item.name, item.path);
            moduleTreeProvider.refreshSim();
        }
    }
    
    /**
     * @description 因发生文件布局变动而进行更新
     * @param addFiles 
     * @param delFiles 
     */
    public async updateByMonitor(addFiles: AbsPath[], delFiles: AbsPath[]) {
        // 目前只支持 Xilinx
        const addfileActionTag = '(add files) ';
        const delfileActionTag = '(del files) ';
        if (addFiles.length > 0) {
            const reportMsg = ['', ...addFiles].join('\n\t');
            MainOutput.report(addfileActionTag + t('info.pl.xilinx.update-addfiles') + reportMsg, {
                level: ReportType.Run
            });
            await this.addFiles(addFiles);
        } else {
            MainOutput.report(addfileActionTag + t('info.pl.xilinx.no-need-add-files'));
        }

        if (delFiles.length > 0) {
            const reportMsg = ['', ...delFiles].join('\n\t');
            MainOutput.report(delfileActionTag + t('info.pl.xilinx.update-delfiles') + reportMsg, {
                level: ReportType.Run
            });
            await this.delFiles(delFiles);
        } else {
            MainOutput.report(delfileActionTag + t('info.pl.xilinx.no-need-del-files'));
        }
    }

    async addFiles(files: string[]) {
        this.context.ope.addFiles(files, this.context);
    }

    async delFiles(files: string[]) {
        this.context.ope.delFiles(files, this.context);
    }

    /**
     * @description 添加自定义 device 字符串
     * @returns 
     */
    async addDevice() {
        const propertySchema = opeParam.propertySchemaPath;
        let propertyParam = hdlFile.readJSON(propertySchema) as PropertySchema;
        const device = await vscode.window.showInputBox({
            password: false,
            ignoreFocusOut: true,
            placeHolder: t('info.addDevice.placeholder')
        });

        if (!device) {
            return;    
        }

        // 同步到缓存中
        const dideHome = opeParam.dideHome;
        const cachePPy = hdlPath.join(dideHome, 'property-schema.json');

        if (!propertyParam.properties.device.enum.includes(device)) {
            propertyParam.properties.device.enum.push(device);
            hdlFile.writeJSON(propertySchema, propertyParam);
            hdlFile.writeJSON(cachePPy, propertyParam);
            vscode.window.showInformationMessage(t('info.addDevice.add-success', device));
        } else {
            vscode.window.showWarningMessage(t('warning.addDevice.name-taken', device));
        }
    }

    /**
     * @description 删除用户创建的 device
     * @returns 
     */
    async delDevice() {
        const propertySchema = opeParam.propertySchemaPath;
        const propertyParam = hdlFile.readJSON(propertySchema) as PropertySchema;
        const cachePPy = hdlPath.join(opeParam.dideHome, 'property-schema.json');

        const device = await vscode.window.showQuickPick(
            propertyParam.properties.device.enum.filter(device => device !== 'none'),
            {
                placeHolder: t('info.delDevice.placeholder'),
                ignoreFocusOut: true
            }
        );
        if (!device) {
            return;
        }

        const index = propertyParam.properties.device.enum.indexOf(device);
        propertyParam.properties.device.enum.splice(index, 1);
        hdlFile.writeJSON(propertySchema, propertyParam);
        hdlFile.writeJSON(cachePPy, propertyParam);
        vscode.window.showInformationMessage(t('info.delDevice.del-success', device));
    }
}

/**
 * @description 包装一条用户 TCL 命令，显式打印结果或错误
 *
 * Vivado 管道 stdin 模式不回显命令结果，包装为 catch + puts 后：
 * - 命令有返回值 → puts 打印
 * - 命令出错     → puts 打印 ERROR
 * - 无返回值     → 不打印多余内容
 *
 * 仅适合单行命令；多行脚本 / 不平衡花括号不适用。
 * @param text 用户命令
 */
function wrapTclCommand(text: string): string {
    return [
        `set __dide_rc [catch { ${text} } __dide_res]`,
        `if {$__dide_rc} { puts "ERROR: $__dide_res" } elseif {$__dide_res ne ""} { puts $__dide_res }`,
        `unset __dide_rc __dide_res`
    ].join('\n');
}

export {
    PlManage,
};
