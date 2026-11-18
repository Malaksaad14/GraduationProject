import React, { useState, useRef, useEffect } from 'react';
import {
    Bot,
    Send,
    X,
    RefreshCw,
    ThumbsUp,
    Copy,
    Check,
    ChevronDown,
    FileText,
    BrainCircuit,
    AlertTriangle
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
            text: 'Hello! I am your Cardiac MRI AI Assistant powered by Google Gemini.\n\nClick "Assess Viability" below or ask any question regarding your loaded DICOM/NIfTI scan, LV localization, or scar assessment.',
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
                text: `API Error: ${errMsg}\n\nPlease check that the backend is running and your Gemini API key is configured correctly in .env.`,
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
     * Render message text with basic formatting
     */
    const renderMessageText = (text) => {
        return text.split('\n').map((line, lIdx) => {
            const trimmed = line.trim();
            const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ');
            const lineContent = isBullet ? trimmed.replace(/^[-*•]\s+/, '') : line;
            const boldReplaced = lineContent.replace(/\*\*(.+?)\*\*/g, (_, match) => `<BOLD>${match}</BOLD>`);

            const renderLineParts = (str) => {
                if (str.includes('<BOLD>')) {
                    const parts = str.split(/(<BOLD>|<\/BOLD>)/);
                    let isBold = false;
                    return parts.map((part, pIdx) => {
                        if (part === '<BOLD>') { isBold = true; return null; }
                        if (part === '</BOLD>') { isBold = false; return null; }
                        return isBold
                            ? <strong key={pIdx} className="text-white font-semibold">{part}</strong>
                            : <span key={pIdx}>{part}</span>;
                    });
                }
                return str;
            };

            if (boldReplaced.startsWith('<BOLD>') && boldReplaced.endsWith('</BOLD>') && !boldReplaced.slice(6, -7).includes('<BOLD>')) {
                const inner = boldReplaced.slice(6, -7);
                return <div key={lIdx} className="font-semibold text-white my-1 text-[12px]">{inner}</div>;
            }

            if (isBullet) {
                return (
                    <div key={lIdx} className="flex items-start gap-1.5 my-0.5 ml-1">
                        <span className="text-white/40">•</span>
                        <div className="flex-1">{renderLineParts(boldReplaced)}</div>
                    </div>
                );
            }

            return <p key={lIdx}>{renderLineParts(boldReplaced)}</p>;
        });
    };

    return (
        <div className="fixed bottom-14 right-5 z-50 select-none font-mono">
            {/* ── FLOATING TRIGGER BUTTON ── */}
            {!isOpen && (
                <button
                    id="ai-chatbot-toggle-btn"
                    onClick={() => setIsOpen(true)}
                    className="flex items-center gap-2 bg-[#0d1b2a] hover:bg-[#152238] text-white/80 hover:text-white px-3.5 py-2.5 rounded-full border border-white/15 shadow-xl transition cursor-pointer"
                >
                    <Bot className="w-4 h-4 text-white/70" />
                    <span className="text-xs font-medium">Gemini Assistant</span>
                </button>
            )}

            {/* ── CHAT PANEL DRAWER ── */}
            {isOpen && (
                <div
                    id="ai-chatbot-panel"
                    className={`bg-[#0d1b2a] border border-white/15 rounded-xl shadow-2xl flex flex-col transition-all duration-200 ${
                        isMinimized ? 'w-80 h-12' : 'w-[420px] h-[560px]'
                    }`}
                >
                    {/* Header */}
                    <div className="bg-[#152238] px-3.5 py-2.5 border-b border-white/10 rounded-t-xl flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <BrainCircuit className="w-4 h-4 text-white/60" />
                            <div>
                                <div className="text-xs font-semibold text-white/90 flex items-center gap-1.5">
                                    <span>Gemini Assistant</span>
                                    <span className="text-[9px] text-white/40 border border-white/10 px-1 rounded">
                                        {activeModelName}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-1 text-white/40">
                            <button
                                id="ai-chatbot-minimize-btn"
                                onClick={() => setIsMinimized(!isMinimized)}
                                className="p-1 hover:text-white hover:bg-white/5 rounded transition cursor-pointer"
                                title={isMinimized ? "Expand" : "Minimize"}
                            >
                                <ChevronDown className={`w-3.5 h-3.5 transform transition-transform ${isMinimized ? 'rotate-180' : ''}`} />
                            </button>
                            <button
                                id="ai-chatbot-close-btn"
                                onClick={() => setIsOpen(false)}
                                className="p-1 hover:text-white hover:bg-white/5 rounded transition cursor-pointer"
                                title="Close"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>

                    {!isMinimized && (
                        <>
                            {/* Scan Context Banner */}
                            <div className="bg-[#091422] px-3 py-1.5 border-b border-white/5 flex items-center justify-between text-[11px] text-white/40">
                                <div className="flex items-center gap-1.5 truncate">
                                    <FileText className="w-3 h-3 text-white/30 flex-shrink-0" />
                                    <span className="truncate">
                                        {activeScanInfo ? `${activeScanInfo.fileName || 'Active Scan'} (Slice ${activeScanInfo.currentSlice + 1})` : 'No file loaded'}
                                    </span>
                                </div>
                                {isLocalized && (
                                    <span className="text-[9px] text-white/60 border border-white/15 px-1.5 py-px rounded">
                                        ROI Active
                                    </span>
                                )}
                            </div>

                            {/* Assess Viability Banner */}
                            <div className="bg-[#152238] px-3 py-1.5 border-b border-white/10 flex items-center justify-between gap-2 text-xs">
                                <span className="text-[11px] text-white/70 truncate">
                                    {activeScanInfo ? `Viability Assessment · Slice ${activeScanInfo.currentSlice + 1}` : 'Assess Myocardial Viability'}
                                </span>
                                <button
                                    id="ai-chatbot-banner-viability-btn"
                                    onClick={() => handleSend("Assess myocardial viability for this scan")}
                                    disabled={isTyping}
                                    className="bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white text-[10px] font-semibold px-2.5 py-1 rounded border border-white/15 transition cursor-pointer"
                                >
                                    Assess
                                </button>
                            </div>

                            {/* API Error Banner */}
                            {apiError && (
                                <div className="bg-rose-950/40 border-b border-rose-900/40 px-3 py-1.5 flex items-center gap-1.5 text-[10px] text-rose-300">
                                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                    <span className="truncate">{apiError}</span>
                                </div>
                            )}

                            {/* Messages Container */}
                            <div className="flex-1 p-3.5 overflow-y-auto space-y-3 bg-[#091422] text-xs">
                                {messages.map((msg, idx) => (
                                    <div
                                        key={msg.id}
                                        className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                                    >
                                        <div
                                            className={`max-w-[90%] rounded-lg px-3.5 py-2 leading-relaxed ${
                                                msg.sender === 'user'
                                                    ? 'bg-white/10 text-white border border-white/15 rounded-br-none'
                                                    : msg.isError
                                                        ? 'bg-rose-950/40 text-rose-200 border border-rose-800/40 rounded-bl-none'
                                                        : 'bg-[#152238] text-white/80 border border-white/10 rounded-bl-none'
                                            }`}
                                        >
                                            <div className="whitespace-pre-line space-y-1">
                                                {renderMessageText(msg.text)}
                                            </div>

                                            {/* Action Card in Initial Message */}
                                            {msg.id === 1 && (
                                                <div className="mt-2.5 pt-2 border-t border-white/10">
                                                    <button
                                                        id="ai-chatbot-welcome-viability-btn"
                                                        onClick={() => handleSend("Assess myocardial viability for this scan")}
                                                        disabled={isTyping}
                                                        className="w-full flex items-center justify-between p-2 rounded bg-white/5 hover:bg-white/10 border border-white/10 transition text-left cursor-pointer"
                                                    >
                                                        <div>
                                                            <div className="text-[11px] font-medium text-white/90">
                                                                Assess Myocardial Viability
                                                            </div>
                                                            <div className="text-[9px] text-white/40">
                                                                Transmurality grading & scar analysis
                                                            </div>
                                                        </div>
                                                        <span className="text-[10px] font-medium text-white/80 bg-white/10 px-2 py-0.5 rounded border border-white/10">
                                                            Run →
                                                        </span>
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* Actions & Timestamp */}
                                        <div className="flex items-center gap-1.5 mt-1 px-1 text-[9px] text-white/30">
                                            <span>{msg.timestamp}</span>
                                            {msg.sender === 'ai' && (
                                                <button
                                                    onClick={() => handleCopy(msg.text, idx)}
                                                    className="hover:text-white/70 transition cursor-pointer"
                                                    title="Copy text"
                                                >
                                                    {copiedIndex === idx ? <Check className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3" />}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                {isTyping && (
                                    <div className="flex items-center gap-2 bg-[#152238] border border-white/10 text-white/60 px-3 py-1.5 rounded-lg w-fit text-xs">
                                        <RefreshCw className="w-3 h-3 animate-spin text-white/40" />
                                        <span>Analyzing scan...</span>
                                    </div>
                                )}
                                <div ref={chatEndRef} />
                            </div>

                            {/* Quick Prompts */}
                            <div className="bg-[#0d1b2a] px-2.5 py-1.5 border-t border-white/10 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                                {quickPrompts.map((prompt, idx) => (
                                    <button
                                        key={idx}
                                        id={`ai-quick-prompt-${idx}`}
                                        onClick={() => handleSend(prompt)}
                                        disabled={isTyping}
                                        className="whitespace-nowrap text-[10px] px-2 py-0.5 rounded border border-white/10 hover:border-white/25 text-white/50 hover:text-white/80 bg-white/5 transition disabled:opacity-40 cursor-pointer"
                                    >
                                        <span>{prompt}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Input Form */}
                            <form
                                id="ai-chatbot-form"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    handleSend();
                                }}
                                className="bg-[#152238] p-2.5 border-t border-white/10 flex items-center gap-1.5 rounded-b-xl"
                            >
                                <input
                                    id="ai-chatbot-input"
                                    ref={inputRef}
                                    type="text"
                                    value={inputMessage}
                                    onChange={(e) => setInputMessage(e.target.value)}
                                    placeholder="Ask about scan, LV ROI, or viability..."
                                    disabled={isTyping}
                                    className="flex-1 bg-[#091422] border border-white/10 focus:border-white/30 rounded px-3 py-1.5 text-xs text-white/80 placeholder-white/25 focus:outline-none transition disabled:opacity-50"
                                />
                                <button
                                    id="ai-chatbot-send-btn"
                                    type="submit"
                                    disabled={!inputMessage.trim() || isTyping}
                                    className="bg-white/10 hover:bg-white/20 disabled:opacity-30 border border-white/15 text-white p-2 rounded transition cursor-pointer"
                                    title="Send"
                                >
                                    <Send className="w-3.5 h-3.5" />
                                </button>
                            </form>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
