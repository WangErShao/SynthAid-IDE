/**
 * IP 参数 schema 定义
 *
 * 人工维护常用 IP 的可配置参数，webview 依据 schema 动态渲染表单，
 * 提交时由 buildIpCreateTcl 生成 create_ip + set_property 命令。
 */

export type IpParamType = 'enum' | 'number' | 'text' | 'bool';

export interface IpParam {
    /** CONFIG.<name> 中的 name，例如 PRIMITIVE */
    name: string;
    /** 表单显示名称 */
    label: string;
    type: IpParamType;
    /** 默认值（字符串形式，Vivado CONFIG 属性都是字符串） */
    default?: string;
    /** enum 类型的候选项 */
    options?: string[];
    /** 提示信息 */
    hint?: string;
}

export interface IpSchema {
    /** VLNV 的 name 部分，例如 clk_wiz */
    id: string;
    version: string;
    vendor: string;
    library: string;
    /** 显示名称 */
    displayName: string;
    /** 功能分类 */
    category: string;
    params: IpParam[];
}

const clkWiz: IpSchema = {
    id: 'clk_wiz',
    version: '6.0',
    vendor: 'xilinx.com',
    library: 'ip',
    displayName: 'Clocking Wizard',
    category: 'Clocking & Reset',
    params: [
        {
            name: 'PRIMITIVE',
            label: '时钟原语',
            type: 'enum',
            default: 'MMCM',
            options: ['MMCM', 'PLL']
        },
        {
            // PRIM_IN_FREQ 才是驱动 clk_in1 实际频率的参数（REF_CLK_FREQ 只是 GUI 参考值，不生效）
            name: 'PRIM_IN_FREQ',
            label: '输入时钟频率 (MHz)',
            type: 'number',
            default: '100.0',
            hint: '输入时钟频率，例如 100.0'
        },
        {
            name: 'CLKIN1_JITTER_PS',
            label: '输入抖动 (ps)',
            type: 'number',
            default: '100',
            hint: '输入时钟抖动，典型值 100~200'
        },
        {
            name: 'CLKOUT1_REQUESTED_OUT_FREQ',
            label: '输出 1 频率 (MHz)',
            type: 'number',
            default: '50.0'
        },
        {
            name: 'CLKOUT2_REQUESTED_OUT_FREQ',
            label: '输出 2 频率 (MHz)',
            type: 'number',
            default: '',
            hint: '留空则只使用 CLKOUT1'
        },
        {
            name: 'CLKOUT3_REQUESTED_OUT_FREQ',
            label: '输出 3 频率 (MHz)',
            type: 'number',
            default: '',
            hint: '留空则不使用'
        },
        {
            name: 'RESET_TYPE',
            label: '复位极性',
            type: 'enum',
            default: 'ACTIVE_HIGH',
            options: ['ACTIVE_HIGH', 'ACTIVE_LOW']
        },
        {
            name: 'USE_RESET',
            label: '使用复位',
            type: 'bool',
            default: 'true'
        },
        {
            name: 'USE_LOCKED',
            label: '使用 LOCKED 信号',
            type: 'bool',
            default: 'true'
        }
    ]
};

const fifoGenerator: IpSchema = {
    id: 'fifo_generator',
    version: '13.2',
    vendor: 'xilinx.com',
    library: 'ip',
    displayName: 'FIFO Generator',
    category: 'Memory',
    params: [
        {
            name: 'Fifo_Implementation',
            label: 'FIFO 实现方式',
            type: 'enum',
            default: 'Common_Clock_Block_RAM',
            options: [
                'Common_Clock_Block_RAM',
                'Common_Clock_Distributed_RAM',
                'Independent_Clocks_Block_RAM',
                'Independent_Clocks_Distributed_RAM',
                'Common_Clock_Builtin_FIFO',
                'Independent_Clocks_Builtin_FIFO'
            ]
        },
        {
            name: 'Input_Data_Width',
            label: '写入数据宽度',
            type: 'number',
            default: '18'
        },
        {
            name: 'Input_Depth',
            label: '写入深度',
            type: 'number',
            default: '1024'
        },
        {
            name: 'Output_Data_Width',
            label: '读出数据宽度',
            type: 'number',
            default: '18',
            hint: '独立时钟模式需单独设置'
        },
        {
            name: 'Output_Depth',
            label: '读出深度',
            type: 'number',
            default: '1024'
        },
        {
            name: 'Use_Embedded_Registers',
            label: '使用内嵌寄存器',
            type: 'bool',
            default: 'false'
        },
        {
            name: 'Read_Data_Count',
            label: '使能读数据计数',
            type: 'bool',
            default: 'false'
        },
        {
            name: 'Write_Data_Count',
            label: '使能写数据计数',
            type: 'bool',
            default: 'false'
        },
        {
            name: 'Reset_Type',
            label: '复位类型',
            type: 'enum',
            default: 'Synchronous_Reset',
            options: ['Synchronous_Reset', 'Asynchronous_Reset']
        },
        {
            name: 'Full_Flags_Reset_Value',
            label: '复位后满标志值',
            type: 'enum',
            default: '0',
            options: ['0', '1']
        }
    ]
};

const blkMemGen: IpSchema = {
    id: 'blk_mem_gen',
    version: '8.4',
    vendor: 'xilinx.com',
    library: 'ip',
    displayName: 'Block Memory Generator',
    category: 'Memory',
    params: [
        {
            name: 'Memory_Type',
            label: '存储器类型',
            type: 'enum',
            default: 'Single_Port_RAM',
            options: [
                'Single_Port_RAM',
                'Simple_Dual_Port_RAM',
                'True_Dual_Port_RAM',
                'Single_Port_ROM',
                'Dual_Port_ROM'
            ]
        },
        {
            name: 'Write_Width_A',
            label: '写数据宽度 (Port A)',
            type: 'number',
            default: '16'
        },
        {
            name: 'Write_Depth_A',
            label: '写深度 (Port A)',
            type: 'number',
            default: '16'
        },
        {
            name: 'Read_Width_A',
            label: '读数据宽度 (Port A)',
            type: 'number',
            default: '16'
        },
        {
            name: 'READ_LATENCY_A',
            label: '读延迟 (Port A)',
            type: 'number',
            default: '1',
            hint: '取值范围 1~256'
        }
    ]
};

const ila: IpSchema = {
    id: 'ila',
    version: '6.2',
    vendor: 'xilinx.com',
    library: 'ip',
    displayName: 'Integrated Logic Analyzer',
    category: 'Debug',
    params: [
        {
            name: 'C_NUM_OF_PROBES',
            label: '探针数量',
            type: 'number',
            default: '1'
        },
        {
            name: 'C_PROBE0_WIDTH',
            label: '探针 0 位宽',
            type: 'number',
            default: '1'
        },
        {
            name: 'C_INPUT_PIPE_STAGES',
            label: '输入流水级数',
            type: 'number',
            default: '0'
        },
        {
            name: 'C_EN_STRG_QUAL',
            label: '使能存储条件',
            type: 'bool',
            default: 'true'
        }
    ]
};

const vio: IpSchema = {
    id: 'vio',
    version: '3.0',
    vendor: 'xilinx.com',
    library: 'ip',
    displayName: 'Virtual Input/Output',
    category: 'Debug',
    params: [
        {
            name: 'C_NUM_PROBE_IN',
            label: '输入探针数量',
            type: 'number',
            default: '1'
        },
        {
            name: 'C_PROBE_IN0_WIDTH',
            label: '输入探针 0 位宽',
            type: 'number',
            default: '1'
        },
        {
            name: 'C_NUM_PROBE_OUT',
            label: '输出探针数量',
            type: 'number',
            default: '1'
        },
        {
            name: 'C_PROBE_OUT0_WIDTH',
            label: '输出探针 0 位宽',
            type: 'number',
            default: '1'
        },
        {
            name: 'C_PROBE_OUT0_INIT_VAL',
            label: '输出探针 0 初值',
            type: 'text',
            default: '0x0',
            hint: '十六进制，如 0x0'
        }
    ]
};

const axiGpio: IpSchema = {
    id: 'axi_gpio',
    version: '2.0',
    vendor: 'xilinx.com',
    library: 'ip',
    displayName: 'AXI GPIO',
    category: 'Peripherals',
    params: [
        {
            name: 'C_GPIO_WIDTH',
            label: 'GPIO 位宽',
            type: 'number',
            default: '32'
        },
        {
            name: 'C_ALL_OUTPUTS',
            label: '全部为输出',
            type: 'bool',
            default: 'false'
        },
        {
            name: 'C_ALL_INPUTS',
            label: '全部为输入',
            type: 'bool',
            default: 'false'
        },
        {
            name: 'C_DOUT_DEFAULT',
            label: '输出默认值',
            type: 'text',
            default: '0x00000000',
            hint: '十六进制'
        },
        {
            name: 'C_IS_DUAL',
            label: '双通道',
            type: 'bool',
            default: 'false'
        },
        {
            name: 'C_INTERRUPT_PRESENT',
            label: '使能中断',
            type: 'bool',
            default: 'false'
        }
    ]
};

export const ipSchemas: Record<string, IpSchema> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'clk_wiz': clkWiz,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'fifo_generator': fifoGenerator,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'blk_mem_gen': blkMemGen,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'ila': ila,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'vio': vio,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'axi_gpio': axiGpio
};

/**
 * @description 根据 schema 与用户填写的参数生成创建 IP 的 TCL 命令
 * @param schema IP schema
 * @param moduleName 实例名（-module_name）
 * @param values 参数名 -> 值（跳过空值）
 */
export function buildIpCreateTcl(
    schema: IpSchema,
    moduleName: string,
    values: Record<string, string>
): string {
    const lines: string[] = [];
    lines.push(
        `create_ip -name ${schema.id} -vendor ${schema.vendor} -library ${schema.library} ` +
        `-version ${schema.version} -module_name ${moduleName}`
    );

    const pairs: string[] = [];
    const extra: Record<string, string> = {};
    for (const param of schema.params) {
        const value = values[param.name];
        if (value === undefined || value === '') {
            continue;
        }
        pairs.push(`CONFIG.${param.name} "${value}"`);
        // 启用某个输出频率时，需同步置 CLKOUTn_USED = true
        const usedMatch = /^CLKOUT(\d+)_REQUESTED_OUT_FREQ$/.exec(param.name);
        if (usedMatch) {
            extra[`CLKOUT${usedMatch[1]}_USED`] = 'true';
        }
    }
    for (const [key, value] of Object.entries(extra)) {
        if (!pairs.some(p => p.startsWith(`CONFIG.${key} `))) {
            pairs.push(`CONFIG.${key} "${value}"`);
        }
    }

    if (pairs.length > 0) {
        lines.push(`set_property -dict [list ${pairs.join(' ')}] [get_ips ${moduleName}]`);
    }

    lines.push(`generate_target all [get_files ${moduleName}.xci]`);
    // 以 xci 路径作为命令结果返回，供扩展定位生成的 IP 文件夹
    lines.push(`get_files -quiet ${moduleName}.xci`);
    return lines.join('\n');
}
