import * as vscode from 'vscode';
import * as fs from 'fs';

import { opeParam } from '../../global';
import { hdlFile, hdlPath } from '../../hdlFs';
import { getIconConfig } from '../../hdlFs/icons';
import { t } from '../../i18n';
import { ipSchemas } from '../ip-catalog/schema';

type IpNodeKind =
    | 'available-root'
    | 'available-category'
    | 'available-ip'
    | 'project-root'
    | 'project-ip'
    | 'file-group'
    | 'file';

interface IpTreeNode {
    label: string;
    kind: IpNodeKind;
    icon: string;
    /** project-ip: IP 文件夹；file: 文件绝对路径 */
    path?: string;
    /** available-ip: 对应 schema id */
    schemaId?: string;
    /** file-group: def=定义文件(xci) out=输出文件(其余) */
    fileGroup?: 'def' | 'out';
    parent?: IpTreeNode;
}

const EXPANDABLE_KINDS: ReadonlySet<IpNodeKind> = new Set([
    'available-root', 'available-category', 'project-root', 'project-ip', 'file-group'
]);

/**
 * @description IP Catalog 树（独立视图 digital-ide-treeView-ip）
 *
 * 两部分：
 * - 可通过 SynthAid 创建：基于 schema.ts 的 ipSchemas，按 category 分组，点击打开创建 webview
 * - 当前项目中例化的 IP：扫描 resolve(hardware.src, '../ip')，展开显示定义文件与输出文件
 */
class IpCatalogTreeProvider implements vscode.TreeDataProvider<IpTreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<IpTreeNode | undefined> = new vscode.EventEmitter();

    public onDidChangeTreeData: vscode.Event<IpTreeNode | undefined> = this._onDidChangeTreeData.event;

    public refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    public getChildren(element?: IpTreeNode): IpTreeNode[] {
        if (!element) {
            return [
                { label: t('ip-catalog.tree.available'), kind: 'available-root', icon: 'ip' },
                { label: t('ip-catalog.tree.project'), kind: 'project-root', icon: 'ip' }
            ];
        }

        switch (element.kind) {
            case 'available-root':
                return this.getAvailableCategories();
            case 'available-category':
                return this.getAvailableIps(element);
            case 'project-root':
                return this.getProjectIps();
            case 'project-ip':
                return this.getIpFileGroups(element);
            case 'file-group':
                return this.getIpFiles(element);
            default:
                return [];
        }
    }

    public getTreeItem(element: IpTreeNode): vscode.TreeItem {
        const collapsible = EXPANDABLE_KINDS.has(element.kind)
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        const treeItem = new vscode.TreeItem(element.label, collapsible);
        treeItem.iconPath = getIconConfig(element.icon);
        treeItem.contextValue = 'IP';
        if (element.path) {
            treeItem.tooltip = element.path;
        }

        if (element.kind === 'available-ip') {
            // 点击打开 IP 创建 webview 并定位到对应 IP
            treeItem.command = {
                title: 'Open IP Catalog',
                command: 'digital-ide.ip-catalog.preselect',
                arguments: [element.schemaId]
            };
        } else if (element.kind === 'file') {
            // 点击打开真实文件
            treeItem.command = {
                title: 'Open File',
                command: 'digital-ide.treeView.arch.openFile',
                arguments: [element.path, undefined, element]
            };
        }

        return treeItem;
    }

    private getAvailableCategories(): IpTreeNode[] {
        const categories = new Map<string, string[]>();
        for (const schema of Object.values(ipSchemas)) {
            const list = categories.get(schema.category) || [];
            list.push(schema.id);
            categories.set(schema.category, list);
        }

        const nodes: IpTreeNode[] = [];
        for (const [category, ids] of categories) {
            nodes.push({
                label: category,
                kind: 'available-category',
                icon: 'file',
                path: ids.join(',')
            });
        }
        return nodes;
    }

    private getAvailableIps(element: IpTreeNode): IpTreeNode[] {
        const ids = (element.path || '').split(',').filter(Boolean);
        const nodes: IpTreeNode[] = [];
        for (const id of ids) {
            const schema = ipSchemas[id];
            if (!schema) {
                continue;
            }
            nodes.push({
                label: `${schema.id} (${schema.displayName})`,
                kind: 'available-ip',
                icon: 'ip',
                schemaId: schema.id,
                parent: element
            });
        }
        return nodes;
    }

    private getProjectIps(): IpTreeNode[] {
        const ipRoot = hdlPath.resolve(opeParam.prjInfo.arch.hardware.src, '../ip');
        if (!fs.existsSync(ipRoot) || !hdlFile.isDir(ipRoot)) {
            return [];
        }

        const nodes: IpTreeNode[] = [];
        for (const folder of fs.readdirSync(ipRoot)) {
            const folderPath = hdlPath.join(ipRoot, folder);
            const xci = hdlPath.join(folderPath, `${folder}.xci`);
            if (!fs.existsSync(xci)) {
                continue;
            }
            nodes.push({
                label: folder,
                kind: 'project-ip',
                icon: 'ip',
                path: folderPath
            });
        }
        return nodes;
    }

    private getIpFileGroups(element: IpTreeNode): IpTreeNode[] {
        return [
            { label: t('ip-catalog.tree.def-files'), kind: 'file-group', icon: 'file', path: element.path, fileGroup: 'def', parent: element },
            { label: t('ip-catalog.tree.out-files'), kind: 'file-group', icon: 'file', path: element.path, fileGroup: 'out', parent: element }
        ];
    }

    private getIpFiles(element: IpTreeNode): IpTreeNode[] {
        const ipDir = element.path;
        if (!ipDir || !fs.existsSync(ipDir) || !hdlFile.isDir(ipDir)) {
            return [];
        }

        const ipName = hdlPath.filename(ipDir) || 'ip';
        const defName = `${ipName}.xci`;

        const nodes: IpTreeNode[] = [];
        for (const entry of fs.readdirSync(ipDir)) {
            const filePath = hdlPath.join(ipDir, entry);
            if (!hdlFile.isFile(filePath)) {
                // 不展开子目录（doc/ synth/ simulation/）
                continue;
            }
            const isDef = element.fileGroup === 'def' ? entry === defName : entry !== defName;
            if (!isDef) {
                continue;
            }
            nodes.push({
                label: entry,
                kind: 'file',
                icon: this.fileIcon(filePath),
                path: filePath,
                parent: element
            });
        }
        return nodes;
    }

    private fileIcon(path: string): string {
        const langID = hdlFile.getLanguageId(path);
        if (langID === 'verilog' || langID === 'systemverilog' || langID === 'vhdl') {
            return langID;
        }
        return 'file';
    }
}

const ipCatalogTreeProvider = new IpCatalogTreeProvider();

export {
    IpCatalogTreeProvider,
    IpTreeNode,
    ipCatalogTreeProvider
};
