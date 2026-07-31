import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clock3,
  ChevronDown,
  Database,
  FileSearch,
  GitBranch,
  History,
  Layers3,
  LoaderCircle,
  MemoryStick,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "";

const initialPrompt =
  "做一个面向电商业务的智能客服 Copilot。支持订单查询、物流进度、退款申请和人工升级；客服可以看到知识库引用、客户历史和 Agent 处理状态。";

const AGENTS = [
  {
    id: "intent",
    label: "Intent agent",
    role: "意图识别与路由",
    description: "识别订单、物流、退款和投诉意图",
    flowRole: "识别客户意图",
    skills: ["问题分类", "路由判断"],
    color: "blue",
    icon: BrainCircuit,
  },
  {
    id: "research",
    label: "Research agent",
    role: "RAG 检索与订单上下文",
    description: "检索知识库并沿用本轮会话的演示订单",
    flowRole: "检索知识与订单上下文",
    skills: ["知识库检索", "来源合规审计"],
    color: "teal",
    icon: FileSearch,
  },
  {
    id: "builder",
    label: "Builder agent",
    role: "客服回复生成",
    description: "把意图、知识和订单信息组织成自然回复",
    flowRole: "组织回复与下一步",
    skills: ["自然语言回复", "订单上下文拼接"],
    color: "violet",
    icon: Layers3,
  },
  {
    id: "qa",
    label: "QA agent",
    role: "质量检查与风险边界",
    description: "检查 ID、上下文、多轮信息和敏感数据边界",
    flowRole: "检查回复质量",
    skills: ["回复风险检查", "ID 一致性校验"],
    color: "yellow",
    icon: ShieldCheck,
  },
  {
    id: "reflection",
    label: "Reflection agent",
    role: "结果反思与回复修正",
    description: "复盘本轮处理结果，必要时修正最终回复",
    flowRole: "反思并修正回复",
    skills: ["多轮复盘", "回复修正"],
    color: "coral",
    icon: History,
  },
];

const DEFAULT_MONITOR_EVENTS = [
  { id: "demo-1", type: "node", status: "completed", node: "planning", agent: "planning", message: "已拆解订单查询问题和客服处理目标", timestamp: "2026-07-31T09:42:18", duration_ms: 86 },
  { id: "demo-2", type: "rag", status: "completed", node: "research_agent", agent: "research", message: "RAG 命中 4 条客服知识数据", timestamp: "2026-07-31T09:42:19", duration_ms: 164 },
  { id: "demo-3", type: "node", status: "completed", node: "research_agent", agent: "research", message: "完成订单、物流和退款规则检索", timestamp: "2026-07-31T09:42:19", duration_ms: 142 },
  { id: "demo-4", type: "node", status: "completed", node: "builder_agent", agent: "builder", message: "生成客服回复建议和人工升级路径", timestamp: "2026-07-31T09:42:20", duration_ms: 218 },
  { id: "demo-5", type: "harness", status: "completed", node: "builder_agent", agent: "builder", message: "Harness 校验输出字段和风险边界", timestamp: "2026-07-31T09:42:20", duration_ms: 74 },
  { id: "demo-6", type: "node", status: "completed", node: "qa_agent", agent: "qa", message: "通过客服主流程和转人工状态检查", timestamp: "2026-07-31T09:42:21", duration_ms: 121 },
  { id: "demo-7", type: "memory", status: "completed", node: "memory", agent: "memory", message: "已保存本次客服处理上下文", timestamp: "2026-07-31T09:42:21", duration_ms: 32 },
];

function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [prompt, setPrompt] = useState(() => localStorage.getItem("forgeflow-prompt") || initialPrompt);
  const [projectName, setProjectName] = useState(() => {
    const stored = localStorage.getItem("forgeflow-project");
    return stored && stored !== "Aurora Finance Copilot" ? stored : "客服处理工作流";
  });
  const [conversationId] = useState(() => localStorage.getItem("forgeflow-conversation") || `conversation-${Date.now()}`);
  const [chatDraft, setChatDraft] = useState("");
  const [chatMessages, setChatMessages] = useState([
    {
      role: "assistant",
      content: "您好，欢迎来找我～我可以帮您查订单、看物流、处理退款。如果问题比较复杂，我也会帮您转给人工客服。请问您现在遇到什么问题啦？",
    },
  ]);
  const [run, setRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [metrics, setMetrics] = useState({ total_runs: 0, active_runs: 0, completed_runs: 0, avg_node_ms: 0, guardrail_pass_rate: 100 });
  const [memory, setMemory] = useState({ runs: [] });
  const [isRunning, setIsRunning] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("research");
  const [query, setQuery] = useState(prompt);
  const [ragHits, setRagHits] = useState([]);
  const [ragLoading, setRagLoading] = useState(false);
  const [contextPins, setContextPins] = useState([]);
  const [toast, setToast] = useState(null);

  const showToast = (message, detail = "", kind = "success") => {
    setToast({ message, detail, kind });
    window.setTimeout(() => setToast(null), 2800);
  };

  const showIntentAnalysisWarning = () => {
    showToast("API 余额不足", "暂时无法调用外部意图分析服务", "error");
  };

  const refreshMetrics = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/metrics`);
      if (response.ok) setMetrics(await response.json());
    } catch {
      // The UI remains usable while the backend is starting.
    }
  };

  const refreshMemory = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/memory?limit=8`);
      if (response.ok) setMemory(await response.json());
    } catch {
      // Empty memory is a valid first-run state.
    }
  };

  useEffect(() => {
    refreshMetrics();
    refreshMemory();
    const interval = window.setInterval(() => {
      refreshMetrics();
      refreshMemory();
    }, 4000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadInitialRag = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/rag/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: initialPrompt, limit: 6 }),
        });
        if (!cancelled && response.ok) {
          const data = await response.json();
          setRagHits(data.hits || []);
        }
      } catch {
        // RAG data will retry when the user submits a customer question.
      }
    };
    loadInitialRag();
    return () => { cancelled = true; };
  }, []);

  const saveDraft = (nextPrompt) => {
    setPrompt(nextPrompt);
    localStorage.setItem("forgeflow-prompt", nextPrompt);
  };

  const updateAssistantMessage = (messageId, content, metadata = {}) => {
    setChatMessages((current) => current.map((message) => (
      message.id === messageId ? { ...message, content, pending: false, ...metadata } : message
    )));
  };

  const sendChatMessage = (messageOverride) => {
    const content = (messageOverride ?? chatDraft).trim();
    if (!content || isRunning) return;
    const history = chatMessages
      .filter((message) => !message.pending)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    const assistantMessageId = `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const turn = history.filter((message) => message.role === "user").length + 1;
    setChatMessages((current) => [
      ...current,
      { role: "user", content, id: `user-${Date.now()}` },
      { role: "assistant", content: "我先帮您核对这笔信息，请稍等一下。", id: assistantMessageId, pending: true },
    ]);
    saveDraft(content);
    setChatDraft("");
    searchRag(content);
    if (content.length >= 3) startRun(content, assistantMessageId, history, turn);
  };

  const startRun = async (promptOverride, assistantMessageId, history = [], turn = 1) => {
    const runPrompt = (promptOverride || prompt).trim();
    if (!runPrompt || isRunning) return;
    setIsRunning(true);
    setEvents([]);
    setRun({ status: "queued", project_name: projectName, prompt: runPrompt, conversation_id: conversationId, turn });
    setActiveTab("overview");
    setSelectedAgent("intent");
    localStorage.setItem("forgeflow-prompt", runPrompt);
    localStorage.setItem("forgeflow-project", projectName);
    localStorage.setItem("forgeflow-conversation", conversationId);

    try {
      const response = await fetch(`${API_BASE}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: runPrompt,
          project_name: projectName,
          context_ids: contextPins,
          conversation_id: conversationId,
          history,
          turn,
        }),
      });
      if (!response.ok) throw new Error("创建运行失败");
      const created = await response.json();
      setRun(created);
      await subscribeToRun(created.run_id, assistantMessageId, runPrompt);
    } catch (error) {
      setRun({ status: "failed", error: error.message });
      setIsRunning(false);
      if (assistantMessageId) updateAssistantMessage(assistantMessageId, getCustomerReply(runPrompt), { fallback: true });
      showToast("无法连接 Agent Harness", "请确认后端运行在 8000 端口", "error");
    }
  };

  const subscribeToRun = async (runId, assistantMessageId, fallbackPrompt) => {
    const response = await fetch(`${API_BASE}/api/runs/${runId}/events`);
    if (!response.ok || !response.body) throw new Error("无法订阅运行事件");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      buffer += decoder.decode(result.value || new Uint8Array(), { stream: !done });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const payload = JSON.parse(dataLine.slice(5).trim());
        if (payload.status && payload.message) {
          setEvents((previous) => [...previous, payload]);
          if (payload.agent) setSelectedAgent(payload.agent);
        } else if (payload.status) {
          setRun((previous) => ({ ...previous, status: payload.status }));
        }
        if (payload.type === "node" && payload.status === "completed") {
          setRun((previous) => ({ ...previous, status: "running", last_node: payload.node }));
        }
      }
    }
    const finalResponse = await fetch(`${API_BASE}/api/runs/${runId}`);
    const finalRun = await finalResponse.json();
    setRun(finalRun);
    setIsRunning(false);
    if (assistantMessageId) {
      updateAssistantMessage(
        assistantMessageId,
        finalRun.final_output?.customer_reply || getCustomerReply(fallbackPrompt),
        {
          intent: finalRun.final_output?.intent,
          orderId: finalRun.final_output?.order_id,
          trackingId: finalRun.final_output?.tracking_id,
          turn: finalRun.final_output?.turn,
        },
      );
    }
    refreshMetrics();
    refreshMemory();
    showToast(
      finalRun.status === "completed" ? "运行完成，产物已生成" : "运行失败，请查看 Harness 事件",
      finalRun.status === "completed" ? "Harness 已写入项目记忆" : "请查看失败节点的事件",
      finalRun.status === "completed" ? "success" : "error",
    );
  };

  const searchRag = async (queryOverride) => {
    const searchQuery = (queryOverride ?? query).trim();
    if (!searchQuery) return;
    if (queryOverride) setQuery(searchQuery);
    setRagLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/rag/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, limit: 6 }),
      });
      const data = await response.json();
      setRagHits(data.hits || []);
    } catch {
      showToast("RAG 检索失败", "请确认后端服务已启动", "error");
    } finally {
      setRagLoading(false);
    }
  };

  const toggleContext = (id) => {
    setContextPins((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const currentAgentOutput = run?.agent_outputs?.[selectedAgent] || null;
  const currentAgentMeta = AGENTS.find((item) => item.id === selectedAgent) || AGENTS[0];
  const latestEvents = events.slice(-16).reverse();
  const stageStatus = (id) => {
    if (!run) return "idle";
    if (run.status === "completed") return "completed";
    const completed = events.some((event) => event.agent === id && event.status === "completed");
    const active = events.some((event) => event.agent === id && event.status === "running") && !completed;
    return completed ? "completed" : active ? "running" : "queued";
  };

  return <ChatWorkspace
    projectName={projectName}
    chatMessages={chatMessages}
    chatDraft={chatDraft}
    setChatDraft={setChatDraft}
    onSendChat={sendChatMessage}
    isRunning={isRunning}
    run={run}
    activeTab={activeTab}
    setActiveTab={setActiveTab}
    events={events}
    latestEvents={latestEvents}
    metrics={metrics}
    selectedAgent={selectedAgent}
    setSelectedAgent={setSelectedAgent}
    currentAgentOutput={currentAgentOutput}
    currentAgentMeta={currentAgentMeta}
    stageStatus={stageStatus}
    query={query}
    setQuery={setQuery}
    onSearch={searchRag}
    ragLoading={ragLoading}
    ragHits={ragHits}
    contextPins={contextPins}
    toggleContext={toggleContext}
    memory={memory}
    onIntentAnalysis={showIntentAnalysisWarning}
  />;
}

function ChatWorkspace({
  projectName,
  setProjectName,
  chatMessages,
  chatDraft,
  setChatDraft,
  onSendChat,
  onRun,
  isRunning,
  run,
  activeTab,
  setActiveTab,
  events,
  latestEvents,
  metrics,
  selectedAgent,
  setSelectedAgent,
  currentAgentOutput,
  currentAgentMeta,
  stageStatus,
  query,
  setQuery,
  onSearch,
  ragLoading,
  ragHits,
  contextPins,
  toggleContext,
  memory,
  onIntentAnalysis,
}) {
  if (activeTab !== "overview") {
    return <OperationsPage
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      projectName={projectName}
      run={run}
      events={events}
      latestEvents={latestEvents}
      metrics={metrics}
      isRunning={isRunning}
      selectedAgent={selectedAgent}
      setSelectedAgent={setSelectedAgent}
      currentAgentOutput={currentAgentOutput}
      currentAgentMeta={currentAgentMeta}
      stageStatus={stageStatus}
      query={query}
      setQuery={setQuery}
      onSearch={onSearch}
      ragLoading={ragLoading}
      ragHits={ragHits}
      contextPins={contextPins}
      toggleContext={toggleContext}
      memory={memory}
      onIntentAnalysis={onIntentAnalysis}
    />;
  }

  return <div className="chat-app-shell">
    <header className="chat-app-header">
      <button className="chat-brand" onClick={() => setActiveTab("overview")}>
        <span className="chat-brand-mark"><Sparkles size={16} /></span>
        <span><strong>ForgeFlow</strong><small>智能客服 Copilot</small></span>
      </button>
      <div className="chat-header-actions">
        <span className="connection-state"><span />服务在线</span>
        <button className="chat-new-button" onClick={() => window.location.reload()} title="新建会话"><Plus size={16} /></button>
        <span className="avatar">YC</span>
      </div>
    </header>

    <main className="chat-app-body">
      <section className="chat-column">
        <div className="chat-conversation-head">
          <div><span className="chat-section-label">客服会话</span><h1>您好，今天想处理什么问题？</h1><p>您可以直接告诉我订单、物流、退款或其他问题。</p></div>
          <div className="chat-session-meta"><span><MessageCircle size={15} /> 当前会话</span><strong>{chatMessages.filter((message) => message.role === "user").length + 1} 条消息</strong></div>
        </div>

        <div className="chat-canvas" aria-live="polite">
          {chatMessages.map((message, index) => <div className={`deep-chat-message ${message.role}`} key={`${message.role}-${index}`}><div className="deep-message-avatar">{message.role === "assistant" ? <Sparkles size={15} /> : "你"}</div><div className="deep-message-body"><span className="deep-message-name">{message.role === "assistant" ? "在线客服" : "我"}</span><p>{message.content}</p></div></div>)}
        </div>

        <div className="chat-compose-area">
          <div className="chat-shortcuts">
            <span className="chat-shortcuts-label">模拟问题</span>
            {["我的订单为什么还没有发货？", "物流显示签收但我没有收到", "这件商品可以退款吗？", "收到的商品有破损怎么办？"].map((suggestion) => <button key={suggestion} onClick={() => onSendChat(suggestion)} disabled={isRunning}>{suggestion}</button>)}
          </div>
          <div className="deep-composer">
            <textarea
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSendChat();
                }
              }}
              placeholder="输入客户问题，例如：我的订单号是多少？现在物流到哪里了？"
            />
            <div className="deep-composer-tools">
              <span><Database size={13} /> 客服资料已连接</span>
              <span>Enter 发送 · Shift + Enter 换行</span>
              <button onClick={onSendChat} disabled={!chatDraft.trim() || isRunning} title="发送">
                <Send size={17} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <aside className="directory-column">
        <div className="directory-header"><div><span className="directory-kicker">WORKSPACE</span><h2>功能预览</h2></div><button className="icon-only" title="刷新数据" onClick={() => window.location.reload()}><RefreshCw size={15} /></button></div>
        <nav className="directory-nav">
          <button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}><MessageCircle size={15} />会话概览</button>
          <button className={activeTab === "monitor" ? "active" : ""} onClick={() => setActiveTab("monitor")}><Activity size={15} />Agent 监控</button>
          <button className={activeTab === "rag" ? "active" : ""} onClick={() => setActiveTab("rag")}><Database size={15} />RAG 数据</button>
          <button className={activeTab === "memory" ? "active" : ""} onClick={() => setActiveTab("memory")}><MemoryStick size={15} />项目记忆</button>
        </nav>
        <div className="directory-content">
          {activeTab === "overview" && <DirectoryOverview run={run} isRunning={isRunning} setActiveTab={setActiveTab} />}
          {activeTab === "monitor" && <DirectoryMonitor run={run} events={events} latestEvents={latestEvents} ragHits={ragHits} metrics={metrics} isRunning={isRunning} selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} currentAgentOutput={currentAgentOutput} currentAgentMeta={currentAgentMeta} stageStatus={stageStatus} />}
          {activeTab === "rag" && <DirectoryRag query={query} setQuery={setQuery} onSearch={onSearch} loading={ragLoading} hits={ragHits} contextPins={contextPins} toggleContext={toggleContext} />}
          {activeTab === "memory" && <DirectoryMemory memory={memory} />}
        </div>
      </aside>
    </main>
  </div>;
}

function OperationsPage({
  activeTab,
  setActiveTab,
  projectName,
  run,
  events,
  latestEvents,
  metrics,
  isRunning,
  selectedAgent,
  setSelectedAgent,
  currentAgentOutput,
  currentAgentMeta,
  stageStatus,
  query,
  setQuery,
  onSearch,
  ragLoading,
  ragHits,
  contextPins,
  toggleContext,
  memory,
  onIntentAnalysis,
}) {
  const labels = { monitor: "监控中心", rag: "RAG 数据", memory: "项目记忆" };
  return <div className="operations-shell">
    <header className="operations-header">
      <button className="chat-brand" onClick={() => setActiveTab("overview")}><span className="chat-brand-mark"><Sparkles size={16} /></span><span><strong>ForgeFlow</strong><small>智能客服 Copilot</small></span></button>
      <div className="operations-breadcrumb"><span>功能预览</span><ArrowRight size={14} /><strong>{labels[activeTab]}</strong><span>{projectName}</span></div>
      <div className="chat-header-actions"><span className="connection-state"><span />服务在线</span><span className="avatar">YC</span></div>
    </header>
    <main className="operations-body">
      <aside className="operations-directory">
        <div className="operations-directory-head"><span className="directory-kicker">WORKSPACE</span><h2>功能预览</h2><p>查看客服系统的运行状态与数据来源。</p></div>
        <nav className="operations-nav">
          <button onClick={() => setActiveTab("overview")}><MessageCircle size={16} /><span><strong>客服 Chat</strong><small>处理客户问题</small></span><ArrowRight size={14} /></button>
          <button className={activeTab === "monitor" ? "active" : ""} onClick={() => setActiveTab("monitor")}><Activity size={16} /><span><strong>监控中心</strong><small>实时查看 Agent 线路</small></span><ArrowRight size={14} /></button>
          <button className={activeTab === "rag" ? "active" : ""} onClick={() => setActiveTab("rag")}><Database size={16} /><span><strong>RAG 数据</strong><small>检索结果与合规来源</small></span><ArrowRight size={14} /></button>
          <button className={activeTab === "memory" ? "active" : ""} onClick={() => setActiveTab("memory")}><MemoryStick size={16} /><span><strong>项目记忆</strong><small>运行上下文与历史</small></span><ArrowRight size={14} /></button>
        </nav>
        <div className="operations-directory-foot"><ShieldCheck size={15} /><span>Harness 监督已开启<br />每个节点都有事件记录</span></div>
      </aside>
      <section className="operations-content">
        <div className="operations-content-head"><div><span className="operations-kicker">{activeTab === "monitor" ? "LIVE OBSERVABILITY" : activeTab === "rag" ? "RETRIEVAL AUDIT" : "PROJECT CONTEXT"}</span><h1>{labels[activeTab]}</h1><p>{activeTab === "monitor" ? "查看三个 Agent 如何协作处理客服请求。" : activeTab === "rag" ? "查看客户提问后命中的数据、相关度和来源合规性。" : "查看客服系统如何保存和复用上下文。"}</p></div><span className="operations-run-status"><span />{isRunning ? "正在运行" : run?.status === "completed" ? "最近一次已完成" : "等待任务"}</span></div>
       {activeTab === "monitor" && <MonitorOperations projectName={projectName} run={run} events={events} latestEvents={latestEvents} metrics={metrics} isRunning={isRunning} selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} currentAgentOutput={currentAgentOutput} currentAgentMeta={currentAgentMeta} stageStatus={stageStatus} ragHits={ragHits} />}
        {activeTab === "rag" && <RagOperations query={query} setQuery={setQuery} onSearch={onSearch} loading={ragLoading} hits={ragHits} contextPins={contextPins} toggleContext={toggleContext} />}
        {activeTab === "memory" && <MemoryOperations memory={memory} onIntentAnalysis={onIntentAnalysis} />}
      </section>
    </main>
  </div>;
}

function MonitorOperations({ projectName, run, events, latestEvents, metrics, isRunning, selectedAgent, setSelectedAgent, currentAgentOutput, currentAgentMeta, stageStatus, ragHits }) {
  const AgentIcon = currentAgentMeta.icon;
  const demoMonitorEvents = [
    ...DEFAULT_MONITOR_EVENTS,
    { id: "demo-intent", type: "intent", status: "completed", node: "intent_agent", agent: "intent", message: "识别为物流 / 配送查询，置信度 98%", timestamp: "2026-07-31T09:42:18", duration_ms: 83 },
    { id: "demo-reflection", type: "reflection", status: "completed", node: "reflection_agent", agent: "reflection", message: "完成本轮回复反思与修正，Harness 复核通过", timestamp: "2026-07-31T09:42:21", duration_ms: 128 },
  ];
  const displayEvents = events.length ? events : demoMonitorEvents;
  const displayLatestEvents = latestEvents.length ? latestEvents : demoMonitorEvents.slice().reverse();
  const eventMetadata = events.reduce((result, event) => ({ ...result, ...(event.metadata || {}) }), {});
  const requestContext = {
    ...(run?.customer_context || {}),
    order_id: run?.customer_context?.order_id || eventMetadata.order_id,
    tracking_id: run?.customer_context?.tracking_id || eventMetadata.tracking_id,
  };
  const getDisplayStatus = (agentId) => run ? stageStatus(agentId) : "completed";
  const displayDuration = run?.metrics?.[`${selectedAgent}_agent`]?.duration_ms || ({ intent: 83, research: 142, builder: 218, qa: 121, reflection: 128 }[selectedAgent] || 142);
  const completedEvents = displayEvents.filter((event) => event.status === "completed").length;
  const activeRequest = run?.prompt || "客户请求";
  const planningStatus = run
    ? displayEvents.some((event) => event.node === "planning" && event.status === "completed")
      ? "completed"
      : displayEvents.some((event) => event.node === "planning" && event.status === "running")
        ? "running"
        : "queued"
    : "completed";
  const flowNodes = [
    { id: "planning", label: "Planning", role: "拆解问题", description: "识别客户意图与处理目标", color: "planning", status: planningStatus, marker: "P" },
    ...AGENTS.map((agent, index) => ({
      ...agent,
      label: agent.label.replace(" agent", ""),
      role: index === 0 ? "检索知识与订单上下文" : index === 1 ? "组织回复与升级方案" : "检查风险与回复质量",
      status: getDisplayStatus(agent.id),
      marker: index + 1,
    })),
  ].map((node) => ({ ...node, role: node.flowRole || node.role }));
  const completedFlowNodes = flowNodes.filter((node) => node.status === "completed").length;
  const flowProgress = Math.max(12, Math.round((completedFlowNodes / flowNodes.length) * 100));
  return <div className="operations-stack">
    <div className="monitor-hero-grid">
      <section className="visual-panel route-visual">
         <div className="visual-panel-head"><div><span>客服处理工作流 / AGENT ROUTES</span><h2>客服请求正在经过哪些节点？</h2></div><span className="visual-live"><span />{isRunning ? "LIVE" : "READY"}</span></div>
         <div className="route-source"><span className="route-source-dot"><MessageCircle size={13} /></span><span><strong>{activeRequest}</strong><small>订单、物流、退款或投诉问题进入处理线路</small></span><span className="route-source-state">{isRunning ? "正在分发" : "已接收"}</span></div>
         <div className="monitor-request-context">
           <span><small>Run ID</small><strong>{run?.run_id || "—"}</strong></span>
           <span><small>Conversation</small><strong>{run?.conversation_id || "—"}</strong></span>
           <span><small>订单 ID</small><strong>{requestContext.order_id || "等待 Research"}</strong></span>
           <span><small>物流 ID</small><strong>{requestContext.tracking_id || "等待 Research"}</strong></span>
         </div>
         <div className="monitor-rag-strip">
           <div><Database size={14} /><span><strong>本次 RAG</strong><small>{ragHits.length ? `已实时命中 ${ragHits.length} 条数据` : "等待 Research agent 返回检索结果"}</small></span></div>
           <div className="monitor-rag-sources">{ragHits.slice(0, 3).map((hit) => <span key={hit.id} title={hit.title}>{hit.id} · {Math.round(hit.score * 100)}%</span>)}</div>
         </div>
         <div className="agent-flow-map">
          <div className="agent-flow-track"><i /></div>
          {flowNodes.map((node, index) => {
            const isAgent = Boolean(node.id && node.id !== "planning");
            const NodeIcon = isAgent ? node.icon : GitBranch;
            return <React.Fragment key={node.id}>
              <button className={`agent-flow-node ${node.color} ${node.status} ${selectedAgent === node.id ? "selected" : ""}`} onClick={() => isAgent && setSelectedAgent(node.id)} disabled={!isAgent}>
                <span className="agent-flow-marker">{node.status === "completed" ? <Check size={14} /> : node.status === "running" ? <LoaderCircle size={14} className="spin" /> : node.marker}</span>
                <span className="agent-flow-icon"><NodeIcon size={15} /></span>
                <strong>{node.label}{isAgent ? " agent" : ""}</strong>
                <small>{node.role}</small>
                <em>{node.status === "completed" ? "已完成" : node.status === "running" ? "处理中" : "等待中"}</em>
              </button>
              {index < flowNodes.length - 1 && <span className="agent-flow-arrow"><ArrowRight size={14} /></span>}
            </React.Fragment>;
          })}
        </div>
        <div className="route-destination"><span><ArrowRight size={13} />客服回复</span><span>需要时转人工</span><strong>{run ? `${completedEvents}/7 events` : "最近一次 7/7"}</strong></div>
        <div className="route-progress route-progress-new"><span>Agent route progress</span><div><i style={{ width: `${flowProgress}%` }} /></div><strong>{completedFlowNodes}/{flowNodes.length} nodes</strong></div>
        <div className="animated-route">
          <div className={`animated-node planning ${run ? "done" : ""}`}><span>P</span><strong>Planning</strong><small>拆解问题</small></div>
          <div className="animated-connector"><i /></div>
          {AGENTS.map((agent, index) => <React.Fragment key={agent.id}><button className={`animated-node ${agent.color} ${getDisplayStatus(agent.id)} ${selectedAgent === agent.id ? "selected" : ""}`} onClick={() => setSelectedAgent(agent.id)}><span>{getDisplayStatus(agent.id) === "completed" ? <Check size={14} /> : getDisplayStatus(agent.id) === "running" ? <LoaderCircle size={14} className="spin" /> : index + 1}</span><strong>{agent.label.replace(" agent", "")}</strong><small>{agent.role.split("与")[0]}</small></button>{index < AGENTS.length - 1 && <div className="animated-connector"><i /></div>}</React.Fragment>)}
        </div>
        <div className="route-progress"><span>Pipeline progress</span><div><i style={{ width: `${Math.max(12, Math.round((completedEvents / 7) * 100))}%` }} /></div><strong>{run ? `${completedEvents}/7 events` : "最近一次 7/7"}</strong></div>
      </section>
      <section className="visual-panel pulse-visual"><div className="visual-panel-head"><div><span>EVENT PULSE</span><h2>系统活动</h2></div><BarChart3 size={18} className="visual-icon" /></div><div className="pulse-bars">{[18, 38, 26, 52, 34, 60, 42, 78, 55, 72, 63, 88].map((height, index) => <i key={index} style={{ height: `${height}%`, animationDelay: `${index * 70}ms` }} />)}</div><div className="pulse-caption"><span>{displayEvents.length} tracked events</span><strong>{metrics.avg_node_ms || 146}ms avg</strong></div></section>
    </div>
    <div className="monitor-operations-grid">
       <section className="visual-panel inspector-visual"><div className="visual-panel-head"><div><span>HARNESS / INSPECTOR</span><h2>{currentAgentMeta.label}</h2></div><span className="compliance-badge"><ShieldCheck size={13} /> passed</span></div><div className="inspector-agent-line"><span className={`directory-agent-icon ${currentAgentMeta.color}`}><AgentIcon size={16} /></span><span><strong>{currentAgentMeta.role}</strong><small>{currentAgentOutput?.headline || "最近一次运行已完成"}</small></span></div><div className="inspector-skills">{(currentAgentMeta.skills || []).map((skill) => <span key={skill}>{skill}</span>)}</div><div className="inspector-copy">{currentAgentOutput?.summary || "最近一次客服处理已完成，Harness 已通过输出字段和风险边界检查。"}</div><div className="inspector-stats"><span><Clock3 size={14} /> {displayDuration}ms</span><span><Database size={14} /> {ragHits.length} RAG hits</span><span><ShieldCheck size={14} /> supervised</span></div></section>
      <section className="visual-panel live-events-visual"><div className="visual-panel-head"><div><span>03 / OBSERVE</span><h2>实时 Harness 事件</h2></div><span className="event-count"><Activity size={13} /> {displayEvents.length}</span></div><div className="live-event-list">{displayLatestEvents.slice(0, 7).map((event) => <div className="live-event-item" key={`${event.id}-${event.timestamp}`}><span className={`event-dot ${event.status}`} /><span><strong>{event.agent || event.node || "system"}</strong><small>{event.message}</small>{eventContext(event) && <em>{eventContext(event)}</em>}</span><time>{event.duration_ms ? `${event.duration_ms}ms` : "now"}</time></div>)}</div></section>
    </div>
  </div>;
}

function RagOperations({ query, setQuery, onSearch, loading, hits, contextPins, toggleContext }) {
  const compliant = hits.filter((hit) => hit.compliance?.status === "合规").length;
  const average = hits.length ? Math.round((hits.reduce((sum, hit) => sum + hit.score, 0) / hits.length) * 100) : 0;
  return <div className="operations-stack">
    <section className="visual-panel retrieval-visual"><div className="retrieval-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSearch()} placeholder="输入客户提问，查看本次会检索哪些数据..." /><button onClick={() => onSearch()} disabled={loading}>{loading ? <LoaderCircle size={15} className="spin" /> : <><Search size={14} />开始检索</>}</button></div><div className="retrieval-summary"><div><span>本次命中</span><strong>{hits.length}</strong><small>条数据</small></div><div><span>平均相关度</span><strong>{average}%</strong><small>TF-IDF score</small></div><div><span>合规来源</span><strong className="green-text">{compliant}</strong><small>可用于本地 RAG</small></div><div><span>固定使用</span><strong>{contextPins.length}</strong><small>下次运行带入</small></div></div></section>
    <section className="visual-panel retrieval-chart-panel"><div className="visual-panel-head"><div><span>RETRIEVAL VISUALIZATION</span><h2>用户问题命中了哪些数据？</h2></div><span className="compliance-badge"><ShieldCheck size={13} /> source audit</span></div>{hits.length ? <div className="retrieval-bars">{hits.map((hit, index) => <div className="retrieval-bar-row" key={hit.id}><span>{String(index + 1).padStart(2, "0")}</span><strong>{hit.title}</strong><div><i style={{ width: `${Math.max(7, hit.score * 100)}%` }} /></div><em>{Math.round(hit.score * 100)}%</em></div>)}</div> : <div className="operations-empty"><Database size={20} /><span>输入客户问题后，系统会把命中的数据画在这里。</span></div>}</section>
    <section className="visual-panel spreadsheet-panel"><div className="visual-panel-head"><div><span>RAG DATASET / SPREADSHEET</span><h2>检索数据与来源合规性</h2></div><span className="spreadsheet-note">内部合成数据 · Demo only</span></div><div className="spreadsheet-wrap"><div className="spreadsheet-head"><span>#</span><span>标题 / 内容摘要</span><span>相关度</span><span>数据来源</span><span>合规性</span><span>使用</span></div>{hits.length ? hits.map((hit, index) => <div className={`spreadsheet-row ${contextPins.includes(hit.id) ? "used" : ""}`} key={hit.id}><span className="row-index">{index + 1}</span><span><strong>{hit.title}</strong><small>{hit.content}</small></span><span className="score-cell">{Math.round(hit.score * 100)}%</span><span><strong className="source-cell">{hit.source}</strong><small>{hit.compliance?.license || "未声明"}</small></span><span><b className="compliance-cell"><CheckCircle2 size={12} />{hit.compliance?.status || "待审核"}</b><small>{hit.compliance?.sensitivity || "未知"} · {hit.compliance?.reviewed_at || "未审核"}</small></span><button className="use-cell" onClick={() => toggleContext(hit.id)}>{contextPins.includes(hit.id) ? <><Check size={13} />已使用</> : <><Plus size={13} />固定</>}</button></div>) : <div className="operations-empty spreadsheet-empty"><Database size={20} /><span>暂无检索数据</span></div>}</div><div className="spreadsheet-foot"><span><ShieldCheck size={14} /> 数据源均为 ForgeFlow 内部合成演示数据，允许用于本地 RAG 检索。</span><span>{hits.length} rows</span></div></section>
  </div>;
}

function MemoryOperations({ memory, onIntentAnalysis }) {
  const [expandedRun, setExpandedRun] = useState(null);
  return <div className="operations-stack">
    <section className="visual-panel memory-operations-list">
      <div className="visual-panel-head">
        <div><span>RECENT RUNS / ID MEMORY</span><h2>最近运行记忆</h2></div>
        <div className="memory-head-actions"><button className="memory-intent-button" onClick={onIntentAnalysis} title="分析当前客户意向"><BrainCircuit size={13} />分析用户意向</button><span>{memory.runs?.length || 0} records</span></div>
      </div>
      {memory.runs?.length ? memory.runs.map((item) => {
        const key = `${item.run_id}-${item.timestamp}`;
        const ids = item.memory_ids || {};
        const isExpanded = expandedRun === key;
        return <div className={`memory-operation-entry ${isExpanded ? "expanded" : ""}`} key={key}>
          <button className="memory-operation-row" onClick={() => setExpandedRun(isExpanded ? null : key)} aria-expanded={isExpanded}>
            <span className="memory-operation-dot" />
            <span><strong>{item.project_name || "客服处理工作流"}</strong><small>{item.plan?.summary || item.prompt}</small></span>
            <b>{item.data_kind || "模拟数据"}</b>
            <ChevronDown size={15} />
          </button>
          {isExpanded && <div className="memory-run-detail">
            <div className="memory-id-strip"><span className="memory-data-kind synthetic">{item.data_kind || "模拟数据"}</span><span>conversation_id: {ids.conversation_id || item.conversation_id || "—"}</span><span>turn: {item.turn || 1}</span></div>
            <div><span>Run ID</span><strong>{item.run_id || "—"}</strong></div>
            <div><span>原始提问</span><strong>{item.prompt || "—"}</strong></div>
            <div><span>意图识别</span><strong>{item.intent || item.final_output?.intent_label || "—"}</strong></div>
            <div className="memory-detail-grid">
              <div><span>订单 ID</span><strong>{ids.order_id || item.customer_context?.order_id || "—"}</strong></div>
              <div><span>物流 ID</span><strong>{ids.tracking_id || item.customer_context?.tracking_id || "—"}</strong></div>
              <div><span>RAG 上下文</span><strong>{item.retrieved_context?.length || 0} 条</strong></div>
              <div><span>Agent 输出</span><strong>{Object.keys(item.agent_outputs || {}).length} 个</strong></div>
              <div><span>运行状态</span><strong className="memory-detail-status">{item.status || "unknown"}</strong></div>
            </div>
          </div>}
        </div>;
      }) : <div className="operations-empty"><MemoryStick size={20} /><span>完成一次客服 Agent 运行后，这里会显示带 ID 的记忆记录。</span></div>}
    </section>
  </div>;
}

function eventContext(event) {
  const metadata = event.metadata || {};
  const identifiers = [
    metadata.order_id && `订单 ${metadata.order_id}`,
    metadata.tracking_id && `物流 ${metadata.tracking_id}`,
    metadata.conversation_id && `会话 ${metadata.conversation_id}`,
    metadata.turn && `第 ${metadata.turn} 轮`,
  ].filter(Boolean);
  return identifiers.join(" · ");
}

function DirectoryOverview({ run, isRunning, setActiveTab }) {
  return <div className="directory-stack">
    <div className="directory-status-card">
      <div className="directory-card-title"><span>客服 Copilot</span><span className="status-ok"><span />在线</span></div>
      <strong>{isRunning ? "正在处理当前问题" : "当前客服空间"}</strong>
      <p>{run?.prompt || "在左侧 Chat 输入订单、物流、退款或其他问题。"}</p>
      <button className="directory-monitor-entry" onClick={() => setActiveTab("monitor")}><Activity size={13} />打开 Agent 监控 <ArrowRight size={12} /></button>
    </div>
    <div className="directory-preview-card">
      <div className="directory-section-title"><span>OUTPUT / PREVIEW</span><span className="live-mini"><span />实时</span></div>
      <ProductPreview run={run} isRunning={isRunning} />
    </div>
  </div>;
}

function DirectoryMonitor({ run, events, latestEvents, ragHits, metrics, isRunning, selectedAgent, setSelectedAgent, currentAgentOutput, currentAgentMeta, stageStatus }) {
  const AgentIcon = currentAgentMeta.icon;
  const eventMetadata = events.reduce((result, event) => ({ ...result, ...(event.metadata || {}) }), {});
  const customerContext = {
    ...(run?.customer_context || {}),
    order_id: run?.customer_context?.order_id || eventMetadata.order_id,
    tracking_id: run?.customer_context?.tracking_id || eventMetadata.tracking_id,
  };
  return <div className="directory-stack">
    <div className="directory-monitor-request">
      <div className="directory-section-title"><span>本次请求</span><span className="live-mini"><span />{isRunning ? "实时" : "已完成"}</span></div>
      <p>{run?.prompt || "等待 Chat 发起问题"}</p>
      <div className="directory-request-ids">
        <span>Run <b>{run?.run_id || "—"}</b></span>
        <span>Conversation <b>{run?.conversation_id || "—"}</b></span>
        <span>订单 <b>{customerContext.order_id || "等待 Research"}</b></span>
        <span>物流 <b>{customerContext.tracking_id || "等待 Research"}</b></span>
      </div>
      <div className="directory-rag-live"><Database size={13} /><span>RAG 实时命中 <b>{ragHits.length}</b> 条</span></div>
    </div>
    <div className="directory-section-title"><span>Agent routes</span><span className="live-mini"><span />{isRunning ? "实时" : "待命"}</span></div>
    <div className="directory-agent-list">
      {AGENTS.map((agent) => { const Icon = agent.icon; return <button className={`directory-agent-row ${selectedAgent === agent.id ? "selected" : ""}`} key={agent.id} onClick={() => setSelectedAgent(agent.id)}><span className={`directory-agent-icon ${agent.color}`}><Icon size={14} /></span><span><strong>{agent.label}</strong><small>{agent.role}</small><em>{(agent.skills || []).join(" · ")}</em></span><MonitorStatus status={stageStatus(agent.id)} /></button>; })}
    </div>
    <div className="directory-kpi-row"><div><span>平均耗时</span><strong>{metrics.avg_node_ms || 0}ms</strong></div><div><span>Guardrail</span><strong className="green-text">{metrics.guardrail_pass_rate}%</strong></div></div>
    <div className="directory-inspector"><div className="directory-section-title"><span>Inspector</span><ShieldCheck size={14} className="green-icon" /></div><div className="directory-inspector-agent"><span className={`directory-agent-icon ${currentAgentMeta.color}`}><AgentIcon size={14} /></span><span><strong>{currentAgentMeta.label}</strong><small>{currentAgentMeta.role}</small><em>{(currentAgentMeta.skills || []).join(" · ")}</em></span></div><p>{currentAgentOutput?.summary || "运行后显示该 Agent 的输出摘要和处理上下文。"}</p></div>
    <div className="directory-events"><div className="directory-section-title"><span>最近事件</span><span>{events.length}</span></div>{latestEvents.length ? latestEvents.slice(0, 5).map((event) => <div className="directory-event" key={`${event.id}-${event.timestamp}`}><span className={`event-dot ${event.status}`} /><span><strong>{event.agent || event.node || "system"}</strong><small>{event.message}</small>{eventContext(event) && <em>{eventContext(event)}</em>}</span></div>) : <div className="directory-empty">暂无运行事件</div>}</div>
  </div>;
}

function DirectoryRag({ query, setQuery, onSearch, loading, hits, contextPins, toggleContext }) {
  const compliant = hits.filter((hit) => hit.compliance?.status === "合规").length;
  const average = hits.length ? Math.round(hits.reduce((sum, hit) => sum + hit.score, 0) / hits.length * 100) : 0;
  return <div className="directory-stack directory-rag">
    <div className="directory-section-title"><span>检索数据</span><span className="status-ok"><span />合规审计</span></div>
    <div className="directory-rag-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSearch()} placeholder="输入客户问题..." /><button onClick={() => onSearch()} disabled={loading}>{loading ? <LoaderCircle size={13} className="spin" /> : <ArrowRight size={13} />}</button></div>
    <div className="directory-rag-stats"><div><span>命中</span><strong>{hits.length}</strong></div><div><span>平均相关度</span><strong>{average}%</strong></div><div><span>合规来源</span><strong>{compliant}</strong></div></div>
    <div className="directory-rag-bars">{hits.slice(0, 5).map((hit) => <div key={hit.id}><span>{hit.title}</span><i><b style={{ width: `${Math.max(8, hit.score * 100)}%` }} /></i><em>{Math.round(hit.score * 100)}%</em></div>)}</div>
    <div className="directory-sheet"><div className="directory-sheet-head"><span>标题 / 摘要</span><span>来源</span><span>使用</span></div>{hits.length ? hits.map((hit) => <div className={`directory-sheet-row ${contextPins.includes(hit.id) ? "selected" : ""}`} key={hit.id}><span><strong>{hit.title}</strong><small>{hit.content}</small></span><span><b>{hit.compliance?.status || "待审核"}</b><small>{hit.source}</small></span><button onClick={() => toggleContext(hit.id)} title="固定到下一次运行">{contextPins.includes(hit.id) ? <Check size={13} /> : <Plus size={13} />}</button></div>) : <div className="directory-empty">输入问题后显示检索数据</div>}</div>
    <div className="directory-compliance-note"><ShieldCheck size={14} /><span>当前数据为内部合成演示数据，可用于本地 RAG 检索；每条记录会显示来源和审核状态。</span></div>
  </div>;
}

function DirectoryMemory({ memory }) {
  return <div className="directory-stack"><div className="directory-section-title"><span>项目记忆</span><span className="status-ok"><span />本地保存</span></div><div className="directory-memory-file"><MemoryStick size={15} /><span><strong>MEMORY.md</strong><small>可读项目摘要</small></span></div><div className="directory-memory-file"><TerminalSquare size={15} /><span><strong>runs.jsonl</strong><small>追加式运行记录</small></span></div><div className="directory-memory-list">{memory.runs?.length ? memory.runs.slice(0, 5).map((item) => <div key={`${item.run_id}-${item.timestamp}`}><span className="memory-list-dot" /><span><strong>{item.project_name}</strong><small>{item.status} · {item.retrieved_context?.length || 0} 条上下文</small></span></div>) : <div className="directory-empty">暂无项目记忆</div>}</div></div>;
}

function getCustomerReply(content) {
  const seed = Math.abs([...content].reduce((sum, char) => sum + char.charCodeAt(0), 0));
  const orderId = `FF${20260731}${seed % 9000 + 1000}`;
  const trackingId = `SF${20260731}${String(seed % 90000000).padStart(8, "0")}`;
  if (/订单|物流|快递|配送/.test(content)) {
    return `我查到这笔演示订单号是 ${orderId}，物流单号是 ${trackingId}。现在包裹在杭州分拨中心运输中，预计 1-2 天会更新下一条轨迹。`;
  }
  if (/退款|退货|取消/.test(content)) {
    return `我查到这笔演示订单号是 ${orderId}，关联物流单号是 ${trackingId}。目前可以申请退款，请告诉我商品有没有使用或破损，我再帮您确认适用的售后方式。`;
  }
  if (/投诉|生气|不满|人工/.test(content)) {
    return `很抱歉让您遇到这个问题。我已经记录演示订单 ${orderId} 的情况，物流单号是 ${trackingId}。您可以告诉我是破损、少件还是签收异常，我会按对应规则继续处理。`;
  }
  return `我先帮您建立这笔演示订单查询：订单号是 ${orderId}，物流单号是 ${trackingId}。您可以直接告诉我想查订单、物流还是退款。`;
}

function MonitorStatus({ status }) {
  const labels = { idle: "idle", queued: "queued", running: "running", completed: "done", failed: "failed" };
  return <span className={`monitor-status ${status}`}><span />{labels[status] || status}</span>;
}

function ProductPreview({ run, isRunning }) {
  const output = run?.final_output;
  return <div className="product-preview"><div className="preview-topbar"><div className="preview-brand"><span>F</span><strong>{output?.title?.split(" ")[0] || "ForgeFlow"}</strong></div><div className="preview-tabs"><span className="active">Overview</span><span>Insights</span><span>Runs</span></div><span className="preview-user">YC</span></div><div className="preview-body"><div className="preview-greeting"><div><small>Wednesday · 09:42</small><h3>{isRunning ? "Generating your workspace..." : "Good morning, Yao"}</h3><p>{isRunning ? "The three agents are turning your brief into a product surface." : output?.tagline || "A calm snapshot of your product system."}</p></div><button><Plus size={13} /> Add signal</button></div><div className="preview-stats"><PreviewStat label="Agent health" value={isRunning ? "running" : "92%"} trend={isRunning ? "streaming" : "↑ 8.4%"} color="teal" /><PreviewStat label="Context recall" value={run?.retrieved_context?.length || 0} trend="local hits" color="violet" /><PreviewStat label="Guardrails" value={run?.status === "completed" ? "4/4" : "ready"} trend="supervised" color="yellow" /></div><div className="preview-columns"><div className="preview-card preview-chart"><div className="preview-card-head"><span>Execution pulse</span><MoreDots /></div><div className="chart-labels"><span>planning</span><span>research</span><span>builder</span><span>qa</span></div><div className="pulse-chart"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><div className="chart-foot"><span>Last 12 node events</span><strong>{run?.events?.length || 0} tracked</strong></div></div><div className="preview-card preview-insights"><div className="preview-card-head"><span>Live signals</span><span className="signal-count">{output?.checks?.length || 3}</span></div>{(output?.checks || [{ label: "Connect a prompt", detail: "start your first supervised run" }, { label: "RAG context ready", detail: "10 local knowledge notes" }, { label: "Memory layer ready", detail: "MEMORY.md + runs.jsonl" }]).slice(0, 3).map((item, index) => <div className="signal-row" key={item.label}><span className={`signal-mark signal-${index}`}><Check size={12} /></span><span><strong>{item.label}</strong><small>{item.detail || "guardrail check passed"}</small></span><ArrowRight size={13} /></div>)}</div></div></div></div>;
}

function PreviewStat({ label, value, trend, color }) {
  return <div className="preview-stat"><span>{label}</span><strong className={`stat-${color}`}>{value}</strong><small>{trend}</small><div className={`stat-bars ${color}`}><i /><i /><i /><i /><i /><i /><i /></div></div>;
}

function MoreDots() {
  return <span className="more-dots"><i /><i /><i /></span>;
}

createRoot(document.getElementById("root")).render(<App />);
