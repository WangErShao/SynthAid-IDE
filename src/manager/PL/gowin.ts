/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn, exec } from 'child_process';
import * as fspath from 'path';
import * as fs from 'fs';

import { AbsPath, opeParam } from '../../global';
import { hdlParam } from '../../hdlParser/core';
import { hdlFile, hdlDir, hdlPath } from '../../hdlFs';
import { HardwareOutput, MainOutput, ReportType } from '../../global/outputChannel';
import { debounce, getPIDsWithName, killProcess } from '../../global/util';
import { t } from '../../i18n';
import { HdlFileProjectType } from '../../hdlParser/common';
import { PLContext } from './xilinx';

/**
 * Gowin operation under PL.
 *
 * 与 XilinxOperation 对齐的方法签名（PlManage 通过 context.ope 统一调用），
 * 内部使用 Gowin Tcl 命令驱动 gw_sh.exe：
 *   create_project / add_file / run syn|pnr|all
 *
 * 关键差异（vs Xilinx）:
 * - 进程: gw_sh.exe（交互式 Tcl shell）
 * - 工程: 创建式（create_project），无 open_project
 * - 流程: run syn / run pnr / run all
 * - device_version: 从 part number 速度等级解析（如 C6/I5 -> C）
 */
class GowinOperation {
    guiLaunched: boolean;
    guiPid: number;
    constructor() {
        this.guiLaunched = false;
        this.guiPid = -1;
    }

    public get gowinPath(): AbsPath {
        return hdlPath.join(opeParam.extensionPath, 'resources', 'script', 'gowin');
    }

    public get prjPath(): AbsPath {
        return opeParam.prjInfo.arch.prjPath;
    }

    public get srcPath(): AbsPath {
        return opeParam.prjInfo.arch.hardware.src;
    }

    public get simPath(): AbsPath {
        return opeParam.prjInfo.arch.hardware.sim;
    }

    public get datPath(): AbsPath {
        return opeParam.prjInfo.arch.hardware.data;
    }

    public get prjInfo(): { path: AbsPath, name: string, device: string } {
        return {
            path: hdlPath.join(this.prjPath, 'gowin'),
            name: opeParam.prjInfo.prjName.PL,
            device: opeParam.prjInfo.device
        };
    }

    /**
     * @description 从 part number 解析 Gowin device_version（速度等级）。
     * 例: "GW1N-LV9LQ144C6/I5" -> "C"  (C6/I5 的版本为 C)
     * 例: "GW1NSR-4CQN48PC6/I5" -> "C"
     */
    public get deviceVersion(): string {
        const dev = this.prjInfo.device;
        // 匹配形如 C6/I5 的速度等级段，取字母部分
        const m = /([A-Za-z])\d+\s*\/\s*\w+/.exec(dev);
        if (m) {
            return m[1].toUpperCase();
        }
        return 'C';
    }

    /**
     * @description Gowin 安装目录下的 gw_sh.exe 路径
     */
    public updateGowinPath(): string {
        const gowinBinFolder = vscode.workspace.getConfiguration('digital-ide.prj.gowin.install').get<string>('path') || '';
        if (hdlFile.isDir(gowinBinFolder)) {
            let gowinPath = hdlPath.join(hdlPath.toSlash(gowinBinFolder), 'gw_sh');
            if (opeParam.os === 'win32') {
                gowinPath += '.exe';
            }
            return gowinPath;
        }
        // 未配置则认为在 PATH 里
        return 'gw_sh';
    }

    /**
     * @description Gowin launch：启动 gw_sh 会话，创建工程（若无）。
     */
    public async launch(context: PLContext): Promise<string | undefined> {
        this.guiLaunched = false;
        this.guiPid = -1;

        const scripts: string[] = [];
        const prjDir = this.prjInfo.path;

        // 创建工程（Gowin 是创建式流程）
        if (!hdlDir.mkdir(prjDir)) {
            vscode.window.showErrorMessage(`mkdir ${prjDir} failed`);
            return undefined;
        }
        this.create(scripts);

        const tclPath = hdlPath.join(this.gowinPath, 'launch.tcl');
        hdlDir.mkdir(this.gowinPath);
        scripts.push(this.getRefreshDesignSourceCommand());
        scripts.push(`file delete ${tclPath} -force`);
        const tclCommands = scripts.join('\n') + '\n';
        hdlFile.writeFile(tclPath, tclCommands);

        context.path = this.updateGowinPath();
        // 注意：gw_sh 不支持 `-tcl <file>`（实测会忽略该参数，脚本不执行）。
        // 正确做法是交互式启动 gw_sh，再通过 stdin `source <tcl>` 执行创建工程等命令。
        const cmd = `"${context.path}"`;

        const _this = this;
        const onGowinClose = debounce(() => {
            context.onProcessExit?.();
            context.process = undefined;
            _this.onGowinClose();
        }, 100);

        function launchScript(): Promise<ChildProcessWithoutNullStreams | undefined> {
            if (!opeParam.workspacePath) {
                return Promise.resolve(undefined);
            }
            const gowinProcess = spawn(cmd, [], { shell: true, stdio: 'pipe', cwd: opeParam.workspacePath });
            // 交互式会话就绪后，source launch.tcl 执行 create_project / add_file
            gowinProcess.stdin.write(`source "${tclPath}"\n`);
            let status: 'pending' | 'fulfilled' = 'pending';
            let doneBuffer = '';

            gowinProcess.on('close', () => onGowinClose());
            gowinProcess.on('exit', () => onGowinClose());
            gowinProcess.on('disconnect', () => onGowinClose());

            return new Promise(resolve => {
                gowinProcess.stdout.on('data', async data => {
                    const text: string = data.toString();
                    const message: string = _this.handleMessage(text, status);
                    context.onOutput?.(text);
                    if (status === 'pending') {
                        HardwareOutput.clear();
                        HardwareOutput.show();
                        resolve(gowinProcess);
                    }
                    HardwareOutput.report(message, { level: ReportType.Info });
                    status = 'fulfilled';

                    // 检测运行完成哨兵，触发日志分析
                    doneBuffer += text;
                    const doneRe = /DIDE_RUN_DONE:(synth|impl)/g;
                    let doneMatch: RegExpExecArray | null;
                    while ((doneMatch = doneRe.exec(doneBuffer)) !== null) {
                        context.onRunComplete?.(doneMatch[1] === 'impl' ? 'impl' : 'synth');
                    }
                    doneBuffer = doneBuffer.replace(/DIDE_RUN_DONE:(synth|impl)/g, '');
                });

                gowinProcess.stderr.on('data', async data => {
                    context.onOutput?.(data.toString());
                    HardwareOutput.report(data.toString(), { level: ReportType.Error });
                    HardwareOutput.show();
                    if (status === 'pending') {
                        resolve(undefined);
                    }
                });
            });
        }

        const process = await vscode.window.withProgress({
            title: t('info.pl.launch.progress.launch-tcl.title'),
            location: vscode.ProgressLocation.Notification,
            cancellable: true
        }, async () => {
            return await launchScript();
        });

        context.process = process;
    }

    private handleMessage(message: string, status: 'pending' | 'fulfilled'): string {
        if (status === 'fulfilled') {
            return message.trim();
        }
        const messageBuffer: string[] = [];
        for (const line of message.trim().split('\n')) {
            if (line.startsWith('source') && line.includes('.tcl')) {
                continue;
            }
            messageBuffer.push(line);
        }
        const launchInfo = t('info.pl.launch.launch-info');
        messageBuffer.unshift(launchInfo);
        return messageBuffer.join("\n");
    }

    private async onGowinClose() {
        await this.closeAllWindows();
    }

    /**
     * @description 生成创建工程的 Tcl 脚本
     */
    public create(scripts: string[]) {
        scripts.push(`create_project -name ${this.prjInfo.name} -dir ${this.prjInfo.path} -pn ${this.prjInfo.device} -device_version ${this.deviceVersion} -force`);
    }

    /**
     * @description 生成刷新设计源文件的 Tcl 命令（add_file 所有 HDL + 约束）
     */
    private getRefreshDesignSourceCommand(): string {
        const scripts: string[] = [];

        // 导入设计源文件（src / library）
        for (const hdlFileEntry of hdlParam.getAllHdlFiles()) {
            switch (hdlFileEntry.projectType) {
                case HdlFileProjectType.Src:
                case HdlFileProjectType.LocalLib:
                case HdlFileProjectType.RemoteLib:
                    scripts.push(`add_file ${hdlFileEntry.path}`);
                    break;
                case HdlFileProjectType.Sim:
                    // Gowin 仿真文件不在工程流程内，跳过
                    break;
                case HdlFileProjectType.IP:
                case HdlFileProjectType.Primitive:
                    break;
                default:
                    break;
            }
        }

        // 添加约束文件（.sdc / .cst）
        hdlFile.pickFileRecursive(this.datPath, filePath => {
            if (filePath.endsWith('.sdc') || filePath.endsWith('.cst')) {
                scripts.push(`add_file ${filePath}`);
            }
        });

        let script = '';
        for (const content of scripts) {
            script += content + '\n';
        }
        return script;
    }

    /**
     * @description 刷新工程设计源（写入 stdin）
     */
    public refresh(context: PLContext) {
        vscode.window.showInformationMessage(
            "Gowin: Refresh",
            { title: 'ok', value: true }
        );
        const cmd = this.getRefreshDesignSourceCommand();
        context.process?.stdin.write(cmd + '\n');
    }

    public async closeAllWindows() {
        if (this.guiPid > 0) {
            await killProcess(this.guiPid);
        }
    }

    public async exit(context: PLContext) {
        context.process?.stdin.write('exit\n');
        await this.closeAllWindows();
    }

    public simulate(context: PLContext) {
        this.simulateCli(context);
    }

    public simulateGui(context: PLContext) {
        vscode.window.showInformationMessage(
            "Gowin: Simulate GUI",
            { title: 'ok', value: true }
        );
        this.simulateCli(context);
    }

    public simulateCli(context: PLContext) {
        vscode.window.showInformationMessage(
            "Gowin: Simulate CLI",
            { title: 'ok', value: true }
        );
        // Gowin 仿真流程（Phase 2 完善）
        context.process?.stdin.write('run sim\n');
    }

    public synth(context: PLContext) {
        const script = `run syn; puts "DIDE_RUN_DONE:synth";`;
        context.process?.stdin.write(script + '\n');
    }

    /**
     * @description 获取 Gowin 综合日志路径（impl/gwsynthesis/<name>.log）
     */
    public getRunLogPath(run: 'synth' | 'impl'): AbsPath {
        if (run === 'synth') {
            return hdlPath.join(this.prjInfo.path, this.prjInfo.name, 'impl', 'gwsynthesis', `${this.prjInfo.name}.log`);
        }
        return hdlPath.join(this.prjInfo.path, this.prjInfo.name, 'impl', 'pnr', `${this.prjInfo.name}.log`);
    }

    public impl(context: PLContext) {
        const script = `run pnr; puts "DIDE_RUN_DONE:impl";`;
        context.process?.stdin.write(script + '\n');
    }

    public build(context: PLContext) {
        const script = `run all; puts "DIDE_RUN_DONE:impl";`;
        context.process?.stdin.write(script + '\n');
    }

    public generateBit(context: PLContext) {
        vscode.window.showInformationMessage(
            "Gowin: BitStream",
            { title: 'ok', value: true }
        );
        // Gowin run all 已包含位流生成；单独触发用 run pnr
        context.process?.stdin.write('run pnr\n');
    }

    public program(context: PLContext) {
        vscode.window.showInformationMessage(
            "Gowin: Program",
            { title: 'ok', value: true }
        );

        // 查找位流文件 impl/pnr/<name>.fs
        const pnrDir = hdlPath.join(this.prjInfo.path, this.prjInfo.name, 'impl', 'pnr');
        const fsFiles = hdlFile.pickFileRecursive(pnrDir, filePath => filePath.endsWith('.fs'));
        if (fsFiles.length === 0) {
            vscode.window.showErrorMessage(`未找到位流文件 (.fs) in ${pnrDir}`);
            return;
        }
        const fsFile = fsFiles[0];

        // 从 device 提取 Gowin 器件短名（GW1N-LV9LQ144C6/I5 -> GW1N-9C）
        const deviceShort = this.extractDeviceShortName(this.prjInfo.device);

        // programmer_cli 路径
        const gowinInstall = vscode.workspace.getConfiguration('digital-ide.prj.gowin.install').get<string>('path') || '';
        const progCli = gowinInstall
            ? hdlPath.join(fspath.dirname(gowinInstall), 'Programmer', 'bin', 'programmer_cli.exe')
            : 'programmer_cli';

        const cmd = `"${progCli}" --device ${deviceShort} --fsFile "${fsFile}"`;

        HardwareOutput.show();
        HardwareOutput.report(`Gowin: Programming ${fsFile}`, { level: ReportType.Run });
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                HardwareOutput.report(`Gowin Programmer 失败: ${error.message}`, { level: ReportType.Error });
                vscode.window.showErrorMessage(`Gowin Programmer 失败: ${stderr || error.message}`);
                return;
            }
            HardwareOutput.report(`Gowin Programmer 成功: ${stdout}`, { level: ReportType.Info });
            vscode.window.showInformationMessage('Gowin 烧录成功');
        });
    }

    /**
     * @description 从完整 part number 提取 Gowin 器件短名（programmer_cli --device 需要）
     * 例: "GW1N-LV9LQ144C6/I5"    -> "GW1N-9C"
     * 例: "GW1NSR-LV4CQN48PC6/I5" -> "GW1NSR-4C"
     */
    private extractDeviceShortName(device: string): string {
        // GW<系列>-<电压><容量><封装>...<速度>/<温度>
        // 例: GW1NSR-LV4CQN48PC6/I5 -> 系列 GW1NSR + 容量 4 + 速度等级 C
        const m = /(GW\d+[A-Z]*)-([A-Z]{0,2})(\d+)/.exec(device);
        if (m) {
            const [, series, , capacity] = m;
            return `${series}-${capacity}${this.deviceVersion}`;
        }
        return device;
    }

    public async gui(context: PLContext) {
        if (context.process === undefined) {
            await this.launch(context);
        }
        const tclProcess = context.process;
        if (tclProcess === undefined) {
            return;
        }
        // Gowin GUI 模式（Phase 2 完善）
        vscode.window.showInformationMessage('Gowin GUI 将在 Phase 2 实现');
        this.guiLaunched = true;
    }

    public addFiles(files: string[], context: PLContext) {
        if (!this.guiLaunched && files.length > 0) {
            const filesString = files.join("\n");
            HardwareOutput.report(t('info.pl.add-files.title') + '\n' + filesString);
            this.execCommandToFilesInTclInterpreter(files, context, "add_file");
        }
    }

    public delFiles(files: string[], context: PLContext) {
        if (!this.guiLaunched && files.length > 0) {
            const filesString = files.join("\n");
            HardwareOutput.report(t('info.pl.del-files.title') + '\n' + filesString);
            this.execCommandToFilesInTclInterpreter(files, context, "rm_file");
        }
    }

    public setSrcTop(name: string, context: PLContext) {
        // Gowin 顶层由 set_device/top 或工程配置决定；MVP 提示
        vscode.window.showInformationMessage(`Gowin: top 设置为 ${name}（Phase 2 完善）`);
    }

    public setSimTop(name: string, context: PLContext) {
        vscode.window.showInformationMessage(`Gowin: sim top 设置为 ${name}（Phase 2 完善）`);
    }

    public execCommandToFilesInTclInterpreter(files: string[], context: PLContext, command: string) {
        if (context.process === undefined) {
            return;
        }
        for (const file of files) {
            context.process.stdin.write(command + ' ' + file + '\n');
        }
    }

    public xExecShowLog(logPath: AbsPath) {
        // Gowin 日志分析（Phase 2 完善）
    }
}

export {
    GowinOperation
};
