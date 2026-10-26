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
    Layers,
    FolderOpen,
    ShieldCheck,
    HeartPulse
} from 'lucide-react';
import { localizeDicom, localizeNifti, uploadDicom, uploadNifti, healthCheck } from '../api';
import {
    parseMedicalFile,
    renderSliceToCanvas,
    base64ToArrayBuffer,
    generateThumbnailUrl,
    isGroundTruthMask,
    getBaseScanName,
    groupAndAssembleDicomFiles
} from '../utils/medicalImageLoader';
import AIChatbot from './AIChatbot';
import ClinicalDataPanel from './ClinicalDataPanel';
import SeriesBrowser, { getSequenceFriendlyName } from './SeriesBrowser';

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

    // ── Multi-Scan / Patient Folder Series State ──────────────────────────────
    const [seriesList, setSeriesList] = useState([]);
    const [activeSeriesId, setActiveSeriesId] = useState(null);
    const [showSeriesBrowser, setShowSeriesBrowser] = useState(true);
    const [patientStudyName, setPatientStudyName] = useState('Patient Study');

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
    const handleCloseClinicalPanel = useCallback(() => setShowClinicalPanel(false), []);
    const [isLoadingLocalizer, setIsLoadingLocalizer] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [backendStatus, setBackendStatus] = useState('checking'); // 'online' | 'offline' | 'checking'
    const [showMetadata, setShowMetadata] = useState(false);
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
    const fileInputRef = useRef(null);
    const folderInputRef = useRef(null);
    const downloadMenuRef = useRef(null);
    const uploadMenuRef = useRef(null);
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

    // ── Helper: Detect if current scan is a Cardiac Cine sequence ────────────
    const currentSeriesObj = seriesList.find((s) => s.id === activeSeriesId) || null;
    const isCineImage = Boolean(
        parsedOriginal?.isCine ||
        (!parsedOriginal?.isT1Mapping && !parsedOriginal?.isMultiEcho && (parsedOriginal?.numTimeFrames || 1) > 1) ||
        (rawFile?.name && /cine|bssfp|truefisp|fiesta|bffe/i.test(rawFile.name)) ||
        (currentSeriesObj?.filename && /cine|bssfp|truefisp|fiesta|bffe/i.test(currentSeriesObj.filename))
    );
    const currentFrameMeta = parsedOriginal?.getTimeFrameMeta
        ? parsedOriginal.getTimeFrameMeta(currentSlice, currentTimeFrame)
        : null;

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
                    if (f) files.push(f);
                } else if (entry.isDirectory) {
                    const dirReader = entry.createReader();
                    const entries = await new Promise((resolve) => {
                        dirReader.readEntries(resolve, () => resolve([]));
                    });
                    for (const child of entries) {
                        queue.push(child);
                    }
                }
            }
        } else if (dataTransfer.files && dataTransfer.files.length > 0) {
            for (let i = 0; i < dataTransfer.files.length; i++) {
                files.push(dataTransfer.files[i]);
            }
        }
        return files;
    };

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
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setIsPlayingCine(false);

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
            setSelectedMaskType('none');
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

    // ── Batch & Folder Files Processing ────────────────────────────────────────
    const processUploadedFiles = async (fileList) => {
        if (!fileList || fileList.length === 0) return;
        setErrorMessage('');
        setClinicalData(null);

        const filesArray = Array.from(fileList);
        const medicalFiles = filesArray.filter((f) => {
            const name = f.name.toLowerCase();
            return (
                name.endsWith('.nii') ||
                name.endsWith('.nii.gz') ||
                name.endsWith('.dcm') ||
                name.endsWith('.dicom')
            );
        });

        if (medicalFiles.length === 0) {
            setErrorMessage('No valid medical files (.nii, .nii.gz, .dcm) found in the selected folder/files.');
            return;
        }

        // Sort files naturally by name
        medicalFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        setStatusMessage(`Parsing ${medicalFiles.length} scan${medicalFiles.length > 1 ? 's' : ''}...`);

        // Detect study / patient folder name
        const firstFile = medicalFiles[0];
        let detectedPatient = 'Patient Study';
        if (firstFile.webkitRelativePath && firstFile.webkitRelativePath.includes('/')) {
            detectedPatient = firstFile.webkitRelativePath.split('/')[0];
        } else {
            const match = firstFile.name.match(/^([A-Za-z0-9_]+?)(?:_SA|_LA|_2CH|_4CH|_LGE|_CINE|\.nii|\.dcm)/i);
            if (match && match[1]) {
                detectedPatient = `Patient ${match[1].replace(/_/g, ' ')}`;
            } else {
                detectedPatient = firstFile.name.replace(/\.[^/.]+$/, '');
            }
        }
        setPatientStudyName(detectedPatient);

        const niftiFiles = medicalFiles.filter((f) => {
            const name = f.name.toLowerCase();
            return name.endsWith('.nii') || name.endsWith('.nii.gz');
        });
        const dicomFiles = medicalFiles.filter((f) => {
            const name = f.name.toLowerCase();
            return name.endsWith('.dcm') || name.endsWith('.dicom');
        });

        const newSeries = [];

        // 1. Group & assemble multi-file DICOM series (e.g. 01_bSSFP_Cine, 02_T1_Mapping, etc.)
        if (dicomFiles.length > 0) {
            setStatusMessage(`Grouping & assembling ${dicomFiles.length} DICOM files...`);
            const assembled = await groupAndAssembleDicomFiles(dicomFiles);
            newSeries.push(...assembled);
        }

        // 2. Process NIfTI files
        for (let i = 0; i < niftiFiles.length; i++) {
            const file = niftiFiles[i];
            try {
                const buffer = await file.arrayBuffer();
                const parsed = await parseMedicalFile(buffer, file.name);
                const thumb = generateThumbnailUrl(parsed);
                const seq = getSequenceFriendlyName(file.name);
                newSeries.push({
                    id: `${file.name}_${file.size}_${i}`,
                    file,
                    filename: file.name,
                    parsed,
                    thumbnailUrl: thumb,
                    numSlices: parsed.numSlices,
                    numTimeFrames: parsed.numTimeFrames,
                    cols: parsed.cols,
                    rows: parsed.rows,
                    type: parsed.type,
                    viewType: seq.name,
                    hasLocalization: false,
                    localizedResult: null
                });
            } catch (err) {
                console.warn(`Error parsing ${file.name}:`, err);
            }
        }

        // Link Ground Truth masks to matching anatomical scans
        const maskMap = new Map();
        for (const s of newSeries) {
            if (isGroundTruthMask(s.filename)) {
                const base = getBaseScanName(s.filename).toLowerCase();
                maskMap.set(base, s);
                s.isGroundTruth = true;
            }
        }

        for (const s of newSeries) {
            if (!isGroundTruthMask(s.filename)) {
                const base = getBaseScanName(s.filename).toLowerCase();
                if (maskMap.has(base)) {
                    const matchedGt = maskMap.get(base);
                    s.gtMask = matchedGt;
                    s.hasGtMask = true;
                }
            }
        }

        if (newSeries.length === 0) {
            setErrorMessage('Failed to parse the selected medical scans.');
            setStatusMessage('');
            return;
        }

        // Auto-select the first anatomical scan so user starts on image rather than an isolated mask
        const firstAnatomical = newSeries.find((s) => !isGroundTruthMask(s.filename)) || newSeries[0];

        // Refine patient/study name if authoritative DICOM tags exist
        const firstDicom = newSeries.find((s) => s.type === 'dicom');
        if (firstDicom && firstDicom.parsed?.metadata?.PatientName && firstDicom.parsed.metadata.PatientName !== 'Anonymous' && firstDicom.parsed.metadata.PatientName !== 'N/A') {
            detectedPatient = firstDicom.parsed.metadata.PatientName.replace(/\^/g, ' ').trim();
        } else if (firstDicom && firstDicom.parsed?.metadata?.StudyDescription && firstDicom.parsed.metadata.StudyDescription !== 'N/A') {
            detectedPatient = firstDicom.parsed.metadata.StudyDescription.trim();
        }
        setPatientStudyName(detectedPatient);

        setSeriesList(newSeries);
        setShowSeriesBrowser(true);
        selectSeries(firstAnatomical);
        setStatusMessage(`Loaded ${newSeries.length} scans for ${detectedPatient}`);
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
        }

        // Render Original Canvas (using spatial slice, cardiac time-frame, and optional mask overlay)
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
                parsedOriginal.max,
                currentMaskData,
                maskOpacity,
                maskPalette
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
        activeGtMask
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
            <div className="h-14 bg-[#0d1420] border-b border-slate-800/80 px-4 flex items-center justify-between text-xs relative z-40 shadow-md gap-3 select-none">
                {/* Left Controls Group */}
                <div className="flex items-center space-x-2 flex-shrink-0">
                    {/* Hidden Inputs for Files and Folders */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".dcm,.dicom,.nii,.nii.gz"
                        multiple
                        className="hidden"
                    />
                    <input
                        type="file"
                        ref={folderInputRef}
                        onChange={handleFolderChange}
                        webkitdirectory="true"
                        directory=""
                        multiple
                        className="hidden"
                    />

                    {/* Consolidated Upload Dropdown */}
                    <div ref={uploadMenuRef} className="relative z-50 flex-shrink-0">
                        <button
                            onClick={() => setIsUploadMenuOpen((prev) => !prev)}
                            className="flex items-center space-x-1.5 bg-gradient-to-r from-cyan-600 via-cyan-500 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-3 py-1.5 rounded-lg shadow-md font-semibold transition transform active:scale-95 cursor-pointer ring-1 ring-cyan-400/30 whitespace-nowrap"
                            title="Upload Cardiac MRI Scans or Patient Folders"
                        >
                            <Upload className="w-3.5 h-3.5 text-cyan-100" />
                            <span>Upload</span>
                            <ChevronDown className={`w-3.5 h-3.5 opacity-80 transition-transform ${isUploadMenuOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isUploadMenuOpen && (
                            <div className="absolute top-full left-0 mt-2 w-56 bg-[#0c131d] border border-cyan-500/50 rounded-xl shadow-2xl z-50 py-1.5 text-xs backdrop-blur-xl ring-1 ring-cyan-500/30">
                                <button
                                    onClick={() => {
                                        setIsUploadMenuOpen(false);
                                        fileInputRef.current?.click();
                                    }}
                                    className="w-full text-left px-3.5 py-2.5 text-slate-200 hover:bg-cyan-950 hover:text-cyan-300 flex items-center space-x-2.5 transition font-medium border-b border-slate-800/80 cursor-pointer"
                                >
                                    <Upload className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                                    <div>
                                        <div className="font-semibold text-white">Upload Scan(s)</div>
                                        <div className="text-[10px] text-slate-400">Single or multiple .nii, .dcm</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => {
                                        setIsUploadMenuOpen(false);
                                        folderInputRef.current?.click();
                                    }}
                                    className="w-full text-left px-3.5 py-2.5 text-slate-200 hover:bg-amber-950/60 hover:text-amber-300 flex items-center space-x-2.5 transition font-medium cursor-pointer"
                                >
                                    <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
                                    <div>
                                        <div className="font-semibold text-amber-200">Upload Patient Folder</div>
                                        <div className="text-[10px] text-slate-400">Multi-series & views</div>
                                    </div>
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Series Explorer Toggle Button */}
                    {seriesList.length > 0 && (
                        <button
                            onClick={() => setShowSeriesBrowser(!showSeriesBrowser)}
                            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg font-semibold border transition flex-shrink-0 whitespace-nowrap cursor-pointer ${
                                showSeriesBrowser
                                    ? 'bg-cyan-950 text-cyan-300 border-cyan-500/80 shadow-md ring-1 ring-cyan-500/40'
                                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                            }`}
                            title="Toggle Studies & Series Explorer (Bottom Filmstrip)"
                        >
                            <Layers className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Series</span>
                            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-cyan-500 text-black font-extrabold">
                                {seriesList.length}
                            </span>
                        </button>
                    )}

                    <div className="h-6 w-px bg-slate-800 mx-0.5 flex-shrink-0" />

                    {/* Send to Localizer Button */}
                    <button
                        onClick={handleSendToLocalizer}
                        disabled={!parsedOriginal || isLoadingLocalizer}
                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-bold transition shadow-lg active:scale-95 flex-shrink-0 whitespace-nowrap cursor-pointer ${
                            !parsedOriginal || isLoadingLocalizer
                                ? 'bg-slate-900 text-slate-500 cursor-not-allowed border border-slate-800'
                                : 'bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-white ring-2 ring-emerald-400/40 glow-emerald'
                        }`}
                        title="Run Deep Learning Left Ventricle Localizer"
                    >
                        {isLoadingLocalizer ? (
                            <>
                                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                <span>Localizing ROI...</span>
                            </>
                        ) : (
                            <>
                                <Zap className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
                                <span>Run Localizer</span>
                            </>
                        )}
                    </button>

                    <div className="h-6 w-px bg-slate-800 mx-0.5 flex-shrink-0" />

                    {/* Assess Myocardial Viability Button */}
                    <button
                        id="workstation-assess-viability-btn"
                        onClick={handleAssessViability}
                        disabled={!parsedOriginal}
                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-bold transition shadow-lg active:scale-95 flex-shrink-0 whitespace-nowrap cursor-pointer ${
                            !parsedOriginal
                                ? 'bg-slate-900 text-slate-500 cursor-not-allowed border border-slate-800'
                                : 'bg-gradient-to-r from-rose-700 via-red-600 to-rose-600 hover:from-rose-600 hover:to-red-500 text-white ring-2 ring-rose-500/40 shadow-rose-950/50'
                        }`}
                        title="Assess Myocardial Viability for this scan with Gemini AI Chatbot"
                    >
                        <HeartPulse className="w-3.5 h-3.5 text-rose-200 fill-rose-300/20" />
                        <span>Assess Viability</span>
                    </button>

                    <div className="h-6 w-px bg-slate-800 mx-0.5 flex-shrink-0" />

                    {/* View Modes Toggle */}
                    <div className="flex items-center bg-slate-900/90 p-1 rounded-lg border border-slate-800 space-x-1 flex-shrink-0 whitespace-nowrap">
                        <button
                            onClick={() => setIsSplitView(false)}
                            disabled={!parsedOriginal}
                            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md font-medium transition whitespace-nowrap cursor-pointer ${
                                !isSplitView
                                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200'
                            } ${!parsedOriginal ? 'opacity-50 cursor-not-allowed' : ''}`}
                            title="Single Viewport Mode"
                        >
                            <Square className="w-3.5 h-3.5" />
                            <span>Single</span>
                        </button>

                        <button
                            onClick={() => setIsSplitView(true)}
                            disabled={!parsedLocalized}
                            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md font-medium transition whitespace-nowrap cursor-pointer ${
                                isSplitView
                                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200'
                            } ${!parsedLocalized ? 'opacity-50 cursor-not-allowed' : ''}`}
                            title={parsedLocalized ? "Split View (1×2) - Original vs Localized ROI" : "Run Localizer to enable Split View"}
                        >
                            <Columns className="w-3.5 h-3.5" />
                            <span>Split 1×2</span>
                        </button>
                    </div>

                    {/* Download Localized Result Button */}
                    {parsedLocalized && (
                        <div ref={downloadMenuRef} className="relative z-50 flex-shrink-0">
                            <button
                                onClick={() => setIsDownloadMenuOpen(!isDownloadMenuOpen)}
                                className="flex items-center space-x-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-2.5 py-1.5 rounded-lg font-semibold text-xs shadow-lg transition active:scale-95 cursor-pointer ring-1 ring-emerald-400/40 whitespace-nowrap"
                                title="Download Localized Output"
                            >
                                <Download className="w-3.5 h-3.5" />
                                <span>Export</span>
                                <ChevronDown className="w-3 h-3 ml-0.5 opacity-80" />
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

                    {/* ── GROUND TRUTH MASK OVERLAY CONTROLS (Only visible if a matching GT mask exists) ── */}
                    {hasMatchingGt && (
                        <>
                            <div className="h-6 w-px bg-slate-800 mx-0.5 flex-shrink-0" />
                            <div className="flex items-center bg-slate-900/90 p-1 rounded-lg border border-slate-800 space-x-1.5 flex-shrink-0 whitespace-nowrap">
                                <button
                                    onClick={() => setSelectedMaskType((prev) => (prev === 'gt' ? 'none' : 'gt'))}
                                    className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                                        selectedMaskType === 'gt'
                                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/70 shadow-sm'
                                            : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                    title={selectedMaskType === 'gt' ? "Hide Ground Truth Mask Overlay" : "Show Ground Truth Mask Overlay"}
                                >
                                    <ShieldCheck className={`w-3.5 h-3.5 ${selectedMaskType === 'gt' ? 'text-emerald-400' : 'text-slate-500'}`} />
                                    <span>{selectedMaskType === 'gt' ? 'GT Mask: ON' : 'Show GT Mask'}</span>
                                </button>

                                {selectedMaskType === 'gt' && (
                                    <div className="flex items-center space-x-1.5 pl-1.5 pr-1 border-l border-slate-800">
                                        <input
                                            type="range"
                                            min="0.1"
                                            max="0.9"
                                            step="0.05"
                                            value={maskOpacity}
                                            onChange={(e) => setMaskOpacity(Number(e.target.value))}
                                            className="w-12 accent-emerald-400 h-1 bg-slate-800 rounded cursor-pointer"
                                            title={`Mask Opacity: ${Math.round(maskOpacity * 100)}%`}
                                        />
                                        <span className="text-[10px] text-slate-400 font-mono w-6 text-right">
                                            {Math.round(maskOpacity * 100)}%
                                        </span>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Right Controls Group */}
                <div className="flex items-center space-x-2 flex-shrink-0 whitespace-nowrap">
                    {/* Interactive Tools (Pan, Zoom, Window) */}
                    <div className="flex items-center bg-slate-900/90 p-1 rounded-lg border border-slate-800 space-x-1 flex-shrink-0">
                        <button
                            onClick={() => setActiveTool('pan')}
                            className={`p-1.5 rounded-md transition cursor-pointer ${activeTool === 'pan' ? 'bg-cyan-900/70 text-cyan-300 border border-cyan-600/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                            title="Pan Tool (Click and drag to position image)"
                        >
                            <Move className="w-4 h-4" />
                        </button>

                        <button
                            onClick={() => setActiveTool('zoom')}
                            className={`p-1.5 rounded-md transition cursor-pointer ${activeTool === 'zoom' ? 'bg-cyan-900/70 text-cyan-300 border border-cyan-600/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                            title="Interactive Zoom Tool (Drag up/down or scroll wheel to zoom)"
                        >
                            <Search className="w-4 h-4" />
                        </button>

                        <button
                            onClick={() => setActiveTool('window')}
                            className={`p-1.5 rounded-md transition cursor-pointer ${activeTool === 'window' ? 'bg-cyan-900/70 text-cyan-300 border border-cyan-600/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                            title="Window / Level (Adjust brightness and contrast)"
                        >
                            <Sun className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="h-6 w-px bg-slate-800 mx-0.5 flex-shrink-0" />

                    {/* Zoom & Reset Buttons */}
                    <div className="flex items-center space-x-1 flex-shrink-0">
                        <button
                            onClick={handleZoomIn}
                            disabled={!parsedOriginal}
                            className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-cyan-300 disabled:opacity-40 transition cursor-pointer"
                            title="Zoom In (+25%)"
                        >
                            <ZoomIn className="w-4 h-4" />
                        </button>

                        <button
                            onClick={handleZoomOut}
                            disabled={!parsedOriginal}
                            className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-cyan-300 disabled:opacity-40 transition cursor-pointer"
                            title="Zoom Out (-20%)"
                        >
                            <ZoomOut className="w-4 h-4" />
                        </button>

                        <button
                            onClick={handleResetView}
                            disabled={!parsedOriginal}
                            className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-cyan-300 disabled:opacity-40 transition cursor-pointer"
                            title="Reset Zoom & Contrast"
                        >
                            <RotateCcw className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="h-6 w-px bg-slate-800 mx-0.5 flex-shrink-0" />

                    {/* Patient Profile & Metadata */}
                    <button
                        onClick={() => { setShowClinicalPanel(prev => !prev); if (!showClinicalPanel) setShowMetadata(false); }}
                        disabled={!parsedOriginal}
                        className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border font-medium transition cursor-pointer flex-shrink-0 ${
                            showClinicalPanel
                                ? 'bg-cyan-600/30 border-cyan-500 text-cyan-300'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                        }`}
                        title="Toggle Patient Profile and Clinical Biomarkers"
                    >
                        <Activity className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Profile</span>
                    </button>

                    <button
                        onClick={() => { setShowMetadata(prev => !prev); if (!showMetadata) setShowClinicalPanel(false); }}
                        disabled={!parsedOriginal}
                        className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border font-medium transition cursor-pointer flex-shrink-0 ${
                            showMetadata
                                ? 'bg-blue-950 text-blue-300 border-blue-700/80 shadow-sm'
                                : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                        } ${!parsedOriginal ? 'opacity-40 cursor-not-allowed' : ''}`}
                        title="Toggle DICOM/NIfTI Header Metadata"
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
                            onClose={handleCloseClinicalPanel}
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
                                <h2 className="text-lg font-bold text-slate-100 tracking-wide">Cardiac MRI Workstation</h2>
                                <p className="text-xs text-slate-400">
                                    Upload single scans or an entire patient folder containing multiple views (CINE, Short-Axis, 2CH, 4CH, LGE).
                                </p>
                            </div>

                            <div className="flex items-center justify-center space-x-2 text-[10px] font-mono text-slate-400 pt-1">
                                <span className="bg-slate-900 border border-slate-800 px-2 py-1 rounded">.DCM</span>
                                <span className="bg-slate-900 border border-slate-800 px-2 py-1 rounded">.DICOM</span>
                                <span className="bg-slate-900 border border-slate-800 px-2 py-1 rounded">.NII</span>
                                <span className="bg-slate-900 border border-slate-800 px-2 py-1 rounded">.NII.GZ</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white py-2.5 px-3 rounded-xl font-bold text-xs shadow-lg transition active:scale-95 ring-1 ring-cyan-400/30 flex items-center justify-center gap-2"
                                >
                                    <Upload className="w-4 h-4" />
                                    <span>Select Scan(s)</span>
                                </button>

                                <button
                                    onClick={() => folderInputRef.current?.click()}
                                    className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white py-2.5 px-3 rounded-xl font-bold text-xs shadow-lg transition active:scale-95 ring-1 ring-amber-400/30 flex items-center justify-center gap-2"
                                >
                                    <FolderOpen className="w-4 h-4" />
                                    <span>Patient Folder</span>
                                </button>
                            </div>
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
                                {selectedMaskType === 'gt' && (
                                    <span className="text-emerald-300 text-[10px] bg-emerald-950/80 border border-emerald-600/60 px-1.5 py-0.5 rounded flex items-center gap-1 font-semibold">
                                        <ShieldCheck className="w-2.5 h-2.5" />
                                        GT MASK ON
                                    </span>
                                )}
                            </div>

                            {/* Viewport Information Overlay (Top Right) */}
                            <div className="absolute top-3 right-3 z-10 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 space-y-0.5 shadow-md">
                                <div>Dim: {parsedOriginal.cols}×{parsedOriginal.rows}</div>
                                <div>Slice: {currentSlice + 1} / {parsedOriginal.numSlices}</div>
                                {((parsedOriginal.numTimeFrames || 1) > 1) && (
                                    <div className="text-emerald-400 font-bold">
                                        {parsedOriginal.isT1Mapping
                                            ? `TI: ${currentFrameMeta?.inversionTime ? currentFrameMeta.inversionTime : `${currentTimeFrame + 1}/${parsedOriginal.numTimeFrames}`}`
                                            : parsedOriginal.isDense
                                            ? `Phase: ${currentTimeFrame + 1} / ${parsedOriginal.numTimeFrames} ${isPlayingCine ? '• PLAY' : ''}`
                                            : `Phase: ${currentTimeFrame + 1} / ${parsedOriginal.numTimeFrames} ${currentFrameMeta?.triggerTime ? `(${currentFrameMeta.triggerTime})` : ''} ${isPlayingCine ? '• CINE' : ''}`
                                        }
                                    </div>
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

            {/* ── FOOTER SLICE / CINE NAVIGATOR BAR ────────────────────────────── */}
            {parsedOriginal && (
                <footer className="h-12 bg-[#0c131d] border-t border-slate-800/80 px-6 flex items-center justify-between z-20 text-xs shadow-inner">
                    <div className="flex items-center space-x-4 w-full max-w-4xl mx-auto font-mono">
                        {/* Cine Playback Button & FPS Control (available for Cine sequences) */}
                        {isCineImage && (
                            <div className="flex items-center space-x-1.5 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 flex-shrink-0">
                                <button
                                    onClick={() => setIsPlayingCine(!isPlayingCine)}
                                    className={`p-1 rounded-md transition cursor-pointer ${
                                        isPlayingCine
                                            ? 'bg-amber-950 text-amber-300 border border-amber-600/80 ring-1 ring-amber-500/50'
                                            : 'text-slate-300 hover:text-white'
                                    }`}
                                    title={isPlayingCine ? "Pause Cine Loop" : "Play Cine Loop"}
                                >
                                    {isPlayingCine ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                                </button>
                                <select
                                    value={cineFps}
                                    onChange={(e) => setCineFps(Number(e.target.value))}
                                    className="bg-transparent text-[10px] text-amber-400 font-mono font-bold focus:outline-none cursor-pointer"
                                    title="CINE Playback Speed (Frames Per Second)"
                                >
                                    <option value={10}>10 fps</option>
                                    <option value={15}>15 fps</option>
                                    <option value={20}>20 fps</option>
                                    <option value={25}>25 fps</option>
                                    <option value={30}>30 fps</option>
                                </select>
                            </div>
                        )}

                        {/* Spatial Slice Navigation (when volume has multiple spatial slices) */}
                        {parsedOriginal.numSlices > 1 && (
                            <div className="flex items-center space-x-2 flex-shrink-0">
                                <button
                                    onClick={() => setCurrentSlice((prev) => Math.max(0, prev - 1))}
                                    disabled={currentSlice === 0}
                                    className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:text-white disabled:opacity-40"
                                    title="Previous Spatial Slice"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <span className="text-cyan-300 w-28 text-center font-bold">
                                    Slice {currentSlice + 1} / {parsedOriginal.numSlices}
                                </span>
                                <button
                                    onClick={() => setCurrentSlice((prev) => Math.min(parsedOriginal.numSlices - 1, prev + 1))}
                                    disabled={currentSlice === parsedOriginal.numSlices - 1}
                                    className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:text-white disabled:opacity-40"
                                    title="Next Spatial Slice"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>

                                {parsedOriginal.numTimeFrames <= 1 && (
                                    <input
                                        type="range"
                                        min="0"
                                        max={parsedOriginal.numSlices - 1}
                                        value={currentSlice}
                                        onChange={(e) => setCurrentSlice(Number(e.target.value))}
                                        className="w-36 accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                                        title="Navigate Spatial Slices"
                                    />
                                )}
                            </div>
                        )}

                        {parsedOriginal.numSlices > 1 && (parsedOriginal.numTimeFrames || 1) > 1 && (
                            <div className="h-4 w-px bg-slate-700 mx-1 flex-shrink-0" />
                        )}

                        {/* Temporal Frames / Cardiac Phases / Inversion Times (TI) Scrubber Slider */}
                        {(parsedOriginal.numTimeFrames || 1) > 1 && (
                            <div className="flex items-center space-x-2 flex-1">
                                <button
                                    onClick={() => setCurrentTimeFrame((prev) => Math.max(0, prev - 1))}
                                    disabled={currentTimeFrame === 0}
                                    className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:text-white disabled:opacity-40"
                                    title="Previous Timepoint / TI"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>

                                <span className="text-amber-300 font-bold whitespace-nowrap min-w-[140px] text-center">
                                    {parsedOriginal.isT1Mapping
                                        ? `TI ${currentTimeFrame + 1}/${parsedOriginal.numTimeFrames} ${currentFrameMeta?.inversionTime ? `(${currentFrameMeta.inversionTime})` : ''}`
                                        : parsedOriginal.isDense
                                        ? `Phase ${currentTimeFrame + 1}/${parsedOriginal.numTimeFrames}`
                                        : `Phase ${currentTimeFrame + 1}/${parsedOriginal.numTimeFrames} ${currentFrameMeta?.triggerTime ? `(${currentFrameMeta.triggerTime})` : ''}`
                                    }
                                </span>

                                <button
                                    onClick={() => setCurrentTimeFrame((prev) => Math.min(parsedOriginal.numTimeFrames - 1, prev + 1))}
                                    disabled={currentTimeFrame === parsedOriginal.numTimeFrames - 1}
                                    className="p-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:text-white disabled:opacity-40"
                                    title="Next Timepoint / TI"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>

                                <input
                                    type="range"
                                    min="0"
                                    max={parsedOriginal.numTimeFrames - 1}
                                    value={currentTimeFrame}
                                    onChange={(e) => setCurrentTimeFrame(Number(e.target.value))}
                                    className="flex-1 accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                                    title={parsedOriginal.isT1Mapping ? "Scrub Inversion Times (TI)" : "Scrub Cardiac Phases"}
                                />
                            </div>
                        )}
                    </div>
                </footer>
            )}

            {/* ── BOTTOM SERIES FILMSTRIP (All Scans at the Very Bottom) ───────── */}
            {seriesList.length > 0 && showSeriesBrowser && (
                <SeriesBrowser
                    seriesList={seriesList}
                    activeSeriesId={activeSeriesId}
                    onSelectSeries={selectSeries}
                    onOpenFolderUpload={() => folderInputRef.current?.click()}
                    onOpenFileUpload={() => fileInputRef.current?.click()}
                    onClose={() => setShowSeriesBrowser(false)}
                    patientName={patientStudyName}
                />
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
