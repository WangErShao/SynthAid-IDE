import * as fs from 'fs';
import * as os from 'os';
import * as fspath from 'path';
import { ChildProcessWithoutNullStreams } from 'child_process';

/**
 * @description Vivado 工具调用桥：在共享 stdout 流上做"请求/响应"帧化
 *
 * 由于 Vivado 管道 stdin 模式不回显命令结果，且 stdout 是共享流（自动命令 / TCL 控制台 / 工具调用混用），
 * 无法用行哨兵可靠截断多行结果。方案：命令结果写入临时文件，stdout 只回 `__DIDE_DONE__:<id>` 标记，
 * 扩展读到标记后读取临时文件得到结果。
 */
export class TclExecutor {
    private pending = new Map<string, {
        resolve: (value: string) => void,
        reject: (reason?: any) => void,
        timer: NodeJS.Timeout,
        filePath: string
    }>();

    /**
     * @description 执行一条 TCL 命令并等待其结果
     * @param command 命令（可包含换行/花括号）
     * @param getProcess 获取当前 Vivado 进程
     * @param timeout 超时毫秒
     */
    public execute(
        command: string,
        getProcess: () => ChildProcessWithoutNullStreams | undefined,
        timeout: number = 30000
    ): Promise<string> {
        const proc = getProcess();
        if (proc === undefined) {
            return Promise.reject(new Error('Vivado is not running'));
        }

        const id = this.newId();
        const dir = fspath.join(os.tmpdir(), 'dide-tcl');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const filePath = fspath.join(dir, `tcl_${id}.txt`);
        // TCL 双引号字符串会把反斜杠当转义符（\t→TAB、\U→U 等），
        // 所以嵌入 TCL 时必须用正斜杠路径
        const tclPath = filePath.replace(/\\/g, '/');

        return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                this.cleanupFile(filePath);
                reject(new Error(`Tcl command timed out after ${timeout}ms`));
            }, timeout);

            this.pending.set(id, { resolve, reject, timer, filePath });

            const framed = [
                `set __dide_f "${tclPath}"`,
                `if {[catch { ${command} } __dide_res]} {`,
                `  set fp [open $__dide_f w]; puts $fp "ERROR: $__dide_res"; close $fp`,
                `} else {`,
                `  set fp [open $__dide_f w]; puts $fp $__dide_res; close $fp`,
                `}`,
                `puts "__DIDE_DONE__:${id}"`,
                `unset __dide_f __dide_res`
            ].join('\n');

            proc.stdin.write(framed + '\n');
        });
    }

    /**
     * @description 处理 stdout 数据，检测完成标记
     */
    public onData(text: string): void {
        const re = /__DIDE_DONE__:([\w-]+)/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
            this.resolvePending(match[1]);
        }
    }

    /**
     * @description Vivado 进程退出时清理所有挂起的调用
     */
    public abortAll(): void {
        for (const id of [...this.pending.keys()]) {
            const item = this.pending.get(id);
            if (item) {
                clearTimeout(item.timer);
                this.cleanupFile(item.filePath);
                item.reject(new Error('Vivado process exited'));
            }
        }
        this.pending.clear();
    }

    private resolvePending(id: string): void {
        const item = this.pending.get(id);
        if (!item) {
            return;
        }
        clearTimeout(item.timer);
        this.pending.delete(id);

        try {
            const content = fs.readFileSync(item.filePath, 'utf-8');
            item.resolve(content);
        } catch (error) {
            item.reject(error);
        } finally {
            this.cleanupFile(item.filePath);
        }
    }

    private cleanupFile(filePath: string): void {
        try {
            fs.unlinkSync(filePath);
        } catch {
            // ignore
        }
    }

    private newId(): string {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }
}
