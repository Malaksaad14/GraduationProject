import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
    ChevronDown,
    ChevronUp,
    FolderOpen,
    Upload,
    X
} from 'lucide-react';
import { isGroundTruthMask, getSequenceFriendlyName, renderSliceToCanvas } from '../utils/medicalImageLoader';

export { getSequenceFriendlyName };

/**
 * Thumbnail canvas item for a single slice / image inside the active subfolder.
 */
function SliceThumbnailItem({
    parsed,
    sliceIndex = 0,
    timeFrameIndex = 0,
    isActive = false,
    onClick,
    label = '',
    subLabel = ''
}) {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!canvasRef.current || !parsed || !parsed.getSliceData) return;
        try {
            const data = parsed.getSliceData(sliceIndex, timeFrameIndex);
            if (!data) return;
            renderSliceToCanvas(
                canvasRef.current,
                data,
                parsed.cols,
                parsed.rows,
                parsed.defaultWindowCenter,
                parsed.defaultWindowWidth,
                parsed.min,
                parsed.max
            );
        } catch (e) {
            console.warn(e);
        }
    }, [parsed, sliceIndex, timeFrameIndex]);

    return (
        <div
            onClick={onClick}
            className={`flex-shrink-0 relative w-20 cursor-pointer rounded border transition-all duration-100 select-none ${
                isActive
                    ? 'border-white/70 ring-1 ring-white/30'
                    : 'border-white/10 hover:border-white/30'
            }`}
        >
            <div className="w-full h-16 bg-[#091422] rounded-t relative flex items-center justify-center overflow-hidden">
                <canvas
                    ref={canvasRef}
                    width={parsed?.cols || 80}
                    height={parsed?.rows || 80}
                    className="w-full h-full object-contain pointer-events-none"
                    style={{ imageRendering: 'pixelated' }}
                />
                {isActive && (
                    <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-white/90" />
                )}
            </div>
            <div className="px-1 py-0.5 text-[9px] font-mono bg-[#0d1b2a]/80 rounded-b flex items-center justify-between">
                <span className={`truncate ${isActive ? 'text-white' : 'text-white/50'}`}>
                    {label}
                </span>
                {subLabel && (
                    <span className="text-[8px] text-white/30 ml-1 truncate">{subLabel}</span>
                )}
            </div>
        </div>
    );
}

export default function SeriesBrowser({
    seriesList = [],
    activeSeriesId,
    onSelectSeries,
    parsedOriginal = null,
    currentSlice = 0,
    currentTimeFrame = 0,
    onSelectSlice = null,
    activeSubfolderName = '',
    onOpenFolderUpload,
    onOpenFileUpload,
    onOpenStudiesDb,
    onClose,
    patientName = 'Patient Study',
    studiesCount = 0
}) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [showGtMasks, setShowGtMasks] = useState(false);
    const [galleryMode, setGalleryMode] = useState('slices');

    const totalSlices = parsedOriginal?.numSlices || 1;
    const totalFrames = parsedOriginal?.numTimeFrames || 1;
    const isSingleSliceCine = totalSlices === 1 && totalFrames > 1;
    const totalImagesInFolder = isSingleSliceCine ? totalFrames : totalSlices;

    const sliceItems = useMemo(() => {
        if (!parsedOriginal || !parsedOriginal.getSliceData) return [];
        const items = [];
        const count = isSingleSliceCine ? totalFrames : totalSlices;

        for (let i = 0; i < count; i++) {
            const sIdx = isSingleSliceCine ? 0 : i;
            const tIdx = isSingleSliceCine ? i : (currentTimeFrame || 0);

            let meta = null;
            if (parsedOriginal.getTimeFrameMeta) {
                meta = parsedOriginal.getTimeFrameMeta(sIdx, tIdx);
            }

            let sub = '';
            if (meta?.inversionTime) sub = `TI ${meta.inversionTime}`;
            else if (meta?.triggerTime) sub = `${meta.triggerTime}`;

            items.push({
                index: i,
                sliceIndex: sIdx,
                timeFrameIndex: tIdx,
                label: isSingleSliceCine ? `Ph ${i + 1}` : `${i + 1}/${count}`,
                subLabel: sub,
                isActive: isSingleSliceCine ? currentTimeFrame === i : currentSlice === i
            });
        }
        return items;
    }, [parsedOriginal, totalSlices, totalFrames, isSingleSliceCine, currentSlice, currentTimeFrame]);

    const gtCount = seriesList.filter((s) => isGroundTruthMask(s.filename)).length;
    const visibleSeries = showGtMasks
        ? seriesList
        : seriesList.filter((s) => !isGroundTruthMask(s.filename));

    const hasMultiSlices = totalImagesInFolder > 1;

    return (
        <div className="bg-[#091422] border-t border-white/10 z-20 flex flex-col shrink-0">
            {/* TOP BAR */}
            <div className="px-3 py-1 border-b border-white/10 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-3">
                    {hasMultiSlices && (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setGalleryMode('slices')}
                                className={`px-2 py-0.5 rounded text-[10px] transition ${
                                    galleryMode === 'slices'
                                        ? 'bg-white/10 text-white'
                                        : 'text-white/40 hover:text-white/70'
                                }`}
                            >
                                Images ({totalImagesInFolder})
                            </button>
                            {seriesList.length > 1 && (
                                <button
                                    onClick={() => setGalleryMode('series')}
                                    className={`px-2 py-0.5 rounded text-[10px] transition ${
                                        galleryMode === 'series'
                                            ? 'bg-white/10 text-white'
                                            : 'text-white/40 hover:text-white/70'
                                    }`}
                                >
                                    Series ({visibleSeries.length})
                                </button>
                            )}
                        </div>
                    )}

                    {activeSubfolderName && (
                        <span className="text-white/35 text-[10px] truncate max-w-[200px]">
                            {activeSubfolderName}
                        </span>
                    )}

                    {galleryMode === 'slices' && totalImagesInFolder > 1 && (
                        <span className="text-[10px] text-white/25">
                            {isSingleSliceCine ? `Phase ${currentTimeFrame + 1}` : `${currentSlice + 1}`} / {totalImagesInFolder}
                        </span>
                    )}

                    {gtCount > 0 && galleryMode === 'series' && (
                        <button
                            onClick={() => setShowGtMasks(!showGtMasks)}
                            className={`px-2 py-0.5 rounded border text-[10px] transition ${
                                showGtMasks
                                    ? 'bg-white/10 text-white border-white/15'
                                    : 'border-white/10 text-white/40 hover:text-white/70'
                            }`}
                        >
                            {showGtMasks ? 'Hide Masks' : `Masks (${gtCount})`}
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-1.5">
                    {onOpenFolderUpload && (
                        <button
                            onClick={onOpenFolderUpload}
                            className="flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 hover:border-white/25 text-[10px] text-white/40 hover:text-white/70 transition"
                        >
                            <FolderOpen className="w-3 h-3" />
                            <span>Folder</span>
                        </button>
                    )}

                    {onOpenFileUpload && (
                        <button
                            onClick={onOpenFileUpload}
                            className="flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 hover:border-white/25 text-[10px] text-white/40 hover:text-white/70 transition"
                        >
                            <Upload className="w-3 h-3" />
                            <span>+ Scan</span>
                        </button>
                    )}

                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="p-1 rounded hover:bg-white/5 text-white/25 hover:text-white/60 transition"
                    >
                        {isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-white/5 text-white/25 hover:text-white/60 transition"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* FILMSTRIP */}
            {!isCollapsed && (
                <div className="px-2 py-2 overflow-x-auto bg-[#091422]">
                    <div className="flex items-start gap-1.5">
                        {galleryMode === 'slices' && sliceItems.length > 0 ? (
                            sliceItems.map((item) => (
                                <SliceThumbnailItem
                                    key={item.index}
                                    parsed={parsedOriginal}
                                    sliceIndex={item.sliceIndex}
                                    timeFrameIndex={item.timeFrameIndex}
                                    isActive={item.isActive}
                                    label={item.label}
                                    subLabel={item.subLabel}
                                    onClick={() => onSelectSlice && onSelectSlice(item.sliceIndex, item.timeFrameIndex)}
                                />
                            ))
                        ) : (
                            visibleSeries.map((series) => {
                                const isActive = series.id === activeSeriesId;
                                const seq = getSequenceFriendlyName(series.filename);
                                const hasLinkedGt = Boolean(series.gtMask || series.hasGtMask);

                                return (
                                    <div
                                        key={series.id}
                                        onClick={() => onSelectSeries(series)}
                                        className={`flex-shrink-0 relative w-24 cursor-pointer rounded border transition-all duration-100 select-none ${
                                            isActive
                                                ? 'border-white/70 ring-1 ring-white/20'
                                                : 'border-white/10 hover:border-white/30'
                                        }`}
                                    >
                                        <div className="w-full h-16 bg-[#091422] rounded-t relative flex items-center justify-center overflow-hidden">
                                            {series.thumbnailUrl ? (
                                                <img
                                                    src={series.thumbnailUrl}
                                                    alt={series.filename}
                                                    className="w-full h-full object-contain pointer-events-none"
                                                    style={{ imageRendering: 'pixelated' }}
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-white/20 text-[9px] font-mono">
                                                    No Preview
                                                </div>
                                            )}

                                            <div className="absolute bottom-1 right-1 bg-[#0d1b2a]/80 px-1 py-px rounded text-[9px] font-mono text-white/50">
                                                {series.numSlices || 1}
                                            </div>

                                            {/* Type tag — from real DICOM metadata only, no guessing */}
                                            {(() => {
                                                // 1. Localizer: detected by parsed flag or name
                                                if (
                                                    series.parsed?.isLocalizer ||
                                                    /localizer|scout/i.test(`${series.filename || ''} ${series.viewType || ''}`)
                                                ) {
                                                    return (
                                                        <div className="absolute top-1 left-1 bg-[#0d1b2a]/80 text-white/60 px-1 py-px rounded text-[8px] font-mono border border-white/10">
                                                            LOC
                                                        </div>
                                                    );
                                                }

                                                // 2. Real DICOM seriesDescription (most reliable source)
                                                let tag = series.seriesDescription || null;

                                                // 3. Known special types as reliable fallback
                                                if (!tag) {
                                                    if (series.parsed?.isT1Mapping) tag = 'T1 Map';
                                                    else if (series.parsed?.isDense) tag = 'DENSE';
                                                }

                                                // 4. If still nothing → show nothing (no guessing)
                                                if (!tag) return null;

                                                if (tag.length > 12) tag = tag.substring(0, 12) + '…';

                                                return (
                                                    <div className="absolute top-1 left-1 bg-[#0d1b2a]/80 text-white/60 px-1 py-px rounded text-[8px] font-mono border border-white/10">
                                                        {tag}
                                                    </div>
                                                );
                                            })()}

                                            {hasLinkedGt && (
                                                <div className="absolute top-1 right-1 bg-[#0d1b2a]/80 text-white/50 px-1 py-px rounded text-[8px] font-mono border border-white/10">
                                                    GT
                                                </div>
                                            )}

                                            {isActive && (
                                                <div className="absolute bottom-1 left-1 w-1.5 h-1.5 rounded-full bg-white/80" />
                                            )}
                                        </div>

                                        <div className="px-1 py-0.5 text-[9px] font-mono bg-[#0d1b2a]/80 rounded-b">
                                            <div
                                                className={`truncate ${isActive ? 'text-white' : 'text-white/50'}`}
                                                title={series.filename}
                                            >
                                                {seq.name}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
