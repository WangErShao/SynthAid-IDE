import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fspath from 'path';
import { spawn } from 'child_process';

import { opeParam } from '../../global';
import { hdlDir, hdlFile, hdlPath } from '../../hdlFs';
import { hdlParam } from '../../hdlParser';
import { t } from '../../i18n';

const VLOG_EXTS = ['.v', '.vh', '.vl', '.sv', '.svh'];

/**
 * @description 生成 Vivado RTL 网表 JSON（独立 batch 进程，不污染主 Vivado 会话）
 *
 * - 扫描 hardware.src 下 Verilog/SV 源文件 + 为项目 IP 生成黑盒 stub
 * - 独立 `vivado -mode batch` 进程：create_project → synth_design -rtl → 遍历 ports/cells/nets → JSON
 * - 输出 <prjPath>/netlist/<module>.json
 * @param moduleName 顶层模块名
 * @returns 生成的 JSON 绝对路径
 */
export async function generateVivadoNetlist(moduleName: string): Promise<string> {
    const prjPath = opeParam.prjInfo.prjPath;
    const device = opeParam.prjInfo.device;
    const srcDir = opeParam.prjInfo.hardwareSrcPath;

    const netlistDir = hdlPath.join(prjPath, 'netlist');
    const workDir = hdlPath.join(netlistDir, 'vivado_work');
    hdlDir.mkdir(workDir);
    hdlDir.mkdir(netlistDir);

    // 1) RTL 源文件
    const rtlFiles = collectRtlFiles(srcDir);
    if (rtlFiles.length === 0) {
        throw new Error(t('netlist-vivado.no-rtl'));
    }

    // 2) IP 黑盒 stub（避免 synth_design -rtl 报 module not found）
    const stubFiles = generateIpStubs(workDir);

    // 3) 写 manifest（每行一个源文件）
    const manifestPath = hdlPath.join(workDir, `${moduleName}.list`);
    fs.writeFileSync(manifestPath, [...rtlFiles, ...stubFiles].join('\n'), 'utf-8');

    // 4) 独立 batch 进程
    const jsonPath = hdlPath.join(netlistDir, `${moduleName}.json`);
    const tclPath = hdlPath.join(opeParam.extensionPath, 'resources', 'dide-netlist', 'vivado_nl.tcl');
    await runVivadoBatch(tclPath, workDir, [device, moduleName, manifestPath, jsonPath], jsonPath);

    // 5) 校验结果非空
    try {
        const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        if (!parsed.cells || parsed.cells.length === 0) {
            throw new Error(t('netlist-vivado.empty', moduleName));
        }
    } catch (error: any) {
        if (error?.message?.startsWith?.('Unexpected')) {
            throw new Error(t('netlist-vivado.bad-json', jsonPath));
        }
        throw error;
    }
    return jsonPath;
}

/**
 * @description 递归收集 Verilog/SV 源文件
 */
function collectRtlFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }
    const files: string[] = [];
    const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const p = fspath.join(d, entry.name);
            if (entry.isDirectory()) {
                if (!/^\./.test(entry.name)) {
                    walk(p);
                }
            } else if (VLOG_EXTS.some(ext => p.toLowerCase().endsWith(ext))) {
                files.push(hdlPath.toSlash(p));
            }
        }
    };
    walk(dir);
    return files;
}

/**
 * @description 为 IP 模块生成 Verilog 黑盒 stub
 *
 * 端口来源（合并，保证 elaboration 不报"named port connection does not exist"）：
 * 1) hdlParam 中 IP 模块已解析的端口（含位宽/方向）
 * 2) 从 RTL 实例源码提取的实际连接端口（方向未知 → inout，位宽标量）
 */
function generateIpStubs(outDir: string): string[] {
    const stubs: string[] = [];
    const seen = new Set<string>();

    const ipModules = hdlParam.getAllHdlModules().filter(m => m.file.doFastType === 'ip');
    const ipNames = new Set(ipModules.map(m => m.name));
    const connectedPorts = collectConnectedIpPorts(ipNames);

    for (const mod of ipModules) {
        if (seen.has(mod.name)) {
            continue;
        }
        seen.add(mod.name);

        // 端口名 -> { dir, width }
        const portInfo = new Map<string, { dir: string; width: string }>();
        for (const port of mod.ports) {
            if (port.type === 'unknown') {
                continue;
            }
            portInfo.set(port.name, {
                dir: port.type === 'output' ? 'output' : port.type === 'inout' ? 'inout' : 'input',
                width: port.width && port.width.trim() ? port.width : ''
            });
        }
        // 补充 RTL 中实际连接的端口（hdlParam 可能漏解析）
        for (const portName of connectedPorts.get(mod.name) || []) {
            if (!portInfo.has(portName)) {
                portInfo.set(portName, { dir: 'inout', width: '' });
            }
        }

        const portArgs: string[] = [];
        for (const [name, info] of portInfo) {
            const width = info.width ? ` ${info.width}` : '';
            portArgs.push(`${info.dir}${width} ${name}`);
        }

        const body = `module ${mod.name}(\n${portArgs.map(p => '    ' + p).join(',\n')}\n);\nendmodule\n`;
        const stubPath = hdlPath.join(outDir, `stub_${mod.name}.v`);
        fs.writeFileSync(stubPath, body, 'utf-8');
        stubs.push(hdlPath.toSlash(stubPath));
    }
    return stubs;
}

/**
 * @description 从 RTL 源码提取每个 IP 模块被实例化时实际连接的端口名
 *
 * 遍历所有模块的实例，筛选 type 为 IP 模块的实例，读取其端口连接区
 * （instance.instports 的 Range）中的 `.port_name(...)`。
 */
function collectConnectedIpPorts(ipNames: Set<string>): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const mod of hdlParam.getAllHdlModules()) {
        for (const inst of mod.getAllInstances()) {
            if (!ipNames.has(inst.type)) {
                continue;
            }
            const ports = result.get(inst.type) || new Set<string>();
            const content = hdlFile.readFile(mod.file.path);
            const range = inst.instports;
            if (content && range) {
                const text = sliceLines(
                    content,
                    range.start.line, range.start.character,
                    range.end.line, range.end.character
                );
                const re = /\.\s*([A-Za-z_]\w*)\s*\(/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    ports.add(m[1]);
                }
            }
            result.set(inst.type, ports);
        }
    }
    return result;
}

/**
 * @description 按行/字符切取源码片段
 */
function sliceLines(content: string, startLine: number, startChar: number, endLine: number, endChar: number): string {
    const lines = content.split('\n');
    if (startLine === endLine) {
        return lines[startLine]?.slice(startChar, endChar) || '';
    }
    const parts: string[] = [];
    for (let i = startLine; i <= endLine && i < lines.length; i++) {
        const line = lines[i];
        if (i === startLine) {
            parts.push(line.slice(startChar));
        } else if (i === endLine) {
            parts.push(line.slice(0, endChar));
        } else {
            parts.push(line);
        }
    }
    return parts.join('\n');
}

/**
 * @description 以独立 batch 进程运行遍历 TCL，等待 JSON 生成
 *
 * 始终把 Vivado 输出写入 <workDir>/<top>_vivado.log，失败时把日志尾部带进错误信息。
 */
function runVivadoBatch(
    tclPath: string,
    cwd: string,
    args: string[],
    jsonPath: string
): Promise<string> {
    return new Promise((resolve, reject) => {
        const vivadoExe = getVivadoExe();
        const logPath = hdlPath.join(cwd, `${args[1] || 'nl'}_vivado.log`);
        const proc = spawn(
            vivadoExe,
            ['-mode', 'batch', '-source', tclPath, '-tclargs', ...args, '-nolog', '-nojournal'],
            { cwd, shell: true }
        );

        let buf = '';
        const append = (d: Buffer) => {
            buf += d.toString();
            try {
                fs.appendFileSync(logPath, d.toString());
            } catch {
                // ignore
            }
        };
        proc.stdout?.on('data', append);
        proc.stderr?.on('data', append);
        proc.on('error', err => reject(err));
        proc.on('close', code => {
            if (fs.existsSync(jsonPath)) {
                resolve(jsonPath);
            } else {
                const tail = buf.split('\n').filter(l => /ERROR|CRITICAL|failed/i.test(l)).slice(-8).join('\n');
                reject(new Error(
                    `Vivado netlist failed (exit ${code}).\nLog: ${logPath}\n${tail}`
                ));
            }
        });
    });
}

/**
 * @description 解析 Vivado 可执行路径（复用 digital-ide.prj.vivado.install.path 配置）
 */
function getVivadoExe(): string {
    const folder = vscode.workspace.getConfiguration('digital-ide.prj.vivado.install').get<string>('path') || '';
    if (folder && hdlFile.isDir(folder)) {
        let exe = hdlPath.join(hdlPath.toSlash(folder), 'vivado');
        if (process.platform === 'win32') {
            exe += '.bat';
        }
        return exe;
    }
    return 'vivado';
}

export { collectRtlFiles, getVivadoExe };
