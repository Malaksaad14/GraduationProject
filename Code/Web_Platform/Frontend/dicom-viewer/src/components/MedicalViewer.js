import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Upload,
    Zap,
    Columns,
    Square,
    RotateCcw,
    Sun,
    Move,
    Activity,
    CheckCircle2,
    AlertCircle,
    FileText,
    ZoomIn,
    ZoomOut,
    Search,
    Download,
    ChevronDown,
    Play,
    Pause,
    ChevronLeft,
    ChevronRight,
    HelpCircle,
    X,
    Sparkles,
    Layers
} from 'lucide-react';
import { localizeDicom, localizeNifti, uploadDicom, uploadNifti, healthCheck } from '../api';
import { parseMedicalFile, renderSliceToCanvas, base64ToArrayBuffer } from '../utils/medicalImageLoader';
import AIChatbot from './AIChatbot';
import ClinicalDataPanel from './ClinicalDataPanel';

export default function MedicalViewer() {
    // ── File State ─────────────────────────────────────────────────────────────
    const [rawFile, setRawFile] = useState(null);
    const [parsedOriginal, setParsedOriginal] = useState(null);
    const [parsedLocalized, setParsedLocalized] = useState(null);
    const [currentSlice, setCurrentSlice] = useState(0);
    const [currentTimeFrame, setCurrentTimeFrame] = useState(0);
    const [cineFps, setCineFps] = useState(20);

    // ── Viewer Controls ────────────────────────────────────────────────────────
    const [windowCenter, setWindowCenter] = useState(0);
    const [windowWidth, setWindowWidth] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDraggingPan, setIsDraggingPan] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [activeTool, setActiveTool] = useState('pan'); // 'pan' | 'window' | 'zoom'

    // ── UI / Split View State ──────────────────────────────────────────────────
    const [isSplitView, setIsSplitView] = useState(false);
    const [clinicalData, setClinicalData] = useState(null);
    const [showClinicalPanel, setShowClinicalPanel] = useState(true);
    const [isLoadingLocalizer, setIsLoadingLocalizer] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [backendStatus, setBackendStatus] = useState('checking'); // 'online' | 'offline' | 'checking'
    const [showMetadata, setShowMetadata] = useState(false);
    const [showShortcutsModal, setShowShortcutsModal] = useState(false);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0, value: 'N/A' });
    const [isPlayingCine, setIsPlayingCine] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);

    // ── Refs ───────────────────────────────────────────────────────────────────
    const origCanvasRef = useRef(null);
    const locCanvasRef = useRef(null);
    const fileInputRef = useRef(null);
    const downloadMenuRef = useRef(null);
    const containerRef = useRef(null);

    // ── Click Outside Listener for Download Menu ─────────────────────────────
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target)) {
                setIsDownloadMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // ── Backend Health Check ───────────────────────────────────────────────────
    useEffect(() => {
        healthCheck()
            .then(() => setBackendStatus('online'))
            .catch(() => setBackendStatus('offline'));
    }, []);

    // ── Cine Loop Animation (Supports 4D Time-Frames & 3D Slices) ──────────────
    useEffect(() => {
        if (!isPlayingCine || !parsedOriginal) return;

        const is4DCine = (parsedOriginal.numTimeFrames || 1) > 1;
        const totalSteps = is4DCine ? parsedOriginal.numTimeFrames : parsedOriginal.numSlices;
        if (totalSteps <= 1) return;

        const intervalMs = Math.round(1000 / (cineFps || 20));
        const timer = setInterval(() => {
            if (is4DCine) {
                setCurrentTimeFrame((prev) => (prev + 1) % parsedOriginal.numTimeFrames);
            } else {
                setCurrentSlice((prev) => (prev + 1) % parsedOriginal.numSlices);
            }
        }, intervalMs);

        return () => clearInterval(timer);
    }, [isPlayingCine, parsedOriginal, cineFps]);

    // ── File Processing ────────────────────────────────────────────────────────
    const processUploadedFile = async (file) => {
        if (!file) return;
        setErrorMessage('');
        setStatusMessage(`Loading ${file.name}...`);
        setRawFile(file);
        setParsedLocalized(null);
        setIsSplitView(false);
        setIsPlayingCine(false);

        try {
            const buffer = await file.arrayBuffer();
            const parsed = await parseMedicalFile(buffer, file.name);
            setParsedOriginal(parsed);
            setCurrentSlice(0);
            setCurrentTimeFrame(0);
            setWindowCenter(parsed.defaultWindowCenter);
            setWindowWidth(parsed.defaultWindowWidth);
            setZoom(1);
            setPan({ x: 0, y: 0 });
            setStatusMessage(`Successfully loaded ${file.name} (${parsed.type.toUpperCase()})`);

            // Also upload metadata and fetch patient clinical profile
            if (parsed.type === 'dicom') {
                uploadDicom(file).then(res => {
                    console.log("[MedicalViewer] DICOM upload result:", res);
                    if (res && res.clinical_data) {
                        setClinicalData(res.clinical_data);
                        setShowClinicalPanel(true);
                    }
                }).catch(console.warn);
            } else {
                uploadNifti(file).then(res => {
                    console.log("[MedicalViewer] NIfTI upload result:", res);
                    if (res && res.clinical_data) {
                        setClinicalData(res.clinical_data);
                        setShowClinicalPanel(true);
                    }
                }).catch(console.warn);
            }
        } catch (err) {
            console.error('Error parsing file:', err);
            setErrorMessage(`Failed to parse file: ${err.message}`);
            setStatusMessage('');
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) processUploadedFile(file);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) processUploadedFile(file);
    };

    // ── Render Canvases ────────────────────────────────────────────────────────
    const renderViews = useCallback(() => {
        if (!parsedOriginal) return;

        // Render Original Canvas (using spatial slice and cardiac time-frame)
        const origSliceData = parsedOriginal.getSliceData(currentSlice, currentTimeFrame);
        if (origCanvasRef.current && origSliceData) {
            renderSliceToCanvas(
                origCanvasRef.current,
                origSliceData,
                parsedOriginal.cols,
                parsedOriginal.rows,
                windowCenter,
                windowWidth,
                parsedOriginal.min,
                parsedOriginal.max
            );
        }

        // Render Localized Canvas if present (synchronized slice & phase)
        if (isSplitView && parsedLocalized && locCanvasRef.current) {
            const locSliceData = parsedLocalized.getSliceData(
                Math.min(currentSlice, parsedLocalized.numSlices - 1),
                Math.min(currentTimeFrame, (parsedLocalized.numTimeFrames || 1) - 1)
            );
            if (locSliceData) {
                // Use the localized volume's own window level so the ROI is always visible,
                // regardless of the original scan's window/level settings.
                const locWC = parsedLocalized.defaultWindowCenter;
                const locWW = parsedLocalized.defaultWindowWidth;
                renderSliceToCanvas(
                    locCanvasRef.current,
                    locSliceData,
                    parsedLocalized.cols,
                    parsedLocalized.rows,
                    locWC,
                    locWW,
                    parsedLocalized.min,
                    parsedLocalized.max
                );
            }
        }

    }, [parsedOriginal, parsedLocalized, isSplitView, currentSlice, currentTimeFrame, windowCenter, windowWidth]);

    useEffect(() => {
        renderViews();
        const animId = requestAnimationFrame(() => {
            renderViews();
        });
        const timer = setTimeout(() => {
            renderViews();
        }, 50);
        return () => {
            cancelAnimationFrame(animId);
            clearTimeout(timer);
        };
    }, [renderViews, isSplitView, parsedLocalized, currentSlice, currentTimeFrame]);

    const [localizedRawData, setLocalizedRawData] = useState(null);
    const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);

    // ── Send to Localizer Handler ──────────────────────────────────────────────
    const handleSendToLocalizer = async () => {
        if (!rawFile || !parsedOriginal) return;
        setIsLoadingLocalizer(true);
        setErrorMessage('');
        setStatusMessage('Sending file to LV Localizer model...');

        try {
            let res;
            if (parsedOriginal.type === 'dicom') {
                res = await localizeDicom(rawFile);
                if (!res.dicom_file_data) throw new Error('No DICOM data in localizer response.');
                const locBuffer = base64ToArrayBuffer(res.dicom_file_data);
                const parsedLoc = await parseMedicalFile(locBuffer, `localized_${rawFile.name}`);
                setLocalizedRawData({ base64: res.dicom_file_data, format: 'dicom' });
                setIsSplitView(true);
                setParsedLocalized(parsedLoc);
            } else {
                res = await localizeNifti(rawFile);
                if (!res.nifti_file_data) throw new Error('No NIfTI data in localizer response.');
                const locBuffer = base64ToArrayBuffer(res.nifti_file_data);
                const parsedLoc = await parseMedicalFile(locBuffer, `localized_${rawFile.name}`);
                setLocalizedRawData({ base64: res.nifti_file_data, format: 'nifti' });
                setIsSplitView(true);
                setParsedLocalized(parsedLoc);
            }

            setStatusMessage('Localization complete! Displaying Real vs Localized view.');
        } catch (err) {
            console.error('Localization error:', err);
            setErrorMessage(`Localizer failed: ${err.message}`);
            setStatusMessage('');
        } finally {
            setIsLoadingLocalizer(false);
        }
    };

    // ── Download Handler for Localized Output ────────────────────────────────
    const handleDownloadLocalized = (targetFormat) => {
        if (!parsedLocalized) return;
        setIsDownloadMenuOpen(false);

        const baseName = rawFile?.name ? rawFile.name.replace(/\.[^/.]+$/, "") : "localized_scan";

        if (targetFormat === 'png') {
            if (!locCanvasRef.current) return;
            const link = document.createElement('a');
            link.download = `localized_${baseName}_slice_${currentSlice + 1}.png`;
            link.href = locCanvasRef.current.toDataURL('image/png');
            link.click();
            return;
        }

        if (localizedRawData?.base64) {
            const byteCharacters = atob(localizedRawData.base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);

            const isDicom = targetFormat === 'dicom';
            const ext = isDicom ? '.dcm' : '.nii.gz';
            const mime = isDicom ? 'application/dicom' : 'application/gzip';
            const blob = new Blob([byteArray], { type: mime });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `localized_${baseName}${ext}`;
            link.href = url;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    };

    // ── Pan / Zoom / Window Level Mouse Handlers ──────────────────────────────
    const handleMouseDown = (e) => {
        if (!parsedOriginal) return;
        setIsDraggingPan(true);
        setDragStart({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = (e) => {
        if (!parsedOriginal) return;

        // Update Mouse Position info
        const rect = origCanvasRef.current?.getBoundingClientRect();
        if (rect) {
            const mouseX = Math.round(((e.clientX - rect.left) / rect.width) * parsedOriginal.cols);
            const mouseY = Math.round(((e.clientY - rect.top) / rect.height) * parsedOriginal.rows);
            setMousePos({ x: mouseX, y: mouseY, value: 'Active' });
        }

        if (!isDraggingPan) return;

        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        setDragStart({ x: e.clientX, y: e.clientY });

        if (activeTool === 'pan') {
            setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        } else if (activeTool === 'window') {
            setWindowWidth((prev) => Math.max(1, prev + dx * 2));
            setWindowCenter((prev) => prev - dy * 2);
        } else if (activeTool === 'zoom') {
            const zoomFactor = dy < 0 ? 1.03 : 0.97;
            setZoom((prev) => Math.max(0.2, Math.min(10, +(prev * zoomFactor).toFixed(3))));
        }
    };

    const handleMouseUp = () => setIsDraggingPan(false);

    const handleWheel = (e) => {
        if (!parsedOriginal) return;
        e.preventDefault();
        if (e.ctrlKey || activeTool === 'zoom') {
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            setZoom((prev) => Math.max(0.2, Math.min(10, +(prev * zoomFactor).toFixed(3))));
        } else if (parsedOriginal) {
            if (e.shiftKey && (parsedOriginal.numTimeFrames || 1) > 1) {
                if (e.deltaY > 0) {
                    setCurrentTimeFrame((prev) => Math.min(parsedOriginal.numTimeFrames - 1, prev + 1));
                } else {
                    setCurrentTimeFrame((prev) => Math.max(0, prev - 1));
                }
            } else if (parsedOriginal.numSlices > 1) {
                if (e.deltaY > 0) {
                    setCurrentSlice((prev) => Math.min(parsedOriginal.numSlices - 1, prev + 1));
                } else {
                    setCurrentSlice((prev) => Math.max(0, prev - 1));
                }
            }
        }
    };

    const handleZoomIn = () => {
        setZoom((prev) => Math.min(10, +(prev * 1.25).toFixed(2)));
    };

    const handleZoomOut = () => {
        setZoom((prev) => Math.max(0.2, +(prev / 1.25).toFixed(2)));
    };

    const handleResetView = () => {
        if (!parsedOriginal) return;
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setWindowCenter(parsedOriginal.defaultWindowCenter);
        setWindowWidth(parsedOriginal.defaultWindowWidth);
    };

    return (
        <div className="flex flex-col h-screen bg-[#070b12] text-slate-100 font-sans select-none overflow-hidden">
            {/* ── TOP HEADER / NAVBAR ────────────────────────────────────────────── */}
            <header className="h-14 bg-gradient-to-r from-[#0b1018] via-[#0f1724] to-[#0b1018] border-b border-slate-800/80 px-5 flex items-center justify-between shadow-xl z-20">
                <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2.5 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 px-3.5 py-1.5 rounded-xl text-white font-bold tracking-wide shadow-lg ring-1 ring-cyan-400/30 text-sm">
                        <Activity className="w-4 h-4 text-cyan-200 animate-pulse" />
                        <span className="font-extrabold tracking-wider">CARDIAC MRI WORKSTATION</span>
                    </div>
                    <div className="hidden sm:flex items-center space-x-2 text-xs text-slate-400 border-l border-slate-800 pl-4 font-mono">
                        <Layers className="w-3.5 h-3.5 text-cyan-400" />
                        <span>LV Localization & Myocardial Viability</span>
                    </div>
                </div>

                {/* Status notifications & Backend indicator */}
                <div className="flex items-center space-x-3">
                    {statusMessage && (
                        <div className="flex items-center space-x-2 text-xs text-emerald-300 bg-emerald-950/60 border border-emerald-700/50 px-3 py-1 rounded-full shadow-sm animate-fade-in">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="font-medium">{statusMessage}</span>
                        </div>
                    )}
                    {errorMessage && (
                        <div className="flex items-center space-x-2 text-xs text-rose-300 bg-rose-950/60 border border-rose-700/50 px-3 py-1 rounded-full shadow-sm animate-fade-in">
                            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                            <span className="font-medium">{errorMessage}</span>
                        </div>
                    )}

                    <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 px-3 py-1 rounded-full text-xs font-mono shadow-inner">
                        <span className={`w-2 h-2 rounded-full ${backendStatus === 'online' ? 'bg-emerald-400 shadow-emerald-400/50 shadow-sm' : backendStatus === 'checking' ? 'bg-amber-400 animate-ping' : 'bg-rose-500'}`} />
                        <span className="text-slate-400">FastAPI API: <strong className={backendStatus === 'online' ? 'text-emerald-400' : 'text-slate-200'}>{backendStatus.toUpperCase()}</strong></span>
                    </div>

                    <button
                        onClick={() => setShowShortcutsModal(true)}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 transition"
                        title="Keyboard Shortcuts & Help"
                    >
                        <HelpCircle className="w-4 h-4" />
                    </button>
                </div>
            </header>

            {/* ── CONTROL TOOLBAR ───────────────────────────────────────────────── */}
            <div className="h-14 bg-[#0d1420] border-b border-slate-800/80 px-4 flex items-center justify-between text-xs relative z-30 shadow-md">
                <div className="flex items-center space-x-2.5">
                    {/* Upload File Button */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".dcm,.dicom,.nii,.nii.gz"
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center space-x-2 bg-gradient-to-r from-cyan-600 via-cyan-500 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-3.5 py-1.5 rounded-lg shadow-md font-semibold transition transform active:scale-95 cursor-pointer ring-1 ring-cyan-400/30"
                    >
                        <Upload className="w-4 h-4 text-cyan-100" />
                        <span>Upload Scan (DICOM / NIfTI)</span>
                    </button>

                    <div className="h-6 w-px bg-slate-800 mx-1" />

                    {/* Send to Localizer Button */}
                    <button
                        onClick={handleSendToLocalizer}
                        disabled={!parsedOriginal || isLoadingLocalizer}
                        className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg font-bold transition shadow-lg active:scale-95 ${
                            !parsedOriginal || isLoadingLocalizer
                                ? 'bg-slate-900 text-slate-500 cursor-not-allowed border border-slate-800'
                                : 'bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-white ring-2 ring-emerald-400/40 glow-emerald'
                        }`}
                    >
                        {isLoadingLocalizer ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                <span>Localizing LV ROI...</span>
                            </>
                        ) : (
                            <>
                                <Zap className="w-4 h-4 fill-amber-300 text-amber-300" />
                                <span>Run Localizer</span>
                            </>
                        )}
                    </button>

                    <div className="h-6 w-px bg-slate-800 mx-1" />

                    {/* View Modes */}
                    <div className="flex items-center bg-slate-900/90 p-1 rounded-lg border border-slate-800 space-x-1">
                        <button
                            onClick={() => setIsSplitView(false)}
                            disabled={!parsedOriginal}
                            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md font-medium transition ${!isSplitView ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60 shadow-sm' : 'text-slate-400 hover:text-slate-200'} ${!parsedOriginal ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <Square className="w-3.5 h-3.5" />
                            <span>Single View</span>
                        </button>

                        <button
                            onClick={() => setIsSplitView(true)}
                            disabled={!parsedLocalized}
                            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md font-medium transition ${isSplitView ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60 shadow-sm' : 'text-slate-400 hover:text-slate-200'} ${!parsedLocalized ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <Columns className="w-3.5 h-3.5" />
                            <span>Split View (1×2)</span>
                        </button>
                    </div>

                    {/* Download Localized Result Button */}
                    {parsedLocalized && (
                        <div ref={downloadMenuRef} className="relative z-50">
                            <button
                                onClick={() => setIsDownloadMenuOpen(!isDownloadMenuOpen)}
                                className="flex items-center space-x-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3.5 py-1.5 rounded-lg font-semibold text-xs shadow-lg transition active:scale-95 cursor-pointer ring-1 ring-emerald-400/40"
                                title="Download Localized Output"
                            >
                                <Download className="w-3.5 h-3.5" />
                                <span>Download Localized</span>
                                <ChevronDown className="w-3.5 h-3.5 ml-0.5 opacity-80" />
                            </button>

                            {isDownloadMenuOpen && (
                                <div className="absolute top-full left-0 mt-2 w-52 bg-[#0c131d] border border-cyan-500/50 rounded-xl shadow-2xl z-50 py-1.5 text-xs backdrop-blur-xl ring-1 ring-cyan-500/30">
                                    <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-cyan-400 tracking-wider border-b border-slate-800">
                                        Select Export Format
                                    </div>
                                    <button
                                        onClick={() => handleDownloadLocalized('dicom')}
                                        className="w-full text-left px-3.5 py-2 text-slate-200 hover:bg-cyan-950 hover:text-cyan-300 flex items-center justify-between transition font-medium"
                                    >
                                        <span>DICOM File</span>
                                        <span className="text-[10px] text-cyan-400 font-mono bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800">.dcm</span>
                                    </button>
                                    <button
                                        onClick={() => handleDownloadLocalized('nifti')}
                                        className="w-full text-left px-3.5 py-2 text-slate-200 hover:bg-cyan-950 hover:text-cyan-300 flex items-center justify-between transition font-medium"
                                    >
                                        <span>NIfTI Volume</span>
                                        <span className="text-[10px] text-teal-400 font-mono bg-teal-950/80 px-1.5 py-0.5 rounded border border-teal-800">.nii.gz</span>
                                    </button>
                                    <button
                                        onClick={() => handleDownloadLocalized('png')}
                                        className="w-full text-left px-3.5 py-2 text-slate-200 hover:bg-cyan-950 hover:text-cyan-300 flex items-center justify-between transition border-t border-slate-800/80 font-medium"
                                    >
                                        <span>Slice Image (PNG)</span>
                                        <span className="text-[10px] text-slate-400 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">.png</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Navigation Tools */}
                <div className="flex items-center space-x-2">
                    <div className="flex items-center bg-slate-900/90 p-1 rounded-lg border border-slate-800 space-x-1">
                        <button
                            onClick={() => setActiveTool('pan')}
                            className={`p-1.5 rounded-md transition ${activeTool === 'pan' ? 'bg-cyan-900/70 text-cyan-300 border border-cyan-600/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                            title="Pan Tool (Click and drag to position image)"
                        >
                            <Move className="w-4 h-4" />
                        </button>

                        <button
                            onClick={() => setActiveTool('zoom')}
                            className={`p-1.5 rounded-md transition ${activeTool === 'zoom' ? 'bg-cyan-900/70 text-cyan-300 border border-cyan-600/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                            title="Interactive Zoom Tool (Drag up/down or scroll wheel to zoom)"
                        >
                            <Search className="w-4 h-4" />
                        </button>

                        <button
                            onClick={() => setActiveTool('window')}
                            className={`p-1.5 rounded-md transition ${activeTool === 'window' ? 'bg-cyan-900/70 text-cyan-300 border border-cyan-600/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                            title="Window / Level (Adjust brightness and contrast)"
                        >
                            <Sun className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="h-6 w-px bg-slate-800 mx-1" />

                    <div className="flex items-center space-x-1">
                        <button
                            onClick={handleZoomIn}
                            disabled={!parsedOriginal}
                            className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-cyan-300 disabled:opacity-40 transition"
                            title="Zoom In (+25%)"
                        >
                            <ZoomIn className="w-4 h-4" />
                        </button>

                        <button
                            onClick={handleZoomOut}
                            disabled={!parsedOriginal}
                            className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-cyan-300 disabled:opacity-40 transition"
                            title="Zoom Out (-20%)"
                        >
                            <ZoomOut className="w-4 h-4" />
                        </button>

                        <button
                            onClick={handleResetView}
                            disabled={!parsedOriginal}
                            className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-cyan-300 disabled:opacity-40 transition"
                            title="Reset Zoom & Contrast"
                        >
                            <RotateCcw className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="h-6 w-px bg-slate-800 mx-1" />

                    {/* Patient Profile & Clinical Labs Button */}
                    <button
                        onClick={() => { setShowClinicalPanel(prev => !prev); if (!showClinicalPanel) setShowMetadata(false); }}
                        disabled={!parsedOriginal}
                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border font-medium transition ${
                            showClinicalPanel
                                ? 'bg-cyan-600/30 border-cyan-500 text-cyan-300'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                        }`}
                        title="Toggle Patient Profile and Clinical Biomarkers"
                    >
                        <Activity className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Patient Profile</span>
                    </button>

                    <button
                        onClick={() => { setShowMetadata(prev => !prev); if (!showMetadata) setShowClinicalPanel(false); }}
                        disabled={!parsedOriginal}
                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border font-medium transition ${showMetadata ? 'bg-blue-950 text-blue-300 border-blue-700/80 shadow-sm' : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'} ${!parsedOriginal ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                        <FileText className="w-3.5 h-3.5 text-blue-400" />
                        <span>Metadata</span>
                    </button>
                </div>
            </div>

            {/* ── MAIN VIEWER VIEWPORTS AREA ────────────────────────────────────── */}
            <div
                className="flex-1 flex overflow-hidden relative bg-[#05080e]"
                onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
            >
                {/* Drag & Drop Highlight Overlay */}
                {isDragOver && (
                    <div className="absolute inset-0 z-40 bg-cyan-950/80 backdrop-blur-md border-4 border-dashed border-cyan-400 flex flex-col items-center justify-center text-cyan-200 space-y-3">
                        <Upload className="w-16 h-16 animate-bounce text-cyan-300" />
                        <span className="text-xl font-bold tracking-wide">Drop DICOM or NIfTI File Here</span>
                        <span className="text-xs text-cyan-400">Supports .dcm, .dicom, .nii, .nii.gz</span>
                    </div>
                )}

                {/* Side Drawer for Patient Profile & Clinical Labs (Left Side) */}
                {showClinicalPanel && (
                    <aside className="w-80 sm:w-96 bg-[#0a0f18] border-r border-slate-800/80 p-3 overflow-y-auto z-20 shadow-2xl flex flex-col">
                        <ClinicalDataPanel
                            clinicalData={clinicalData}
                            onClose={() => setShowClinicalPanel(false)}
                        />
                    </aside>
                )}

                {/* Side Drawer for Metadata */}
                {showMetadata && parsedOriginal && (
                    <aside className="w-80 bg-[#0a0f18] border-r border-slate-800/80 p-4 text-xs overflow-y-auto z-10 shadow-2xl font-mono">
                        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
                            <div className="flex items-center space-x-2 text-cyan-400 font-bold">
                                <FileText className="w-4 h-4" />
                                <span>DICOM / NIfTI HEADER</span>
                            </div>
                            <button
                                onClick={() => setShowMetadata(false)}
                                className="text-slate-400 hover:text-slate-200"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                                <div className="text-[10px] uppercase text-slate-500 font-bold">Patient & File</div>
                                <div className="text-slate-200 font-bold truncate mt-0.5">{rawFile?.name || 'Scan'}</div>
                                <div className="text-cyan-400 text-[11px] mt-1">{parsedOriginal.type.toUpperCase()} Format</div>
                            </div>

                            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-1.5 text-slate-300">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Dimensions:</span>
                                    <span>{parsedOriginal.cols} × {parsedOriginal.rows}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Slices Count:</span>
                                    <span>{parsedOriginal.numSlices}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Default W / L:</span>
                                    <span>{Math.round(parsedOriginal.defaultWindowWidth)} / {Math.round(parsedOriginal.defaultWindowCenter)}</span>
                                </div>
                            </div>
                        </div>
                    </aside>
                )}

                {/* VIEWPORTS CONTAINER */}
                {!parsedOriginal ? (
                    /* EMPTY DROPZONE STATE */
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#070b12] relative overflow-hidden">
                        <div className="absolute w-[500px] h-[500px] bg-cyan-600/5 rounded-full blur-3xl pointer-events-none" />

                        <div className="max-w-md bg-[#0e1622]/80 border border-slate-800 rounded-2xl p-8 backdrop-blur-xl shadow-2xl space-y-5 relative z-10">
                            <div className="w-16 h-16 bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/40 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                                <Upload className="w-8 h-8 text-cyan-400" />
                            </div>

                            <div className="space-y-1">
                                <h2 className="text-lg font-bold text-slate-100 tracking-wide">Upload Cardiac MRI Scan</h2>
                                <p className="text-xs text-slate-400">
                                    Drag & drop your medical imaging file or click below to browse.
                                </p>
                            </div>

                            <div className="flex items-center justify-center space-x-2 text-[10px] font-mono text-slate-400 pt-1">
                                <span className="bg-slate-900 border border-slate-800 px-2 py-1 rounded">.DCM</span>
                                <span className="bg-slate-900 border border-slate-800 px-2 py-1 rounded">.DICOM</span>
                                <span className="bg-slate-900 border border-slate-800 px-2 py-1 rounded">.NII</span>
                                <span className="bg-slate-900 border border-slate-800 px-2 py-1 rounded">.NII.GZ</span>
                            </div>

                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white py-2.5 rounded-xl font-bold text-xs shadow-lg transition active:scale-95 ring-2 ring-cyan-400/30"
                            >
                                Select File to View
                            </button>
                        </div>
                    </div>
                ) : (
                    /* LOADED VIEWPORTS */
                    <div className="flex-1 flex overflow-hidden relative" ref={containerRef}>
                        {/* VIEWPORT 1: ORIGINAL SCAN */}
                        <div
                            className={`${isSplitView ? 'w-1/2 border-r border-slate-800' : 'w-full'} flex flex-col relative bg-black`}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onWheel={handleWheel}
                        >
                            {/* Viewport Overlay Header (Top Left) */}
                            <div className="absolute top-3 left-3 z-10 flex items-center space-x-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-xs shadow-md font-mono">
                                <span className="font-bold text-cyan-300">ORIGINAL CARDIAC SCAN</span>
                                <span className="text-slate-400 text-[10px] bg-slate-800 px-1.5 py-0.5 rounded">
                                    {parsedOriginal.type.toUpperCase()}
                                </span>
                            </div>

                            {/* Viewport Information Overlay (Top Right) */}
                            <div className="absolute top-3 right-3 z-10 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 space-y-0.5 shadow-md">
                                <div>Dim: {parsedOriginal.cols}×{parsedOriginal.rows}</div>
                                <div>Slice: {currentSlice + 1} / {parsedOriginal.numSlices}</div>
                                {((parsedOriginal.numTimeFrames || 1) > 1) && (
                                    <div className="text-emerald-400 font-bold">Phase: {currentTimeFrame + 1} / {parsedOriginal.numTimeFrames} {isPlayingCine ? '• CINE' : ''}</div>
                                )}
                            </div>

                            {/* Canvas Wrapper */}
                            <div className="flex-1 flex items-center justify-center overflow-hidden bg-black relative">
                                <canvas
                                    ref={origCanvasRef}
                                    style={{
                                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                                        imageRendering: 'pixelated',
                                        transition: isDraggingPan ? 'none' : 'transform 0.1s ease-out'
                                    }}
                                    className="max-w-full max-h-full object-contain cursor-crosshair shadow-2xl"
                                />
                            </div>

                            {/* Viewport Information Overlay (Bottom Left) */}
                            <div className="absolute bottom-3 left-3 z-10 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 flex items-center space-x-3 shadow-md">
                                <span>W: {Math.round(windowWidth)}</span>
                                <span>L: {Math.round(windowCenter)}</span>
                                <span className="text-cyan-400 font-bold">Zoom: {zoom.toFixed(2)}x</span>
                                <span>X:{mousePos.x} Y:{mousePos.y}</span>
                            </div>
                        </div>

                        {/* VIEWPORT 2: LOCALIZED SCAN (SPLIT VIEW) */}
                        {isSplitView && (
                            <div
                                className="w-1/2 flex flex-col relative bg-black"
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onWheel={handleWheel}
                            >
                                {/* Viewport Overlay Header */}
                                <div className="absolute top-3 left-3 z-10 flex items-center space-x-2 bg-emerald-950/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-emerald-800/60 text-xs shadow-md font-mono">
                                    <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300 animate-pulse" />
                                    <span className="font-bold text-emerald-300">LOCALIZED LV ROI</span>
                                    <span className="text-emerald-400 font-mono text-[10px] bg-emerald-900/60 px-1.5 py-0.5 rounded border border-emerald-700/50">MODEL OUTPUT</span>
                                </div>

                                {/* Viewport Information Overlay (Top Right) */}
                                {parsedLocalized && (
                                    <div className="absolute top-3 right-3 z-10 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-emerald-300 space-y-0.5 shadow-md">
                                        <div>Dim: {parsedLocalized.cols}×{parsedLocalized.rows}</div>
                                        <div>ROI Extracted ✅</div>
                                    </div>
                                )}



                                {/* Canvas Wrapper */}
                                <div className="flex-1 flex items-center justify-center overflow-hidden bg-black relative">
                                    {parsedLocalized ? (
                                        <canvas
                                            ref={locCanvasRef}
                                            style={{
                                                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                                                imageRendering: 'pixelated',
                                                transition: isDraggingPan ? 'none' : 'transform 0.1s ease-out'
                                            }}
                                            className="max-w-full max-h-full object-contain cursor-crosshair shadow-2xl ring-1 ring-emerald-500/30"
                                        />
                                    ) : (
                                        <div className="flex flex-col items-center justify-center text-slate-500">
                                            <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-2" />
                                            <span>Processing Localization...</span>
                                        </div>
                                    )}
                                </div>

                                {/* Viewport Information Overlay (Bottom Left) */}
                                <div className="absolute bottom-3 left-3 z-10 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 flex items-center space-x-3 shadow-md">
                                    <span className="text-emerald-400 font-bold">Synchronized View</span>
                                    <span>LV ROI Active</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── FOOTER SLICE NAVIGATOR BAR ────────────────────────────────────── */}
            {parsedOriginal && (
                <footer className="h-12 bg-[#0c131d] border-t border-slate-800/80 px-6 flex items-center justify-between z-20 text-xs shadow-inner">
                    <div className="flex items-center space-x-4 w-full max-w-3xl mx-auto font-mono">
                        {/* Cine Playback Button */}
                        {parsedOriginal.numSlices > 1 && (
                            <button
                                onClick={() => setIsPlayingCine(!isPlayingCine)}
                                className={`p-1.5 rounded-lg border transition ${isPlayingCine ? 'bg-amber-950 text-amber-300 border-amber-600/80' : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white'}`}
                                title={isPlayingCine ? "Pause Cine Loop" : "Play Cine Loop"}
                            >
                                {isPlayingCine ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                            </button>
                        )}

                        <button
                            onClick={() => setCurrentSlice((prev) => Math.max(0, prev - 1))}
                            disabled={currentSlice === 0}
                            className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:text-white disabled:opacity-40"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>

                        <span className="text-slate-300 w-28 text-center font-bold">
                            Slice {currentSlice + 1} / {parsedOriginal.numSlices}
                        </span>

                        <button
                            onClick={() => setCurrentSlice((prev) => Math.min(parsedOriginal.numSlices - 1, prev + 1))}
                            disabled={currentSlice === parsedOriginal.numSlices - 1}
                            className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:text-white disabled:opacity-40"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>

                        {parsedOriginal.numSlices > 1 && (
                            <input
                                type="range"
                                min="0"
                                max={parsedOriginal.numSlices - 1}
                                value={currentSlice}
                                onChange={(e) => setCurrentSlice(Number(e.target.value))}
                                className="flex-1 accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                            />
                        )}
                    </div>
                </footer>
            )}

            {/* ── KEYBOARD SHORTCUTS HELP MODAL ─────────────────────────────────── */}
            {showShortcutsModal && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0e1622] border border-cyan-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl relative space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                            <div className="flex items-center space-x-2 text-cyan-400 font-bold">
                                <Sparkles className="w-4 h-4 text-cyan-400" />
                                <span>Workstation Navigation & Shortcuts</span>
                            </div>
                            <button onClick={() => setShowShortcutsModal(false)} className="text-slate-400 hover:text-white">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-2.5 text-xs font-mono text-slate-300">
                            <div className="flex justify-between bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800">
                                <span>Pan Image:</span>
                                <span className="text-cyan-300">Select Pan Tool & Drag</span>
                            </div>
                            <div className="flex justify-between bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800">
                                <span>Zoom In / Out:</span>
                                <span className="text-cyan-300">Ctrl + Wheel or Zoom Tool</span>
                            </div>
                            <div className="flex justify-between bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800">
                                <span>Brightness / Contrast:</span>
                                <span className="text-cyan-300">Window Tool & Drag</span>
                            </div>
                            <div className="flex justify-between bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800">
                                <span>Next / Prev Slice:</span>
                                <span className="text-cyan-300">Mouse Scroll Wheel</span>
                            </div>
                        </div>

                        <button
                            onClick={() => setShowShortcutsModal(false)}
                            className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2 rounded-xl text-xs transition"
                        >
                            Got It
                        </button>
                    </div>
                </div>
            )}

            {/* ── AI RAG CHATBOT WIDGET ────────────────────────────────────────── */}
            <AIChatbot
                activeScanInfo={
                    parsedOriginal
                        ? {
                              fileName: rawFile?.name,
                              type: parsedOriginal.type,
                              currentSlice,
                              totalSlices: parsedOriginal.numSlices,
                              rows: parsedOriginal.rows,
                              cols: parsedOriginal.cols
                          }
                        : null
                }
                isLocalized={Boolean(parsedLocalized)}
            />
        </div>
    );
}
