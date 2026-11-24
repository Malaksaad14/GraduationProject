import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
    Upload,
    Columns,
    Square,
    RotateCcw,
    Sun,
    Move,
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
    FolderOpen,
    Folder,
    ShieldCheck,
    Layers
} from 'lucide-react';
import { localizeDicom, localizeNifti, predictDicom, predictNifti, uploadDicom, uploadNifti, healthCheck } from '../api';
import {
    parseMedicalFile,
    renderSliceToCanvas,
    base64ToArrayBuffer,
    isGroundTruthMask,
    getBaseScanName,
    buildHierarchicalStudyTree,
    assembleSingleStudy
} from '../utils/medicalImageLoader';
import AIChatbot from './AIChatbot';
import ClinicalDataPanel from './ClinicalDataPanel';
import SeriesBrowser from './SeriesBrowser';
import StudyHierarchyBrowser from './StudyHierarchyBrowser';

// ── Recursive Directory Tree Helpers & Component ─────────────────────────────
function checkDescendantMatches(node, q) {
    if (!node || !node.children) return false;
    return node.children.some(
        (child) => child.name.toLowerCase().includes(q) || checkDescendantMatches(child, q)
    );
}

function checkHasActiveDescendant(node, activeStudyId) {
    if (!node || !node.children || !activeStudyId) return false;
    return node.children.some(
        (child) => (child.study && child.study.id === activeStudyId) || checkHasActiveDescendant(child, activeStudyId)
    );
}

function DirectoryTreeNode({
    node,
    depth = 0,
    activeStudyId,
    expandedNodes,
    onToggleExpand,
    onOpenStudy,
    filterText = ''
}) {
    const q = filterText ? filterText.trim().toLowerCase() : '';
    const matchesSelf = q ? node.name.toLowerCase().includes(q) : true;
    const hasMatchingDescendant = q ? checkDescendantMatches(node, q) : true;

    if (q && !matchesSelf && !hasMatchingDescendant) {
        return null;
    }

    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = q ? true : expandedNodes.has(node.id);
    const isStudyNode = Boolean(node.study);
    const isActive = node.study && node.study.id === activeStudyId;
    const hasActiveChild = checkHasActiveDescendant(node, activeStudyId);

    return (
        <div className="space-y-0.5 select-none font-mono">
            <div
                onClick={() => {
                    if (isStudyNode) {
                        onOpenStudy(node.study);
                    } else if (hasChildren) {
                        onToggleExpand(node.id);
                    }
                }}
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
                className={`group py-1.5 pr-2 rounded cursor-pointer border transition duration-150 flex items-center justify-between ${
                    isActive
                        ? 'bg-white/15 border-white/30 text-white font-semibold'
                        : hasActiveChild
                        ? 'bg-white/5 border-white/15 text-white/90'
                        : 'border-transparent hover:bg-white/5 text-white/65 hover:text-white'
                }`}
                title={node.fullPath || node.name}
            >
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                    {hasChildren ? (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleExpand(node.id);
                            }}
                            className="p-0.5 hover:text-white text-white/40 transition flex-shrink-0"
                        >
                            {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                            )}
                        </button>
                    ) : (
                        <div className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
                            <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-white/30 group-hover:bg-white/70'}`} />
                        </div>
                    )}

                    {hasChildren ? (
                        <Folder className={`w-3.5 h-3.5 flex-shrink-0 ${isExpanded ? 'text-white/70' : 'text-white/40'}`} />
                    ) : null}

                    <span className={`truncate text-[11px] ${
                        isActive
                            ? 'text-white'
                            : hasActiveChild
                            ? 'text-white/90 font-medium'
                            : 'text-white/70 group-hover:text-white'
                    }`}>
                        {node.name}
                    </span>
                </div>

                <div className="flex items-center gap-1 ml-1 flex-shrink-0">
                    {isStudyNode ? (
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                            isActive ? 'bg-white/20 text-white font-bold' : 'bg-white/5 text-white/30'
                        }`}>
                            {node.study.imageCount} imgs
                        </span>
                    ) : (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/30">
                            {node.totalStudies} {node.totalStudies === 1 ? 'scan' : 'scans'}
                        </span>
                    )}
                </div>
            </div>

            {/* Recursively Render Child Nodes */}
            {hasChildren && isExpanded && (
                <div className="space-y-0.5 relative">
                    {node.children.map((child) => (
                        <DirectoryTreeNode
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            activeStudyId={activeStudyId}
                            expandedNodes={expandedNodes}
                            onToggleExpand={onToggleExpand}
                            onOpenStudy={onOpenStudy}
                            filterText={filterText}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function MedicalViewer() {
    // ── File & Series State ────────────────────────────────────────────────────
    const [rawFile, setRawFile] = useState(null);
    const [parsedOriginal, setParsedOriginal] = useState(null);
    const [parsedLocalized, setParsedLocalized] = useState(null);
    const [currentSlice, setCurrentSlice] = useState(0);
    const [currentTimeFrame, setCurrentTimeFrame] = useState(0);
    const [cineFps, setCineFps] = useState(20);

    // ── Segmentation Mask Overlay State ────────────────────────────────────────
    const [selectedMaskType, setSelectedMaskType] = useState('none'); // 'none' | 'gt' | 'ai'
    const [maskOpacity, setMaskOpacity] = useState(0.5);

    // ── Brush / Mask Editor State ──────────────────────────────────────────────
    const [isBrushMode, setIsBrushMode] = useState(false);       // brush tool active?
    const [brushTool, setBrushTool] = useState('draw');           // 'draw' | 'erase'
    const [brushLabel, setBrushLabel] = useState(1);              // 1: LV Myo, 2: LV Cavity, 3: RV
    const [brushSize, setBrushSize] = useState(10);               // radius in image pixels
    const [brushMaskData, setBrushMaskData] = useState(null);     // Map: sliceIdx → Uint8Array(rows*cols)
    const [isBrushDrawing, setIsBrushDrawing] = useState(false);

    // ── Multi-Scan / Patient Folder Series State ──────────────────────────────
    const [seriesList, setSeriesList] = useState([]);
    const [activeSeriesId, setActiveSeriesId] = useState(null);
    const [showSeriesBrowser, setShowSeriesBrowser] = useState(true);
    const [patientStudyName, setPatientStudyName] = useState('Patient Study');

    // ── Hierarchical Patient Studies State (Documents DB / File Tree) ─────────
    const [patientHierarchy, setPatientHierarchy] = useState(null);
    const [activeStudyId, setActiveStudyId] = useState(null);
    const [showStudiesDbModal, setShowStudiesDbModal] = useState(false);
    const [isLoadingStudy, setIsLoadingStudy] = useState(false);

    // ── Workstation Sidebar State (Folders on Side) ──────────────────────────
    const [sidebarTab, setSidebarTab] = useState('folders'); // 'folders' | 'clinical' | 'metadata'
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [subfolderFilter, setSubfolderFilter] = useState('');
    const [isFolderDropdownOpen, setIsFolderDropdownOpen] = useState(false);
    const [expandedStudies, setExpandedStudies] = useState(new Set());

    const toggleStudyExpand = useCallback((studyId, e) => {
        if (e) e.stopPropagation();
        setExpandedStudies((prev) => {
            const next = new Set(prev);
            if (next.has(studyId)) next.delete(studyId);
            else next.add(studyId);
            return next;
        });
    }, []);

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
    const [isLoadingLocalizer, setIsLoadingLocalizer] = useState(false);
    const [isLoadingSegment, setIsLoadingSegment] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [backendStatus, setBackendStatus] = useState('checking'); // 'online' | 'offline' | 'checking'
    const [showShortcutsModal, setShowShortcutsModal] = useState(false);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0, value: 'N/A' });
    const [isPlayingCine, setIsPlayingCine] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
    const [chatbotExternalTrigger, setChatbotExternalTrigger] = useState(null);

    const handleAssessViability = useCallback(() => {
        setChatbotExternalTrigger({
            prompt: "Assess myocardial viability for this scan",
            timestamp: Date.now()
        });
    }, []);

    // ── Refs ───────────────────────────────────────────────────────────────────
    const origCanvasRef = useRef(null);
    const locCanvasRef = useRef(null);
    const maskCanvasRef = useRef(null);
    const fileInputRef = useRef(null);
    const folderInputRef = useRef(null);
    const downloadMenuRef = useRef(null);
    const uploadMenuRef = useRef(null);
    const folderDropdownRef = useRef(null);
    const containerRef = useRef(null);

    // ── Click Outside Listener for Menus ──────────────────────────────────────
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target)) {
                setIsDownloadMenuOpen(false);
            }
            if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target)) {
                setIsUploadMenuOpen(false);
            }
            if (folderDropdownRef.current && !folderDropdownRef.current.contains(e.target)) {
                setIsFolderDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        const handleGlobalMouseUp = () => {
            setIsDraggingPan(false);
            setIsBrushDrawing(false);
        };
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, []);

    // ── Backend Health Check ───────────────────────────────────────────────────
    useEffect(() => {
        healthCheck()
            .then(() => setBackendStatus('online'))
            .catch(() => setBackendStatus('offline'));
    }, []);

    // ── Helper: Detect if current scan is a Cardiac Cine sequence ────────────
    const currentSeriesObj = seriesList.find((s) => s.id === activeSeriesId) || null;
    const activeStudyObj = patientHierarchy?.studies?.find((s) => s.id === activeStudyId) || null;

    const filteredSubfolders = useMemo(() => {
        if (!patientHierarchy?.studies) return [];
        if (!subfolderFilter.trim()) return patientHierarchy.studies;
        const q = subfolderFilter.toLowerCase();
        return patientHierarchy.studies.filter((s) => {
            return (
                (s.name && s.name.toLowerCase().includes(q)) ||
                (s.category && s.category.toLowerCase().includes(q)) ||
                (s.sequenceName && s.sequenceName.toLowerCase().includes(q)) ||
                (s.seriesDescription && s.seriesDescription.toLowerCase().includes(q))
            );
        });
    }, [patientHierarchy, subfolderFilter]);

    const categoriesMap = useMemo(() => {
        if (!filteredSubfolders || filteredSubfolders.length === 0) return new Map();
        const map = new Map();
        for (const study of filteredSubfolders) {
            const cat = study.category || 'General';
            if (!map.has(cat)) {
                map.set(cat, []);
            }
            map.get(cat).push(study);
        }
        return map;
    }, [filteredSubfolders]);
    const isLocalizerScan = Boolean(
        parsedOriginal?.isLocalizer ||
        (rawFile?.name && /localizer|scout/i.test(rawFile.name)) ||
        (currentSeriesObj?.filename && /localizer|scout/i.test(currentSeriesObj.filename)) ||
        (currentSeriesObj?.viewType && /localizer|scout/i.test(currentSeriesObj.viewType))
    );
    const isCineImage = !isLocalizerScan && Boolean(
        parsedOriginal?.isCine ||
        (!parsedOriginal?.isT1Mapping && !parsedOriginal?.isMultiEcho && (parsedOriginal?.numTimeFrames || 1) > 1) ||
        (rawFile?.name && /cine|bssfp|truefisp|fiesta|bffe/i.test(rawFile.name)) ||
        (currentSeriesObj?.filename && /cine|bssfp|truefisp|fiesta|bffe/i.test(currentSeriesObj.filename))
    );
    const isT1Image = Boolean(
        parsedOriginal?.isT1Mapping ||
        (rawFile?.name && /t1.*map|molli|shmolli|sasha/i.test(rawFile.name)) ||
        (currentSeriesObj?.filename && /t1.*map|molli|shmolli|sasha/i.test(currentSeriesObj.filename))
    );
    const currentFrameMeta = parsedOriginal?.getTimeFrameMeta
        ? parsedOriginal.getTimeFrameMeta(currentSlice, currentTimeFrame)
        : null;
    const currentSliceInfo = parsedOriginal?.getSliceInfo
        ? parsedOriginal.getSliceInfo(currentSlice, currentTimeFrame)
        : null;
    const activeSliceCols = currentSliceInfo?.cols || parsedOriginal?.cols || 256;
    const activeSliceRows = currentSliceInfo?.rows || parsedOriginal?.rows || 256;

    // ── Cine Loop Animation (Runs only for Cine sequences) ─────────────────────
    useEffect(() => {
        if (!isPlayingCine || !parsedOriginal || !isCineImage) return;

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
    }, [isPlayingCine, parsedOriginal, isCineImage, cineFps]);

    // ── Helper: Extract all files recursively (handles directories & multiple files) ──
    const extractFilesFromDataTransfer = async (dataTransfer) => {
        const files = [];
        if (dataTransfer.items && dataTransfer.items.length > 0) {
            const queue = [];
            for (let i = 0; i < dataTransfer.items.length; i++) {
                const item = dataTransfer.items[i];
                if (item.webkitGetAsEntry) {
                    const entry = item.webkitGetAsEntry();
                    if (entry) queue.push(entry);
                } else if (item.kind === 'file') {
                    const f = item.getAsFile();
                    if (f) files.push(f);
                }
            }

            while (queue.length > 0) {
                const entry = queue.shift();
                if (entry.isFile) {
                    const f = await new Promise((resolve) => entry.file(resolve));
                    if (f) {
                        if (entry.fullPath) {
                            f.relativePath = entry.fullPath.replace(/^\//, '');
                        }
                        files.push(f);
                    }
                } else if (entry.isDirectory) {
                    const dirReader = entry.createReader();
                    let batch;
                    do {
                        batch = await new Promise((resolve) => dirReader.readEntries(resolve, () => resolve([])));
                        if (batch && batch.length > 0) {
                            for (const child of batch) queue.push(child);
                        }
                    } while (batch && batch.length > 0);
                }
            }
        } else if (dataTransfer.files && dataTransfer.files.length > 0) {
            for (let i = 0; i < dataTransfer.files.length; i++) {
                files.push(dataTransfer.files[i]);
            }
        }
        return files;
    };

    // ── Calculate Comfortable Auto-Fit Zoom for Viewport ──────────────────────
    const getFitZoom = (parsed, isSplit = false) => {
        if (!parsed) return 1;
        const cols = parsed.cols || 256;
        const rows = parsed.rows || 256;
        const container = containerRef.current;
        const availW = container ? ((container.clientWidth / (isSplit ? 2 : 1)) - 60) : 800;
        const availH = container ? (container.clientHeight - 60) : 600;
        const scale = Math.min(availW / cols, availH / rows);
        // Default to a generous scale so scans (often 256x216) fill ~80% of the screen immediately
        return Math.max(1.8, Math.min(6.0, +(scale * 0.88).toFixed(2)));
    };

    // ── Auto-fit Zoom when Scan or View changes ──────────────────────────────
    useEffect(() => {
        if (!parsedOriginal) return;
        const timer = setTimeout(() => {
            if (containerRef.current) {
                const fit = getFitZoom(parsedOriginal, isSplitView);
                setZoom(fit);
                setPan({ x: 0, y: 0 });
            }
        }, 60);
        return () => clearTimeout(timer);
    }, [parsedOriginal, isSplitView]);

    // ── Select an Active Series from the Browser ──────────────────────────────
    const selectSeries = (series) => {
        if (!series) return;
        setActiveSeriesId(series.id);
        setRawFile(series.file);
        setParsedOriginal(series.parsed);
        setCurrentSlice(0);
        setCurrentTimeFrame(0);
        setWindowCenter(series.parsed.defaultWindowCenter);
        setWindowWidth(series.parsed.defaultWindowWidth);
        const fit = getFitZoom(series.parsed, Boolean(series.localizedResult));
        setZoom(fit);
        setPan({ x: 0, y: 0 });
        setIsPlayingCine(false);
        setIsBrushMode(false);
        setBrushMaskData(null);

        // Restore cached localized view if available
        if (series.localizedResult) {
            setParsedLocalized(series.localizedResult.parsed);
            setLocalizedRawData(series.localizedResult.raw);
            setIsSplitView(true);
        } else {
            setParsedLocalized(null);
            setLocalizedRawData(null);
            setIsSplitView(false);
        }

        // Auto-adjust mask selection when switching scans
        if (selectedMaskType === 'gt' && !series.hasGtMask && !series.gtMask) {
            setSelectedMaskType(series.aiMask ? 'ai' : 'none');
        } else if (selectedMaskType === 'ai' && !series.aiMask) {
            setSelectedMaskType(series.hasGtMask || series.gtMask ? 'gt' : 'none');
        }

        setStatusMessage(`Active scan: ${series.filename} (${series.viewType || series.parsed.type.toUpperCase()})`);

        // Preserve patient profile across series of the same patient study without re-rendering or flickering
        if (series.clinicalData) {
            setClinicalData((prev) => (prev === series.clinicalData ? prev : series.clinicalData));
        } else {
            // Inherit already-loaded study clinical data if available
            setClinicalData((prev) => {
                if (prev) {
                    series.clinicalData = prev;
                    return prev;
                }
                // If not yet loaded for this study, fetch once
                const uploader = series.parsed.type === 'dicom' ? uploadDicom : uploadNifti;
                uploader(series.file)
                    .then((res) => {
                        if (res && res.clinical_data) {
                            series.clinicalData = res.clinical_data;
                            setClinicalData((current) => current || res.clinical_data);
                        }
                    })
                    .catch(console.warn);
                return prev;
            });
        }
    };

    // ── Open a Specific Subfolder / Study from Hierarchy ─────────────────────
    const handleOpenStudy = async (study) => {
        if (!study) return;
        setIsLoadingStudy(true);
        setActiveStudyId(study.id);
        setStatusMessage(`Loading ${study.name} (${study.imageCount} images)...`);

        if (study.category) {
            setExpandedStudies((prev) => new Set(prev).add(study.category));
        }

        try {
            const seriesObj = await assembleSingleStudy(study);
            if (!seriesObj) {
                setErrorMessage(`Failed to assemble images for ${study.name}`);
                setIsLoadingStudy(false);
                return;
            }

            // Link matching GT mask if available in hierarchy
            if (patientHierarchy?.studies) {
                const base = getBaseScanName(study.name).toLowerCase();
                const gtStudy = patientHierarchy.studies.find(
                    (s) => isGroundTruthMask(s.name) && getBaseScanName(s.name).toLowerCase() === base
                );
                if (gtStudy && gtStudy.id !== study.id) {
                    const gtSeries = await assembleSingleStudy(gtStudy);
                    if (gtSeries) {
                        seriesObj.gtMask = gtSeries;
                        seriesObj.hasGtMask = true;
                    }
                }
            }

            // Keep loaded studies in seriesList so filmstrip and selector can switch between them
            setSeriesList((prev) => {
                const existingIdx = prev.findIndex((s) => s.id === seriesObj.id);
                if (existingIdx >= 0) {
                    const copy = [...prev];
                    copy[existingIdx] = seriesObj;
                    return copy;
                }
                return [...prev, seriesObj];
            });

            selectSeries(seriesObj);
            const isCineScan = seriesObj.parsed?.isCine && !/localizer|scout/i.test(study.name);
            const phaseSuffix = isCineScan && seriesObj.numTimeFrames > 1
                ? ` • ${seriesObj.numTimeFrames} CINE Phases`
                : (seriesObj.parsed?.isT1Mapping && seriesObj.numTimeFrames > 1 ? ` • ${seriesObj.numTimeFrames} TIs` : '');
            setStatusMessage(`Active study: ${study.name} (${seriesObj.numSlices || 1} Slices${phaseSuffix})`);
        } catch (err) {
            console.error('Error opening study:', err);
            setErrorMessage(`Error loading ${study.name}: ${err.message}`);
        } finally {
            setIsLoadingStudy(false);
        }
    };

    // ── Batch & Folder Files Processing ────────────────────────────────────────
    const processUploadedFiles = async (fileList) => {
        if (!fileList || fileList.length === 0) return;
        setErrorMessage('');
        setClinicalData(null);
        setSeriesList([]);

        setStatusMessage('Scanning patient directory structure...');

        try {
            const hierarchy = await buildHierarchicalStudyTree(fileList);
            if (!hierarchy || !hierarchy.studies || hierarchy.studies.length === 0) {
                setErrorMessage('No valid medical files (.nii, .nii.gz, .dcm) found in the selected folder.');
                setStatusMessage('');
                return;
            }

            setPatientHierarchy(hierarchy);
            setPatientStudyName(hierarchy.patientName);
            setSidebarTab('folders');
            setIsSidebarOpen(true);

            // Folders start completely collapsed — user opens only what they choose
            setExpandedStudies(new Set());

            // Do not display any scan automatically — wait until user explicitly selects a scan
            setActiveStudyId(null);
            setParsedOriginal(null);
            setParsedLocalized(null);
            setRawFile(null);
            setStatusMessage(`Loaded patient hierarchy (${hierarchy.studies.length} scans). Select a scan to view.`);
        } catch (err) {
            console.error('Error organizing patient studies:', err);
            setErrorMessage(`Failed to organize patient studies: ${err.message}`);
            setStatusMessage('');
        }
    };

    const handleFileChange = (e) => {
        const files = e.target.files;
        if (files && files.length > 0) processUploadedFiles(files);
    };

    const handleFolderChange = (e) => {
        const files = e.target.files;
        if (files && files.length > 0) processUploadedFiles(files);
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        setIsDragOver(false);

        try {
            const files = await extractFilesFromDataTransfer(e.dataTransfer);
            if (files && files.length > 0) {
                processUploadedFiles(files);
            }
        } catch (err) {
            console.error('Error handling dropped files:', err);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                processUploadedFiles(e.dataTransfer.files);
            }
        }
    };

    const activeGtMask = currentSeriesObj?.gtMask || null;
    const hasMatchingGt = Boolean(activeGtMask || currentSeriesObj?.hasGtMask);
    const activeAiMask = currentSeriesObj?.aiMask || null;
    const hasAiMask = Boolean(activeAiMask);

    // ── Render Canvases ────────────────────────────────────────────────────────
    const renderViews = useCallback(() => {
        if (!parsedOriginal) return;

        // Determine which mask overlay (if any) to render
        let currentMaskData = null;
        let maskPalette = 'groundTruth';

        if (selectedMaskType === 'gt' && activeGtMask && activeGtMask.parsed) {
            const mSlice = Math.min(currentSlice, (activeGtMask.parsed.numSlices || 1) - 1);
            const mTime = Math.min(currentTimeFrame, (activeGtMask.parsed.numTimeFrames || 1) - 1);
            currentMaskData = activeGtMask.parsed.getSliceData(mSlice, mTime);
            maskPalette = 'groundTruth';
        } else if (selectedMaskType === 'ai' && activeAiMask && activeAiMask.parsed) {
            const mSlice = Math.min(currentSlice, (activeAiMask.parsed.numSlices || 1) - 1);
            const mTime = Math.min(currentTimeFrame, (activeAiMask.parsed.numTimeFrames || 1) - 1);
            currentMaskData = activeAiMask.parsed.getSliceData(mSlice, mTime);
            maskPalette = 'ai';
        }

        // Render Original Canvas (using spatial slice, cardiac time-frame, and optional mask overlay)
        const origSliceData = parsedOriginal.getSliceData(currentSlice, currentTimeFrame);
        const sliceInfo = parsedOriginal.getSliceInfo
            ? parsedOriginal.getSliceInfo(currentSlice, currentTimeFrame)
            : null;
        if (origCanvasRef.current && origSliceData) {
            renderSliceToCanvas(
                origCanvasRef.current,
                origSliceData,
                sliceInfo?.cols || parsedOriginal.cols,
                sliceInfo?.rows || parsedOriginal.rows,
                windowCenter,
                windowWidth,
                sliceInfo?.min ?? parsedOriginal.min,
                sliceInfo?.max ?? parsedOriginal.max,
                currentMaskData,
                maskOpacity,
                maskPalette
            );
        }

        // Render Localized / Preprocessed Canvas if present (synchronized slice & phase)
        if (isSplitView && parsedLocalized && locCanvasRef.current) {
            const locSliceIdx = Math.min(currentSlice, parsedLocalized.numSlices - 1);
            const locTimeIdx = Math.min(currentTimeFrame, (parsedLocalized.numTimeFrames || 1) - 1);
            const locSliceData = parsedLocalized.getSliceData(locSliceIdx, locTimeIdx);
            if (locSliceData) {
                let locMaskData = null;
                if (
                    selectedMaskType === 'ai' &&
                    activeAiMask?.roiParsed &&
                    activeAiMask.roiParsed.cols === parsedLocalized.cols &&
                    activeAiMask.roiParsed.rows === parsedLocalized.rows
                ) {
                    const roiSlice = Math.min(currentSlice, (activeAiMask.roiParsed.numSlices || 1) - 1);
                    locMaskData = activeAiMask.roiParsed.getSliceData(roiSlice, 0);
                }

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
                    parsedLocalized.max,
                    locMaskData,
                    maskOpacity,
                    'ai'
                );
            }
        }

    }, [
        parsedOriginal,
        parsedLocalized,
        isSplitView,
        currentSlice,
        currentTimeFrame,
        windowCenter,
        windowWidth,
        selectedMaskType,
        maskOpacity,
        activeGtMask,
        activeAiMask
    ]);

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
            let parsedLoc;
            let rawData;
            if (parsedOriginal.type === 'dicom') {
                res = await localizeDicom(rawFile);
                if (!res.dicom_file_data) throw new Error('No DICOM data in localizer response.');
                const locBuffer = base64ToArrayBuffer(res.dicom_file_data);
                parsedLoc = await parseMedicalFile(locBuffer, `localized_${rawFile.name}`);
                rawData = { base64: res.dicom_file_data, format: 'dicom' };
            } else {
                res = await localizeNifti(rawFile);
                if (!res.nifti_file_data) throw new Error('No NIfTI data in localizer response.');
                const locBuffer = base64ToArrayBuffer(res.nifti_file_data);
                parsedLoc = await parseMedicalFile(locBuffer, `localized_${rawFile.name}`);
                rawData = { base64: res.nifti_file_data, format: 'nifti' };
            }

            setLocalizedRawData(rawData);
            setIsSplitView(true);
            setParsedLocalized(parsedLoc);

            // Cache localization result into seriesList for this series
            setSeriesList((prevList) =>
                prevList.map((s) => {
                    if (s.id === activeSeriesId) {
                        return {
                            ...s,
                            hasLocalization: true,
                            localizedResult: { parsed: parsedLoc, raw: rawData }
                        };
                    }
                    return s;
                })
            );

            setStatusMessage('Localization complete! Displaying Real vs Localized view.');
        } catch (err) {
            console.error('Localization error:', err);
            setErrorMessage(`Localizer failed: ${err.message}`);
            setStatusMessage('');
        } finally {
            setIsLoadingLocalizer(false);
        }
    };

    // ── Run Full Preprocessing + nnU-Net Segmentation Pipeline ────────────────
    const handleRunSegmentation = async () => {
        if (!rawFile || !parsedOriginal) return;
        setIsLoadingSegment(true);
        setErrorMessage('');
        setStatusMessage('Running preprocessing and nnU-Net segmentation...');

        try {
            const res = parsedOriginal.type === 'dicom'
                ? await predictDicom(rawFile)
                : await predictNifti(rawFile);

            if (!res.mask_nifti_data) {
                throw new Error('No segmentation mask returned by backend.');
            }

            const baseName = rawFile.name.replace(/\.nii(\.gz)?$/i, '').replace(/\.(dcm|dicom)$/i, '');
            const maskBuffer = base64ToArrayBuffer(res.mask_nifti_data);
            const parsedMask = await parseMedicalFile(maskBuffer, `${baseName}_pred.nii.gz`);

            let parsedRoiMask = null;
            if (res.roi_mask_nifti_data) {
                const roiMaskBuffer = base64ToArrayBuffer(res.roi_mask_nifti_data);
                parsedRoiMask = await parseMedicalFile(roiMaskBuffer, `${baseName}_roi_pred.nii.gz`);
            }

            let parsedPreprocessed = null;
            if (res.preprocessed_nifti_data) {
                const prepBuffer = base64ToArrayBuffer(res.preprocessed_nifti_data);
                parsedPreprocessed = await parseMedicalFile(prepBuffer, `preprocessed_${baseName}.nii.gz`);
                const rawPrep = { base64: res.preprocessed_nifti_data, format: 'nifti' };
                setLocalizedRawData(rawPrep);
                setParsedLocalized(parsedPreprocessed);
                setIsSplitView(true);
            }

            const aiMaskObj = {
                parsed: parsedMask,
                roiParsed: parsedRoiMask,
                base64: res.mask_nifti_data,
                roiBase64: res.roi_mask_nifti_data || null,
                labelCounts: res.label_counts || {},
                labels: res.labels || {},
            };

            setSeriesList((prevList) =>
                prevList.map((s) => {
                    if (s.id === activeSeriesId) {
                        return {
                            ...s,
                            aiMask: aiMaskObj,
                            hasAiMask: true,
                            ...(parsedPreprocessed
                                ? {
                                      hasLocalization: true,
                                      localizedResult: {
                                          parsed: parsedPreprocessed,
                                          raw: { base64: res.preprocessed_nifti_data, format: 'nifti' }
                                      }
                                  }
                                : {})
                        };
                    }
                    return s;
                })
            );

            setSelectedMaskType('ai');

            const summary = Object.entries(res.label_counts || {})
                .filter(([, count]) => count > 0)
                .map(([name, count]) => `${name}: ${count}`)
                .join(' · ');
            setStatusMessage(
                summary
                    ? `Segmentation complete! (${summary})`
                    : 'Segmentation complete! AI mask overlaid on scan.'
            );
        } catch (err) {
            console.error('Segmentation error:', err);
            setErrorMessage(`Segmentation failed: ${err.message}`);
            setStatusMessage('');
        } finally {
            setIsLoadingSegment(false);
        }
    };

    const handleDownloadAiMask = () => {
        if (!activeAiMask?.base64) return;
        const baseName = rawFile?.name
            ? rawFile.name.replace(/\.nii(\.gz)?$/i, '').replace(/\.(dcm|dicom)$/i, '')
            : 'scan';
        const byteCharacters = atob(activeAiMask.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/gzip' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseName}_pred.nii.gz`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
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
        if (isBrushMode) {
            setIsBrushDrawing(true);
            paintBrush(e.clientX, e.clientY);
            return;
        }
        setIsDraggingPan(true);
        setDragStart({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = (e) => {
        if (!parsedOriginal) return;

        // Update Mouse Position info
        const rect = origCanvasRef.current?.getBoundingClientRect();
        if (rect) {
            const mouseX = Math.round(((e.clientX - rect.left) / rect.width) * activeSliceCols);
            const mouseY = Math.round(((e.clientY - rect.top) / rect.height) * activeSliceRows);
            setMousePos({ x: mouseX, y: mouseY, value: 'Active' });
        }

        if (isBrushMode) {
            if (isBrushDrawing) paintBrush(e.clientX, e.clientY);
            return;
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

    const handleMouseUp = () => {
        setIsDraggingPan(false);
        setIsBrushDrawing(false);
    };

    // ── Brush: render mask canvas overlay ─────────────────────────────────────
    useEffect(() => {
        const canvas = maskCanvasRef.current;
        const imgCanvas = origCanvasRef.current;
        if (!canvas || !imgCanvas || !parsedOriginal) return;

        canvas.width = activeSliceCols;
        canvas.height = activeSliceRows;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!isBrushMode) return;

        const sliceMask = brushMaskData?.get(currentSlice);
        if (!sliceMask) return;

        const imgData = ctx.createImageData(activeSliceCols, activeSliceRows);
        const alpha = Math.round(maskOpacity * 255);
        for (let i = 0; i < sliceMask.length; i++) {
            const label = sliceMask[i];
            if (label > 0) {
                let rgb = [6, 182, 212]; // Label 1: Cyan (Cavity)
                if (label === 2) rgb = [168, 85, 247];      // Label 2: Purple (Myocardium)
                else if (label === 3) rgb = [245, 158, 11]; // Label 3: Amber (Infarction)
                else if (label === 4) rgb = [244, 63, 94];  // Label 4: Rose (No-Reflow)
                imgData.data[i * 4]     = rgb[0];
                imgData.data[i * 4 + 1] = rgb[1];
                imgData.data[i * 4 + 2] = rgb[2];
                imgData.data[i * 4 + 3] = alpha;
            }
        }
        ctx.putImageData(imgData, 0, 0);
    }, [brushMaskData, currentSlice, parsedOriginal, isBrushMode, maskOpacity, activeSliceCols, activeSliceRows]);

    // ── Brush: initialize mask (prefill from active GT/AI mask if available) ──
    const handleStartBrushMode = useCallback(() => {
        if (!parsedOriginal) return;
        setIsBrushMode(true);
        setBrushMaskData((prev) => {
            const map = prev ? new Map(prev) : new Map();

            const sourceMaskParsed =
                selectedMaskType === 'gt' && activeGtMask?.parsed
                    ? activeGtMask.parsed
                    : selectedMaskType === 'ai' && activeAiMask?.parsed
                    ? activeAiMask.parsed
                    : activeAiMask?.parsed || activeGtMask?.parsed || null;

            for (let s = 0; s < parsedOriginal.numSlices; s++) {
                if (!map.has(s)) {
                    const sInfo = parsedOriginal.getSliceInfo ? parsedOriginal.getSliceInfo(s, 0) : null;
                    const cols = sInfo?.cols || parsedOriginal.cols;
                    const rows = sInfo?.rows || parsedOriginal.rows;
                    const sliceArr = new Uint8Array(rows * cols);
                    // Preserve integer labels (1, 2, 3, 4...) from active GT or AI mask
                    if (sourceMaskParsed) {
                        const mSlice = Math.min(s, (sourceMaskParsed.numSlices || 1) - 1);
                        const existingMask = sourceMaskParsed.getSliceData(mSlice, 0);
                        if (existingMask) {
                            for (let i = 0; i < Math.min(sliceArr.length, existingMask.length); i++) {
                                sliceArr[i] = existingMask[i] > 0 ? Math.min(255, Math.round(existingMask[i])) : 0;
                            }
                        }
                    }
                    map.set(s, sliceArr);
                }
            }
            return map;
        });
    }, [parsedOriginal, selectedMaskType, activeGtMask, activeAiMask]);

    // ── Brush: convert display coords → image pixel coords ───────────────────
    const displayToImageCoords = useCallback((clientX, clientY) => {
        const imgCanvas = origCanvasRef.current;
        if (!imgCanvas || !parsedOriginal) return null;
        const rect = imgCanvas.getBoundingClientRect();
        // getBoundingClientRect gives the displayed (scaled) canvas position
        const px = Math.round(((clientX - rect.left) / rect.width) * activeSliceCols);
        const py = Math.round(((clientY - rect.top) / rect.height) * activeSliceRows);
        return { px, py };
    }, [parsedOriginal, activeSliceCols, activeSliceRows]);

    // ── Brush: paint circle in mask at image coords ───────────────────────────
    const paintBrush = useCallback((clientX, clientY) => {
        if (!parsedOriginal || !brushMaskData) return;
        const coords = displayToImageCoords(clientX, clientY);
        if (!coords) return;
        const { px, py } = coords;
        const cols = activeSliceCols;
        const rows = activeSliceRows;
        const r = brushSize;
        const value = brushTool === 'draw' ? brushLabel : 0;

        setBrushMaskData((prev) => {
            const map = new Map(prev);
            const slice = map.get(currentSlice) || new Uint8Array(rows * cols);
            const updated = new Uint8Array(slice);
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (dx * dx + dy * dy <= r * r) {
                        const nx = px + dx;
                        const ny = py + dy;
                        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
                            updated[ny * cols + nx] = value;
                        }
                    }
                }
            }
            map.set(currentSlice, updated);
            return map;
        });
    }, [parsedOriginal, brushMaskData, brushSize, brushTool, brushLabel, currentSlice, displayToImageCoords, activeSliceCols, activeSliceRows]);

    // ── Brush: save mask as NIfTI to backend (and optionally download) ────────
    const handleSaveMask = useCallback(async (triggerDownload = false) => {
        if (!parsedOriginal || !brushMaskData) return;
        const numSlices = parsedOriginal.numSlices;
        const rows = parsedOriginal.rows;
        const cols = parsedOriginal.cols;

        // Flatten all slices into one Uint8Array [slices × rows × cols]
        const flatMask = new Uint8Array(numSlices * rows * cols);
        for (let s = 0; s < numSlices; s++) {
            const sliceArr = brushMaskData.get(s);
            if (sliceArr) {
                flatMask.set(sliceArr, s * rows * cols);
            }
        }

        try {
            const blob = new Blob([flatMask], { type: 'application/octet-stream' });
            const form = new FormData();
            form.append('mask_data', blob, 'brush_mask.bin');
            form.append('num_slices', String(numSlices));
            form.append('rows', String(rows));
            form.append('cols', String(cols));
            form.append('series_name', currentSeriesObj?.filename || parsedOriginal.filename || 'scan');
            if (rawFile && /\.(nii|nii\.gz)$/i.test(rawFile.name)) {
                form.append('reference_nifti', rawFile, rawFile.name);
            }

            const res = await fetch('http://localhost:8000/mask/save', { method: 'POST', body: form });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();

            const countsSummary = data.label_counts
                ? Object.entries(data.label_counts).map(([k, v]) => `L${k}: ${v}`).join(', ')
                : `${data.nonzero_voxels || 0} voxels`;
            setStatusMessage(`Mask saved: ${data.filename} (${countsSummary || 'empty'})`);

            if (triggerDownload && data.download_url) {
                const link = document.createElement('a');
                link.href = `http://localhost:8000${data.download_url}`;
                link.download = data.filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        } catch (err) {
            setErrorMessage(`Mask save failed: ${err.message}`);
        }
    }, [parsedOriginal, brushMaskData, currentSeriesObj, rawFile]);

    const handleWheel = (e) => {
        if (!parsedOriginal) return;
        e.preventDefault();
        if (e.ctrlKey || activeTool === 'zoom') {
            const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
            setZoom((prev) => Math.max(0.6, Math.min(10, +(prev * zoomFactor).toFixed(3))));
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
        setZoom((prev) => Math.max(0.6, +(prev / 1.25).toFixed(2)));
    };

    const handleResetView = () => {
        if (!parsedOriginal) return;
        setZoom(getFitZoom(parsedOriginal, isSplitView));
        setPan({ x: 0, y: 0 });
        setWindowCenter(parsedOriginal.defaultWindowCenter);
        setWindowWidth(parsedOriginal.defaultWindowWidth);
    };

    return (
        <div className="flex flex-col h-screen bg-[#070b12] text-slate-100 font-sans select-none overflow-hidden">
            {/* ── TOP HEADER ── */}
            <header className="h-10 bg-[#0d1b2a] border-b border-white/10 px-4 flex items-center justify-between z-20">
                <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-white/80 tracking-wide font-mono">Cardiac MRI</span>
                    <span className="hidden sm:block text-[11px] text-white/25 font-mono border-l border-white/10 pl-3">
                        LV Localization & Myocardial Viability
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    {statusMessage && (
                        <span className="text-[11px] text-white/50 font-mono">{statusMessage}</span>
                    )}
                    {errorMessage && (
                        <span className="text-[11px] text-rose-400/70 font-mono">{errorMessage}</span>
                    )}
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-white/30">
                        <span className={`w-1.5 h-1.5 rounded-full ${backendStatus === 'online' ? 'bg-white/50' : backendStatus === 'checking' ? 'bg-white/30 animate-pulse' : 'bg-rose-500/50'}`} />
                        <span>API: {backendStatus}</span>
                    </div>
                    <button
                        onClick={() => setShowShortcutsModal(true)}
                        className="p-1 rounded hover:bg-white/5 text-white/25 hover:text-white/60 transition"
                        title="Keyboard shortcuts"
                    >
                        <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                </div>
            </header>

            {/* ── CONTROL TOOLBAR ── */}
            <div className="h-11 bg-[#0d1b2a] border-b border-white/10 px-3 flex items-center justify-between text-xs z-40 gap-2 select-none overflow-x-auto">
                {/* Left group */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* Hidden file inputs */}
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".dcm,.dicom,.nii,.nii.gz" multiple className="hidden" />
                    <input type="file" ref={folderInputRef} onChange={handleFolderChange} webkitdirectory="true" directory="" multiple className="hidden" />

                    {/* Upload dropdown */}
                    <div ref={uploadMenuRef} className="relative z-50 flex-shrink-0">
                        <button
                            onClick={() => setIsUploadMenuOpen((prev) => !prev)}
                            className="flex items-center gap-1 border border-white/15 hover:border-white/30 text-white/60 hover:text-white/90 px-2.5 py-1 rounded font-mono transition"
                        >
                            <Upload className="w-3.5 h-3.5" />
                            <span>Upload</span>
                            <ChevronDown className={`w-3 h-3 opacity-50 transition-transform ${isUploadMenuOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isUploadMenuOpen && (
                            <div className="absolute top-full left-0 mt-1 w-48 bg-[#152238] border border-white/15 rounded shadow-xl z-50 py-1 text-xs">
                                <button
                                    onClick={() => { setIsUploadMenuOpen(false); fileInputRef.current?.click(); }}
                                    className="w-full text-left px-3 py-2 text-white/60 hover:bg-white/5 hover:text-white/90 flex items-center gap-2 transition border-b border-white/5"
                                >
                                    <Upload className="w-3.5 h-3.5 flex-shrink-0" />
                                    <div>
                                        <div className="font-medium text-white/80">Upload Scan(s)</div>
                                        <div className="text-[10px] text-white/30">.nii, .dcm</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => { setIsUploadMenuOpen(false); folderInputRef.current?.click(); }}
                                    className="w-full text-left px-3 py-2 text-white/60 hover:bg-white/5 hover:text-white/90 flex items-center gap-2 transition"
                                >
                                    <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
                                    <div>
                                        <div className="font-medium text-white/80">Patient Folder</div>
                                        <div className="text-[10px] text-white/30">Multi-series</div>
                                    </div>
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Quick folder dropdown */}
                    {patientHierarchy?.studies?.length > 0 && (
                        <div ref={folderDropdownRef} className="relative z-50 flex-shrink-0">
                            <button
                                onClick={() => setIsFolderDropdownOpen((prev) => !prev)}
                                className="flex items-center gap-1.5 border border-white/10 hover:border-white/25 text-white/55 hover:text-white/80 px-2.5 py-1 rounded font-mono transition"
                            >
                                <Folder className="w-3.5 h-3.5" />
                                <span className="max-w-[120px] truncate">{activeStudyObj?.name || 'Folders'}</span>
                                {activeStudyObj && <span className="text-white/25 text-[10px]">({activeStudyObj.imageCount})</span>}
                                <ChevronDown className={`w-3 h-3 opacity-40 transition-transform ${isFolderDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {isFolderDropdownOpen && (
                                <div className="absolute top-full left-0 mt-1 w-60 bg-[#152238] border border-white/15 rounded shadow-xl z-50 py-1 text-xs max-h-72 overflow-y-auto">
                                    <div className="px-3 py-1.5 text-[10px] text-white/25 font-mono border-b border-white/5 flex justify-between">
                                        <span>Subfolders</span>
                                        <span>{patientHierarchy.studies.length}</span>
                                    </div>
                                    {Array.from(categoriesMap.entries()).map(([catName, catStudies]) => (
                                        <React.Fragment key={catName}>
                                            <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-white/30 font-mono bg-white/5 border-y border-white/5">
                                                {catName.replace(/^\d+[_\-\s]/, '').replace(/_/g, ' ')}
                                            </div>
                                            {catStudies.map((study) => (
                                                <button
                                                    key={study.id}
                                                    onClick={() => { setIsFolderDropdownOpen(false); handleOpenStudy(study); }}
                                                    className={`w-full text-left pl-5 pr-3 py-1.5 flex items-center justify-between transition cursor-pointer text-xs ${
                                                        study.id === activeStudyId
                                                            ? 'bg-white/10 text-white font-medium border-l border-white/40'
                                                            : 'text-white/50 hover:bg-white/5 hover:text-white/80'
                                                    }`}
                                                >
                                                    <span className="truncate pr-2">{study.name}</span>
                                                    <span className="text-[9px] text-white/25 flex-shrink-0">{study.imageCount} imgs</span>
                                                </button>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Folders sidebar toggle */}
                    {patientHierarchy?.studies?.length > 0 && (
                        <button
                            onClick={() => { setIsSidebarOpen((prev) => !prev); setSidebarTab('folders'); }}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded border font-mono transition flex-shrink-0 ${
                                isSidebarOpen && sidebarTab === 'folders'
                                    ? 'bg-white/10 border-white/25 text-white/80'
                                    : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/70'
                            }`}
                        >
                            <Folder className="w-3.5 h-3.5" />
                            <span>Folders</span>
                            <span className="text-[10px] text-white/30">({patientHierarchy.studies.length})</span>
                        </button>
                    )}

                    {/* Run Localizer */}
                    <button
                        onClick={handleSendToLocalizer}
                        disabled={!parsedOriginal || isLoadingLocalizer || isLoadingSegment}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded border font-mono transition flex-shrink-0 ${
                            !parsedOriginal || isLoadingLocalizer || isLoadingSegment
                                ? 'border-white/8 text-white/20 cursor-not-allowed'
                                : 'border-white/20 text-white/60 hover:border-white/40 hover:text-white/90'
                        }`}
                    >
                        {isLoadingLocalizer ? (
                            <>
                                <div className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin" />
                                <span>Localizing...</span>
                            </>
                        ) : (
                            <span>Run Localizer</span>
                        )}
                    </button>

                    {/* Run Segmentation */}
                    <button
                        onClick={handleRunSegmentation}
                        disabled={!parsedOriginal || isLoadingSegment || isLoadingLocalizer}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded border font-mono transition flex-shrink-0 ${
                            !parsedOriginal || isLoadingSegment || isLoadingLocalizer
                                ? 'border-white/8 text-white/20 cursor-not-allowed'
                                : 'border-cyan-500/40 text-cyan-300/85 hover:border-cyan-400 hover:text-cyan-200 bg-cyan-500/10'
                        }`}
                        title="Preprocess volume and run nnU-Net segmentation"
                    >
                        {isLoadingSegment ? (
                            <>
                                <div className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
                                <span>Segmenting...</span>
                            </>
                        ) : (
                            <>
                                <Layers className="w-3.5 h-3.5" />
                                <span>Run Segmentation</span>
                            </>
                        )}
                    </button>

                    <div className="h-5 w-px bg-white/8 mx-0.5 flex-shrink-0" />

                    {/* Assess Viability */}
                    <button
                        id="workstation-assess-viability-btn"
                        onClick={handleAssessViability}
                        disabled={!parsedOriginal}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded border font-mono transition flex-shrink-0 ${
                            !parsedOriginal
                                ? 'border-white/8 text-white/20 cursor-not-allowed'
                                : 'border-white/20 text-white/60 hover:border-white/40 hover:text-white/90'
                        }`}
                    >
                        <span>Assess Viability</span>
                    </button>

                    <div className="h-5 w-px bg-white/8 mx-0.5 flex-shrink-0" />

                    {/* Single / Split view */}
                    <div className="flex items-center bg-white/5 rounded border border-white/8 overflow-hidden flex-shrink-0">
                        <button
                            onClick={() => setIsSplitView(false)}
                            disabled={!parsedOriginal}
                            className={`flex items-center gap-1 px-2.5 py-1 font-mono transition ${
                                !isSplitView ? 'bg-white/10 text-white/80' : 'text-white/35 hover:text-white/60'
                            } ${!parsedOriginal ? 'opacity-30 cursor-not-allowed' : ''}`}
                        >
                            <Square className="w-3.5 h-3.5" />
                            <span>Single</span>
                        </button>
                        <button
                            onClick={() => setIsSplitView(true)}
                            disabled={!parsedLocalized}
                            className={`flex items-center gap-1 px-2.5 py-1 font-mono transition border-l border-white/8 ${
                                isSplitView ? 'bg-white/10 text-white/80' : 'text-white/35 hover:text-white/60'
                            } ${!parsedLocalized ? 'opacity-30 cursor-not-allowed' : ''}`}
                        >
                            <Columns className="w-3.5 h-3.5" />
                            <span>Split 1×2</span>
                        </button>
                    </div>

                    {/* Export (only when localized) */}
                    {parsedLocalized && (
                        <div ref={downloadMenuRef} className="relative z-50 flex-shrink-0">
                            <button
                                onClick={() => setIsDownloadMenuOpen(!isDownloadMenuOpen)}
                                className="flex items-center gap-1 border border-white/15 hover:border-white/30 text-white/50 hover:text-white/80 px-2.5 py-1 rounded font-mono transition"
                            >
                                <Download className="w-3.5 h-3.5" />
                                <span>Export</span>
                                <ChevronDown className="w-3 h-3 opacity-40 ml-0.5" />
                            </button>

                            {isDownloadMenuOpen && (
                                <div className="absolute top-full left-0 mt-1 w-48 bg-[#152238] border border-white/15 rounded shadow-xl z-50 py-1 text-xs">
                                    <div className="px-3 py-1.5 text-[10px] text-white/25 font-mono border-b border-white/5">Export Format</div>
                                    <button onClick={() => handleDownloadLocalized('dicom')} className="w-full text-left px-3 py-2 text-white/60 hover:bg-white/5 hover:text-white/90 flex justify-between transition font-mono">
                                        <span>DICOM</span><span className="text-white/25">.dcm</span>
                                    </button>
                                    <button onClick={() => handleDownloadLocalized('nifti')} className="w-full text-left px-3 py-2 text-white/60 hover:bg-white/5 hover:text-white/90 flex justify-between transition font-mono">
                                        <span>NIfTI</span><span className="text-white/25">.nii.gz</span>
                                    </button>
                                    <button onClick={() => handleDownloadLocalized('png')} className="w-full text-left px-3 py-2 text-white/60 hover:bg-white/5 hover:text-white/90 flex justify-between transition border-t border-white/5 font-mono">
                                        <span>PNG Slice</span><span className="text-white/25">.png</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* AI Mask controls */}
                    {hasAiMask && (
                        <>
                            <div className="h-5 w-px bg-white/8 mx-0.5 flex-shrink-0" />
                            <div className="flex items-center bg-white/5 rounded border border-cyan-500/30 px-1 gap-1 flex-shrink-0">
                                <button
                                    onClick={() => setSelectedMaskType((prev) => (prev === 'ai' ? 'none' : 'ai'))}
                                    className={`flex items-center gap-1 px-2 py-1 rounded font-mono text-xs transition cursor-pointer ${
                                        selectedMaskType === 'ai' ? 'bg-cyan-500/20 text-cyan-200' : 'text-white/40 hover:text-white/75'
                                    }`}
                                >
                                    <Layers className="w-3.5 h-3.5" />
                                    <span>{selectedMaskType === 'ai' ? 'AI: ON' : 'AI Mask'}</span>
                                </button>
                                {selectedMaskType === 'ai' && (
                                    <div className="flex items-center gap-1 pl-1 border-l border-white/8">
                                        <input
                                            type="range" min="0.1" max="0.9" step="0.05"
                                            value={maskOpacity}
                                            onChange={(e) => setMaskOpacity(Number(e.target.value))}
                                            className="w-12 accent-cyan-400 h-1 bg-white/10 rounded cursor-pointer"
                                        />
                                        <span className="text-[10px] text-white/40 font-mono w-6">{Math.round(maskOpacity * 100)}%</span>
                                    </div>
                                )}
                                <button
                                    onClick={handleDownloadAiMask}
                                    className="border-l border-white/8 pl-1.5 pr-1 py-0.5 text-[10px] font-mono text-cyan-300/70 hover:text-cyan-200 transition cursor-pointer"
                                    title="Download predicted segmentation mask (.nii.gz)"
                                >
                                    <Download className="w-3 h-3" />
                                </button>
                            </div>
                        </>
                    )}

                    {/* GT Mask controls */}
                    {hasMatchingGt && (
                        <>
                            <div className="h-5 w-px bg-white/8 mx-0.5 flex-shrink-0" />
                            <div className="flex items-center bg-white/5 rounded border border-white/8 px-1 gap-1 flex-shrink-0">
                                <button
                                    onClick={() => setSelectedMaskType((prev) => (prev === 'gt' ? 'none' : 'gt'))}
                                    className={`flex items-center gap-1 px-2 py-1 rounded font-mono text-xs transition cursor-pointer ${
                                        selectedMaskType === 'gt' ? 'bg-white/10 text-white/80' : 'text-white/35 hover:text-white/60'
                                    }`}
                                >
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    <span>{selectedMaskType === 'gt' ? 'GT: ON' : 'GT Mask'}</span>
                                </button>
                                {selectedMaskType === 'gt' && (
                                    <div className="flex items-center gap-1 pl-1 border-l border-white/8">
                                        <input
                                            type="range" min="0.1" max="0.9" step="0.05"
                                            value={maskOpacity}
                                            onChange={(e) => setMaskOpacity(Number(e.target.value))}
                                            className="w-12 accent-white h-1 bg-white/10 rounded cursor-pointer"
                                        />
                                        <span className="text-[10px] text-white/30 font-mono w-6">{Math.round(maskOpacity * 100)}%</span>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {/* ── Brush / Mask Editor Controls ── */}
                    {parsedOriginal && (
                        <>
                            <div className="h-5 w-px bg-white/8 mx-0.5 flex-shrink-0" />
                            <div className="flex items-center bg-white/5 rounded border border-white/8 px-1 gap-1 flex-shrink-0">
                                {/* Toggle brush mode */}
                                <button
                                    onClick={() => {
                                        if (isBrushMode) {
                                            setIsBrushMode(false);
                                        } else {
                                            handleStartBrushMode();
                                        }
                                    }}
                                    className={`flex items-center gap-1 px-2 py-1 rounded font-mono text-xs transition cursor-pointer ${
                                        isBrushMode ? 'bg-white/15 text-white/90' : 'text-white/35 hover:text-white/60'
                                    }`}
                                    title="Toggle brush mask editor"
                                >
                                    <span className="font-mono text-[11px]">✎</span>
                                    <span>Brush</span>
                                </button>

                                {isBrushMode && (
                                    <>
                                        {/* Region / Label selector (1, 2, 3, 4) */}
                                        <div className="flex items-center border-l border-white/8 pl-1 gap-0.5">
                                            {[
                                                { id: 1, name: 'L1', title: 'Region 1 (LV Cavity)', dot: 'bg-cyan-500' },
                                                { id: 2, name: 'L2', title: 'Region 2 (Myocardium)', dot: 'bg-purple-500' },
                                                { id: 3, name: 'L3', title: 'Region 3 (Infarction)', dot: 'bg-amber-500' },
                                                { id: 4, name: 'L4', title: 'Region 4 (No-Reflow)', dot: 'bg-rose-500' },
                                            ].map((lbl) => (
                                                <button
                                                    key={lbl.id}
                                                    onClick={() => { setBrushLabel(lbl.id); setBrushTool('draw'); }}
                                                    title={lbl.title}
                                                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
                                                        brushTool === 'draw' && brushLabel === lbl.id
                                                            ? 'bg-white/15 text-white'
                                                            : 'text-white/40 hover:text-white/75'
                                                    }`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full ${lbl.dot}`} />
                                                    <span>{lbl.name}</span>
                                                </button>
                                            ))}
                                        </div>

                                        {/* Draw / Erase toggle */}
                                        <div className="flex items-center border-l border-white/8 pl-1 gap-0.5">
                                            <button
                                                onClick={() => setBrushTool('draw')}
                                                className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
                                                    brushTool === 'draw' ? 'bg-white/15 text-white/90' : 'text-white/35 hover:text-white/60'
                                                }`}
                                            >Draw</button>
                                            <button
                                                onClick={() => setBrushTool('erase')}
                                                className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
                                                    brushTool === 'erase' ? 'bg-white/15 text-white/90' : 'text-white/35 hover:text-white/60'
                                                }`}
                                            >Erase</button>
                                        </div>

                                        {/* Brush size */}
                                        <div className="flex items-center gap-1 border-l border-white/8 pl-1">
                                            <span className="text-[10px] text-white/30 font-mono">Size</span>
                                            <input
                                                type="range" min="2" max="40" step="1"
                                                value={brushSize}
                                                onChange={(e) => setBrushSize(Number(e.target.value))}
                                                className="w-14 accent-white h-1 bg-white/10 rounded cursor-pointer"
                                            />
                                            <span className="text-[10px] text-white/30 font-mono w-5">{brushSize}</span>
                                        </div>

                                        {/* Opacity */}
                                        <div className="flex items-center gap-1 border-l border-white/8 pl-1">
                                            <span className="text-[10px] text-white/30 font-mono">Opacity</span>
                                            <input
                                                type="range" min="0.1" max="1" step="0.05"
                                                value={maskOpacity}
                                                onChange={(e) => setMaskOpacity(Number(e.target.value))}
                                                className="w-12 accent-white h-1 bg-white/10 rounded cursor-pointer"
                                            />
                                        </div>

                                        {/* Clear slice */}
                                        <button
                                            onClick={() => {
                                                if (!parsedOriginal) return;
                                                setBrushMaskData((prev) => {
                                                    const map = new Map(prev);
                                                    map.set(currentSlice, new Uint8Array(parsedOriginal.rows * parsedOriginal.cols));
                                                    return map;
                                                });
                                            }}
                                            className="border-l border-white/8 pl-1 px-2 py-0.5 text-[10px] font-mono text-white/30 hover:text-white/60 transition cursor-pointer"
                                            title="Clear this slice"
                                        >Clear</button>

                                        {/* Save mask */}
                                        <button
                                            onClick={() => handleSaveMask(false)}
                                            className="border-l border-white/8 pl-1 px-2 py-0.5 text-[10px] font-mono text-white/50 hover:text-white/80 transition cursor-pointer"
                                            title="Save mask to backend (outputs/masks)"
                                        >Save</button>

                                        {/* Save & Download .nii.gz */}
                                        <button
                                            onClick={() => handleSaveMask(true)}
                                            className="border-l border-white/8 pl-1 px-2 py-0.5 text-[10px] font-mono text-white/60 hover:text-white transition cursor-pointer"
                                            title="Save and download _gt.nii.gz to re-upload with dataset"
                                        >Download</button>
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Right group: tools */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* Pan / Zoom / Window tools */}
                    <div className="flex items-center bg-white/5 rounded border border-white/8 overflow-hidden">
                        <button
                            onClick={() => setActiveTool('pan')}
                            className={`p-1.5 transition cursor-pointer ${activeTool === 'pan' ? 'bg-white/15 text-white' : 'text-white/35 hover:text-white/70'}`}
                            title="Pan"
                        >
                            <Move className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => setActiveTool('zoom')}
                            className={`p-1.5 transition cursor-pointer border-l border-white/8 ${activeTool === 'zoom' ? 'bg-white/15 text-white' : 'text-white/35 hover:text-white/70'}`}
                            title="Zoom"
                        >
                            <Search className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => setActiveTool('window')}
                            className={`p-1.5 transition cursor-pointer border-l border-white/8 ${activeTool === 'window' ? 'bg-white/15 text-white' : 'text-white/35 hover:text-white/70'}`}
                            title="Window/Level"
                        >
                            <Sun className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    <div className="h-5 w-px bg-white/8 flex-shrink-0" />

                    {/* Zoom In/Out/Reset */}
                    <div className="flex items-center gap-0.5">
                        <button onClick={handleZoomIn} disabled={!parsedOriginal} className="p-1.5 rounded hover:bg-white/5 text-white/35 hover:text-white/70 disabled:opacity-20 transition" title="Zoom in">
                            <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={handleZoomOut} disabled={!parsedOriginal} className="p-1.5 rounded hover:bg-white/5 text-white/35 hover:text-white/70 disabled:opacity-20 transition" title="Zoom out">
                            <ZoomOut className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={handleResetView} disabled={!parsedOriginal} className="p-1.5 rounded hover:bg-white/5 text-white/35 hover:text-white/70 disabled:opacity-20 transition" title="Reset">
                            <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* ── MAIN VIEWER VIEWPORTS AREA (Full Height & Clear) ────────────────── */}
            <div
                className="flex-1 flex overflow-hidden relative bg-[#091422]"
                onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
            >
                {/* Drag & Drop Highlight Overlay */}
                {isDragOver && (
                    <div className="absolute inset-0 z-40 bg-[#0d1b2a]/90 backdrop-blur-md border-4 border-dashed border-white/40 flex flex-col items-center justify-center text-white/70 space-y-3">
                        <Upload className="w-16 h-16 animate-bounce text-white/60" />
                        <span className="text-xl font-bold tracking-wide">Drop DICOM or NIfTI File Here</span>
                        <span className="text-xs text-white/40">Supports .dcm, .dicom, .nii, .nii.gz</span>
                    </div>
                )}

                {/* ── LEFT SIDEBAR (FOLDERS + PROFILE + TAGS) ── */}
                {isSidebarOpen ? (
                    <aside className="w-72 bg-[#091422] border-r border-white/10 flex flex-col z-20 shrink-0">
                        {/* Sidebar Tab Header */}
                        <div className="px-2 py-1.5 border-b border-white/10 flex items-center justify-between">
                            <div className="flex items-center gap-0.5 text-[10px] font-mono">
                                {patientHierarchy?.studies?.length > 0 && (
                                    <button
                                        onClick={() => setSidebarTab('folders')}
                                        className={`px-2.5 py-1 rounded transition ${
                                            sidebarTab === 'folders'
                                                ? 'bg-white/10 text-white'
                                                : 'text-white/40 hover:text-white/70'
                                        }`}
                                    >
                                        Folders ({patientHierarchy.studies.length})
                                    </button>
                                )}
                                <button
                                    onClick={() => setSidebarTab('clinical')}
                                    className={`px-2.5 py-1 rounded transition ${
                                        sidebarTab === 'clinical'
                                            ? 'bg-white/10 text-white'
                                            : 'text-white/40 hover:text-white/70'
                                    }`}
                                >
                                    Profile
                                </button>
                                {parsedOriginal && (
                                    <button
                                        onClick={() => setSidebarTab('metadata')}
                                        className={`px-2.5 py-1 rounded transition ${
                                            sidebarTab === 'metadata'
                                                ? 'bg-white/10 text-white'
                                                : 'text-white/40 hover:text-white/70'
                                        }`}
                                    >
                                        Tags
                                    </button>
                                )}
                            </div>

                            <button
                                onClick={() => setIsSidebarOpen(false)}
                                className="p-1 rounded hover:bg-white/5 text-white/30 hover:text-white/70 transition"
                                title="Collapse sidebar"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Tab 1: Folders */}
                        {sidebarTab === 'folders' && patientHierarchy && (
                            <div className="flex-1 flex flex-col overflow-hidden p-2 gap-1.5">
                                <div className="relative">
                                    <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25" />
                                    <input
                                        type="text"
                                        value={subfolderFilter}
                                        onChange={(e) => setSubfolderFilter(e.target.value)}
                                        placeholder="Filter..."
                                        className="w-full bg-white/5 border border-white/10 focus:border-white/30 rounded pl-7 pr-2 py-1 text-[11px] font-mono text-white/70 placeholder-white/20 focus:outline-none transition"
                                    />
                                    {subfolderFilter && (
                                        <button
                                            onClick={() => setSubfolderFilter('')}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>

                                <div className="flex-1 overflow-y-auto space-y-0.5 font-mono text-xs pr-1">
                                    {patientHierarchy.tree && patientHierarchy.tree.children && patientHierarchy.tree.children.length > 0 ? (
                                        patientHierarchy.tree.children.map((childNode) => (
                                            <DirectoryTreeNode
                                                key={childNode.id}
                                                node={childNode}
                                                depth={0}
                                                activeStudyId={activeStudyId}
                                                expandedNodes={expandedStudies}
                                                onToggleExpand={toggleStudyExpand}
                                                onOpenStudy={handleOpenStudy}
                                                filterText={subfolderFilter}
                                            />
                                        ))
                                    ) : (
                                        <div className="text-white/30 text-center py-6 text-[11px]">No folders found</div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Tab 2: Clinical Profile */}
                        {sidebarTab === 'clinical' && (
                            <div className="flex-1 overflow-y-auto p-2">
                                <ClinicalDataPanel clinicalData={clinicalData} />
                            </div>
                        )}

                        {/* Tab 3: Metadata Tags */}
                        {sidebarTab === 'metadata' && parsedOriginal && (
                            <div className="flex-1 overflow-y-auto p-3 text-[11px] font-mono space-y-2">
                                <div className="border border-white/10 rounded p-2 space-y-1 text-white/60">
                                    <div className="text-white/30 text-[9px] uppercase tracking-wider mb-1">File</div>
                                    <div className="text-white/80 truncate">{rawFile?.name || 'Scan'}</div>
                                    <div className="text-white/35">{parsedOriginal.type.toUpperCase()}</div>
                                </div>
                                <div className="border border-white/10 rounded p-2 space-y-1.5 text-white/60">
                                    <div className="text-white/30 text-[9px] uppercase tracking-wider mb-1">Info</div>
                                    <div className="flex justify-between">
                                        <span className="text-white/35">Dimensions</span>
                                        <span>{parsedOriginal.cols} × {parsedOriginal.rows}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-white/35">Slices</span>
                                        <span>{parsedOriginal.numSlices}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-white/35">W / L</span>
                                        <span>{Math.round(parsedOriginal.defaultWindowWidth)} / {Math.round(parsedOriginal.defaultWindowCenter)}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </aside>
                ) : (
                    /* Collapsed handle */
                    <button
                        onClick={() => setIsSidebarOpen(true)}
                        className="w-6 bg-[#091422] hover:bg-white/5 border-r border-white/10 flex flex-col items-center justify-center py-4 text-white/25 hover:text-white/60 transition z-20 cursor-pointer shrink-0"
                        title="Expand sidebar"
                    >
                        <ChevronRight className="w-3.5 h-3.5 mb-2" />
                        <span className="text-[9px] font-mono [writing-mode:vertical-rl] rotate-180">
                            {patientHierarchy ? `${patientHierarchy.studies.length} folders` : 'sidebar'}
                        </span>
                    </button>
                )}

                {/* VIEWPORTS CONTAINER */}
                {!parsedOriginal ? (
                    patientHierarchy ? (
                        /* FOLDER LOADED BUT NO SCAN SELECTED YET */
                        <div className="flex-1 flex flex-col items-center justify-center bg-[#091422] text-center p-8 select-none">
                            <div className="max-w-sm space-y-3 p-6 rounded-lg border border-white/10 bg-[#0d1b2a]/70">
                                <Folder className="w-8 h-8 text-white/30 mx-auto" />
                                <div>
                                    <p className="text-sm text-white/80 font-medium font-mono">{patientStudyName || 'Patient Study'}</p>
                                    <p className="text-xs text-white/40 font-mono mt-1">
                                        {patientHierarchy.studies.length} scans available
                                    </p>
                                </div>
                                <p className="text-[11px] text-white/35 font-mono pt-1">
                                    Select a scan from the folders list to view
                                </p>
                            </div>
                        </div>
                    ) : (
                        /* INITIAL EMPTY STATE BEFORE UPLOAD */
                        <div className="flex-1 flex flex-col items-center justify-center bg-[#091422] text-center p-8">
                            <div className="max-w-xs space-y-4">
                                <Upload className="w-8 h-8 text-white/20 mx-auto" />
                                <div>
                                    <p className="text-sm text-white/50 font-medium">Cardiac MRI Workstation</p>
                                    <p className="text-xs text-white/25 mt-1">Upload a scan or patient folder to begin</p>
                                </div>
                                <div className="flex items-center justify-center gap-2 text-[10px] font-mono text-white/20">
                                    <span>.DCM</span><span>·</span><span>.DICOM</span><span>·</span><span>.NII</span><span>·</span><span>.NII.GZ</span>
                                </div>
                                <div className="flex gap-2 justify-center pt-1">
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="border border-white/15 hover:border-white/30 text-white/50 hover:text-white/80 px-4 py-2 rounded text-xs font-mono transition flex items-center gap-1.5"
                                    >
                                        <Upload className="w-3.5 h-3.5" />
                                        <span>Select Scan(s)</span>
                                    </button>
                                    <button
                                        onClick={() => folderInputRef.current?.click()}
                                        className="border border-white/15 hover:border-white/30 text-white/50 hover:text-white/80 px-4 py-2 rounded text-xs font-mono transition flex items-center gap-1.5"
                                    >
                                        <FolderOpen className="w-3.5 h-3.5" />
                                        <span>Patient Folder</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
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
                            {/* Viewport Overlay — Top Left */}
                            <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-[#0d1b2a]/80 px-2 py-1 rounded text-[10px] font-mono text-white/50">
                                <span>{parsedOriginal.type.toUpperCase()}</span>
                                {selectedMaskType === 'gt' && (
                                    <span className="text-white/60 border border-white/15 px-1 rounded">GT</span>
                                )}
                                {selectedMaskType === 'ai' && (
                                    <span className="text-cyan-300 border border-cyan-500/30 px-1 rounded">AI</span>
                                )}
                                {activeStudyObj && (
                                    <button
                                        onClick={() => { setIsSidebarOpen(true); setSidebarTab('folders'); }}
                                        className="text-white/50 hover:text-white/80 border border-white/10 hover:border-white/25 px-1.5 rounded transition cursor-pointer"
                                        title="Open folders sidebar"
                                    >
                                        {currentSeriesObj?.viewType || currentSeriesObj?.filename || activeStudyObj.name}
                                    </button>
                                )}
                            </div>

                            {/* Viewport Overlay — Top Right */}
                            <div className="absolute top-2 right-2 z-10 bg-[#0d1b2a]/80 px-2 py-1 rounded text-[10px] font-mono text-white/40 space-y-0.5">
                                <div>{activeSliceCols}×{activeSliceRows}</div>
                                <div>{currentSlice + 1} / {parsedOriginal.numSlices}</div>
                                {((parsedOriginal.numTimeFrames || 1) > 1 && (isCineImage || isT1Image)) && (
                                    <div className="text-white/60">
                                        {isT1Image
                                            ? `TI: ${currentFrameMeta?.inversionTime ?? `${currentTimeFrame + 1}/${parsedOriginal.numTimeFrames}`}`
                                            : `Ph: ${currentTimeFrame + 1}/${parsedOriginal.numTimeFrames}${isPlayingCine ? ' ▶' : ''}`
                                        }
                                    </div>
                                )}
                            </div>

                            {/* Canvas Wrapper */}
                            <div className="flex-1 flex items-center justify-center overflow-hidden bg-black relative">
                                <div
                                    style={{
                                        position: 'relative',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                                        transformOrigin: 'center center',
                                        transition: isDraggingPan ? 'none' : 'transform 0.1s ease-out'
                                    }}
                                >
                                    <canvas
                                        ref={origCanvasRef}
                                        style={{ display: 'block', imageRendering: 'pixelated' }}
                                        className="max-w-full max-h-full object-contain shadow-2xl"
                                    />
                                    {/* Brush Mask Overlay Canvas — pixel-perfect overlay over origCanvas */}
                                    {isBrushMode && (
                                        <canvas
                                            ref={maskCanvasRef}
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                left: 0,
                                                width: '100%',
                                                height: '100%',
                                                imageRendering: 'pixelated',
                                                pointerEvents: 'none'
                                            }}
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Viewport Overlay — Bottom Left */}
                            <div className="absolute bottom-2 left-2 z-10 bg-[#0d1b2a]/80 px-2 py-1 rounded text-[10px] font-mono text-white/40 flex items-center gap-3">
                                <span>W: {Math.round(windowWidth)}</span>
                                <span>L: {Math.round(windowCenter)}</span>
                                <span>{zoom.toFixed(2)}x</span>
                                <span>{mousePos.x},{mousePos.y}</span>
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
                                {/* Viewport 2 — Top Left */}
                                <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-[#0d1b2a]/80 px-2 py-1 rounded text-[10px] font-mono text-white/50">
                                    <span>LOCALIZED LV</span>
                                    <span className="border border-white/10 px-1 rounded text-white/35">MODEL</span>
                                </div>

                                {/* Viewport 2 — Top Right */}
                                {parsedLocalized && (
                                    <div className="absolute top-2 right-2 z-10 bg-[#0d1b2a]/80 px-2 py-1 rounded text-[10px] font-mono text-white/40 space-y-0.5">
                                        <div>{parsedLocalized.cols}×{parsedLocalized.rows}</div>
                                        <div>ROI extracted</div>
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
                                            className="max-w-full max-h-full object-contain cursor-crosshair shadow-2xl"
                                        />
                                    ) : (
                                        <div className="flex flex-col items-center justify-center text-slate-500">
                                            <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-2" />
                                            <span>Processing Localization...</span>
                                        </div>
                                    )}
                                </div>

                                {/* Viewport 2 — Bottom Left */}
                                <div className="absolute bottom-2 left-2 z-10 bg-[#0d1b2a]/80 px-2 py-1 rounded text-[10px] font-mono text-white/35">
                                    Synchronized · LV ROI
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── FOOTER NAVIGATOR ── */}
            {parsedOriginal && (
                <footer className="h-10 bg-[#091422] border-t border-white/10 px-4 flex items-center z-20 text-xs font-mono gap-3">
                    {/* Cine play / fps */}
                    {isCineImage && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                                onClick={() => setIsPlayingCine(!isPlayingCine)}
                                className={`p-1 rounded transition cursor-pointer ${
                                    isPlayingCine
                                        ? 'bg-white/10 text-white'
                                        : 'text-white/40 hover:text-white/70'
                                }`}
                                title={isPlayingCine ? 'Pause' : 'Play'}
                            >
                                {isPlayingCine ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                            </button>
                            <select
                                value={cineFps}
                                onChange={(e) => setCineFps(Number(e.target.value))}
                                className="bg-transparent text-[10px] text-white/40 focus:outline-none cursor-pointer"
                            >
                                <option value={10}>10 fps</option>
                                <option value={15}>15 fps</option>
                                <option value={20}>20 fps</option>
                                <option value={25}>25 fps</option>
                                <option value={30}>30 fps</option>
                            </select>
                        </div>
                    )}

                    {/* Spatial slice nav & main slider */}
                    {parsedOriginal.numSlices > 1 && (
                        <div className={`flex items-center gap-1.5 ${!isCineImage && !isT1Image ? 'flex-1' : 'flex-shrink-0'}`}>
                            <button
                                onClick={() => setCurrentSlice((prev) => Math.max(0, prev - 1))}
                                disabled={currentSlice === 0}
                                className="p-1 rounded bg-white/5 text-white/50 hover:text-white disabled:opacity-25 transition"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-white/50 w-24 text-center">
                                {currentSlice + 1} / {parsedOriginal.numSlices}
                            </span>
                            <button
                                onClick={() => setCurrentSlice((prev) => Math.min(parsedOriginal.numSlices - 1, prev + 1))}
                                disabled={currentSlice === parsedOriginal.numSlices - 1}
                                className="p-1 rounded bg-white/5 text-white/50 hover:text-white disabled:opacity-25 transition"
                            >
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                            {/* If not a CINE or T1 sequence (e.g. Localizer or 3D volume), this is the MAIN full-width slider! */}
                            {(!isCineImage && !isT1Image) ? (
                                <input
                                    type="range"
                                    min="0"
                                    max={parsedOriginal.numSlices - 1}
                                    value={currentSlice}
                                    onChange={(e) => setCurrentSlice(Number(e.target.value))}
                                    className="flex-1 accent-white h-1 bg-white/10 rounded cursor-pointer"
                                />
                            ) : (
                                parsedOriginal.numTimeFrames <= 1 && (
                                    <input
                                        type="range"
                                        min="0"
                                        max={parsedOriginal.numSlices - 1}
                                        value={currentSlice}
                                        onChange={(e) => setCurrentSlice(Number(e.target.value))}
                                        className="w-32 accent-white h-1 bg-white/10 rounded cursor-pointer"
                                    />
                                )
                            )}
                        </div>
                    )}

                    {parsedOriginal.numSlices > 1 && (isCineImage || isT1Image) && (parsedOriginal.numTimeFrames || 1) > 1 && (
                        <div className="h-3 w-px bg-white/10 flex-shrink-0" />
                    )}

                    {/* Temporal / phase / TI scrubber (ONLY for true CINE or T1 Mapping sequences) */}
                    {(isCineImage || isT1Image) && (parsedOriginal.numTimeFrames || 1) > 1 && (
                        <div className="flex items-center gap-1.5 flex-1">
                            <button
                                onClick={() => setCurrentTimeFrame((prev) => Math.max(0, prev - 1))}
                                disabled={currentTimeFrame === 0}
                                className="p-1 rounded bg-white/5 text-white/50 hover:text-white disabled:opacity-25 transition"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-white/50 whitespace-nowrap min-w-[120px] text-center">
                                {isT1Image
                                    ? `TI ${currentTimeFrame + 1}/${parsedOriginal.numTimeFrames}${currentFrameMeta?.inversionTime ? ` (${currentFrameMeta.inversionTime})` : ''}`
                                    : `Phase ${currentTimeFrame + 1}/${parsedOriginal.numTimeFrames}${currentFrameMeta?.triggerTime ? ` (${currentFrameMeta.triggerTime})` : ''}`
                                }
                            </span>
                            <button
                                onClick={() => setCurrentTimeFrame((prev) => Math.min(parsedOriginal.numTimeFrames - 1, prev + 1))}
                                disabled={currentTimeFrame === parsedOriginal.numTimeFrames - 1}
                                className="p-1 rounded bg-white/5 text-white/50 hover:text-white disabled:opacity-25 transition"
                            >
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                            <input
                                type="range"
                                min="0"
                                max={parsedOriginal.numTimeFrames - 1}
                                value={currentTimeFrame}
                                onChange={(e) => setCurrentTimeFrame(Number(e.target.value))}
                                className="flex-1 accent-white h-1 bg-white/10 rounded cursor-pointer"
                            />
                        </div>
                    )}
                </footer>
            )}

            {/* ── BOTTOM SERIES FILMSTRIP (All Scans at the Very Bottom) ───────── */}
            {seriesList.length > 0 && showSeriesBrowser && (
                <SeriesBrowser
                    seriesList={seriesList}
                    activeSeriesId={activeSeriesId}
                    onSelectSeries={selectSeries}
                    parsedOriginal={parsedOriginal}
                    currentSlice={currentSlice}
                    currentTimeFrame={currentTimeFrame}
                    onSelectSlice={(sIdx, tIdx) => {
                        setCurrentSlice(sIdx);
                        if (typeof tIdx === 'number') setCurrentTimeFrame(tIdx);
                    }}
                    activeSubfolderName={currentSeriesObj?.viewType || currentSeriesObj?.filename || activeStudyObj?.name || ''}
                    onOpenFolderUpload={() => folderInputRef.current?.click()}
                    onOpenFileUpload={() => fileInputRef.current?.click()}
                    onOpenStudiesDb={patientHierarchy?.studies?.length > 0 ? () => setShowStudiesDbModal(true) : null}
                    studiesCount={patientHierarchy?.studies?.length || 0}
                    onClose={() => setShowSeriesBrowser(false)}
                    patientName={patientStudyName}
                />
            )}

            {/* ── FULL DOCUMENTS DB MODAL (Horos / OsiriX Style) ─────────────── */}
            {showStudiesDbModal && patientHierarchy && (
                <div className="fixed inset-0 z-50 bg-[#091422]/80 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
                    <div className="bg-[#080d16] border border-cyan-500/50 rounded-2xl max-w-5xl w-full max-h-[85vh] shadow-2xl flex flex-col overflow-hidden">
                        <StudyHierarchyBrowser
                            hierarchy={patientHierarchy}
                            activeStudyId={activeStudyId}
                            onSelectStudy={(study) => {
                                handleOpenStudy(study);
                                setShowStudiesDbModal(false);
                            }}
                            isLoadingStudy={isLoadingStudy}
                            onClose={() => setShowStudiesDbModal(false)}
                            isCollapsed={false}
                        />
                    </div>
                </div>
            )}

            {/* ── KEYBOARD SHORTCUTS HELP MODAL ─────────────────────────────────── */}
            {showShortcutsModal && (
                <div className="fixed inset-0 z-50 bg-[#091422]/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0e1622] border border-cyan-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl relative space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                            <div className="flex items-center space-x-2 text-white/40 font-bold">
                                <Sparkles className="w-4 h-4 text-white/40" />
                                <span>Workstation Navigation & Shortcuts</span>
                            </div>
                            <button onClick={() => setShowShortcutsModal(false)} className="text-slate-400 hover:text-white">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-2.5 text-xs font-mono text-slate-300">
                            <div className="flex justify-between bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800">
                                <span>Pan Image:</span>
                                <span className="text-white/60">Select Pan Tool & Drag</span>
                            </div>
                            <div className="flex justify-between bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800">
                                <span>Zoom In / Out:</span>
                                <span className="text-white/60">Ctrl + Wheel or Zoom Tool</span>
                            </div>
                            <div className="flex justify-between bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800">
                                <span>Brightness / Contrast:</span>
                                <span className="text-white/60">Window Tool & Drag</span>
                            </div>
                            <div className="flex justify-between bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800">
                                <span>Next / Prev Slice:</span>
                                <span className="text-white/60">Mouse Scroll Wheel</span>
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
                              fileName: currentSeriesObj?.filename || rawFile?.name || 'Cardiac Scan',
                              type: parsedOriginal.type,
                              currentSlice,
                              totalSlices: parsedOriginal.numSlices,
                              rows: parsedOriginal.rows,
                              cols: parsedOriginal.cols,
                              sequenceType: currentSeriesObj?.sequenceType || currentSeriesObj?.name || 'Cardiac MRI',
                              patientName: patientStudyName || 'Patient Study',
                              hasAiMask: Boolean(currentSeriesObj?.aiMask),
                              hasGtMask: Boolean(activeGtMask || currentSeriesObj?.hasGtMask),
                              clinicalData: clinicalData || null,
                              metadata: parsedOriginal.metadata || null
                          }
                        : null
                }
                isLocalized={Boolean(parsedLocalized)}
                externalTrigger={chatbotExternalTrigger}
            />
        </div>
    );
}
