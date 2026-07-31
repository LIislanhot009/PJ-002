# ForgeFlow 智能客服 Agent 项目说明

## 项目概述

ForgeFlow 是一个面向电商客服场景的多 Agent 工作台。用户可以通过 Chat 输入订单、物流、退款或投诉问题，系统会为每轮对话生成一组稳定的模拟订单号和物流号，并保留 conversation_id、turn、RAG 引用和处理路径，支持连续追问。

## 功能完整性

项目使用 React + Vite 构建前端，FastAPI + LangGraph 构建后端。客服请求会依次经过 Planning、Intent agent、Research agent、Builder agent、QA agent 和 Reflection agent。Research agent 从本地 RAG 知识库检索客服规则，Builder agent 生成自然语言回复，QA 与 Reflection 负责质量检查、风险边界和结果修正。监控中心实时展示每个节点的状态、耗时、事件和 Harness guardrail 结果。项目记忆会记录 run_id、conversation_id、turn、意图、订单 ID、物流 ID，并区分模拟数据与真实数据。

## 工程思维

项目采用顺序型 LangGraph，减少不必要的复杂分支，适合演示客服处理链路。Harness 被拆为独立的 `backend/harness.py`，统一处理节点计时、事件落库、异常捕获和 guardrail。RAG 使用本地 TF-IDF，避免依赖外部模型和 API Key，保证离线可运行。多轮上下文由前端携带 history，后端通过 conversation_id 保持同一组演示数据。

## 用户体验

工作台采用 Chat 优先布局，模拟问题支持点击即发送。回复中会显示虚拟订单号和物流号，用户可以继续追问“现在到哪里了”等问题。监控、RAG 数据和项目记忆使用独立页面，降低业务人员理解 Agent 技术细节的成本。项目记忆页提供展开查看 ID 的交互，并提供意图分析入口；由于本 Demo 不配置外部模型余额，点击后会提示“API 余额不足”。

## 创新性与可扩展性

项目将客服对话、RAG 合规展示、Agent 路线图、Harness 监督和 Claude Code 风格记忆结合在同一工作台中。后续可替换本地模拟数据为真实订单 API、接入向量数据库、增加人工审核节点，或把 Reflection agent 改为真实模型评审器。

## 运行与部署

本地运行执行 `.\start-demo.ps1`，前端地址为 `http://127.0.0.1:5173`，后端文档为 `http://127.0.0.1:8000/docs`。公网部署建议前端使用 Vercel，后端使用 Render 或 Railway；前端配置 `VITE_API_BASE` 指向后端公网地址，后端开放对应域名的 CORS。当前项目已完成本地构建验证，公网链接和 GitHub 地址需在绑定账号后补充。
