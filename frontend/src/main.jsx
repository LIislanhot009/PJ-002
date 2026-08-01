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
  Copy,
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

const DEFAULT_CHAT_MESSAGES = [
  {
    role: "assistant",
    content: "您好，欢迎来找我～我可以帮您查订单、看物流、处理退款。如果问题比较复杂，我也会帮您转给人工客服。请问您现在遇到什么问题啦？",
  },
];

const AGENT_ICONS = {
  intent: BrainCircuit,
  research: FileSearch,
  builder: Layers3,
  qa: ShieldCheck,
  reflection: History,
};

function normalizeAgents(serverAgents) {
  return (serverAgents || []).map((agent) => ({
    ...(AGENTS.find((item) => item.id === agent.id) || {}),
    ...agent,
    flowRole: agent.flow_role || agent.role,
    icon: AGENT_ICONS[agent.id] || BrainCircuit,
  }));
}

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function App() {
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem("forgeflow-active-tab") || "overview");
  const [prompt, setPrompt] = useState(() => localStorage.getItem("forgeflow-prompt") || initialPrompt);
  const [projectName, setProjectName] = useState(() => {
    const stored = localStorage.getItem("forgeflow-project");
    return stored && stored !== "Aurora Finance Copilot" ? stored : "客服处理工作流";
  });
  const [conversationId, setConversationId] = useState(() => localStorage.getItem("forgeflow-conversation") || `conversation-${Date.now()}`);
  const [chatDraft, setChatDraft] = useState("");
  const [chatMessages, setChatMessages] = useState(() => readStorage("forgeflow-chat-messages", DEFAULT_CHAT_MESSAGES));
  const [run, setRun] = useState(() => readStorage("forgeflow-run", null));
  const [events, setEvents] = useState(() => readStorage("forgeflow-events", []));
  const [metrics, setMetrics] = useState({ total_runs: 0, active_runs: 0, completed_runs: 0, avg_node_ms: 0, guardrail_pass_rate: 100 });
  const [agents, setAgents] = useState(AGENTS);
  const [memory, setMemory] = useState({ runs: [] });
  const [isRunning, setIsRunning] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("research");
  const [query, setQuery] = useState(prompt);
  const [ragHits, setRagHits] = useState([]);
  const [ragLoading, setRagLoading] = useState(false);
  const [contextPins, setContextPins] = useState([]);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    localStorage.setItem("forgeflow-active-tab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem("forgeflow-chat-messages", JSON.stringify(chatMessages));
  }, [chatMessages]);

  useEffect(() => {
    if (run) localStorage.setItem("forgeflow-run", JSON.stringify(run));
    else localStorage.removeItem("forgeflow-run");
  }, [run]);

  useEffect(() => {
    localStorage.setItem("forgeflow-events", JSON.stringify(events));
  }, [events]);

  const resetConversation = () => {
    const nextConversationId = `conversation-${Date.now()}`;
    setConversationId(nextConversationId);
    setChatMessages(DEFAULT_CHAT_MESSAGES);
    setChatDraft("");
    setRun(null);
    setEvents([]);
    setActiveTab("overview");
    localStorage.setItem("forgeflow-conversation", nextConversationId);
    localStorage.removeItem("forgeflow-chat-messages");
    localStorage.removeItem("forgeflow-run");
    localStorage.removeItem("forgeflow-events");
  };

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
      if (response.ok) {
        const data = await response.json();
        setMetrics(data);
        if (data.agents?.length) setAgents(normalizeAgents(data.agents));
      }
    } catch {
      // The UI remains usable while the backend is starting.
    }
  };

  const refreshMemory = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/memory?limit=8`, { cache: "no-store" });
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

  const resolvePendingAssistant = (latestRun) => {
    const finalOutput = latestRun?.final_output;
    if (!finalOutput?.customer_reply) return;
    setChatMessages((current) => {
      const pendingIndex = current.findLastIndex?.(
        (message) => message.role === "assistant" && message.pending,
      );
      if (pendingIndex === undefined || pendingIndex < 0) return current;
      return current.map((message, index) => index === pendingIndex
        ? {
          ...message,
          content: finalOutput.customer_reply,
          pending: false,
          intent: finalOutput.intent,
          orderId: finalOutput.order_id,
          trackingId: finalOutput.tracking_id,
          turn: finalOutput.turn,
        }
        : message);
    });
  };

  const refreshRunSnapshot = async (runId) => {
    const response = await fetch(`${API_BASE}/api/runs/${runId}`, { cache: "no-store" });
    if (!response.ok) return null;
    const latest = await response.json();
    setRun(latest);
    setEvents(latest.events || []);
    if (Array.isArray(latest.retrieved_context)) setRagHits(latest.retrieved_context);
    return latest;
  };

  useEffect(() => {
    resolvePendingAssistant(run);
  }, [run?.run_id, run?.final_output?.customer_reply]);

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
      await subscribeToRun(created.run_id, assistantMessageId);
    } catch (error) {
      setRun({ status: "failed", error: error.message });
      setIsRunning(false);
      if (assistantMessageId) {
        updateAssistantMessage(assistantMessageId, "这次客服处理暂时没有完成，请稍后重试。", { fallback: true });
      }
      showToast("无法连接 Agent Harness", "请确认后端运行在 8000 端口", "error");
    }
  };

  const subscribeToRun = async (runId, assistantMessageId) => {
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
            if (payload.type === "rag") refreshRunSnapshot(runId);
            if (payload.type === "memory") refreshMemory();
        } else if (payload.status) {
          setRun((previous) => ({ ...previous, status: payload.status }));
        }
        if (payload.type === "node" && payload.status === "completed") {
          setRun((previous) => ({ ...previous, status: "running", last_node: payload.node }));
        }
      }
    }
    const finalRun = await refreshRunSnapshot(runId);
    if (!finalRun) throw new Error("无法读取本次运行结果");
    setIsRunning(false);
    if (assistantMessageId) {
      updateAssistantMessage(
        assistantMessageId,
        finalRun.final_output?.customer_reply || "这次客服处理没有生成可交付回复，请查看监控中心的失败节点。",
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

  useEffect(() => {
    const resumable = run?.run_id && ["queued", "running"].includes(run.status);
    if (!resumable || isRunning) return undefined;

    let cancelled = false;
    const resumeRun = async () => {
      setIsRunning(true);
      try {
        while (!cancelled) {
          const response = await fetch(`${API_BASE}/api/runs/${run.run_id}`, { cache: "no-store" });
          if (!response.ok) throw new Error("服务端已清理这次运行");
          const latest = await response.json();
          if (cancelled) return;
          setRun(latest);
          setEvents(latest.events || []);
          if (Array.isArray(latest.retrieved_context)) setRagHits(latest.retrieved_context);
          if (latest.status === "completed" || latest.status === "failed") {
            resolvePendingAssistant(latest);
            setIsRunning(false);
            refreshMetrics();
            refreshMemory();
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 700));
        }
      } catch (error) {
        if (cancelled) return;
        setIsRunning(false);
        showToast("运行状态已失联", error.message, "error");
      }
    };

    resumeRun();
    return () => { cancelled = true; };
  }, [run?.run_id]);

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
  const currentAgentMeta = agents.find((item) => item.id === selectedAgent) || agents[0];
  const latestEvents = events.slice(-16).reverse();
  const stageStatus = (id) => {
    if (!run) return "idle";
    const failed = events.some((event) => event.agent === id && event.status === "failed");
    if (failed) return "failed";
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
    agents={agents}
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
    onNewConversation={resetConversation}
  />;
}

function ChatWorkspace({
  projectName,
  chatMessages,
  chatDraft,
  setChatDraft,
  onSendChat,
  isRunning,
  run,
  activeTab,
  setActiveTab,
  events,
  latestEvents,
  metrics,
  agents,
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
  onNewConversation,
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
      agents={agents}
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
        <button className="chat-new-button" onClick={onNewConversation} title="新建会话"><Plus size={16} /></button>
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
          {activeTab === "overview" && <DirectoryOverview setActiveTab={setActiveTab} />}
          {activeTab === "monitor" && <DirectoryMonitor run={run} events={events} latestEvents={latestEvents} ragHits={ragHits} metrics={metrics} agents={agents} isRunning={isRunning} selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} currentAgentOutput={currentAgentOutput} currentAgentMeta={currentAgentMeta} stageStatus={stageStatus} />}
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
  agents,
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
        <div className="operations-content-head"><div><span className="operations-kicker">{activeTab === "monitor" ? "LIVE OBSERVABILITY" : activeTab === "rag" ? "RETRIEVAL AUDIT" : "PROJECT CONTEXT"}</span><h1>{labels[activeTab]}</h1><p>{activeTab === "monitor" ? "查看 Planning、5 个 Agent 和 Memory 如何协作处理客服请求。" : activeTab === "rag" ? "查看客户提问后命中的数据、相关度和来源合规性。" : "查看客服系统如何保存和复用上下文。"}</p></div><span className="operations-run-status"><span />{isRunning ? "正在运行" : run?.status === "completed" ? "最近一次已完成" : "等待任务"}</span></div>
       {activeTab === "monitor" && <MonitorOperations run={run} events={events} latestEvents={latestEvents} metrics={metrics} agents={agents} isRunning={isRunning} selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} currentAgentOutput={currentAgentOutput} currentAgentMeta={currentAgentMeta} stageStatus={stageStatus} ragHits={ragHits} />}
        {activeTab === "rag" && <RagOperations query={query} setQuery={setQuery} onSearch={onSearch} loading={ragLoading} hits={ragHits} contextPins={contextPins} toggleContext={toggleContext} />}
        {activeTab === "memory" && <MemoryOperations memory={memory} onIntentAnalysis={onIntentAnalysis} />}
      </section>
    </main>
  </div>;
}

function MonitorOperations({ run, events, latestEvents, metrics, agents, isRunning, selectedAgent, setSelectedAgent, currentAgentOutput, currentAgentMeta, stageStatus, ragHits }) {
  const AgentIcon = currentAgentMeta.icon;
  const displayEvents = events;
  const displayLatestEvents = latestEvents;
  const liveRagHits = Array.isArray(run?.retrieved_context) ? run.retrieved_context : ragHits;
  const eventMetadata = events.reduce((result, event) => ({ ...result, ...(event.metadata || {}) }), {});
  const requestContext = {
    ...(run?.customer_context || {}),
    order_id: run?.customer_context?.order_id || eventMetadata.order_id,
    tracking_id: run?.customer_context?.tracking_id || eventMetadata.tracking_id,
  };
  const getDisplayStatus = (agentId) => run ? stageStatus(agentId) : "queued";
  const getNodeStatus = (nodeId) => {
    if (!run) return "queued";
    const completed = displayEvents.some((event) => event.node === nodeId && event.status === "completed");
    const active = displayEvents.some((event) => event.node === nodeId && event.status === "running");
    return completed ? "completed" : active ? "running" : "queued";
  };
  const durationEvent = displayEvents
    .filter((event) => event.agent === selectedAgent && event.duration_ms)
    .reduce((latest, event) => event, null);
  const displayDuration = run?.metrics?.[`${selectedAgent}_agent`]?.duration_ms
    || durationEvent?.duration_ms
    || 0;
  const selectedEvents = displayEvents.filter((event) => event.agent === selectedAgent);
  const selectedRunningEvent = selectedEvents.find((event) => event.status === "running");
  const selectedCompletedEvent = selectedEvents
    .filter((event) => event.status === "completed")
    .reduce((latest, event) => event, null);
  const selectedInput = selectedRunningEvent?.metadata?.input_summary
    || selectedCompletedEvent?.metadata?.input_summary
    || {};
  const selectedOutput = selectedCompletedEvent?.metadata?.output_summary || {};
  const executionId = selectedCompletedEvent?.metadata?.execution_id
    || selectedRunningEvent?.metadata?.execution_id
    || "等待运行";
  const runDurations = displayEvents
    .map((event) => event.duration_ms)
    .filter((duration) => Number.isFinite(duration) && duration > 0);
  const averageDuration = runDurations.length
    ? Math.round(runDurations.reduce((sum, duration) => sum + duration, 0) / runDurations.length)
    : 0;
  const activeRequest = run?.prompt || "等待 Chat 发起客户问题";
  const planningStatus = run
    ? displayEvents.some((event) => event.node === "planning" && event.status === "completed")
      ? "completed"
      : displayEvents.some((event) => event.node === "planning" && event.status === "running")
        ? "running"
        : "queued"
    : "queued";
  const flowNodes = [
    { id: "planning", label: "Planning", role: "拆解问题", description: "识别客户意图与处理目标", color: "planning", status: planningStatus, marker: "P" },
    ...agents.map((agent, index) => ({
      ...agent,
      label: agent.label.replace(" agent", ""),
      role: agent.flowRole || agent.role,
      status: getDisplayStatus(agent.id),
      marker: index + 1,
    })),
    { id: "memory", label: "Memory", role: "持久化项目记忆", flowRole: "写入项目上下文", color: "memory", status: getNodeStatus("memory"), marker: "M", icon: MemoryStick },
  ].map((node) => ({ ...node, role: node.flowRole || node.role }));
  const completedFlowNodes = flowNodes.filter((node) => node.status === "completed").length;
  const flowProgress = run ? Math.round((completedFlowNodes / flowNodes.length) * 100) : 0;
  const completedNodeCount = new Set(
    displayEvents
      .filter((event) => event.type === "node" && event.status === "completed" && event.node)
      .map((event) => event.node),
  ).size;
  return <div className="operations-stack">
    <div className="monitor-hero-grid">
      <section className="visual-panel route-visual">
         <div className="visual-panel-head"><div><span>客服处理工作流 / AGENT ROUTES</span><h2>客服请求正在经过哪些节点？</h2></div><span className="visual-live"><span />{isRunning ? "LIVE" : "READY"}</span></div>
         <div className="route-source"><span className="route-source-dot"><MessageCircle size={13} /></span><span><strong>{activeRequest}</strong><small>订单、物流、退款或投诉问题进入处理线路</small></span><span className="route-source-state">{isRunning ? "正在分发" : run ? "已完成" : "等待请求"}</span></div>
         <div className="monitor-request-context">
           <span><small>Run ID</small><strong>{run?.run_id || "—"}</strong></span>
           <span><small>Conversation</small><strong>{run?.conversation_id || "—"}</strong></span>
           <span><small>订单 ID</small><strong>{requestContext.order_id || "等待 Research"}</strong></span>
           <span><small>物流 ID</small><strong>{requestContext.tracking_id || "等待 Research"}</strong></span>
         </div>
          <div className="monitor-rag-strip">
            <div><Database size={14} /><span><strong>本次 RAG</strong><small>{liveRagHits.length ? `已实时命中 ${liveRagHits.length} 条数据` : "等待 Research agent 返回检索结果"}</small></span></div>
            <div className="monitor-rag-sources">{liveRagHits.slice(0, 3).map((hit) => <span key={hit.id} title={hit.title}>{hit.id} · {Math.round(hit.score * 100)}%</span>)}</div>
         </div>
         <div className="agent-flow-map">
          <div className="agent-flow-track"><i /></div>
           {flowNodes.map((node, index) => {
             const isAgent = agents.some((agent) => agent.id === node.id);
            const NodeIcon = node.icon || (node.id === "planning" ? GitBranch : MemoryStick);
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
        <div className="route-destination"><span><ArrowRight size={13} />客服回复</span><span>Harness 校验后交付</span><strong>{run ? `${completedNodeCount}/${flowNodes.length} nodes` : "等待首次运行"}</strong></div>
        <div className="route-progress route-progress-new"><span>Agent route progress</span><div><i style={{ width: `${flowProgress}%` }} /></div><strong>{completedFlowNodes}/{flowNodes.length} nodes</strong></div>
        <div className="animated-route">
          <div className={`animated-node planning ${run ? "done" : ""}`}><span>P</span><strong>Planning</strong><small>拆解问题</small></div>
          <div className="animated-connector"><i /></div>
           {agents.map((agent, index) => <React.Fragment key={agent.id}><button className={`animated-node ${agent.color} ${getDisplayStatus(agent.id)} ${selectedAgent === agent.id ? "selected" : ""}`} onClick={() => setSelectedAgent(agent.id)}><span>{getDisplayStatus(agent.id) === "completed" ? <Check size={14} /> : getDisplayStatus(agent.id) === "running" ? <LoaderCircle size={14} className="spin" /> : index + 1}</span><strong>{agent.label.replace(" agent", "")}</strong><small>{(agent.flowRole || agent.role).split("与")[0]}</small></button>{index < agents.length - 1 && <div className="animated-connector"><i /></div>}</React.Fragment>)}
        </div>
        <div className="route-progress"><span>Harness node progress</span><div><i style={{ width: `${run ? Math.round((completedNodeCount / flowNodes.length) * 100) : 0}%` }} /></div><strong>{run ? `${completedNodeCount}/${flowNodes.length} nodes` : `0/${flowNodes.length} nodes`}</strong></div>
      </section>
       <section className="visual-panel pulse-visual"><div className="visual-panel-head"><div><span>EVENT PULSE</span><h2>系统活动</h2></div><BarChart3 size={18} className="visual-icon" /></div><div className="pulse-bars">{displayEvents.slice(-12).map((event, index) => <i key={`${event.id}-${index}`} style={{ height: `${Math.min(92, Math.max(18, event.duration_ms || (event.status === "running" ? 44 : 28)))}%`, animationDelay: `${index * 70}ms` }} />)}{!displayEvents.length && <div className="operations-empty pulse-empty"><Activity size={18} /><span>发送一条客服问题开始记录事件</span></div>}</div><div className="pulse-caption"><span>{displayEvents.length} tracked events</span><strong>{averageDuration || metrics.avg_node_ms || 0}ms avg</strong></div></section>
    </div>
    <div className="monitor-operations-grid">
        <section className="visual-panel inspector-visual"><div className="visual-panel-head"><div><span>HARNESS / INSPECTOR</span><h2>{currentAgentMeta.label}</h2></div><span className="compliance-badge"><ShieldCheck size={13} /> {run ? "supervised" : "ready"}</span></div><div className="inspector-agent-line"><span className={`directory-agent-icon ${currentAgentMeta.color}`}><AgentIcon size={16} /></span><span><strong>{currentAgentMeta.role}</strong><small>{currentAgentOutput?.headline || "发送问题后显示本节点的真实输出"}</small></span></div><div className="inspector-skills">{(currentAgentMeta.skills || []).map((skill) => <span key={skill}>{skill}</span>)}</div><div className="inspector-execution"><div><span>Execution ID</span><strong>{executionId}</strong></div><div><span>Input</span><strong>{selectedInput.prompt || "等待 Agent 接收问题"}</strong></div><div><span>Output</span><strong>{selectedOutput.summary || currentAgentOutput?.summary || "等待 Agent 返回结果"}</strong></div></div><div className="inspector-copy"><span>{currentAgentOutput?.summary || "Harness 会在节点运行后记录输入、输出、耗时和校验结果。"}</span><small className="inspector-provider">生成方式：{currentAgentOutput?.provider === "deepseek" ? `DeepSeek / ${currentAgentOutput.model || "configured model"}` : currentAgentOutput?.provider_error ? `grounded fallback · ${currentAgentOutput.provider_error}` : currentAgentOutput ? "LangGraph node" : "等待运行"}</small></div><div className="inspector-stats"><span><Clock3 size={14} /> {displayDuration}ms</span><span><Database size={14} /> {liveRagHits.length} RAG hits</span><span><ShieldCheck size={14} /> {run ? "supervised" : "ready"}</span></div></section>
       <section className="visual-panel live-events-visual"><div className="visual-panel-head"><div><span>03 / OBSERVE</span><h2>实时 Harness 事件</h2></div><span className="event-count"><Activity size={13} /> {displayEvents.length}</span></div><div className="live-event-list">{displayLatestEvents.length ? displayLatestEvents.slice(0, 7).map((event) => <div className="live-event-item" key={`${event.id}-${event.timestamp}`}><span className={`event-dot ${event.status}`} /><span><strong>{event.agent || event.node || "system"}</strong><small>{event.message}</small>{eventContext(event) && <em>{eventContext(event)}</em>}</span><time>{event.duration_ms ? `${event.duration_ms}ms` : "now"}</time></div>) : <div className="operations-empty"><Activity size={18} /><span>发送一条客服问题后，Harness 事件会实时出现在这里。</span></div>}</div></section>
    </div>
    <section className="monitor-output-preview">
      <div className="monitor-output-head"><div><span>OUTPUT / PREVIEW</span><h2>本次客服处理产物</h2></div><span className="visual-live"><span />{isRunning ? "LIVE" : "READY"}</span></div>
       <ProductPreview run={run} isRunning={isRunning} agents={agents} />
    </section>
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
    metadata.execution_id && `执行 ${metadata.execution_id}`,
  ].filter(Boolean);
  return identifiers.join(" · ");
}

function DirectoryOverview({ setActiveTab }) {
  return <div className="directory-overview-quiet">
    <span className="directory-kicker">CURRENT SESSION</span>
    <p>处理结果、Agent 线路和 Harness 事件统一放在监控中心。</p>
    <button className="directory-monitor-entry" onClick={() => setActiveTab("monitor")}><Activity size={13} />打开监控中心 <ArrowRight size={12} /></button>
  </div>;
}

function DirectoryMonitor({ run, events, latestEvents, ragHits, metrics, agents, isRunning, selectedAgent, setSelectedAgent, currentAgentOutput, currentAgentMeta, stageStatus }) {
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
      {agents.map((agent) => { const Icon = agent.icon; return <button className={`directory-agent-row ${selectedAgent === agent.id ? "selected" : ""}`} key={agent.id} onClick={() => setSelectedAgent(agent.id)}><span className={`directory-agent-icon ${agent.color}`}><Icon size={14} /></span><span><strong>{agent.label}</strong><small>{agent.role}</small><em>{(agent.skills || []).join(" · ")}</em></span><MonitorStatus status={stageStatus(agent.id)} /></button>; })}
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

function MonitorStatus({ status }) {
  const labels = { idle: "idle", queued: "queued", running: "running", completed: "done", failed: "failed" };
  return <span className={`monitor-status ${status}`}><span />{labels[status] || status}</span>;
}

function ProductPreview({ run, isRunning, agents }) {
  const [activeView, setActiveView] = useState("reply");
  const [copied, setCopied] = useState(false);
  const output = run?.final_output;
  const reply = output?.customer_reply || "";
  const routeNodes = run?.plan?.route?.map((item) => [item.node || item.id, item.label])
    || [
      ["planning", "Planning"],
      ...agents.map((agent) => [`${agent.id}_agent`, agent.label.replace(" agent", "")]),
      ["memory", "Memory"],
    ];
  const getNodeStatus = (node) => {
    if (!run) return "待运行";
    if (run.events?.some((event) => event.node === node && event.status === "completed")) return "已完成";
    if (run.events?.some((event) => event.node === node && event.status === "running")) return "处理中";
    return "等待中";
  };
  const pulseValues = (run?.events || []).slice(-8).map((event) => Math.min(90, Math.max(24, event.duration_ms ? event.duration_ms / 3 : 34)));
  const copyReply = async () => {
    if (!reply) return;
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  const signals = output?.checks || [
    { label: "等待客户问题", detail: "发送一条客服问题开始运行" },
  ];
  const passedChecks = output?.checks?.filter((item) => item.status === "passed").length || 0;
  const checkCount = output?.checks?.length || 0;
  return <div className="product-preview product-preview-live">
    <div className="preview-topbar">
      <div className="preview-brand"><span>F</span><strong>客服结果</strong></div>
      <div className="preview-tabs" role="tablist">
        {[["reply", "回复"], ["route", "线路"], ["context", "上下文"]].map(([id, label]) => <button key={id} className={activeView === id ? "active" : ""} onClick={() => setActiveView(id)} role="tab" aria-selected={activeView === id}>{label}</button>)}
      </div>
      <span className="preview-user">{output?.llm_provider === "deepseek" ? "DS" : "FF"}</span>
    </div>
    <div className="preview-body">
       <div className="preview-greeting">
         <div><small>{run?.run_id ? `Run ${run.run_id}` : "OUTPUT / PREVIEW"}</small><h3>{isRunning ? "正在生成客服结果..." : output ? "本轮客服回复已生成" : "等待客户问题"}</h3><p>{isRunning ? "LangGraph 正在按计划执行 Agent 节点。" : output?.tagline || "发送订单、物流或退款问题，查看真实运行结果。"}</p></div>
        <button className="preview-copy-button" onClick={copyReply} disabled={!reply}><Copy size={13} />{copied ? "已复制" : "复制回复"}</button>
      </div>
      <div className="preview-stats">
        <PreviewStat label="生成方式" value={output?.llm_provider === "deepseek" ? "DeepSeek" : "Fallback"} trend={output?.llm_model || "未配置 API Key"} color="teal" />
        <PreviewStat label="Context recall" value={run?.retrieved_context?.length || 0} trend="RAG hits" color="violet" />
         <PreviewStat label="Guardrails" value={checkCount ? `${passedChecks}/${checkCount}` : "—"} trend={checkCount ? "Harness supervised" : "等待运行"} color="yellow" />
      </div>
      {activeView === "reply" && <div className="preview-live-result"><div className="preview-card-head"><span>客服回复</span><span className="preview-provider">{output?.llm_provider === "deepseek" ? "DeepSeek generated" : "Local fallback"}</span></div><p>{reply || "还没有生成回复。请从 Chat 输入一条客户问题。"}</p><div className="preview-id-row"><span>订单 {output?.order_id || "等待生成"}</span><span>物流 {output?.tracking_id || "等待生成"}</span></div></div>}
      {activeView === "route" && <div className="preview-route-list">{routeNodes.map(([node, label], index) => <div className="preview-route-row" key={node}><span>{index + 1}</span><strong>{label}</strong><small>{getNodeStatus(node)}</small></div>)}</div>}
      {activeView === "context" && <div className="preview-context-grid"><div><span>Conversation</span><strong>{run?.conversation_id || "等待生成"}</strong></div><div><span>意图</span><strong>{output?.intent_label || "等待识别"}</strong></div><div><span>RAG 来源</span><strong>{run?.retrieved_context?.map((item) => item.id).join("、") || "等待检索"}</strong></div><div><span>数据类型</span><strong>{output?.data_kind || "合成演示数据"}</strong></div></div>}
       <div className="preview-columns">
         <div className="preview-card preview-chart"><div className="preview-card-head"><span>Execution pulse</span><MoreDots /></div><div className="chart-labels"><span>planning</span><span>research</span><span>builder</span><span>qa</span></div><div className="pulse-chart">{pulseValues.length ? pulseValues.map((height, index) => <i key={index} style={{ height: `${height}%` }} />) : <div className="operations-empty"><Activity size={16} /><span>运行后显示真实节点耗时</span></div>}</div><div className="chart-foot"><span>当前事件</span><strong>{run?.events?.length || 0} tracked</strong></div></div>
        <div className="preview-card preview-insights"><div className="preview-card-head"><span>Live signals</span><span className="signal-count">{signals.length}</span></div>{signals.slice(0, 3).map((item, index) => <div className="signal-row" key={item.label}><span className={`signal-mark signal-${index}`}><Check size={12} /></span><span><strong>{item.label}</strong><small>{item.detail || "guardrail check passed"}</small></span><ArrowRight size={13} /></div>)}</div>
      </div>
    </div>
  </div>;
}

function PreviewStat({ label, value, trend, color }) {
  return <div className="preview-stat"><span>{label}</span><strong className={`stat-${color}`}>{value}</strong><small>{trend}</small><div className={`stat-bars ${color}`}><i /><i /><i /><i /><i /><i /><i /></div></div>;
}

function MoreDots() {
  return <span className="more-dots"><i /><i /><i /></span>;
}

createRoot(document.getElementById("root")).render(<App />);
