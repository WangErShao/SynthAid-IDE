// Standalone verification of the Vivado synth/impl log analyzer.
// Uses real-format samples (Vivado 2018.3) for synth/impl logs + companion .rpt reports.
//
// Usage (from repo root):
//   npm run compile
//   node scripts/synth-log-analyzer.test.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { XilinxSynthAnalyzer, analyzeSynthLog } = require(path.join(__dirname, '..', 'out', 'function', 'log-analysis', 'analyzer.js'));

const analyzer = new XilinxSynthAnalyzer();
const SYNTH_LOG = 'C:/work/proj/prj/xilinx/template.runs/synth_1/runme.log';
const IMPL_LOG = 'C:/work/proj/prj/xilinx/template.runs/impl_1/runme.log';

// ---- 真实格式：utilization_synth.rpt 的 | Site Type | 5 列表 ----
const utilizationTable = [
    '+-------------------------+------+-------+-----------+-------+',
    '|        Site Type        | Used | Fixed | Available | Util% |',
    '+-------------------------+------+-------+-----------+-------+',
    '| Slice LUTs*             |  163 |     0 |     20800 |  0.78 |',
    '|   LUT as Logic          |  163 |     0 |     20800 |  0.78 |',
    '| Slice Registers         |  162 |     0 |     41600 |  0.39 |',
    '| F7 Muxes                |    0 |     0 |     16300 |  0.00 |',
    '+-------------------------+------+-------+-----------+-------+',
    '* Warning! The Final LUT count ...'
].join('\n');

const synthLog = [
    '****** Vivado v2018.3 (64-bit)******',
    '  SW Build 2405991 on Thu Dec  6 23:38:27 MST 2018',
    '',
    'WARNING: [Synth 8-689] width (12) of port connection \'pix_x\' does not match port width (10)',
    'CRITICAL WARNING: [Vivado 12-574] timing constraints are not properly formed',
    '   see constraints.xdc line 42 for more details.',
    'WARNING: [Synth 8-6157] 1 warning messages generated',
    '',
    'Report Cell Usage: ',
    '+------+--------+------+',
    '|      |Cell    |Count |',
    '+------+--------+------+',
    '|1     |LUT1    |     5|',
    '|2     |FDCE    |   112|',
    '+------+--------+------+',
    '',
    'synth_design completed successfully',
    'INFO: [Common 17-206] Exiting Vivado at ...',
    '',
    '===== template_utilization_synth.rpt =====',
    utilizationTable
].join('\n');

// ---- 真实格式：timing_summary_routed.rpt 的 Design Timing Summary / Clock Summary / Intra Clock Table ----
const timingRpt = [
    '| Design Timing Summary',
    '| ---------------------',
    '',
    '    WNS(ns)      TNS(ns)  TNS Failing Endpoints  TNS Total Endpoints      WHS(ns)      THS(ns)  THS Failing Endpoints  THS Total Endpoints     WPWS(ns)     TPWS(ns)  TPWS Failing Endpoints  TPWS Total Endpoints  ',
    '    -------      -------  ---------------------  -------------------      -------      -------  ---------------------  -------------------     --------     --------  ----------------------  --------------------  ',
    '      5.485        0.000                      0                  188        0.106        0.000                      0                  188        3.500        0.000                       0                   174  ',
    '',
    'All user specified timing constraints are met.',
    '',
    '| Clock Summary',
    '| -------------',
    '',
    'Clock               Waveform(ns)         Period(ns)      Frequency(MHz)',
    '-----               ------------         ----------      --------------',
    'sys_clk             {0.000 10.000}       20.000          50.000          ',
    '  clk_out1_clk_gen  {0.000 20.000}       40.000          25.000          ',
    '',
    '| Intra Clock Table',
    '| -----------------',
    '',
    'Clock                   WNS(ns)      TNS(ns)  TNS Failing Endpoints  TNS Total Endpoints      WHS(ns)      THS(ns)  THS Failing Endpoints  THS Total Endpoints     WPWS(ns)     TPWS(ns)  TPWS Failing Endpoints  TPWS Total Endpoints  ',
    '-----                   -------      -------  ---------------------  -------------------      -------      -------  ---------------------  -------------------     --------     --------  ----------------------  --------------------  ',
    'sys_clk                                                                                                                                                               7.000        0.000                       0                     1  ',
    '  clk_out1_clk_gen       35.475        0.000                      0                  122        0.175        0.000                      0                  122       19.500        0.000                       0                   114  ',
    '  clk_out2_clk_gen        5.830        0.000                      0                   66        0.170        0.000                      0                   66        3.500        0.000                       0                    56  '
].join('\n');

const implLog = [
    '****** Vivado v2018.3 (64-bit)******',
    '',
    'INFO: [Place 30-746] Post Placement Timing Summary WNS=6.152',
    'INFO: [Route 35-416] Intermediate Timing Summary | WNS=5.775  | TNS=0.000  | WHS=-0.393 | THS=-15.667|',
    'INFO: [Route 35-57] Estimated Timing Summary | WNS=5.482  | TNS=0.000  | WHS=0.104  | THS=0.000  |',
    '',
    'WARNING: [Route 35-327] The final timing numbers ...',
    'CRITICAL WARNING: [Vivado 12-574] timing constraints are not properly formed',
    '',
    'INFO: [Common 17-206] Exiting Vivado at ...',
    '',
    '===== template_timing_summary_routed.rpt =====',
    timingRpt
].join('\n');

const repeatLog = [
    '****** Vivado v2020.1 (64-bit)******',
    '',
    'WARNING: [Synth 8-3917] instance u_ram of module ram is unbound',
    'WARNING: [Synth 8-3917] instance u_ram2 of module ram is unbound',
    'WARNING: [Synth 8-3917] instance u_ram of module ram is unbound',
    'ERROR: [Synth 8-615] failed to synthesize module',
    'ERROR: [Synth 8-615] failed to synthesize module',
    'CRITICAL WARNING: [Vivado 12-574] timing constraints are not properly formed',
    ''
].join('\n');

const failLog = [
    '****** Vivado v2018.3 (64-bit)******',
    '',
    'WNS (ns): -1.234',
    'TNS (ns): -12.345',
    'ERROR: [Synth 8-615] failed to synthesize module \'top\'',
    '   the module was not synthesized, see /home/user/design/hdl/top.v line 88',
    'CRITICAL WARNING: [Vivado 12-574] timing constraints are not properly formed',
    ''
].join('\n');

function run(name, fn) {
    try {
        fn();
        console.log('PASS  ' + name);
    } catch (e) {
        console.error('FAIL  ' + name);
        console.error(e.message);
        process.exitCode = 1;
    }
}

// ---- synth log（真实格式 + 配套 utilization rpt） ----
const s = analyzer.analyze(synthLog, SYNTH_LOG);
run('synth: stage is synth', () => assert.strictEqual(s.stage, 'synth'));
run('synth: no errors', () => assert.strictEqual(s.success, true));
run('synth: completed', () => assert.strictEqual(s.completed, true));
run('synth: 1 CRITICAL WARNING, 2 warnings', () => {
    assert.strictEqual(s.criticalWarnings.length, 1);
    assert.strictEqual(s.warnings.length, 2);
});
run('synth: resource table from utilization rpt (5-col)', () => {
    assert.ok(s.resources, 'resources missing');
    assert.strictEqual(s.resources.length, 4);
    assert.strictEqual(s.resources[0].name, 'Slice LUTs*');
    assert.strictEqual(s.resources[0].used, '163');
    assert.strictEqual(s.resources[0].available, '20800');
    assert.strictEqual(s.resources[0].utilization, '0.78');
    assert.strictEqual(s.resources[2].name, 'Slice Registers');
});
run('synth: no timing info', () => assert.strictEqual(s.timing, undefined));

// ---- impl log（真实格式 + 配套 timing rpt） ----
const i = analyzer.analyze(implLog, IMPL_LOG);
run('impl: stage is impl', () => assert.strictEqual(i.stage, 'impl'));
run('impl: run name', () => assert.strictEqual(i.runName, 'impl_1'));
run('impl: completed', () => assert.strictEqual(i.completed, true));
run('impl: timing summary from Design Timing Summary (aligned cols)', () => {
    assert.ok(i.timing, 'timing missing');
    assert.ok(i.timing.summary.some(x => x.name === 'WNS' && x.value === '5.485'));
    assert.ok(i.timing.summary.some(x => x.name === 'TNS' && x.value === '0.000'));
    assert.ok(i.timing.summary.some(x => x.name === 'WHS' && x.value === '0.106'));
    assert.ok(i.timing.summary.some(x => x.name === 'THS' && x.value === '0.000'));
});
run('impl: clock summary extracted', () => {
    assert.ok(i.timing.clocks, 'clocks missing');
    assert.strictEqual(i.timing.clocks.length, 2);
    assert.strictEqual(i.timing.clocks[0].name, 'sys_clk');
    assert.strictEqual(i.timing.clocks[0].period, '20.000');
    assert.strictEqual(i.timing.clocks[0].frequency, '50.000');
});
run('impl: intra clock path groups extracted', () => {
    assert.strictEqual(i.timing.pathGroups.length, 2);
    assert.strictEqual(i.timing.pathGroups[0].name, 'clk_out1_clk_gen');
    assert.strictEqual(i.timing.pathGroups[0].wns, '35.475');
    assert.strictEqual(i.timing.pathGroups[1].name, 'clk_out2_clk_gen');
    assert.strictEqual(i.timing.pathGroups[1].wns, '5.830');
});
run('impl: timing met', () => assert.strictEqual(i.timing.met, true));

// ---- 聚合去重 ----
const r = analyzer.analyze(repeatLog, SYNTH_LOG);
run('agg: errors aggregated to 1 with count 2', () => {
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.errors[0].count, 2);
});
run('agg: warnings aggregated, one has count 2', () => {
    assert.strictEqual(r.warnings.length, 2);
    const counts = r.warnings.map(w => w.count).sort();
    assert.deepStrictEqual(counts, [1, 2]);
});

// ---- 键值格式兜底 + 失败 ----
const f = analyzer.analyze(failLog, SYNTH_LOG);
run('fail: success flag false', () => assert.strictEqual(f.success, false));
run('fail: 1 error, file/line extracted', () => {
    assert.strictEqual(f.errors.length, 1);
    assert.strictEqual(f.errors[0].line, 88);
    assert.ok(f.errors[0].file.includes('top.v'));
});
run('fail: key-value timing WNS (ns): value', () => {
    assert.ok(f.timing.summary.some(x => x.name === 'WNS' && x.value === '-1.234'));
    assert.ok(f.timing.summary.some(x => x.name === 'TNS' && x.value === '-12.345'));
});

// ---- 集成测试：analyzeSynthLog 读取 runme.log + 同目录配套 .rpt ----
(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dide-test-'));
    try {
        fs.writeFileSync(path.join(dir, 'runme.log'), implLog.split('\n===== template_timing_summary_routed.rpt =====')[0]);
        fs.writeFileSync(path.join(dir, 'template_timing_summary_routed.rpt'), timingRpt);
        fs.writeFileSync(path.join(dir, 'template_utilization_placed.rpt'), utilizationTable);

        const result = await analyzeSynthLog(path.join(dir, 'runme.log'));
        run('integration: analyzeSynthLog merges companion .rpt (resources+timing)', () => {
            assert.ok(result, 'result missing');
            assert.ok(result.resources, 'resources should come from utilization_placed.rpt');
            assert.strictEqual(result.resources[0].name, 'Slice LUTs*');
            assert.ok(result.timing, 'timing should come from timing_summary_routed.rpt');
            assert.ok(result.timing.summary.some(x => x.name === 'WNS' && x.value === '5.485'));
            assert.strictEqual(result.timing.clocks.length, 2);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }

    console.log(process.exitCode === 1 ? '\nSOME TESTS FAILED' : '\nALL TESTS PASSED');
})();
