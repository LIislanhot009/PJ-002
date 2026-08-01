# ForgeFlow 智能客服 Agent 工作台

ForgeFlow 是一个面向电商客服团队的多 Agent 协同产品。它把客户在订单、物流、退款和商品异常方面的自然语言问题，转换成一条可追踪、可复核的客服处理流程。

产品不是单纯的聊天机器人，而是一个给客服业务人员使用的 Agent 工作台：

`客户提问 → 意图识别 → 知识库检索 → 客服回复生成 → QA 检查 → Reflection 复盘 → 回复客户`

## 产品背景

电商客服每天需要处理大量重复但不能出错的问题，例如“订单什么时候发货”“物流显示签收但没有收到”“商品破损如何退款”。传统客服系统通常只能提供固定 FAQ 或一个不可解释的对话模型，客服很难知道系统使用了哪些资料、经过了哪些判断，也无法快速复核订单号、物流号和风险边界。

ForgeFlow 针对这个问题提供一个业务可用的客服 Copilot。客服只需要像聊天一样输入客户问题，系统会自动识别意图、检索本地知识库、生成带订单和物流上下文的自然回复，并把每个 Agent 的输入、输出、耗时和校验结果展示在监控中心。这样既能提升一线客服的处理效率，也能让主管复盘每次自动化回复是否可靠。

项目中的订单号、物流号和知识库内容均为合成演示数据，不连接真实客户系统。

## 技术结构

- **Backend**：FastAPI + LangGraph `StateGraph`
- **Agent workflow**：
  - `Intent agent`：优先调用 DeepSeek 做意图识别；无 Key 时使用本地规则降级
  - `Research agent`：基于自造知识库做本地 TF-IDF RAG 检索
  - `Builder agent`：优先调用 DeepSeek 生成客服回复；无 Key 时使用安全模板降级
  - `QA agent`：检查 ID、上下文、敏感信息边界和回复完整性
  - `Reflection agent`：复盘结果并修正最终回复
- **Harness**：包裹每个 LangGraph 节点，记录开始/完成/失败、耗时、guardrail 和输出摘要
- **Memory**：使用 Claude Code 风格的 `memory/MEMORY.md` + `memory/runs.jsonl`
- **Frontend**：React + Vite + lucide-react

## 启动

### 方式一：一条 PowerShell 命令

```powershell
.\start-demo.ps1
```

### 方式二：分别启动

后端：

```powershell
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

前端：

```powershell
cd frontend
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。

### 启用 DeepSeek

项目不会把 API Key 写进代码。PowerShell 中先设置环境变量，再启动服务：

```powershell
$env:DEEPSEEK_API_KEY="你的 DeepSeek Key"
$env:DEEPSEEK_MODEL="deepseek-v4-flash"
.\start-demo.ps1
```

未配置 Key 时系统仍可离线运行，监控和结果预览会标记为 `local-fallback`。Render 部署时，在服务的 `Environment` 页面添加同名 `DEEPSEEK_API_KEY` 和可选的 `DEEPSEEK_MODEL`，不要把真实 Key 提交到 GitHub。

## 交互重点

1. 在工作台输入客户问题，点击发送，系统会自动运行完整 workflow。
2. 观察 LangGraph 节点和 Harness 事件流。
3. 点击不同 Agent 查看输入输出摘要、耗时与 guardrail 状态。
4. 在 `RAG 检索` 页面搜索自造知识库，并把结果 pin 到当前上下文。
5. 在 `项目记忆` 页面查看写入的运行摘要。

## API

- `GET /api/health`
- `POST /api/runs`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/events`
- `GET /api/metrics`
- `POST /api/rag/search`
- `GET /api/memory`

## 公网部署

项目提供 `Dockerfile` 和 `render.yaml`。容器会先构建 React，再由 FastAPI 同源托管 `frontend/dist`，部署后只需要一个公网地址。

1. 在 GitHub 新建空仓库，例如 `forgeflow-agent-console`。
2. 推送本项目代码。
3. 在 Render 选择 `New > Blueprint`，连接仓库并使用 `render.yaml`。
4. 部署完成后打开 Render 提供的地址，访问 `/api/health` 检查后端。

本地验证生产包：

```powershell
docker build -t forgeflow-agent-console .
docker run --rm -p 8000:8000 forgeflow-agent-console
```

然后打开 `http://127.0.0.1:8000`。
