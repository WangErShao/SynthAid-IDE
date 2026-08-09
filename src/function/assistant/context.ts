import { opeParam } from '../../global';
import { hdlParam } from '../../hdlParser';

/**
 * @description 基于已解析的 hdlParam 构建 RTL 设计结构上下文
 *
 * 等价于 SynthAid 用 pyslang 做的工作，但复用扩展自身的解析结果
 * （Rust LSP 在工程启动时已完成解析），无需引入 Python/pyslang 依赖。
 */
export function buildRtlContext(): string {
    const lines: string[] = [];

    const prjInfo = opeParam.prjInfo;
    lines.push(`Project: ${prjInfo.prjName.PL || '-'}`);
    lines.push(`Device: ${prjInfo.device || '-'}`);
    const top = opeParam.firstSrcTopModule?.name;
    if (top) {
        lines.push(`Top module: ${top}`);
    }
    lines.push('');

    const files = hdlParam.getAllHdlFiles();
    if (files.length === 0) {
        lines.push('(No HDL files parsed yet — open a project and let it parse first.)');
        return lines.join('\n');
    }

    for (const file of files) {
        const modules = file.getAllHdlModules();
        if (modules.length === 0) {
            continue;
        }
        lines.push(`=== file: ${file.path} ===`);
        for (const module of modules) {
            lines.push(`module ${module.name}${module.archName ? ` (${module.archName})` : ''}:`);
            if (module.ports.length > 0) {
                lines.push('  ports:');
                for (const port of module.ports) {
                    lines.push(`    ${port.type} ${port.name}${port.width ? ` ${port.width}` : ''}`);
                }
            }
            if (module.params.length > 0) {
                lines.push('  params:');
                for (const param of module.params) {
                    lines.push(`    ${param.name} = ${param.init || ''}`);
                }
            }
            const instances = module.getAllInstances();
            if (instances.length > 0) {
                lines.push('  instances:');
                for (const inst of instances) {
                    lines.push(`    ${inst.name} : ${inst.type}`);
                }
            }
            lines.push('');
        }
    }

    return lines.join('\n');
}
