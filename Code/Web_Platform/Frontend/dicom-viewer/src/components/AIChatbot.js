import React, { useState, useRef, useEffect } from 'react';
import {
    Bot,
    Send,
    X,
    Sparkles,
    RefreshCw,
    ThumbsUp,
    Copy,
    Check,
    ChevronDown,
    FileText,
    BrainCircuit,
    BookOpen,
    Zap,
    AlertTriangle,
    HeartPulse
} from 'lucide-react';
import { askChatbot, getChatbotHealth } from '../api';

export default function AIChatbot({ activeScanInfo, isLocalized, externalTrigger }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [inputMessage, setInputMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [copiedIndex, setCopiedIndex] = useState(null);
    const [apiError, setApiError] = useState(null);
    const [activeModelName, setActiveModelName] = useState('gemini-3.5-flash');
    const [isBackendReady, setIsBackendReady] = useState(true);

    const [messages, setMessages] = useState([
        {
            id: 1,
            sender: 'ai',
            text: 'Hello! I am your **Cardiac MRI AI Assistant** powered by Google Gemini.\n\nClick **"Assess Myocardial Viability"** below or ask me any question regarding your loaded DICOM/NIfTI scan, LV localization, or myocardial scar assessment.',
            sources: [],
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
    ]);

    const chatEndRef = useRef(null);
    const inputRef = useRef(null);

    const quickPrompts = [
        "Assess myocardial viability for this scan",
        "Explain the localized LV region",
        "Assess slice contrast & ROI quality",
        "Summarize scan metadata & clinical metrics"
    ];

    useEffect(() => {
        getChatbotHealth().then((health) => {
            if (health.model) {
                setActiveModelName(health.model);
            }
            setIsBackendReady(health.status === 'ready');
        }).catch(() => {
            setIsBackendReady(false);
        });
    }, []);

    // Handle external triggers (e.g. from MedicalViewer top toolbar)
    useEffect(() => {
        if (externalTrigger && externalTrigger.prompt) {
            setIsOpen(true);
            setIsMinimized(false);
            handleSend(externalTrigger.prompt);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [externalTrigger]);

    useEffect(() => {
        if (isOpen && !isMinimized) {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isOpen, isMinimized, isTyping]);

    const handleSend = async (textToSend) => {
        const query = textToSend || inputMessage;
        if (!query.trim()) return;

        const userMsg = {
            id: Date.now(),
            sender: 'user',
            text: query,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages((prev) => [...prev, userMsg]);
        if (!textToSend) setInputMessage('');
        setIsTyping(true);
        setApiError(null);

        try {
            const data = await askChatbot(query, activeScanInfo, isLocalized);

            if (data.model) {
                setActiveModelName(data.model);
                setIsBackendReady(true);
            }

            const aiMsg = {
                id: Date.now() + 1,
                sender: 'ai',
                text: data.reply,
                model: data.model,
                sources: [],
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };

            setMessages((prev) => [...prev, aiMsg]);
        } catch (err) {
            const errMsg = err.message || 'Unknown error from Gemini API';
            setApiError(errMsg);
            const aiErrMsg = {
                id: Date.now() + 1,
                sender: 'ai',
                text: `⚠️ **API Error**: ${errMsg}\n\nPlease check that the backend is running and your Gemini API key is configured correctly in \`.env\`.`,
                sources: [],
                isError: true,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            setMessages((prev) => [...prev, aiErrMsg]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleCopy = (text, index) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    /**
     * Render message text with basic markdown-like formatting:
     * **bold** → cyan bold, bullet lines, numbers, and highlighted viability metrics.
     */
    const renderMessageText = (text) => {
        return text.split('\n').map((line, lIdx) => {
            const trimmed = line.trim();

            // Detect bullet lines: "- ", "* ", "• "
            const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ');
            const lineContent = isBullet ? trimmed.replace(/^[-*•]\s+/, '') : line;

            // Bold headers like **Title**
            const boldReplaced = lineContent.replace(/\*\*(.+?)\*\*/g, (_, match) => `<BOLD>${match}</BOLD>`);

            const renderLineParts = (str) => {
                if (str.includes('<BOLD>')) {
                    const parts = str.split(/(<BOLD>|<\/BOLD>)/);
                    let isBold = false;
                    return parts.map((part, pIdx) => {
                        if (part === '<BOLD>') { isBold = true; return null; }
                        if (part === '</BOLD>') { isBold = false; return null; }
                        return isBold
                            ? <strong key={pIdx} className="text-cyan-300 font-semibold">{part}</strong>
                            : <span key={pIdx}>{part}</span>;
                    });
                }
                return str;
            };

            if (boldReplaced.startsWith('<BOLD>') && boldReplaced.endsWith('</BOLD>') && !boldReplaced.slice(6, -7).includes('<BOLD>')) {
                const inner = boldReplaced.slice(6, -7);
                return <div key={lIdx} className="font-bold text-cyan-300 my-1 text-[13px]">{inner}</div>;
            }

            if (isBullet) {
                return (
                    <div key={lIdx} className="flex items-start space-x-1.5 my-0.5 ml-1">
                        <span className="text-cyan-400 font-bold">•</span>
                        <div className="flex-1">{renderLineParts(boldReplaced)}</div>
                    </div>
                );
            }

            return <p key={lIdx}>{renderLineParts(boldReplaced)}</p>;
        });
    };

    return (
        <div className="fixed bottom-5 right-5 z-50 font-sans">
            {/* ── FLOATING TRIGGER BUTTON ───────────────────────────────────── */}
            {!isOpen && (
                <button
                    id="ai-chatbot-toggle-btn"
                    onClick={() => setIsOpen(true)}
                    className="group relative flex items-center space-x-3 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white px-4 py-3 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-105 active:scale-95 ring-2 ring-cyan-400/40 cursor-pointer"
                >
                    <div className="relative">
                        <Bot className="w-6 h-6 text-cyan-200 group-hover:rotate-12 transition-transform duration-300" />
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full ring-2 ring-slate-900 animate-pulse" />
                    </div>
                    <div className="text-left pr-1">
                        <div className="text-xs font-bold tracking-wide flex items-center space-x-1">
                            <span>Ask Gemini AI</span>
                            <Sparkles className="w-3 h-3 text-amber-300 fill-amber-300" />
                        </div>
                        <div className="text-[10px] text-cyan-200/80">Cardiac RAG Assistant</div>
                    </div>
                </button>
            )}

            {/* ── CHAT PANEL DRAWER ───────────────────────────────────────────── */}
            {isOpen && (
                <div
                    id="ai-chatbot-panel"
                    className={`bg-[#0d131d] border border-cyan-800/50 rounded-2xl shadow-2xl flex flex-col transition-all duration-300 backdrop-blur-xl ${
                        isMinimized ? 'w-80 h-14' : 'w-[440px] h-[600px]'
                    }`}
                >
                    {/* Header */}
                    <div className="bg-gradient-to-r from-[#131b28] to-[#182335] px-4 py-3 border-b border-slate-800 rounded-t-2xl flex items-center justify-between">
                        <div className="flex items-center space-x-2.5">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-md">
                                <BrainCircuit className="w-4 h-4 text-white" />
                            </div>
                            <div>
                                <div className="text-sm font-bold text-slate-100 flex items-center space-x-1.5">
                                    <span>Gemini RAG Assistant</span>
                                    <span className="bg-emerald-950 text-emerald-400 text-[9px] font-mono px-1.5 py-0.5 rounded border border-emerald-800">
                                        LIVE
                                    </span>
                                </div>
                                <div className={`text-[11px] flex items-center space-x-1 ${isBackendReady ? 'text-emerald-400' : 'text-amber-400'}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${isBackendReady ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                                    <span>{activeModelName} · {isBackendReady ? 'Ready' : 'Connecting...'}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center space-x-1 text-slate-400">
                            <button
                                id="ai-chatbot-minimize-btn"
                                onClick={() => setIsMinimized(!isMinimized)}
                                className="p-1 hover:text-slate-200 hover:bg-slate-800 rounded transition cursor-pointer"
                                title={isMinimized ? "Expand" : "Minimize"}
                            >
                                <ChevronDown className={`w-4 h-4 transform transition-transform ${isMinimized ? 'rotate-180' : ''}`} />
                            </button>
                            <button
                                id="ai-chatbot-close-btn"
                                onClick={() => setIsOpen(false)}
                                className="p-1 hover:text-rose-400 hover:bg-slate-800 rounded transition cursor-pointer"
                                title="Close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {!isMinimized && (
                        <>
                            {/* Scan Context Banner */}
                            <div className="bg-[#111823]/90 px-3 py-2 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-300">
                                <div className="flex items-center space-x-2 truncate">
                                    <FileText className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                                    <span className="truncate font-mono text-[11px]">
                                        {activeScanInfo ? `${activeScanInfo.fileName || 'Active Scan'} (Slice ${activeScanInfo.currentSlice + 1})` : 'No file loaded yet'}
                                    </span>
                                </div>
                                {isLocalized && (
                                    <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                                        ROI Active
                                    </span>
                                )}
                            </div>

                            {/* ── DEDICATED OPTION: ASSESS MYOCARDIAL VIABILITY BANNER ── */}
                            <div className="bg-gradient-to-r from-rose-950/70 via-[#14121d] to-[#0f172a] px-3 py-2 border-b border-rose-900/40 flex items-center justify-between gap-2 text-xs">
                                <div className="flex items-center space-x-2 min-w-0">
                                    <HeartPulse className="w-4 h-4 text-rose-400 animate-pulse flex-shrink-0" />
                                    <span className="text-[11px] text-slate-200 font-medium truncate">
                                        {activeScanInfo ? `Viability Assessment · Slice ${activeScanInfo.currentSlice + 1}` : 'Assess Myocardial Viability'}
                                    </span>
                                </div>
                                <button
                                    id="ai-chatbot-banner-viability-btn"
                                    onClick={() => handleSend("Assess myocardial viability for this scan")}
                                    disabled={isTyping}
                                    className="flex items-center space-x-1.5 bg-gradient-to-r from-rose-600 via-red-600 to-rose-600 hover:from-rose-500 hover:to-red-500 disabled:opacity-50 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg shadow transition active:scale-95 flex-shrink-0 cursor-pointer border border-rose-400/30"
                                    title="Assess myocardial viability for this scan using Gemini AI"
                                >
                                    <Sparkles className="w-3 h-3 text-amber-300 fill-amber-300" />
                                    <span>Assess Viability</span>
                                </button>
                            </div>

                            {/* API Error Banner */}
                            {apiError && (
                                <div className="bg-rose-950/60 border-b border-rose-900/60 px-3 py-1.5 flex items-center space-x-2 text-[11px] text-rose-300">
                                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span className="truncate">{apiError}</span>
                                </div>
                            )}

                            {/* Messages Container */}
                            <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-[#090d14]/70 text-xs">
                                {messages.map((msg, idx) => (
                                    <div
                                        key={msg.id}
                                        className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                                    >
                                        <div
                                            className={`max-w-[88%] rounded-2xl px-4 py-2.5 shadow-md leading-relaxed ${
                                                msg.sender === 'user'
                                                    ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-br-none'
                                                    : msg.isError
                                                        ? 'bg-rose-950/60 text-rose-200 border border-rose-900/60 rounded-bl-none'
                                                        : 'bg-[#151e2b] text-slate-200 border border-slate-800 rounded-bl-none'
                                            }`}
                                        >
                                            <div className="whitespace-pre-line space-y-1">
                                                {renderMessageText(msg.text)}
                                            </div>

                                            {/* Interactive Action Card in Initial Message */}
                                            {msg.id === 1 && (
                                                <div className="mt-3 pt-2.5 border-t border-slate-700/60">
                                                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1.5 flex items-center gap-1">
                                                        <Sparkles className="w-3 h-3 text-amber-300" />
                                                        <span>Quick Action</span>
                                                    </div>
                                                    <button
                                                        id="ai-chatbot-welcome-viability-btn"
                                                        onClick={() => handleSend("Assess myocardial viability for this scan")}
                                                        disabled={isTyping}
                                                        className="w-full group flex items-center justify-between p-2.5 rounded-xl bg-gradient-to-r from-rose-950/80 via-red-950/50 to-slate-900 border border-rose-800/80 hover:border-rose-500 transition-all shadow-md text-left cursor-pointer active:scale-98"
                                                    >
                                                        <div className="flex items-center space-x-2.5">
                                                            <div className="w-7 h-7 rounded-lg bg-rose-600/30 border border-rose-500/50 flex items-center justify-center group-hover:scale-105 transition-transform flex-shrink-0">
                                                                <HeartPulse className="w-4 h-4 text-rose-400 group-hover:text-rose-300" />
                                                            </div>
                                                            <div>
                                                                <div className="text-xs font-bold text-rose-200 group-hover:text-white flex items-center gap-1.5">
                                                                    <span>Assess Myocardial Viability</span>
                                                                </div>
                                                                <div className="text-[10px] text-rose-300/70">
                                                                    Transmurality grading & scar recovery analysis
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <span className="text-[10px] font-bold text-white bg-rose-600 group-hover:bg-rose-500 px-2.5 py-1 rounded-md shadow-sm transition">
                                                            Assess →
                                                        </span>
                                                    </button>
                                                </div>
                                            )}

                                            {/* Model badge */}
                                            {msg.model && (
                                                <div className="mt-2 pt-1 border-t border-slate-700/50 text-[10px] text-slate-500 flex items-center space-x-1">
                                                    <Sparkles className="w-2.5 h-2.5 text-cyan-500" />
                                                    <span>{msg.model}</span>
                                                </div>
                                            )}

                                            {/* RAG Sources Citations */}
                                            {msg.sources && msg.sources.length > 0 && (
                                                <div className="mt-2.5 pt-2 border-t border-slate-700/60 text-[10px] text-cyan-400/90 space-y-1">
                                                    <div className="font-semibold text-slate-400 flex items-center space-x-1">
                                                        <BookOpen className="w-3 h-3 text-cyan-400" />
                                                        <span>Context Sources:</span>
                                                    </div>
                                                    {msg.sources.map((src, sIdx) => (
                                                        <div key={sIdx} className="bg-slate-900/60 px-2 py-0.5 rounded text-slate-300 font-mono truncate">
                                                            • {src}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Actions & Timestamp */}
                                        <div className="flex items-center space-x-2 mt-1 px-1 text-[10px] text-slate-500">
                                            <span>{msg.timestamp}</span>
                                            {msg.sender === 'ai' && (
                                                <>
                                                    <button
                                                        onClick={() => handleCopy(msg.text, idx)}
                                                        className="hover:text-slate-300 transition cursor-pointer"
                                                        title="Copy text"
                                                    >
                                                        {copiedIndex === idx ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                                    </button>
                                                    <button className="hover:text-emerald-400 transition cursor-pointer" title="Helpful">
                                                        <ThumbsUp className="w-3 h-3" />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                {/* Typing Indicator */}
                                {isTyping && (
                                    <div className="flex items-center space-x-2 bg-[#151e2b] border border-slate-800 text-cyan-400 px-3 py-2 rounded-2xl rounded-bl-none w-fit text-xs">
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                                        <span>Gemini is analyzing scan & viability...</span>
                                    </div>
                                )}
                                <div ref={chatEndRef} />
                            </div>

                            {/* Quick Prompt Chips */}
                            <div className="bg-[#0f1622] px-3 py-2 border-t border-slate-800/80 flex items-center space-x-2 overflow-x-auto no-scrollbar">
                                <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                                {quickPrompts.map((prompt, idx) => {
                                    const isViability = prompt.toLowerCase().includes('viability');
                                    return (
                                        <button
                                            key={idx}
                                            id={`ai-quick-prompt-${idx}`}
                                            onClick={() => handleSend(prompt)}
                                            disabled={isTyping}
                                            className={`whitespace-nowrap text-[11px] px-2.5 py-1 rounded-full transition disabled:opacity-50 flex items-center space-x-1 cursor-pointer ${
                                                isViability
                                                    ? 'bg-rose-950/90 hover:bg-rose-900 text-rose-200 border border-rose-600 font-semibold shadow-sm ring-1 ring-rose-500/30'
                                                    : 'bg-slate-800/80 hover:bg-cyan-950 hover:text-cyan-300 hover:border-cyan-700 text-slate-300 border border-slate-700/80'
                                            }`}
                                        >
                                            {isViability && <HeartPulse className="w-3 h-3 text-rose-400" />}
                                            <span>{prompt}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Input Form */}
                            <form
                                id="ai-chatbot-form"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    handleSend();
                                }}
                                className="bg-[#131b28] p-3 border-t border-slate-800 flex items-center space-x-2 rounded-b-2xl"
                            >
                                <button
                                    id="ai-chatbot-input-viability-btn"
                                    type="button"
                                    onClick={() => handleSend("Assess myocardial viability for this scan")}
                                    disabled={isTyping}
                                    className="p-2 rounded-xl bg-rose-950/70 hover:bg-rose-900 text-rose-300 border border-rose-800/80 hover:border-rose-600 transition disabled:opacity-50 cursor-pointer flex-shrink-0"
                                    title="Quick Action: Assess myocardial viability for this scan"
                                >
                                    <HeartPulse className="w-4 h-4 text-rose-400" />
                                </button>
                                <input
                                    id="ai-chatbot-input"
                                    ref={inputRef}
                                    type="text"
                                    value={inputMessage}
                                    onChange={(e) => setInputMessage(e.target.value)}
                                    placeholder="Ask about scan, LV ROI, or viability..."
                                    disabled={isTyping}
                                    className="flex-1 bg-[#090d14] border border-slate-700/80 focus:border-cyan-500 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition disabled:opacity-60"
                                />
                                <button
                                    id="ai-chatbot-send-btn"
                                    type="submit"
                                    disabled={!inputMessage.trim() || isTyping}
                                    className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white p-2.5 rounded-xl transition shadow active:scale-95 cursor-pointer"
                                    title="Send Message"
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            </form>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
