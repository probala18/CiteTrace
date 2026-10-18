"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState, useRef } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Eye,
  EyeOff,
  FileCheck,
  FileText,
  Filter,
  Globe,
  History,
  Key,
  Layers,
  LoaderCircle,
  Moon,
  PanelLeft,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  UploadCloud,
  X,
  XCircle
} from "lucide-react";

type BackendConfig = {
  apiUrl: string;
  apiKey: string;
  apiBaseUrl: string;
  llmModel: string;
};

const DEFAULT_CONFIG: BackendConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || "/api",
  apiKey: "",
  apiBaseUrl: "https://openrouter.ai/api/v1",
  llmModel: "openrouter/free",
};

type DocumentItem = {
  id: string;
  filename: string;
  file_type: string;
  content_sha256: string;
  page_count: number | null;
  chunk_count: number;
  created_at: string;
};

type Citation = {
  evidence_id: string;
  document_id: string;
  filename: string;
  page_number: number | null;
  heading: string | null;
  excerpt: string;
  retrieval_score: number | null;
};

type Claim = {
  id: string;
  claim: string;
  status: "supported" | "partially_supported" | "contradicted" | "unverified";
  explanation: string;
  citations: Citation[];
};

type AnswerMode = "precise" | "executive" | "comprehensive" | "audit" | "timeline";

interface ModeOption {
  id: AnswerMode;
  label: string;
  badge: string;
  icon: string;
  desc: string;
}

const ANSWER_MODES: ModeOption[] = [
  {
    id: "precise",
    label: "Precise",
    badge: "Factual Precision",
    icon: "🎯",
    desc: "Concise, atomic facts with exact citations and zero fluff",
  },
  {
    id: "executive",
    label: "Executive Briefing",
    badge: "Executive Summary",
    icon: "👔",
    desc: "Strategic takeaways, bottom-line impacts & decision synthesis",
  },
  {
    id: "comprehensive",
    label: "Comprehensive",
    badge: "Deep Research",
    icon: "📖",
    desc: "Exhaustive breakdown of clauses, conditions & procedural nuances",
  },
  {
    id: "audit",
    label: "Audit & Risk",
    badge: "Compliance Audit",
    icon: "🛡️",
    desc: "Scrutiny of binding obligations, liabilities, restrictions & penalties",
  },
  {
    id: "timeline",
    label: "Timeline & Dates",
    badge: "Temporal Milestones",
    icon: "⏱️",
    desc: "Chronological sequence of deadlines, notice periods & milestones",
  },
];

type QueryResult = {
  status: "verified" | "mixed" | "insufficient_evidence" | "verification_failed";
  answer: string;
  claims: Claim[];
  retrieved_evidence: Citation[];
  warning: string | null;
  mode?: string;
};

function readableError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body && typeof (body as { detail?: unknown }).detail === "string") {
    return (body as { detail: string }).detail;
  }
  return fallback;
}

function statusLabel(status: Claim["status"]) {
  return ({
    supported: "Supported",
    partially_supported: "Partially supported",
    contradicted: "Contradicted",
    unverified: "Unverified"
  })[status];
}

export default function Home() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [docDropdownOpen, setDocDropdownOpen] = useState(false);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("precise");
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState("");
  const [submittedScope, setSubmittedScope] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queryHistory, setQueryHistory] = useState<{ query: string; docId: string | null; docName?: string; mode?: string }[]>([]);

  // UI state
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Settings & Configuration state
  const [config, setConfig] = useState<BackendConfig>(DEFAULT_CONFIG);
  const [tempConfig, setTempConfig] = useState<BackendConfig>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarFileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem("citetrace_theme") as "light" | "dark" | null;
      if (savedTheme === "light" || savedTheme === "dark") {
        setTheme(savedTheme);
        document.documentElement.setAttribute("data-theme", savedTheme);
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
      }
    } catch {}

    try {
      const savedConfig = localStorage.getItem("citetrace_backend_config");
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        setConfig((prev) => ({ ...prev, ...parsed }));
        setTempConfig((prev) => ({ ...prev, ...parsed }));
      }
    } catch {}
  }, []);

  const changeTheme = (newTheme: "light" | "dark") => {
    setTheme(newTheme);
    try {
      localStorage.setItem("citetrace_theme", newTheme);
    } catch {}
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  const getHeaders = useCallback((extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...extra };
    if (config.apiKey.trim()) headers["x-openai-api-key"] = config.apiKey.trim();
    if (config.apiBaseUrl.trim()) headers["x-openai-base-url"] = config.apiBaseUrl.trim();
    if (config.llmModel.trim()) headers["x-llm-model"] = config.llmModel.trim();
    return headers;
  }, [config]);

  const refreshDocuments = useCallback(async (overrideApi?: string) => {
    setLoadingDocs(true);
    const target = (overrideApi || config.apiUrl || "/api").trim().replace(/\/$/, "");
    try {
      const res = await fetch(`${target}/documents`, { cache: "no-store", headers: getHeaders() });
      if (!res.ok) throw new Error("Could not connect to backend. Please check server.");
      const list: DocumentItem[] = await res.json();
      setDocuments(list);
      // If targeted doc was deleted, reset target
      setSelectedDocId((prev) => (prev && list.some((d) => d.id === prev) ? prev : null));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend is unavailable.");
    } finally {
      setLoadingDocs(false);
    }
  }, [config.apiUrl, getHeaders]);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  // Upload handler
  async function uploadFile(fileToUpload?: File) {
    const file = fileToUpload || selectedFile;
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const target = (config.apiUrl || "/api").trim().replace(/\/$/, "");
      const data = new FormData();
      data.append("file", file);
      const res = await fetch(`${target}/documents`, { method: "POST", body: data, headers: getHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(readableError(body, "Upload failed."));
      setNotice(`Indexed "${body.filename}" into ${body.chunk_count} evidence chunks.`);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (sidebarFileInputRef.current) sidebarFileInputRef.current.value = "";
      await refreshDocuments();
      if (body.id) setSelectedDocId(body.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  const activeDoc = documents.find((d) => d.id === selectedDocId);
  const activeMode = ANSWER_MODES.find((m) => m.id === answerMode) || ANSWER_MODES[0];
  const resultMode = result?.mode ? ANSWER_MODES.find((m) => m.id === result.mode) : activeMode;

  // Ask Question handler
  async function submitQuery(q?: string, targetDocId?: string | null, modeToUse?: AnswerMode) {
    const text = (q ?? question).trim();
    if (!text) return;
    const docIdToUse = targetDocId !== undefined ? targetDocId : selectedDocId;
    const mode = modeToUse || answerMode;
    const docName = documents.find((d) => d.id === docIdToUse)?.filename;

    setSubmittedQuestion(text);
    setSubmittedScope(docName ? `Target: ${docName}` : "Scope: All Documents");
    
    // Record history
    setQueryHistory((prev) => [
      { query: text, docId: docIdToUse, docName, mode },
      ...prev.filter((item) => item.query !== text)
    ].slice(0, 8));

    setBusy(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      const target = (config.apiUrl || "/api").trim().replace(/\/$/, "");
      const payload: any = {
        question: text,
        mode: mode,
      };
      if (docIdToUse) {
        payload.document_id = docIdToUse;
      }
      if (config.apiKey.trim()) payload.api_key = config.apiKey.trim();
      if (config.apiBaseUrl.trim()) payload.api_base_url = config.apiBaseUrl.trim();
      if (config.llmModel.trim()) payload.llm_model = config.llmModel.trim();

      const res = await fetch(`${target}/query`, {
        method: "POST",
        headers: getHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(readableError(body, "Query failed."));
      setResult(body as QueryResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed.");
    } finally {
      setBusy(false);
    }
  }

  async function testBackendConnection() {
    setTestStatus("testing");
    setTestMessage("Pinging backend endpoint...");
    const target = (tempConfig.apiUrl || "/api").trim().replace(/\/$/, "");
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${target}/documents`, {
        signal: controller.signal,
        cache: "no-store",
        headers: tempConfig.apiKey ? { "x-openai-api-key": tempConfig.apiKey.trim() } : {}
      });
      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;
      if (res.ok) {
        const docs = await res.json().catch(() => []);
        setTestStatus("success");
        setTestMessage(`Connected to "${target}" (${res.status} OK in ${elapsed}ms) - ${Array.isArray(docs) ? docs.length : 0} document(s) detected.`);
      } else {
        setTestStatus("error");
        setTestMessage(`Backend returned status ${res.status}: ${res.statusText}`);
      }
    } catch (e: any) {
      setTestStatus("error");
      setTestMessage(e.name === "AbortError" ? "Connection timed out after 6 seconds." : (e.message || "Failed to reach endpoint."));
    }
  }

  function saveSettings() {
    setConfig({ ...tempConfig });
    try {
      localStorage.setItem("citetrace_backend_config", JSON.stringify(tempConfig));
    } catch {}
    setShowSettings(false);
    setNotice("Settings applied successfully.");
    void refreshDocuments(tempConfig.apiUrl);
  }

  function resetToDefaults() {
    setTempConfig({ ...DEFAULT_CONFIG });
    setTestStatus("idle");
    setTestMessage("");
  }

  // Remove Document handler
  async function removeDocument(doc: DocumentItem) {
    if (!window.confirm(`Delete ${doc.filename} and all indexed passages?`)) return;
    setError("");
    setNotice("");
    try {
      const target = (config.apiUrl || "/api").trim().replace(/\/$/, "");
      const res = await fetch(`${target}/documents/${doc.id}`, { method: "DELETE", headers: getHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(readableError(body, "Delete failed."));
      setNotice(`Deleted ${doc.filename}.`);
      if (selectedDocId === doc.id) setSelectedDocId(null);
      await refreshDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  const handleNewChat = () => {
    setResult(null);
    setSubmittedQuestion("");
    setSubmittedScope(null);
    setQuestion("");
    setError("");
    setNotice("");
  };

  const handleCardClick = (promptText: string) => {
    setQuestion(promptText);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitQuery();
    }
  };

  const totalChunks = documents.reduce((acc, d) => acc + d.chunk_count, 0);

  return (
    <div className="app-container">
      {/* Top Navigation Bar */}
      <header className="top-nav">
        <div className="nav-left">
          <a className="brand-wrapper" href="#" onClick={handleNewChat}>
            <div className="brand-icon-box">
              {/* Green Spiral Vortex Logo */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12" />
                <path d="M12 6a6 6 0 0 1 6 6c0 3.314-2.686 6-6 6s-6-2.686-6-6" />
                <path d="M12 9a3 3 0 0 1 3 3c0 1.657-1.343 3-3 3s-3-1.343-3-3" />
              </svg>
            </div>
            <span className="brand-name">Evidence<span>AI</span></span>
            <span className="brand-badge">VERIFIED PASSAGES</span>
          </a>

          <button
            className="sidebar-toggle-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Toggle sidebar"
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={18} />
          </button>
        </div>

        {/* Right Nav Controls */}
        <div className="nav-right">
          <div className="status-badge-pill">
            <span className="status-live-dot" />
            <span>Hybrid Retrieval Ready</span>
          </div>

          <div className="theme-toggle-group">
            <button
              className={`theme-btn ${theme === "light" ? "active" : ""}`}
              onClick={() => changeTheme("light")}
              title="Light theme"
              aria-label="Light theme"
            >
              <Sun size={15} />
            </button>
            <button
              className={`theme-btn ${theme === "dark" ? "active" : ""}`}
              onClick={() => changeTheme("dark")}
              title="Dark theme"
              aria-label="Dark theme"
            >
              <Moon size={15} />
            </button>
          </div>

          {/* Settings Trigger */}
          <button
            className="settings-trigger-btn"
            onClick={() => {
              setTempConfig({ ...config });
              setTestStatus("idle");
              setTestMessage("");
              setShowSettings(true);
            }}
            title="Backend & AI Configuration"
            aria-label="Settings"
          >
            <Settings size={15} />
            <span>Settings</span>
          </button>
        </div>
      </header>

      {/* Main Layout Area */}
      <div className="app-body">
        {/* Left Sidebar: Documents & History */}
        <aside className={`app-sidebar ${sidebarOpen ? "" : "collapsed"}`}>
          <div className="sidebar-glow" />

          {/* New Question Button */}
          <button className="new-chat-btn" onClick={handleNewChat}>
            <Plus size={16} />
            <span>New Question</span>
          </button>

          {/* Direct Document Upload Dropzone */}
          <label className="sidebar-upload-card" htmlFor="sidebar-file-input">
            <div className="sidebar-upload-icon">
              <UploadCloud size={20} />
            </div>
            <strong>{selectedFile ? selectedFile.name : "Add Document"}</strong>
            <span>{selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB · Ready` : "Click to select PDF or DOCX"}</span>
            {selectedFile && (
              <button
                type="button"
                className="sidebar-upload-btn"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void uploadFile();
                }}
              >
                {busy ? <LoaderCircle size={13} className="spin" /> : <Plus size={13} />}
                <span>{busy ? "Indexing…" : "Index Document"}</span>
              </button>
            )}
          </label>
          <input
            ref={sidebarFileInputRef}
            id="sidebar-file-input"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display: "none" }}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const file = e.target.files?.[0];
              if (file) {
                setSelectedFile(file);
              }
            }}
          />

          {/* Indexed Documents Section */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span className="sidebar-section-title">
                INDEXED SOURCES ({documents.length})
              </span>
              <button
                className="sidebar-refresh-btn"
                onClick={() => void refreshDocuments()}
                title="Refresh sources list"
                aria-label="Refresh sources list"
              >
                <RefreshCw size={13} className={loadingDocs ? "spin" : ""} />
              </button>
            </div>

            <div className="sidebar-docs-list">
              {loadingDocs && documents.length === 0 ? (
                <div className="sidebar-empty-docs">Loading sources…</div>
              ) : documents.length === 0 ? (
                <div className="sidebar-empty-docs">
                  No sources indexed yet.<br />Upload a PDF or DOCX above.
                </div>
              ) : (
                documents.map((doc) => {
                  const isSelected = selectedDocId === doc.id;
                  return (
                    <div
                      className={`sidebar-doc-item ${isSelected ? "selected" : ""}`}
                      key={doc.id}
                      onClick={() => {
                        setSelectedDocId(isSelected ? null : doc.id);
                        setNotice(
                          isSelected
                            ? "Reset query scope to All Documents"
                            : `Now querying exclusively within "${doc.filename}"`
                        );
                      }}
                      title={isSelected ? "Click to search all documents" : `Click to target queries exclusively to ${doc.filename}`}
                    >
                      <div className="sidebar-doc-info">
                        <div className="sidebar-doc-icon">
                          <FileText size={14} />
                        </div>
                        <div className="sidebar-doc-text">
                          <div className="sidebar-doc-name" title={doc.filename}>
                            {doc.filename}
                          </div>
                          <div className="sidebar-doc-meta">
                            <span>{doc.page_count ? `${doc.page_count} p` : "DOCX"} · {doc.chunk_count} chunks</span>
                            {isSelected && <span className="sidebar-doc-active-badge">TARGETED</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        className="sidebar-doc-del-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeDocument(doc);
                        }}
                        title={`Delete ${doc.filename}`}
                        aria-label={`Delete ${doc.filename}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent Queries in this session */}
          {queryHistory.length > 0 && (
            <div className="sidebar-section" style={{ flex: "none" }}>
              <div className="sidebar-section-header">
                <span className="sidebar-section-title">RECENT QUERIES</span>
              </div>
              <div className="sidebar-history-list">
                {queryHistory.map((item, idx) => (
                  <button
                    key={idx}
                    className="sidebar-history-item"
                    onClick={() => {
                      setQuestion(item.query);
                      setSelectedDocId(item.docId);
                      void submitQuery(item.query, item.docId);
                    }}
                    title={`${item.query} ${item.docName ? `(${item.docName})` : "(All docs)"}`}
                  >
                    <History size={13} />
                    <span>{item.query}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sidebar Footer */}
          <div className="sidebar-footer">
            <span>FastAPI Server</span>
            <strong>Connected (8000)</strong>
          </div>
        </aside>

        {/* Main Content Workspace */}
        <main className="main-workspace">
          {/* Top-Right Neon Lime Ambient Glow */}
          <div className="main-ambient-glow" />

          {/* Workspace Sub-Header with Document Target Scope Dropdown */}
          <div className="workspace-topbar">
            <div className="workspace-badge-group">
              <div className="workspace-pill">
                <ShieldCheck size={14} color="var(--lime-primary)" />
                <span>Strict Evidence Grounding</span>
              </div>
            </div>

            {/* Document Targeting Scope Selector */}
            <div className="doc-target-dropdown-wrap">
              <button
                className={`doc-target-btn ${selectedDocId ? "targeted" : ""}`}
                onClick={() => setDocDropdownOpen(!docDropdownOpen)}
              >
                <Filter size={13} />
                <span>{activeDoc ? `Target: ${activeDoc.filename}` : "Scope: All Documents"}</span>
                <ChevronDown size={13} />
              </button>

              {docDropdownOpen && (
                <div className="doc-target-menu">
                  <button
                    className={`doc-target-menu-item ${!selectedDocId ? "active" : ""}`}
                    onClick={() => {
                      setSelectedDocId(null);
                      setDocDropdownOpen(false);
                      setNotice("Query scope set to search across all documents.");
                    }}
                  >
                    <span>All Documents ({documents.length} sources)</span>
                    {!selectedDocId && <Check size={13} />}
                  </button>

                  {documents.map((doc) => (
                    <button
                      key={doc.id}
                      className={`doc-target-menu-item ${selectedDocId === doc.id ? "active" : ""}`}
                      onClick={() => {
                        setSelectedDocId(doc.id);
                        setDocDropdownOpen(false);
                        setNotice(`Query scope restricted to "${doc.filename}".`);
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190 }}>
                        {doc.filename}
                      </span>
                      {selectedDocId === doc.id && <Check size={13} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Main Scroll Area */}
          <div className="workspace-scroll-area">
            {/* Alert Notifications */}
            {error && (
              <div className="toast-alert error">
                <AlertTriangle size={18} />
                <span style={{ flex: 1 }}>{error}</span>
                <button onClick={() => setError("")} style={{ color: "inherit" }}><X size={15} /></button>
              </div>
            )}
            {notice && (
              <div className="toast-alert success">
                <CheckCircle2 size={18} />
                <span style={{ flex: 1 }}>{notice}</span>
                <button onClick={() => setNotice("")} style={{ color: "inherit" }}><X size={15} /></button>
              </div>
            )}

            {/* Welcome State (when no active result and not busy) */}
            {!result && !busy && (
              <div className="welcome-hero">
                {/* Glowing Spiral Swirl Emblem */}
                <div className="hero-vortex-wrap">
                  <div className="hero-vortex-glow" />
                  <svg className="hero-vortex-svg" viewBox="0 0 100 100" fill="none">
                    <circle cx="50" cy="50" r="16" fill="url(#centerGlow)" opacity="0.6" />
                    <path
                      d="M50 14 C69.8 14 86 30.2 86 50 C86 69.8 69.8 86 50 86 C30.2 86 14 69.8 14 50 C14 36 22 23.8 34 18"
                      stroke="url(#vortexGrad1)"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M50 25 C63.8 25 75 36.2 75 50 C75 63.8 63.8 75 50 75 C36.2 75 25 63.8 25 50 C25 40 31 31.6 40 27"
                      stroke="url(#vortexGrad2)"
                      strokeWidth="4.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M50 36 C57.7 36 64 42.3 64 50 C64 57.7 57.7 64 50 64 C42.3 64 36 57.7 36 50 C36 44 40.5 39.5 46 37"
                      stroke="url(#vortexGrad3)"
                      strokeWidth="4"
                      strokeLinecap="round"
                    />
                    <defs>
                      <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#a3e635" />
                        <stop offset="100%" stopColor="#84cc16" stopOpacity="0" />
                      </radialGradient>
                      <linearGradient id="vortexGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#d9f99d" />
                        <stop offset="50%" stopColor="#a3e635" />
                        <stop offset="100%" stopColor="#65a30d" />
                      </linearGradient>
                      <linearGradient id="vortexGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#bef264" />
                        <stop offset="60%" stopColor="#84cc16" />
                        <stop offset="100%" stopColor="#4d7c0f" />
                      </linearGradient>
                      <linearGradient id="vortexGrad3" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#84cc16" />
                        <stop offset="100%" stopColor="#a3e635" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>

                <h1 className="welcome-title">Evidence Intelligence</h1>
                <p className="welcome-subtitle">
                  {activeDoc ? (
                    <>Currently querying specifically in <strong>{activeDoc.filename}</strong> ({activeDoc.chunk_count} passages).</>
                  ) : (
                    <>Ask questions across your documents. Inspect source passages and verify every claim before you rely on it.</>
                  )}
                </p>

                {/* 3 Real Document Intelligence Action Cards */}
                <div className="feature-cards-grid">
                  <div
                    className="feature-card"
                    onClick={() =>
                      handleCardClick(
                        activeDoc
                          ? `What are the key obligations and binding terms in ${activeDoc.filename}?`
                          : "What are the key obligations, binding terms, and responsibilities in the documents?"
                      )
                    }
                  >
                    <div className="feature-card-icon">
                      <FileCheck size={19} />
                    </div>
                    <div className="feature-card-title">Obligations &amp; Terms</div>
                    <div className="feature-card-desc">
                      Inspect contractual obligations, binding clauses, and legal responsibilities.
                    </div>
                  </div>

                  <div
                    className="feature-card"
                    onClick={() =>
                      handleCardClick(
                        activeDoc
                          ? `Extract and verify factual claims from ${activeDoc.filename}.`
                          : "Extract each factual claim and cross-verify with exact citations and contradiction checks."
                      )
                    }
                  >
                    <div className="feature-card-icon">
                      <ShieldCheck size={19} />
                    </div>
                    <div className="feature-card-title">Claim Verification</div>
                    <div className="feature-card-desc">
                      Break down findings into verifiable atomic claims with citation proof.
                    </div>
                  </div>

                  <div
                    className="feature-card"
                    onClick={() =>
                      handleCardClick(
                        activeDoc
                          ? `What deadlines, dates, or time periods are mentioned in ${activeDoc.filename}?`
                          : "What deadlines, milestones, notice periods, and critical dates are specified?"
                      )
                    }
                  >
                    <div className="feature-card-icon">
                      <Calendar size={19} />
                    </div>
                    <div className="feature-card-title">Deadlines &amp; Dates</div>
                    <div className="feature-card-desc">
                      Identify time-sensitive milestones, expiration dates, and critical timelines.
                    </div>
                  </div>
                </div>

                {/* Starter Pills */}
                <div className="starter-pills-row">
                  {[
                    activeDoc ? `What are the main requirements in ${activeDoc.filename}?` : "What are the key obligations?",
                    "What deadlines are mentioned?",
                    "Is any claim contradicted by another passage?"
                  ].map((p) => (
                    <button
                      key={p}
                      className="starter-pill"
                      onClick={() => handleCardClick(p)}
                    >
                      <Search size={12} />
                      <span>{p}</span>
                      <ArrowUpRight size={11} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Loading / Thinking State */}
            {busy && (
              <div className="thinking-box">
                <div className="thinking-spinner" />
                <div className="thinking-title">
                  {activeDoc ? `Searching in ${activeDoc.filename}…` : "Following the evidence…"}
                </div>
                <div className="thinking-subtitle">
                  Retrieving relevant document chunks, validating factual claims, and checking source support.
                </div>
                <div className="thinking-steps">
                  <span className="thinking-step-item">
                    <Check size={14} color="var(--lime-primary)" />
                    Retrieve passages
                  </span>
                  <span>•</span>
                  <span className="thinking-step-item">
                    <span className="pulse-dot" />
                    Formulate claims
                  </span>
                  <span>•</span>
                  <span className="thinking-step-item">
                    <span className="pulse-dot" />
                    Verify citations
                  </span>
                </div>
              </div>
            )}

            {/* Results Chat Stream */}
            {result && !busy && (
              <div className="chat-stream-container">
                {/* User Message Bubble */}
                <div className="user-message-row">
                  <div className="user-message-bubble">
                    <p className="user-message-text">{submittedQuestion}</p>
                    {submittedScope && (
                      <div className="user-message-scope">
                        <Filter size={11} />
                        <span>{submittedScope}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Assistant Answer & Verification Card */}
                <div className="assistant-response-card">
                  <div className="response-header">
                    <div className="response-title-wrap">
                      <div className="response-icon-badge">
                        <ShieldCheck size={17} />
                      </div>
                      <span className="response-heading">Verified Answer</span>
                      {resultMode && (
                        <span className="response-mode-badge" title={resultMode.desc}>
                          <span>{resultMode.icon}</span>
                          <span>{resultMode.label}</span>
                        </span>
                      )}
                    </div>

                    <span className={`overall-status-pill ${result.status}`}>
                      <span className="status-dot-indicator" />
                      {result.status.replaceAll("_", " ")}
                    </span>
                  </div>

                  {/* Answer Text */}
                  <div className="answer-body-text">{result.answer}</div>

                  {/* Warning banner if present */}
                  {result.warning && (
                    <div className="warning-banner">
                      <AlertTriangle size={16} />
                      <span>{result.warning}</span>
                    </div>
                  )}

                  {/* Claims Section */}
                  <div className="claims-section-header">
                    <div className="claims-title">
                      <span>Atomic Claim Verification</span>
                      <span className="claims-count-badge">
                        {result.claims.length} claim{result.claims.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      Every claim verified against citations
                    </span>
                  </div>

                  {/* Claim Cards List */}
                  <div className="claims-cards-list">
                    {result.claims.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "18px", color: "var(--text-muted)", fontSize: 13 }}>
                        No individual claim statements found in retrieved passages.
                      </div>
                    ) : (
                      result.claims.map((claim, index) => (
                        <div className={`claim-card-item ${claim.status}`} key={`${claim.id}-${index}`}>
                          <div className="claim-card-top">
                            <span className="claim-id-tag">{claim.id || `C${index + 1}`}</span>
                            <span className={`claim-status-badge ${claim.status}`}>
                              {claim.status === "supported" ? (
                                <CheckCircle2 size={13} />
                              ) : claim.status === "contradicted" ? (
                                <XCircle size={13} />
                              ) : (
                                <AlertTriangle size={13} />
                              )}
                              {statusLabel(claim.status)}
                            </span>
                          </div>

                          <div className="claim-statement">{claim.claim}</div>
                          <div className="claim-explanation-text">{claim.explanation}</div>

                          {/* Citations List */}
                          {claim.citations.length > 0 && (
                            <div className="claim-citations-section">
                              {claim.citations.map((cite, citeIndex) => (
                                <div className="citation-box" key={`${cite.evidence_id}-${citeIndex}`}>
                                  <div className="citation-header-row">
                                    <div className="citation-file-info">
                                      <FileText size={13} />
                                      <span>{cite.filename}</span>
                                      <span className="citation-meta-span">
                                        {cite.page_number ? `· Page ${cite.page_number}` : cite.heading ? `· ${cite.heading}` : ""}
                                      </span>
                                    </div>
                                    <span className="citation-match-score">
                                      {cite.retrieval_score != null
                                        ? `${(cite.retrieval_score * 100).toFixed(0)}% MATCH`
                                        : "SOURCE"}
                                    </span>
                                  </div>
                                  <blockquote className="citation-quote">{cite.excerpt}</blockquote>
                                  <button
                                    className="copy-passage-btn"
                                    onClick={() => {
                                      void navigator.clipboard?.writeText(
                                        `${cite.filename}${cite.page_number ? `, page ${cite.page_number}` : ""}\n${cite.excerpt}`
                                      );
                                      setNotice("Copied citation passage to clipboard.");
                                    }}
                                  >
                                    <ArrowDownToLine size={12} />
                                    <span>Copy passage</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Retrieved Passages Accordion */}
                  {result.retrieved_evidence.length > 0 && (
                    <details className="retrieved-accordion">
                      <summary className="retrieved-accordion-summary">
                        <span>All Retrieved Evidence Passages ({result.retrieved_evidence.length})</span>
                        <ArrowDownToLine size={14} />
                      </summary>
                      <div className="retrieved-items-list">
                        {result.retrieved_evidence.map((item, i) => (
                          <div className="retrieved-item-row" key={`${item.evidence_id}-${i}`}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <strong>
                                #{i + 1} {item.filename} {item.page_number ? `(Page ${item.page_number})` : ""}
                              </strong>
                              <span style={{ fontFamily: "var(--font-mono)", color: "var(--lime-primary)" }}>
                                {((item.retrieval_score || 0) * 100).toFixed(0)}% match
                              </span>
                            </div>
                            <p>{item.excerpt}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Floating Input Bar */}
          <div className="input-section-wrap">
            <form
              className="input-box-container"
              onSubmit={(e) => {
                e.preventDefault();
                void submitQuery();
              }}
            >
              {/* Top Row: Sparkle + Textarea */}
              <div className="input-top-row">
                <span className="input-sparkle-icon">✨</span>
                <textarea
                  ref={textareaRef}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    documents.length === 0
                      ? "Upload a document in the sidebar to begin asking questions..."
                      : activeDoc
                      ? `Ask a question specifically about "${activeDoc.filename}"...`
                      : "Ask a question across your indexed documents..."
                  }
                  rows={1}
                  className="main-textarea"
                />
              </div>

              {/* Bottom Row Tools */}
              <div className="input-bottom-toolbar">
                <div className="toolbar-left-tools">
                  {/* Paperclip attachment button -> opens file picker */}
                  <button
                    type="button"
                    className="tool-icon-btn"
                    title="Upload & index document (PDF / DOCX)"
                    aria-label="Upload document"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip size={17} />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    style={{ display: "none" }}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void uploadFile(file);
                      }
                    }}
                  />

                  {/* Mode Selector Dropdown */}
                  <div className="mode-selector-wrap">
                    <button
                      type="button"
                      className={`mode-selector-btn ${modeDropdownOpen ? "open" : ""}`}
                      onClick={() => setModeDropdownOpen(!modeDropdownOpen)}
                      title={`Answer mode: ${activeMode.label} - ${activeMode.desc}`}
                      aria-label="Select answer mode"
                    >
                      <span className="mode-btn-emoji">{activeMode.icon}</span>
                      <span className="mode-btn-text">{activeMode.label}</span>
                      <ChevronDown size={12} className={`mode-chevron ${modeDropdownOpen ? "open" : ""}`} />
                    </button>

                    {modeDropdownOpen && (
                      <div className="mode-dropdown-popover">
                        <div className="mode-popover-title">Answer Mode &amp; System Prompt</div>
                        {ANSWER_MODES.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={`mode-popover-item ${answerMode === m.id ? "active" : ""}`}
                            onClick={() => {
                              setAnswerMode(m.id);
                              setModeDropdownOpen(false);
                              setNotice(`Answer mode set to ${m.label} (${m.badge}).`);
                            }}
                          >
                            <span className="mode-popover-icon">{m.icon}</span>
                            <div className="mode-popover-content">
                              <div className="mode-popover-row">
                                <span className="mode-popover-name">{m.label}</span>
                                <span className="mode-popover-tag">{m.badge}</span>
                              </div>
                              <div className="mode-popover-desc">{m.desc}</div>
                            </div>
                            {answerMode === m.id && <Check size={14} className="mode-popover-check" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Active Target Indicator Pill if a specific document is chosen */}
                  {activeDoc ? (
                    <div className="active-target-pill">
                      <FileText size={12} />
                      <span style={{ maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {activeDoc.filename}
                      </span>
                      <button
                        type="button"
                        className="active-target-pill-clear"
                        onClick={() => setSelectedDocId(null)}
                        title="Clear target (search all documents)"
                        aria-label="Clear document target"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="tool-pill-info">
                      <BookOpen size={13} color="var(--lime-primary)" />
                      <span>{documents.length} source{documents.length === 1 ? "" : "s"} ({totalChunks} chunks)</span>
                    </div>
                  )}
                </div>

                {/* Right controls: Circular Send Button */}
                <div className="toolbar-right-tools">
                  <button
                    type="submit"
                    className="send-btn-circle"
                    disabled={busy || !question.trim() || documents.length === 0}
                    title="Verify answer"
                    aria-label="Verify answer"
                  >
                    {busy ? <LoaderCircle size={16} className="spin" /> : <Send size={15} style={{ marginLeft: 1 }} />}
                  </button>
                </div>
              </div>
            </form>

            <div className="disclaimer-text">
              Answers and claims are verified strictly against retrieved document passages.
            </div>
          </div>
        </main>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="settings-modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="settings-modal-card" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="settings-modal-header">
              <div className="settings-modal-title-group">
                <div className="settings-modal-icon-badge">
                  <Settings size={18} />
                </div>
                <div>
                  <h3 className="settings-modal-title">Backend & AI Settings</h3>
                  <p className="settings-modal-subtitle">
                    Configure server endpoints, AI credentials, and model routing.
                  </p>
                </div>
              </div>
              <button
                className="settings-modal-close"
                onClick={() => setShowSettings(false)}
                title="Close settings"
                aria-label="Close settings"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body: Field and Value inputs */}
            <div className="settings-modal-body">
              {/* Field 1: Backend API URL */}
              <div className="settings-field-group">
                <div className="settings-field-label-row">
                  <label className="settings-field-label">
                    <Globe size={14} /> Backend API URL
                  </label>
                  <span className="settings-field-tag">Required</span>
                </div>
                <div className="settings-input-wrapper">
                  <input
                    type="text"
                    className="settings-input"
                    value={tempConfig.apiUrl}
                    onChange={(e) => setTempConfig({ ...tempConfig, apiUrl: e.target.value })}
                    placeholder="/api (Vercel Serverless) or http://localhost:8000/api"
                  />
                </div>
                <div className="settings-presets-row">
                  <span className="settings-presets-label">Presets:</span>
                  <button
                    type="button"
                    className="settings-preset-chip"
                    onClick={() => setTempConfig({ ...tempConfig, apiUrl: "/api" })}
                  >
                    Vercel Serverless (/api)
                  </button>
                  <button
                    type="button"
                    className="settings-preset-chip"
                    onClick={() => setTempConfig({ ...tempConfig, apiUrl: "http://localhost:8000/api" })}
                  >
                    Local FastAPI (http://localhost:8000/api)
                  </button>
                </div>
                <div className="settings-field-help">
                  The HTTP endpoint used for document uploads, chunk storage, and verified RAG queries.
                </div>
              </div>

              {/* Field 2: OpenRouter / OpenAI API Key */}
              <div className="settings-field-group">
                <div className="settings-field-label-row">
                  <label className="settings-field-label">
                    <Key size={14} /> AI Provider API Key (OpenRouter / OpenAI)
                  </label>
                  <span className="settings-field-tag secret">Secret</span>
                </div>
                <div className="settings-input-wrapper">
                  <input
                    type={showApiKey ? "text" : "password"}
                    className="settings-input"
                    value={tempConfig.apiKey}
                    onChange={(e) => setTempConfig({ ...tempConfig, apiKey: e.target.value })}
                    placeholder="sk-or-v1-... or sk-proj-..."
                  />
                  <button
                    type="button"
                    className="settings-input-toggle-btn"
                    onClick={() => setShowApiKey(!showApiKey)}
                    title={showApiKey ? "Hide key" : "Show key"}
                    aria-label="Toggle key visibility"
                  >
                    {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <div className="settings-field-help">
                  Optional in browser if already configured in Vercel or local .env environment variables.
                </div>
              </div>

              {/* Field 3: AI Base URL */}
              <div className="settings-field-group">
                <div className="settings-field-label-row">
                  <label className="settings-field-label">
                    <Globe size={14} /> AI Provider Base URL
                  </label>
                </div>
                <div className="settings-input-wrapper">
                  <input
                    type="text"
                    className="settings-input"
                    value={tempConfig.apiBaseUrl}
                    onChange={(e) => setTempConfig({ ...tempConfig, apiBaseUrl: e.target.value })}
                    placeholder="https://openrouter.ai/api/v1"
                  />
                </div>
                <div className="settings-presets-row">
                  <span className="settings-presets-label">Presets:</span>
                  <button
                    type="button"
                    className="settings-preset-chip"
                    onClick={() => setTempConfig({ ...tempConfig, apiBaseUrl: "https://openrouter.ai/api/v1" })}
                  >
                    OpenRouter
                  </button>
                  <button
                    type="button"
                    className="settings-preset-chip"
                    onClick={() => setTempConfig({ ...tempConfig, apiBaseUrl: "https://api.openai.com/v1" })}
                  >
                    OpenAI Direct
                  </button>
                </div>
                <div className="settings-field-help">
                  Base endpoint for chat completions and vector embeddings.
                </div>
              </div>

              {/* Field 4: LLM Model */}
              <div className="settings-field-group">
                <div className="settings-field-label-row">
                  <label className="settings-field-label">
                    <Cpu size={14} /> LLM Model Identifier
                  </label>
                </div>
                <div className="settings-input-wrapper">
                  <input
                    type="text"
                    className="settings-input"
                    value={tempConfig.llmModel}
                    onChange={(e) => setTempConfig({ ...tempConfig, llmModel: e.target.value })}
                    placeholder="openrouter/free or meta-llama/llama-3.3-70b-instruct:free"
                  />
                </div>
                <div className="settings-presets-row">
                  <span className="settings-presets-label">Popular:</span>
                  <button
                    type="button"
                    className="settings-preset-chip"
                    onClick={() => setTempConfig({ ...tempConfig, llmModel: "openrouter/free" })}
                  >
                    openrouter/free
                  </button>
                  <button
                    type="button"
                    className="settings-preset-chip"
                    onClick={() => setTempConfig({ ...tempConfig, llmModel: "meta-llama/llama-3.3-70b-instruct:free" })}
                  >
                    llama-3.3-70b
                  </button>
                  <button
                    type="button"
                    className="settings-preset-chip"
                    onClick={() => setTempConfig({ ...tempConfig, llmModel: "google/gemini-2.0-flash-001" })}
                  >
                    gemini-2.0-flash
                  </button>
                </div>
                <div className="settings-field-help">
                  Identifier of the model used to extract atomic claims and evaluate citations.
                </div>
              </div>

              {/* Connection Test Output Banner */}
              {testStatus !== "idle" && (
                <div className={`settings-test-banner ${testStatus}`}>
                  {testStatus === "testing" && <LoaderCircle size={15} className="spin" />}
                  {testStatus === "success" && <CheckCircle2 size={15} />}
                  {testStatus === "error" && <AlertCircle size={15} />}
                  <span>{testMessage}</span>
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="settings-modal-footer">
              <div className="settings-footer-left">
                <button
                  type="button"
                  className="settings-secondary-btn"
                  onClick={testBackendConnection}
                  disabled={testStatus === "testing"}
                >
                  {testStatus === "testing" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
                  <span>Test Connection</span>
                </button>
                <button
                  type="button"
                  className="settings-text-btn"
                  onClick={resetToDefaults}
                  title="Reset to defaults"
                >
                  <RotateCcw size={13} />
                  <span>Reset</span>
                </button>
              </div>

              <div className="settings-footer-right">
                <button
                  type="button"
                  className="settings-cancel-btn"
                  onClick={() => setShowSettings(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="settings-save-btn"
                  onClick={saveSettings}
                >
                  <Save size={14} />
                  <span>Save Configuration</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
