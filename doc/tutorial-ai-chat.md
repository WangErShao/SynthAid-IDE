# SynthAid-IDE 教程（二）：AI 助手聊天

AI 助手（AI Chat）让你直接与 LLM 对话，它能**基于工程解析结果回答设计问题**，还能**在当前 Vivado 会话里执行 TCL 查询**，帮你分析设计、排查问题。

## 1. 打开方式

- 侧边栏 **SMART Options 树** → 双击 **AI Chat** 节点
- 或命令面板输入 `SynthAid-IDE: 打开 AI 助手聊天`

## 2. 首次使用：配置 API

1. 点击聊天窗口右上角 **⚙ 设置**（或 `Ctrl+,` 打开设置搜索 `digital-ide.assistant`）
2. 配置以下项（默认支持任意 OpenAI 兼容 API）：
   - `digital-ide.assistant.apiBase`：API 地址（默认 `https://api.deepseek.com/v1`）
   - `digital-ide.assistant.apiKey`：你的 API 密钥（必填）
   - `digital-ide.assistant.model`：模型名（默认 `deepseek-v4-pro`）
   - `digital-ide.assistant.systemPrompt`：系统提示词（可自定义）
3. 保存后回到聊天窗口即可使用

> 未配置 apiKey 时，发送消息会提示先设置。

## 3. 基本使用

- 底部输入框输入问题，**回车**发送（`Shift+Enter` 换行）
- 发送后按钮显示"思考中"，整段回复返回；期间工具调用会实时展示在对话里
- **清空**清掉当前对话；再次打开面板会复用同一个会话

## 4. 两大核心能力

### 4.1 自动注入 RTL 设计结构（离线解析）

插件会把工程已解析的**模块层级 / 端口 / 参数 / 例化**注入给 LLM，所以可以直接问：

```
当前工程的顶层模块是什么？有哪些端口？
谁例化了 clk_gen 模块？
xx 信号的位宽是多少？
```

LLM 直接基于解析结果回答，不需要反复查 Vivado。

> 前提：打开工程并等解析完成（HARD 树能看到模块）；文件改动后建议重启窗口刷新上下文。
> 可通过设置 `digital-ide.assistant.injectRtlContext` 开关此功能。

### 4.2 工具调用（run_vivado_tcl）

需要实时信息时，LLM 会自动调用 `run_vivado_tcl` 工具，在**当前 Vivado 进程**里执行 TCL 查询：

```
看看我的资源利用率怎么样？
有没有时序违例？最差路径在哪？
查一下 current_design 里有哪些时钟？
```

> 前提：需要先 **Launch** 启动 Vivado；否则工具调用会报"Vivado 未运行"，LLM 会自行调整。
> 运行综合/实现期间工具调用会排队，可能超时（默认 30s）。

## 5. 示例对话

```
你：当前工程顶层模块是哪个？
AI：顶层是 hdmi_colorbar，端口有 clk、rst_n、hdmi_tx_p 等。

你：资源占用怎么样？
AI：我先查一下。…（调用 report_utilization -return_string）
    LUT 163/20800（0.78%）、寄存器 162/41600（0.39%）…
```

## 6. 注意事项

1. **需要联网**：AI 聊天依赖外部 LLM API（DeepSeek/OpenAI/Ollama 等）。
2. **非流式**：当前为整段返回，流式输出后续版本支持。
3. **上下文来自 hdlParam**：工程未打开/未解析时 RTL 上下文为空（有兜底提示）。
