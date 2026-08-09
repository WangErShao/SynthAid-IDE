import * as vscode from 'vscode';

import { getIconConfig } from '../../hdlFs/icons';

interface AssistantNode {
    name: string;
    cmd: string;
    icon: string;
    tip: string;
}

// 后续需要新增节点时，直接在此数组追加即可
const NODES: AssistantNode[] = [
    {
        name: 'AI Chat',
        cmd: 'digital-ide.assistant.open-chat',
        icon: 'cmd',
        tip: 'Open the AI assistant chat'
    }
];

/**
 * @description AI Assistant 树（第 5 个视图）
 */
export class AssistantTreeProvider implements vscode.TreeDataProvider<AssistantNode> {
    public getChildren(element?: AssistantNode): AssistantNode[] {
        return element ? [] : NODES;
    }

    public getTreeItem(element: AssistantNode): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
        treeItem.contextValue = 'ASSISTANT';
        treeItem.tooltip = element.tip;
        treeItem.iconPath = getIconConfig(element.icon);
        // 双击触发（走统一 dispatch，与 HARD/SOFT 一致）
        treeItem.command = {
            title: element.cmd,
            command: 'digital-ide.treeView.dispatch',
            arguments: [element.cmd]
        };
        return treeItem;
    }
}

const assistantTreeProvider = new AssistantTreeProvider();

export {
    assistantTreeProvider
};
