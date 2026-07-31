# ForgeFlow Agent Control Room

一个面向 Atoms Demo 笔试题的可运行 Agent 产品原型：

`自然语言需求 → Planning → Research Agent → Builder Agent → QA Agent → 可视化产物`

## 技术结构

- **Backend**：FastAPI + LangGraph `StateGraph`
- **3 个 Agent**：
  - `Research agent`：基于自造知识库做本地 TF-IDF RAG 检索
  - `Builder agent`：把研究上下文生成成产品结构、页面和交互规格
  - `QA agent`：检查主流程、响应式、错误恢复和风险边界
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

## 交互重点

1. 在工作台输入需求，点击 `Run 3 agents`。
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
