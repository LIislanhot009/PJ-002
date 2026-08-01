# ForgeFlow 智能客服 Agent 工作台项目笔记

## 项目背景

本项目面向电商客服，解决订单、物流、退款和商品异常处理效率低、过程不可追踪的问题。客服输入客户问题后，系统会自动识别意图、检索知识库、生成自然回复，并展示每个 Agent 的处理路径，方便业务人员复核。订单号、物流号和知识库均为合成演示数据，不连接真实客户系统。

## 技术选型

前端采用 React + Vite，使用 Chat 优先的响应式布局，提供客服会话、Agent 监控、RAG 数据和项目记忆页面。后端采用 FastAPI，使用 LangGraph 编排 Planning、Intent、Research、Builder、QA 和 Reflection 节点。Intent 和 Builder 优先调用 DeepSeek，未配置 Key 时安全降级到基于 RAG 事实的 grounded fallback，不由前端生成假回复。RAG 使用本地 TF-IDF 检索，Harness 负责记录节点状态、执行 ID、输入摘要、输出摘要、耗时和风险校验，Memory 使用 `MEMORY.md` 与 `runs.jsonl` 保存上下文。项目通过 Docker 部署到 Render。

## 任务拆分

先梳理客服流程和模拟数据，再搭建 LangGraph 顺序工作流；随后实现 Harness 事件监督、SSE 实时日志和多轮会话；最后完成 Chat、监控、RAG 表格、记忆展开、Docker、文档和 GitHub 交付。

## 功能目录说明

- **客服 Chat**：业务人员直接输入客户问题，也可以点击模拟问题。系统支持 Enter 发送、Shift + Enter 换行，并生成模拟订单号、物流号和自然客服回复，支持连续追问。
- **会话概览**：展示当前客服会话、请求状态和最近一次处理结果，是业务人员开始工作的默认页面。
- **OUTPUT / PREVIEW**：用一个紧凑的结果卡展示 Agent 生成的客服工作结果、上下文命中数、Guardrail 状态和执行活动。
- **Agent 监控**：展示请求从 Planning、Intent、Research、Builder 到 QA、Reflection 的实时线路。业务人员可以查看 Run ID、Conversation ID、订单 ID、物流 ID、节点状态、技能、耗时和 Harness 日志。
- **RAG 数据**：展示本次提问命中的知识条目、相关度、数据来源和合规状态，使用表格和可视化条形图呈现，还可以固定数据到下一轮上下文。
- **项目记忆**：展示 `MEMORY.md` 和 `runs.jsonl` 保存的历史运行。每条记录可以展开查看原始问题、意图、订单号、物流号、RAG 条数和 Agent 输出数量；意图分析按钮会模拟 API 余额不足提示。

## 测试与交付

项目已通过 `npm run build`、Python 编译和 smoke tests，覆盖本地降级、DeepSeek 意图路径、RAG 合规命中、订单物流 ID 稳定性及完整 Agent 链路。测试还验证了请求创建、实时事件、最终回复和记忆写入，并隔离测试记忆，避免污染业务数据。项目已推送至 GitHub `LIislanhot009/PJ-002`，Render 已配置公网部署。
