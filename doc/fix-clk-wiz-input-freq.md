# clk_wiz 输入频率参数修复总结

> 修复时间：2026-08-22
> 影响：IP 创建面板创建 Xilinx Clocking Wizard (clk_wiz) 时，输入时钟频率配置无效。

---

## 问题

在 SynthAid-IDE 的 IP 创建面板配置 clk_wiz，设置**输入时钟频率 50MHz** 后，生成的 IP 实际输入频率却是 **100MHz**。

```
预期:  clk_in1 = 50MHz（clkin1_period = 20ns）
实际:  clk_in1 = 100MHz（clkin1_period = 10ns）
```

## 根因

通过 Vivado batch 实测定位：**clk_wiz 6.0 里，`REF_CLK_FREQ` 参数不驱动实际输入频率。**

| 参数 | 作用 | 实测效果 |
|------|------|---------|
| `REF_CLK_FREQ` | GUI 参考显示值 | ❌ 设 50 后 clkin1_period 仍为 10ns（100MHz）|
| `PRIM_IN_FREQ` | **实际主输入频率** | ✅ 设 50 后 clkin1_period 变 20ns（50MHz）|

**结论**：`REF_CLK_FREQ` 只是 GUI 里的"参考频率"显示字段，控制 `clkin1_period` 的真实参数是 **`PRIM_IN_FREQ`**（Vivado 默认 100MHz）。代码里用了 `REF_CLK_FREQ`，导致设置从未生效。

## 验证（Vivado 2018.3 batch 实测）

```
# 方法 A（错误）：REF_CLK_FREQ=50
create_ip -name clk_wiz -version 6.0 -module_name cw_ref
set_property -dict [list CONFIG.REF_CLK_FREQ "50" ...] [get_ips cw_ref]
→ CLKIN1_PERIOD = 10.000（100MHz）❌

# 方法 B（正确）：PRIM_IN_FREQ=50
set_property -dict [list CONFIG.PRIM_IN_FREQ "50" ...] [get_ips cw_ref]
→ CLKIN1_PERIOD = 20.000（50MHz）✅
```

## 修复

`src/function/ip-catalog/schema.ts` —— clk_wiz 输入频率参数名：

```diff
  {
-   name: 'REF_CLK_FREQ',
+   name: 'PRIM_IN_FREQ',   // 驱动 clk_in1 实际频率的参数
    label: '输入时钟频率 (MHz)',
    type: 'number',
    default: '100.0',
  }
```

修复后，面板填"输入时钟频率 50"生成 `CONFIG.PRIM_IN_FREQ "50"`，IP 输入正确为 50MHz。

## 提交

- Commit: `d15d572`
- 已推送 GitHub main

## 附带说明

- 该 bug 一直存在（`REF_CLK_FREQ` 从未生效），现修复。
- 涉及 clk_wiz 6.0（Vivado 2018.3 实测），其他版本 clk_wiz 行为一致（PRIM_IN_FREQ 为输入频率参数）。
