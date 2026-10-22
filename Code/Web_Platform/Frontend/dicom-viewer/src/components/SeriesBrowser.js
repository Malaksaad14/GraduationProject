import React, { useState } from 'react';
import {
    Layers,
    CheckCircle2,
    Play,
    FolderOpen,
    Upload,
    ChevronDown,
    ChevronUp,
    Activity,
    ShieldCheck,
    X
} from 'lucide-react';
import { isGroundTruthMask } from '../utils/medicalImageLoader';

/**
 * Infer human-friendly cardiac sequence or view name from filename.
 */
export function getSequenceFriendlyName(filename = '') {
    const fn = filename.toUpperCase();
    if (fn.includes('_GT') || fn.includes('_MASK') || fn.includes('_SEG')) {
        return { name: 'Ground Truth Mask', tag: 'GT', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
    }
    if (fn.includes('SA_CINE') || (fn.includes('SA') && fn.includes('CINE'))) {
        return { name: 'Short Axis (Cine)', tag: 'CINE', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
    }
    if (fn.includes('LA_2CH') || fn.includes('2CH')) {
        return { name: '2-Chamber View (LA)', tag: '2-CH', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' };
    }
    if (fn.includes('LA_4CH') || fn.includes('4CH')) {
        return { name: '4-Chamber View (LA)', tag: '4-CH', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' };
    }
    if (fn.includes('LA_3CH') || fn.includes('3CH')) {
        return { name: '3-Chamber View (LA)', tag: '3-CH', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' };
    }
    if (fn.includes('LGE') || fn.includes('DE_') || fn.includes('INFARCT') || fn.includes('VIAB')) {
        return { name: 'Late Gadolinium (LGE)', tag: 'LGE', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
    }
    if (fn.includes('T1')) {
        return { name: 'T1 Parametric Map', tag: 'T1', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
    }
    if (fn.includes('T2')) {
        return { name: 'T2 Edema Mapping', tag: 'T2', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' };
    }
    if (fn.includes('DIXON') || fn.includes('MDIXON')) {
        return { name: 'mDIXON Water/Fat', tag: 'DIXON', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' };
    }
    if (fn.includes('BFFE') || fn.includes('FFE')) {
        return { name: 'Balanced FFE Cine', tag: 'bFFE', color: 'bg-teal-500/20 text-teal-300 border-teal-500/40' };
    }
    if (fn.includes('SA') || fn.includes('SHORT')) {
        return { name: 'Short Axis (SA)', tag: 'SA', color: 'bg-slate-500/20 text-slate-300 border-slate-500/40' };
    }
    return { name: filename.replace(/(\.nii|\.gz|\.dcm|\.dicom)/gi, ''), tag: 'VIEW', color: 'bg-slate-700/30 text-slate-300 border-slate-700/50' };
}

export default function SeriesBrowser({
    seriesList = [],
    activeSeriesId,
    onSelectSeries,
    onOpenFolderUpload,
    onOpenFileUpload,
    onClose,
    patientName = 'Patient Study'
}) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [showGtMasks, setShowGtMasks] = useState(false);

    if (!seriesList || seriesList.length === 0) return null;

    // Filter ground truth mask files by default from main gallery
    const gtCount = seriesList.filter((s) => isGroundTruthMask(s.filename)).length;
    const visibleSeries = showGtMasks
        ? seriesList
        : seriesList.filter((s) => !isGroundTruthMask(s.filename));

    const activeSeries = seriesList.find((s) => s.id === activeSeriesId) || seriesList[0];
    const activeSeq = activeSeries ? getSequenceFriendlyName(activeSeries.filename) : null;

    return (
        <div className="bg-[#090f18]/95 border-t border-cyan-500/30 backdrop-blur-md shadow-2xl z-20 flex flex-col shrink-0">
            {/* ── COMPACT BOTTOM TOOLBAR ────────────────────────────────────── */}
            <div className="px-4 py-1.5 bg-[#060a10] border-b border-slate-800/80 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-1.5 text-cyan-400 font-bold tracking-wide">
                        <Layers className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="uppercase text-[10px] font-mono">Patient Scans ({visibleSeries.length})</span>
                    </div>

                    <span className="text-slate-700">|</span>

                    <span className="px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-800/60 text-cyan-300 font-mono text-[10px] font-semibold flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        {patientName}
                    </span>

                    {activeSeries && (
                        <span className="text-[11px] text-slate-300 font-mono hidden sm:inline">
                            Active: <strong className="text-cyan-300">{activeSeq?.name || activeSeries.filename}</strong>
                            <span className="text-slate-500 text-[10px] ml-1.5">({activeSeries.numSlices || 1} Slices)</span>
                        </span>
                    )}

                    {/* Ground truth masks toggle if any GT files exist in folder */}
                    {gtCount > 0 && (
                        <button
                            onClick={() => setShowGtMasks(!showGtMasks)}
                            className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[10px] font-mono transition ${
                                showGtMasks
                                    ? 'bg-emerald-950 text-emerald-300 border-emerald-500/80 ring-1 ring-emerald-500/40 shadow-sm'
                                    : 'bg-slate-850 text-slate-400 border-slate-700 hover:text-emerald-300 hover:border-emerald-600/50'
                            }`}
                            title="Toggle standalone Ground Truth mask files in the gallery"
                        >
                            <ShieldCheck className="w-3 h-3 text-emerald-400" />
                            <span>{showGtMasks ? 'Hide Raw Masks' : `Masks (${gtCount} linked)`}</span>
                        </button>
                    )}
                </div>

                <div className="flex items-center space-x-2">
                    {onOpenFolderUpload && (
                        <button
                            onClick={onOpenFolderUpload}
                            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] transition"
                            title="Upload Another Patient Folder"
                        >
                            <FolderOpen className="w-3 h-3 text-amber-400" />
                            <span>Folder</span>
                        </button>
                    )}

                    {onOpenFileUpload && (
                        <button
                            onClick={onOpenFileUpload}
                            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] transition"
                            title="Add Scans / Files"
                        >
                            <Upload className="w-3 h-3 text-cyan-400" />
                            <span>+ Scan</span>
                        </button>
                    )}

                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
                        title={isCollapsed ? 'Show Scans Carousel' : 'Minimize Scans Carousel'}
                    >
                        {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"
                            title="Close Filmstrip"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* ── HORIZONTAL SCROLLABLE THUMBNAIL FILMSTRIP ─────────────────── */}
            {!isCollapsed && (
                <div className="px-3 py-2 overflow-x-auto bg-[#070b12]">
                    <div className="flex items-center space-x-3">
                        {visibleSeries.map((series) => {
                            const isActive = series.id === activeSeriesId;
                            const isMask = isGroundTruthMask(series.filename);
                            const seq = getSequenceFriendlyName(series.filename);
                            const hasLinkedGt = Boolean(series.gtMask || series.hasGtMask);

                            return (
                                <div
                                    key={series.id}
                                    onClick={() => onSelectSeries(series)}
                                    className={`flex-shrink-0 group relative w-28 cursor-pointer rounded-lg bg-[#0c1420] border transition-all duration-150 transform hover:-translate-y-0.5 select-none ${
                                        isActive
                                            ? 'ring-2 ring-cyan-400 border-cyan-400 shadow-lg shadow-cyan-950/60 bg-[#0f1b2b]'
                                            : isMask
                                            ? 'border-emerald-800/60 bg-[#0a1612] hover:border-emerald-600'
                                            : 'border-slate-800/90 hover:border-slate-600 hover:bg-[#101825]'
                                    }`}
                                >
                                    {/* Thumbnail Preview (Middle Slice) */}
                                    <div className="w-full h-20 bg-black rounded-t-lg relative flex items-center justify-center overflow-hidden">
                                        {series.thumbnailUrl ? (
                                            <img
                                                src={series.thumbnailUrl}
                                                alt={series.filename}
                                                className="w-full h-full object-contain pointer-events-none"
                                                style={{ imageRendering: 'pixelated' }}
                                            />
                                        ) : (
                                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 font-mono text-[9px]">
                                                <Activity className="w-5 h-5 mb-0.5 text-slate-700" />
                                                <span>Scan</span>
                                            </div>
                                        )}

                                        {/* Slice count badge (Bottom-Right, Horos style) */}
                                        <div className="absolute bottom-1 right-1 bg-black/85 backdrop-blur-sm border border-slate-700/60 px-1.5 py-0.2 rounded text-[9px] font-mono font-bold text-white shadow-md">
                                            {series.numSlices || 1}
                                        </div>

                                        {/* Cine indicator badge (Top-Left) */}
                                        {(series.numTimeFrames || 1) > 1 && (
                                            <div className="absolute top-1 left-1 bg-amber-500/95 text-black px-1.5 py-0.2 rounded text-[8px] font-mono font-black flex items-center gap-0.5 shadow-md">
                                                <Play className="w-2 h-2 fill-black" />
                                                <span>CINE</span>
                                            </div>
                                        )}

                                        {/* Linked GT Mask indicator */}
                                        {hasLinkedGt && (
                                            <div
                                                className="absolute bottom-1 left-1 bg-emerald-500 text-black px-1 py-0.2 rounded text-[8px] font-mono font-extrabold flex items-center gap-0.5 shadow-md"
                                                title="Ground Truth Mask Available for Overlay"
                                            >
                                                <ShieldCheck className="w-2.5 h-2.5" />
                                                <span>GT</span>
                                            </div>
                                        )}

                                        {/* Active Checkmark (Top-Right) */}
                                        {isActive && (
                                            <div className="absolute top-1 right-1 bg-cyan-500 text-slate-950 p-0.5 rounded-full shadow-lg">
                                                <CheckCircle2 className="w-3 h-3" />
                                            </div>
                                        )}

                                        {/* AI ROI Ready Tag */}
                                        {series.hasLocalization && !hasLinkedGt && (
                                            <div className="absolute bottom-1 left-1 bg-cyan-500/90 text-black px-1 py-0.2 rounded text-[8px] font-mono font-bold">
                                                ROI
                                            </div>
                                        )}
                                    </div>

                                    {/* Bottom Card Title */}
                                    <div className="p-1 text-[9px] font-mono border-t border-slate-800/80 bg-[#080d14]/90 rounded-b-lg">
                                        <div
                                            className={`font-semibold truncate ${isActive ? 'text-cyan-300' : 'text-slate-300'}`}
                                            title={series.filename}
                                        >
                                            {seq.name}
                                        </div>
                                        <div className="flex items-center justify-between text-[8px] text-slate-500 mt-0.5">
                                            <span className="truncate max-w-[60px]" title={series.filename}>
                                                {series.filename}
                                            </span>
                                            <span className="text-cyan-400 font-medium">
                                                {series.cols}×{series.rows}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
