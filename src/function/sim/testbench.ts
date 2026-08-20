import * as vscode from 'vscode';

import { MainOutput, opeParam } from '../../global';
import { hdlPath, hdlFile} from '../../hdlFs';
import { HdlModule, hdlParam } from '../../hdlParser/core';
import { instanceByLangID, getSelectItem } from './instance';
import { HdlLangID } from '../../global/enum';

function overwrite() {
    const options = {
        preview: false,
        viewColumn: vscode.ViewColumn.Active
    };
    const tbSrcPath = hdlPath.join(opeParam.extensionPath, 'lib', 'testbench.v');
    const uri = vscode.Uri.file(tbSrcPath);
    vscode.window.showTextDocument(uri, options);
}

function generateTestbenchFile(langID: HdlLangID, module: HdlModule) {
    const tbSrcPath = hdlPath.join(opeParam.extensionPath, 'lib', 'testbench.v');
    const tbDisPath = hdlPath.join(opeParam.prjInfo.arch.hardware.sim, 'testbench.v');

    if (!hdlFile.isFile(tbDisPath)) {
        var temp = hdlFile.readFile(tbSrcPath);
    } else {
        var temp = hdlFile.readFile(tbDisPath);
    }

    if (!temp) {
        vscode.window.showErrorMessage(
            `找不到 testbench 模板（${tbSrcPath}）或已有的 ${tbDisPath}。` +
            '请确认插件安装完整（缺少 lib/testbench.v），或先手动创建 testbench.v。'
        );
        return null;
    }

    let content = '';
    const lines = temp.split('\n');
    const len = lines.length;
    for (let index = 0; index < len; index++) {
        const line = lines[index];
        content += line + '\n';
        if (line.indexOf("//Instance ") !== -1) {
            content += instanceByLangID(langID, module) + '\n';
        }
    }
    try {
        hdlFile.writeFile(tbDisPath, content);
        MainOutput.report("Generate testbench to " + tbDisPath);
    } catch (err) {
        vscode.window.showErrorMessage("Generate testbench failed:" + err);
    }
}

async function testbench() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('please select a editor!');
        return;
    }
    const uri = editor.document.uri;
    const option = {
        placeHolder: 'Select a Module to generate testbench'
    };
    const path = hdlPath.toSlash(uri.fsPath);
    const langID = hdlFile.getLanguageId(path);

    if (!hdlFile.isHDLFile(path)) {
        vscode.window.showWarningMessage(`当前文件不是 HDL 文件，无法生成 testbench: ${path}`);
        return;
    }

    const currentHdlFile = hdlParam.getHdlFile(path);
    if (!currentHdlFile) {
        vscode.window.showWarningMessage(
            `当前文件尚未被解析到模块信息（${path}）。` +
            '请确认工程 LSP 解析正常（检查状态栏 linter 是否就绪），必要时保存文件或重新打开窗口后再试。'
        );
        return;
    }
    const currentHdlModules = currentHdlFile.getAllHdlModules();
    if (currentHdlModules.length === 0) {
        vscode.window.showWarningMessage(
            `文件 ${path} 未解析到任何模块，无法生成 testbench。` +
            '请检查文件是否有语法错误导致模块未被识别。'
        );
        return;
    }
    const items = getSelectItem(currentHdlModules);
    const select = await vscode.window.showQuickPick(items, option);
    if (select) {
        generateTestbenchFile(langID, select.module);
    }
}


export {
    testbench
};