import React, { useState, useMemo } from 'react';
import {
    Database,
    Folder,
    FolderOpen,
    FolderTree,
    Table as TableIcon,
    FileText,
    CheckCircle2,
    Search,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    X,
    Eye
} from 'lucide-react';

/**
 * StudyHierarchyBrowser - Hierarchical Documents DB / Studies Table & Tree Browser
 * 
 * Reflects OsiriX / Horos / PACS workstation organization:
 * - Displays all subfolders / studies with image counts, sequence descriptions, and DICOM metadata.
 * - Allows users to click into and open a specific subfolder/study to view ONLY its corresponding images.
 * - Prevents performance lag via lazy-loading and provides an intuitive file tree / table navigation.
 */
export default function StudyHierarchyBrowser({
    hierarchy,
    activeStudyId,
    onSelectStudy,
    isLoadingStudy = false,
    onClose,
    isCollapsed = false,
    onToggleCollapse
}) {
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState('table'); // 'table' | 'tree'
    const [expandedTreeNodes, setExpandedTreeNodes] = useState({});

    const studies = useMemo(() => hierarchy?.studies || [], [hierarchy]);

    // Filter studies by search query (matches study name, sequence, modality, patient ID)
    const filteredStudies = useMemo(() => {
        if (!searchQuery.trim()) return studies;
        const q = searchQuery.toLowerCase();
        return studies.filter((s) => {
            return (
                (s.name && s.name.toLowerCase().includes(q)) ||
                (s.sequenceName && s.sequenceName.toLowerCase().includes(q)) ||
                (s.seriesDescription && s.seriesDescription.toLowerCase().includes(q)) ||
                (s.studyDescription && s.studyDescription.toLowerCase().includes(q)) ||
                (s.modality && s.modality.toLowerCase().includes(q)) ||
                (s.sequenceTag && s.sequenceTag.toLowerCase().includes(q))
            );
        });
    }, [studies, searchQuery]);

    if (!hierarchy || studies.length === 0) return null;

    const toggleTreeNode = (nodeId) => {
        setExpandedTreeNodes((prev) => ({
            ...prev,
            [nodeId]: !prev[nodeId]
        }));
    };

    return (
        <div className="bg-[#080d16] border-b border-cyan-500/30 text-slate-100 flex flex-col z-30 shadow-2xl relative select-none">
            {/* ── TOP HEADER / TOOLBAR (DOCUMENTS DB) ──────────────────────────────── */}
            <div className="px-4 py-2 bg-[#060a12] border-b border-slate-800 flex items-center justify-between text-xs gap-3">
                {/* Left info group */}
                <div className="flex items-center space-x-3 flex-wrap gap-y-1">
                    <div className="flex items-center space-x-2 text-cyan-400 font-bold tracking-wider">
                        <Database className="w-4 h-4 text-cyan-400" />
                        <span className="font-mono uppercase text-[11px] font-black">Documents DB</span>
                    </div>

                    <span className="text-slate-700 hidden sm:inline">|</span>

                    {/* Patient Name Badge */}
                    <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-800/80 text-cyan-300 font-mono text-[11px] font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        <span>{hierarchy.patientName || 'Patient Study'}</span>
                    </div>

                    {/* Patient ID Badge */}
                    {hierarchy.patientId && hierarchy.patientId !== 'N/A' && (
                        <div className="hidden md:flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-mono text-[10px]">
                            <span className="text-slate-500">ID:</span>
                            <span className="text-cyan-400 font-semibold">{hierarchy.patientId}</span>
                        </div>
                    )}

                    {/* Total studies & images count */}
                    <div className="flex items-center space-x-1.5 text-slate-400 font-mono text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-cyan-300 font-bold">
                            {studies.length} Studies / Subfolders
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                            {hierarchy.totalFilesCount?.toLocaleString() || studies.reduce((acc, s) => acc + s.imageCount, 0)} Total Images
                        </span>
                    </div>
                </div>

                {/* Right controls: Search, View Mode Toggle, Collapse, Close */}
                <div className="flex items-center space-x-2 flex-shrink-0">
                    {/* Search Bar */}
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search studies & sequences..."
                            className="bg-[#0b121e] border border-slate-700/80 focus:border-cyan-500 rounded-lg pl-7 pr-2 py-1 text-[11px] font-mono text-slate-200 placeholder-slate-500 focus:outline-none w-36 sm:w-52 transition"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>

                    {/* View Switcher: Table vs Tree */}
                    <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
                        <button
                            onClick={() => setViewMode('table')}
                            className={`p-1 rounded flex items-center space-x-1 text-[10px] font-mono transition ${
                                viewMode === 'table'
                                    ? 'bg-cyan-950 text-cyan-300 font-bold border border-cyan-800/80 shadow-sm'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                            title="Table View (Horos / OsiriX Style)"
                        >
                            <TableIcon className="w-3.5 h-3.5" />
                            <span className="hidden lg:inline">Table</span>
                        </button>
                        <button
                            onClick={() => setViewMode('tree')}
                            className={`p-1 rounded flex items-center space-x-1 text-[10px] font-mono transition ${
                                viewMode === 'tree'
                                    ? 'bg-cyan-950 text-cyan-300 font-bold border border-cyan-800/80 shadow-sm'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                            title="File Tree View"
                        >
                            <FolderTree className="w-3.5 h-3.5" />
                            <span className="hidden lg:inline">Tree</span>
                        </button>
                    </div>

                    {/* Minimize / Collapse Toggle */}
                    {onToggleCollapse && (
                        <button
                            onClick={onToggleCollapse}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
                            title={isCollapsed ? 'Expand Documents DB Table' : 'Minimize Documents DB Table'}
                        >
                            {isCollapsed ? <ChevronDown className="w-4 h-4 text-cyan-400" /> : <ChevronUp className="w-4 h-4" />}
                        </button>
                    )}

                    {/* Close Button */}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"
                            title="Close Documents DB View"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* ── EXPANDABLE TABLE / TREE CONTENT ─────────────────────────────────── */}
            {!isCollapsed && (
                <div className="max-h-72 overflow-y-auto bg-[#070b14] border-t border-slate-800/70">
                    {viewMode === 'table' ? (
                        /* ── OSIRIX / HOROS WORKSTATION TABLE VIEW ───────────────────── */
                        <table className="w-full text-left border-collapse text-[11px] font-mono select-none">
                            <thead className="bg-[#0b121e] text-slate-400 border-b border-slate-800 sticky top-0 z-10 text-[10px] uppercase font-bold tracking-wider">
                                <tr>
                                    <th className="py-1.5 px-3 w-8 text-center">#</th>
                                    <th className="py-1.5 px-3">Patient Name</th>
                                    <th className="py-1.5 px-3">Patient ID</th>
                                    <th className="py-1.5 px-3">Date Added</th>
                                    <th className="py-1.5 px-3 text-center">Images</th>
                                    <th className="py-1.5 px-3">Study Description</th>
                                    <th className="py-1.5 px-3">Sequence / Subfolder</th>
                                    <th className="py-1.5 px-3">Date Acquired</th>
                                    <th className="py-1.5 px-3 text-center">Modality</th>
                                    <th className="py-1.5 px-3 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {filteredStudies.map((study, idx) => {
                                    const isActive = study.id === activeStudyId;
                                    const isCurrentLoading = isLoadingStudy && isActive;

                                    return (
                                        <tr
                                            key={study.id}
                                            onClick={() => onSelectStudy(study)}
                                            className={`cursor-pointer transition duration-75 group ${
                                                isActive
                                                    ? 'bg-cyan-950/70 border-l-4 border-l-cyan-400 text-cyan-200 font-semibold shadow-inner'
                                                    : 'hover:bg-[#0e1726] text-slate-300'
                                            }`}
                                        >
                                            {/* Index / Active Status Icon */}
                                            <td className="py-1.5 px-3 text-center">
                                                {isCurrentLoading ? (
                                                    <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto" />
                                                ) : isActive ? (
                                                    <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 mx-auto" />
                                                ) : (
                                                    <span className="text-slate-600 text-[9px] group-hover:text-slate-400">
                                                        {idx + 1}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Patient Name */}
                                            <td className="py-1.5 px-3 truncate max-w-[140px] text-slate-200">
                                                <div className="flex items-center space-x-1.5">
                                                    <Folder className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-cyan-400' : 'text-amber-500/80'}`} />
                                                    <span className="truncate">{hierarchy.patientName}</span>
                                                </div>
                                            </td>

                                            {/* Patient ID */}
                                            <td className="py-1.5 px-3 text-slate-400 truncate max-w-[120px]">
                                                {hierarchy.patientId || 'N/A'}
                                            </td>

                                            {/* Date Added */}
                                            <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap text-[10px]">
                                                {hierarchy.dateAdded || 'Today'}
                                            </td>

                                            {/* Images Count (Badge matching screenshot) */}
                                            <td className="py-1.5 px-3 text-center">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold shadow-sm ${
                                                    isActive
                                                        ? 'bg-cyan-500 text-slate-950 ring-1 ring-cyan-400'
                                                        : 'bg-slate-800 text-cyan-300 border border-slate-700/80'
                                                }`}>
                                                    {study.imageCount}
                                                </span>
                                            </td>

                                            {/* Study Description */}
                                            <td className="py-1.5 px-3 truncate max-w-[180px] text-slate-300">
                                                {study.studyDescription || hierarchy.studyDescription || 'Cardiac MRI'}
                                            </td>

                                            {/* Sequence / Subfolder Name */}
                                            <td className="py-1.5 px-3">
                                                <div className="flex items-center space-x-1.5">
                                                    <span className={`font-semibold truncate max-w-[180px] ${isActive ? 'text-cyan-300' : 'text-slate-200'}`}>
                                                        {study.name}
                                                    </span>
                                                    {study.sequenceTag && (
                                                        <span className={`px-1.5 py-0.2 rounded text-[8px] font-bold border ${study.tagColor || 'bg-slate-800 text-slate-300 border-slate-700'}`}>
                                                            {study.sequenceTag}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Date Acquired */}
                                            <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap text-[10px]">
                                                {study.dateAcquired || 'N/A'}
                                            </td>

                                            {/* Modality */}
                                            <td className="py-1.5 px-3 text-center">
                                                <span className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-slate-300 text-[9px] font-bold">
                                                    {study.modality || 'MR'}
                                                </span>
                                            </td>

                                            {/* Action Button */}
                                            <td className="py-1.5 px-3 text-center">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onSelectStudy(study);
                                                    }}
                                                    className={`px-2.5 py-0.5 rounded text-[10px] font-semibold transition flex items-center space-x-1 mx-auto ${
                                                        isActive
                                                            ? 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-md'
                                                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700'
                                                    }`}
                                                >
                                                    <Eye className="w-3 h-3" />
                                                    <span>{isActive ? 'Viewing' : 'Open'}</span>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : (
                        /* ── HIERARCHICAL FILE TREE VIEW ────────────────────────────── */
                        <div className="p-3 font-mono text-xs space-y-2">
                            {/* Root Patient Folder */}
                            <div className="flex items-center space-x-2 text-cyan-300 font-bold">
                                <FolderOpen className="w-4 h-4 text-cyan-400" />
                                <span>{hierarchy.patientName}</span>
                                <span className="text-[10px] text-slate-500 font-normal">
                                    ({studies.length} Subfolders • {hierarchy.totalFilesCount} DICOM Files)
                                </span>
                            </div>

                            {/* Subfolder Branches */}
                            <div className="pl-5 border-l-2 border-slate-800 space-y-1 mt-1">
                                {filteredStudies.map((study) => {
                                    const isActive = study.id === activeStudyId;
                                    const isExpanded = Boolean(expandedTreeNodes[study.id]);

                                    return (
                                        <div key={study.id} className="space-y-1">
                                            <div
                                                onClick={() => onSelectStudy(study)}
                                                className={`flex items-center justify-between p-1.5 rounded-lg cursor-pointer transition ${
                                                    isActive
                                                        ? 'bg-cyan-950/80 border border-cyan-500/80 text-cyan-200'
                                                        : 'hover:bg-slate-800/60 text-slate-300'
                                                }`}
                                            >
                                                <div className="flex items-center space-x-2 truncate">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            toggleTreeNode(study.id);
                                                        }}
                                                        className="text-slate-500 hover:text-slate-300"
                                                    >
                                                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                                    </button>
                                                    <Folder className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-amber-400'}`} />
                                                    <span className="font-semibold truncate">{study.name}</span>
                                                    <span className="text-[10px] text-slate-500 truncate">({study.sequenceName})</span>
                                                </div>

                                                <div className="flex items-center space-x-2 flex-shrink-0">
                                                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-cyan-300 text-[10px] font-bold">
                                                        {study.imageCount} files
                                                    </span>
                                                    {isActive && (
                                                        <span className="text-cyan-400 text-[10px] font-bold flex items-center gap-1">
                                                            <CheckCircle2 className="w-3 h-3" /> Active
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Expanded File Slices under Subfolder */}
                                            {isExpanded && (
                                                <div className="pl-6 border-l border-slate-800 text-[10px] text-slate-400 space-y-0.5 py-1">
                                                    {study.files.slice(0, 15).map((f, i) => (
                                                        <div key={i} className="flex items-center space-x-1.5 py-0.5 text-slate-400 truncate">
                                                            <FileText className="w-3 h-3 text-slate-600 flex-shrink-0" />
                                                            <span className="truncate">{f.name}</span>
                                                            <span className="text-slate-600 text-[9px]">({(f.size / 1024).toFixed(0)} KB)</span>
                                                        </div>
                                                    ))}
                                                    {study.files.length > 15 && (
                                                        <div className="text-slate-600 italic pl-4 py-0.5">
                                                            ... and {study.files.length - 15} more DICOM files
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
