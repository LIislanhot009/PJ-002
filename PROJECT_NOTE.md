# ForgeFlow 智能客服 Agent 工作台项目笔记

## 项目背景

本项目面向电商客服，解决订单、物流、退款和商品异常处理效率低、过程不可追踪的问题。客服输入客户问题后，系统会自动识别意图、检索知识库、生成自然回复，并展示每个 Agent 的处理路径，方便业务人员复核。订单号、物流号和知识库均为合成演示数据，不连接真实客户系统。

## 技术选型

前端采用 React + Vite，使用 Chat 优先的响应式布局，提供客服会话、Agent 监控、RAG 数据和项目记忆页面。后端采用 FastAPI，使用 LangGraph 编排 Planning、Intent、Research、Builder、QA 和 Reflection 节点。RAG 使用本地 TF-IDF 检索，Harness 负责记录节点状态、耗时、输出字段和风险校验，Memory 使用 `MEMORY.md` 与 `runs.jsonl` 保存上下文。项目通过 Docker 部署到 Render。

## 任务拆分

先梳理客服流程和模拟数据，再搭建 LangGraph 顺序工作流；随后实现 Harness 事件监督、SSE 实时日志和多轮会话；最后完成 Chat、监控、RAG 表格、记忆展开、Docker、文档和 GitHub 交付。

## 测试与交付

项目已通过 `npm run build`、Python 编译和 4 项 smoke tests，覆盖意图分类、RAG 合规命中、订单物流 ID 稳定性及完整 Agent 链路。测试还验证了请求创建、实时事件、最终回复和记忆写入，并隔离测试记忆，避免污染业务数据。项目已推送至 GitHub `LIislanhot009/PJ-002`，Render 已配置公网部署。
