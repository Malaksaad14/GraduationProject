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
    HeartPulse,
    Activity
} from 'lucide-react';
import { askChatbot, getChatbotHealth } from '../api';

export default function AIChatbot({ activeScanInfo, isLocalized }) {
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
            text: 'Hello! I am your **Cardiac MRI AI Assistant** powered by Google Gemini.\n\nClick **"Assess myocardial viability for this scan"** below or ask me any question regarding your loaded DICOM/NIfTI scan, LV localization, or myocardial scar assessment.',
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
     * **bold** → cyan bold, bullet lines, normal lines.
     */
    const renderMessageText = (text) => {
        return text.split('\n').map((line, lIdx) => {
            // Bold headers like **Title**
            const boldReplaced = line.replace(/\*\*(.+?)\*\*/g, (_, match) => `<BOLD>${match}</BOLD>`);

            if (boldReplaced.startsWith('<BOLD>') && boldReplaced.endsWith('</BOLD>') && !boldReplaced.slice(6, -7).includes('<BOLD>')) {
                const inner = boldReplaced.slice(6, -7);
                return <div key={lIdx} className="font-bold text-cyan-300 my-1">{inner}</div>;
            }

            // Lines with inline bold
            if (boldReplaced.includes('<BOLD>')) {
                const parts = boldReplaced.split(/(<BOLD>|<\/BOLD>)/);
                let isBold = false;
                const rendered = parts.map((part, pIdx) => {
                    if (part === '<BOLD>') { isBold = true; return null; }
                    if (part === '</BOLD>') { isBold = false; return null; }
                    return isBold
                        ? <strong key={pIdx} className="text-cyan-300 font-semibold">{part}</strong>
                        : <span key={pIdx}>{part}</span>;
                });
                return <p key={lIdx}>{rendered}</p>;
            }

            return <p key={lIdx}>{line}</p>;
        });
    };

    return (
        <div className="fixed bottom-5 right-5 z-50 font-sans">
            {/* ── FLOATING TRIGGER BUTTON ───────────────────────────────────── */}
            {!isOpen && (
                <button
                    id="ai-chatbot-toggle-btn"
                    onClick={() => setIsOpen(true)}
                    className="group relative flex items-center space-x-3 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white px-4 py-3 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-105 active:scale-95 ring-2 ring-cyan-400/40"
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
                        isMinimized ? 'w-80 h-14' : 'w-[420px] h-[580px]'
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
                                className="p-1 hover:text-slate-200 hover:bg-slate-800 rounded transition"
                                title={isMinimized ? "Expand" : "Minimize"}
                            >
                                <ChevronDown className={`w-4 h-4 transform transition-transform ${isMinimized ? 'rotate-180' : ''}`} />
                            </button>
                            <button
                                id="ai-chatbot-close-btn"
                                onClick={() => setIsOpen(false)}
                                className="p-1 hover:text-rose-400 hover:bg-slate-800 rounded transition"
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
                                            className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-md leading-relaxed ${
                                                msg.sender === 'user'
                                                    ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-br-none'
                                                    : msg.isError
                                                        ? 'bg-rose-950/60 text-rose-200 border border-rose-900/60 rounded-bl-none'
                                                        : 'bg-[#151e2b] text-slate-200 border border-slate-800 rounded-bl-none'
                                            }`}
                                        >
                                            <div className="whitespace-pre-line space-y-0.5">
                                                {renderMessageText(msg.text)}
                                            </div>

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
                                                        className="hover:text-slate-300 transition"
                                                        title="Copy text"
                                                    >
                                                        {copiedIndex === idx ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                                    </button>
                                                    <button className="hover:text-emerald-400 transition" title="Helpful">
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
                                        <span>Gemini is thinking...</span>
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
                                                    ? 'bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-700/80 font-medium shadow-sm'
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
                                    className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white p-2.5 rounded-xl transition shadow active:scale-95"
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
