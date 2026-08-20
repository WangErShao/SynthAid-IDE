import * as vscode from 'vscode';

import { t } from '../../i18n';
import { generateVivadoNetlist } from './vivado';

/**
 * @description 打开 Vivado 真实网表视图（层级下钻）
 *
 * 1) 独立 batch 进程生成 RTL 网表 JSON
 * 2) webview 以网格布局显示当前模块的子模块框 + 内部 net 连线
 *    点击可下钻的模块框进入下一层；面包屑/返回导航
 */
export async function openVivadoNetlistViewer(moduleName: string) {
    const panel = vscode.window.createWebviewPanel(
        'digital-ide.netlist-vivado',
        t('netlist-vivado.title', moduleName),
        vscode.ViewColumn.Two,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    try {
        const jsonPath = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: t('netlist-vivado.generating'),
            cancellable: false
        }, () => generateVivadoNetlist(moduleName));

        const jsonUri = panel.webview.asWebviewUri(vscode.Uri.file(jsonPath)).toString();
        panel.webview.html = makeHtml(moduleName, jsonUri);
    } catch (error: any) {
        panel.webview.html = makeErrorHtml(error?.message || String(error));
    }
}

/**
 * @description 渲染层级下钻网表页
 */
function makeHtml(moduleName: string, jsonUri: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Netlist</title>
<style>
    :root {
        --bg: #1e1e1e; --fg: #d4d4d4; --border: #3c3c3c;
        --cell: #264f78; --box: #0e639c; --prim: #3a3d41;
        --net: #7fb069; --net-dim: #3a4a3a; --sel: #f0a030; --text: #d4d4d4;
        --expand: #f0a030;
    }
    * { box-sizing: border-box; }
    body.vscode-light {
        --bg:#fff; --fg:#333; --cell:#d6e4f0; --box:#4f94cd; --prim:#e6e6e6;
        --net:#4a8f3f; --net-dim:#c9dec9; --text:#222;
    }
    html, body { margin:0; height:100%; background:var(--bg); color:var(--fg);
        font-family: var(--vscode-font-family, sans-serif); font-size:12px; overflow:hidden; }
    .head { padding:6px 10px; border-bottom:1px solid var(--border); }
    .head .crumb { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
    .crumb .sep { color:var(--fg); opacity:.5; }
    .crumb .part { cursor:pointer; color:var(--box); font-family: var(--vscode-editor-font-family, Consolas, monospace); }
    .crumb .part:hover { text-decoration:underline; }
    .crumb .part.cur { color:var(--fg); cursor:default; font-weight:600; }
    .crumb button { background:var(--box); color:#fff; border:none; padding:2px 9px; border-radius:3px; cursor:pointer; }
    .crumbsub { display:flex; align-items:center; gap:8px; margin-top:4px; }
    .crumbsub label { display:flex; align-items:center; gap:4px; }
    #wrap { width:100%; height:calc(100% - 78px); position:relative; overflow:hidden; }
    svg { width:100%; height:100%; display:block; }
    #ports { position:absolute; left:10px; top:10px; width:190px; max-height:70%;
        overflow:auto; background:var(--bg); border:1px solid var(--border); border-radius:5px;
        padding:6px 8px; opacity:.95; }
    #ports .pt { font-size:11px; padding:1px 0; color:var(--fg); font-family: var(--vscode-editor-font-family, Consolas, monospace); }
    #ports .pt b { color:var(--net); }
    #err { padding:16px; color:#f85149; white-space:pre-wrap; font-family:monospace; }
    .hint { position:absolute; right:10px; bottom:8px; color:var(--fg); opacity:.5; font-size:11px; }
</style>
</head>
<body>
<div class="head">
    <div class="crumb" id="crumb"></div>
    <div class="crumbsub">
        <button id="back">◀ Back</button>
        <label><input type="checkbox" id="showPrim" checked> primitives</label>
        <span style="opacity:.6" id="meta"></span>
    </div>
</div>
<div id="wrap">
    <svg id="svg"></svg>
    <div id="ports"></div>
    <div class="hint">点击带 ◀ 标记的模块框下钻一层 · 面包屑返回</div>
</div>
<script>
    const svg = document.getElementById('svg');
    const NS = 'http://www.w3.org/2000/svg';
    const CELL_W = 170, CELL_H = 40, H_GAP = 46, V_GAP = 30, PAD = 30;

    let data = null;
    let path = [];          // 当前模块路径段
    let showPrim = true;

    function el(name, attrs) {
        const e = document.createElementNS(NS, name);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        return e;
    }

    fetch(${JSON.stringify(jsonUri)}).then(r => r.json()).then(d => {
        data = d;
        document.getElementById('showPrim').addEventListener('change', e => {
            showPrim = e.target.checked;
            render();
        });
        render();
    }).catch(err => {
        const w = document.getElementById('wrap');
        w.innerHTML = '<div id="err">' + (err.message || String(err)) + '</div>';
    });

    function segs(name) { return name.split('/'); }

    // 当前层的直接子 cell
    function children() {
        const prefix = path.join('/');
        const res = [];
        for (const c of data.cells) {
            if (prefix === '') {
                if (c.name.indexOf('/') === -1) res.push(c);
            } else {
                const p = prefix + '/';
                if (c.name.startsWith(p) && c.name.slice(p.length).indexOf('/') === -1) res.push(c);
            }
        }
        return res;
    }

    // cell 是否有下级（可下钻）
    function expandable(name) {
        const p = name + '/';
        return data.cells.some(c => c.name.startsWith(p));
    }

    // 当前层的模块端口
    function ports() {
        const prefix = path.join('/');
        if (prefix === '') {
            // 顶层端口：来自 net.ports
            const seen = new Set();
            const res = [];
            for (const n of data.nets) {
                for (const p of n.ports || []) {
                    if (!seen.has(p)) { seen.add(p); res.push({ name: p, dir: 'top', net: n.name }); }
                }
            }
            return res;
        }
        // 子模块端口：pin.cell === prefix
        const seen = new Set();
        const res = [];
        for (const n of data.nets) {
            for (const p of n.pins || []) {
                if (p.cell === prefix && !seen.has(p.pin)) {
                    seen.add(p.pin);
                    res.push({ name: p.pin.split('/').pop(), dir: p.dir, net: n.name });
                }
            }
        }
        return res;
    }

    // 当前层的内部 net：连接两个及以上子 cell
    function internalNets(childSet) {
        return data.nets.filter(n => {
            const set = new Set((n.pins || []).map(p => p.cell).filter(c => childSet.has(c)));
            return set.size >= 2;
        });
    }

    function render() {
        svg.innerHTML = '';
        document.getElementById('ports').innerHTML = '';
        const crumbs = document.getElementById('crumb');
        crumbs.innerHTML = '';
        crumbs.appendChild(elNode('button', '↻'));
        crumbs.lastChild.onclick = () => { path = []; render(); };
        const parts = ['top'].concat(path);
        let acc = [];
        for (let i = 0; i < parts.length; i++) {
            if (i > 0) crumbs.appendChild(elNode('span', ' / ', 'sep'));
            const part = elNode('span', parts[i], 'part' + (i === parts.length - 1 ? ' cur' : ''));
            if (i < parts.length - 1) {
                part.onclick = () => { path = acc.slice(); render(); };
            }
            crumbs.appendChild(part);
            if (i > 0) acc.push(parts[i]);
        }

        const kids = children().filter(c => showPrim || !c.primitive);
        const childSet = new Set(kids.map(c => c.name));
        const nets = internalNets(childSet);
        const modPorts = ports();
        const meta = document.getElementById('meta');
        meta.textContent = '  children ' + kids.length + ' · nets ' + nets.length + ' · ports ' + modPorts.length;

        // ---- 布局：网格 ----
        const cols = Math.max(1, Math.ceil(Math.sqrt(kids.length)));
        kids.forEach((k, i) => {
            const col = i % cols, row = Math.floor(i / cols);
            k._x = PAD + col * (CELL_W + H_GAP) + CELL_W / 2;
            k._y = PAD + row * (CELL_H + V_GAP) + CELL_H / 2;
        });
        const rows = Math.ceil(kids.length / cols);
        const W = PAD * 2 + cols * (CELL_W + H_GAP);
        const H = PAD * 2 + rows * (CELL_H + V_GAP);

        const g = el('g', {});
        svg.appendChild(g);

        // ---- 内部 net 边 ----
        const edgeMap = new Map(); // netName -> line
        for (const n of nets) {
            const group = new Map(); // cell -> pins
            let driver = null;
            for (const p of n.pins || []) {
                if (!childSet.has(p.cell)) continue;
                if (!group.has(p.cell)) group.set(p.cell, []);
                group.get(p.cell).push(p);
                if (/^(OUT|out|INOUT|inout)$/.test(p.dir || '')) driver = p.cell;
            }
            const ids = [...group.keys()];
            const nodeMap = new Map(kids.map(k => [k.name, k]));
            if (ids.length < 2) continue;
            const pairs = driver ? ids.filter(x => x !== driver).map(x => [driver, x])
                : ids.slice(0, -1).map((x, i) => [x, ids[i + 1]]);
            const lines = [];
            for (const [a, b] of pairs) {
                const ka = nodeMap.get(a), kb = nodeMap.get(b);
                if (!ka || !kb) continue;
                const line = el('line', { stroke: 'var(--net-dim)', 'stroke-width': 1.4 });
                line._a = ka; line._b = kb;
                line.setAttribute('title', n.name);
                g.appendChild(line);
                lines.push(line);
                line.addEventListener('click', ev => {
                    ev.stopPropagation();
                    selectNet(n.name);
                });
            }
            edgeMap.set(n.name, lines);
        }

        // ---- 模块框 ----
        for (const k of kids) {
            const isPrim = !!k.primitive;
            const canDrill = expandable(k.name);
            const grp = el('g', {});
            const rect = el('rect', {
                rx: 6, ry: 6,
                fill: isPrim ? 'var(--prim)' : 'var(--cell)',
                stroke: isPrim ? 'var(--border)' : 'var(--box)', 'stroke-width': 1.4
            });
            const label = el('text', { fill: 'var(--text)', 'font-size': 11 });
            label.textContent = k.name.split('/').pop();
            const type = el('text', { fill: 'var(--fg)', 'font-size': 8, opacity: .7 });
            type.textContent = (canDrill ? '◀ ' : '') + k.type;
            grp.appendChild(rect); grp.appendChild(label); grp.appendChild(type);
            grp.setAttribute('title', k.name + '  [' + k.type + ']' + (canDrill ? '\n点击下钻' : ''));
            k._rect = rect; k._label = label; k._type = type;
            g.appendChild(grp);
            grp.addEventListener('click', ev => {
                ev.stopPropagation();
                if (canDrill) { path = segs(k.name); render(); }
            });
        }

        // ---- 几何 ----
        const setGeo = () => {
            for (const k of kids) {
                k._rect.setAttribute('x', k._x - CELL_W / 2);
                k._rect.setAttribute('y', k._y - CELL_H / 2);
                k._rect.setAttribute('width', CELL_W);
                k._rect.setAttribute('height', CELL_H);
                k._label.setAttribute('x', k._x); k._label.setAttribute('y', k._y - 1);
                k._label.setAttribute('text-anchor', 'middle');
                k._type.setAttribute('x', k._x); k._type.setAttribute('y', k._y + 11);
                k._type.setAttribute('text-anchor', 'middle');
            }
            for (const n of nets) {
                for (const line of edgeMap.get(n.name) || []) {
                    line.setAttribute('x1', line._a._x); line.setAttribute('y1', line._a._y);
                    line.setAttribute('x2', line._b._x); line.setAttribute('y2', line._b._y);
                }
            }
        };
        setGeo();

        function selectNet(name) {
            clearNet();
            for (const line of edgeMap.get(name) || []) {
                line.setAttribute('stroke', 'var(--sel)');
                line.setAttribute('stroke-width', 2.6);
            }
        }
        function clearNet() {
            for (const n of nets) {
                for (const line of edgeMap.get(n.name) || []) {
                    line.setAttribute('stroke', 'var(--net-dim)');
                    line.setAttribute('stroke-width', 1.4);
                }
            }
        }

        // ---- 视口 ----
        let vb = { x: 0, y: 0, w: Math.max(W, 800) + 260, h: Math.max(H, 500) };
        let drag = null;
        function apply() { svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h); }
        svg.addEventListener('wheel', ev => {
            ev.preventDefault();
            const s = ev.deltaY < 0 ? .86 : 1.16;
            const r = svg.getBoundingClientRect();
            const mx = (ev.clientX - r.left) / r.width * vb.w + vb.x;
            const my = (ev.clientY - r.top) / r.height * vb.h + vb.y;
            vb.w *= s; vb.h *= s;
            vb.x = mx - (ev.clientX - r.left) / r.width * vb.w;
            vb.y = my - (ev.clientY - r.top) / r.height * vb.h;
            apply();
        }, { passive: false });
        svg.addEventListener('mousedown', ev => { drag = { x: ev.clientX, y: ev.clientY, vx: vb.x, vy: vb.y }; });
        window.addEventListener('mousemove', ev => {
            if (!drag) return;
            const r = svg.getBoundingClientRect();
            vb.x = drag.vx - (ev.clientX - drag.x) / r.width * vb.w;
            vb.y = drag.vy - (ev.clientY - drag.y) / r.height * vb.h;
            apply();
        });
        window.addEventListener('mouseup', () => { drag = null; });
        apply();

        // ---- 端口面板 ----
        const panel = document.getElementById('ports');
        if (modPorts.length) {
            const t = elNode('div', 'Ports (' + modPorts.length + ')');
            t.style.fontWeight = '600';
            t.style.marginBottom = '3px';
            panel.appendChild(t);
            for (const p of modPorts) {
                const d = elNode('div', '');
                d.className = 'pt';
                const b = document.createElement('b');
                b.textContent = (p.dir === 'OUT' || p.dir === 'out' ? '⇧ ' : p.dir === 'INOUT' || p.dir === 'inout' ? '⇅ ' : '⇩ ') + p.name;
                d.appendChild(b);
                panel.appendChild(d);
            }
        }
    }

    function elNode(tag, text, cls) {
        const e = document.createElement(tag);
        if (text !== undefined) e.textContent = text;
        if (cls) e.className = cls;
        return e;
    }

    document.getElementById('back').addEventListener('click', () => {
        if (path.length > 0) { path = path.slice(0, -1); render(); }
    });
</script>
</body>
</html>`;
}

/**
 * @description 渲染错误页面
 */
function makeErrorHtml(message: string): string {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>body{background:#1e1e1e;color:#f85149;font-family:sans-serif;padding:20px;white-space:pre-wrap;}</style>
</head><body>${message}</body></html>`;
}
