import React, { useState } from "react";
import {
    Activity, FileText, ChevronDown, ChevronUp,
    AlertCircle, CheckCircle, ShieldAlert, Heart,
    Cpu, Tag, FlaskConical, Info
} from "lucide-react";

// --- helpers ------------------------------------------------------------------

/** Returns true if a value is real (not null/undefined/empty/N/A). */
const hasValue = (v) =>
    v !== null && v !== undefined && String(v).trim() !== "" && String(v).trim().toUpperCase() !== "N/A";

/** Badge colour for disease severity/code. */
const getBadgeStyle = (severity, code) => {
    if (code === "NOR") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    if (code === "LV") return "bg-red-500/20 text-red-300 border-red-500/40";
    if (severity === "Critical" || severity === "High")
        return "bg-rose-500/20 text-rose-300 border-rose-500/40";
    return "bg-amber-500/20 text-amber-300 border-amber-500/40";
};

/** Inline chip for a lab-result status value. */
const StatusChip = ({ status }) => {
    if (status === "critical" || status === "high")
        return (
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> High
            </span>
        );
    if (status === "low")
        return (
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Low
            </span>
        );
    return (
        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Normal
        </span>
    );
};

/** Generic key/value row used across multiple sections. */
const KVRow = ({ label, value }) => (
    <div className="flex justify-between items-start gap-2 py-1 border-b border-[#4aa0ce]/10 last:border-0">
        <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">{label}</span>
        <span className="text-[11px] font-semibold text-[#8ed8f8] text-right break-all">{value}</span>
    </div>
);

/** Section header */
const SectionHeader = ({ icon: Icon, title }) => (
    <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-[#4aa0ce]" />
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#76c7e8]">{title}</h4>
    </div>
);

// --- main component -----------------------------------------------------------

export default function ClinicalDataPanel({ clinicalData, onClose }) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [showRaw, setShowRaw] = useState(false);

    // 1. Nothing uploaded yet
    if (!clinicalData) {
        return (
            <div className="bg-[#0e1722] border border-[#4aa0ce]/40 rounded-xl p-4 text-white text-xs shadow-xl m-2">
                <div className="flex items-center gap-2 text-gray-400">
                    <AlertCircle className="w-4 h-4 text-[#4aa0ce]" />
                    <span>Upload a DICOM or NIfTI scan to load patient clinical history and lab results.</span>
                </div>
            </div>
        );
    }

    // 2. Record not found in any dataset
    if (!clinicalData.found) {
        return (
            <div className="bg-[#1a1215] border border-amber-500/40 rounded-xl p-4 text-white text-xs shadow-xl m-2">
                <div className="flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <div className="font-semibold text-amber-300 mb-1">Clinical Record Notice</div>
                        <div className="text-gray-300">
                            {clinicalData.message ||
                                `No clinical records found for Patient ID: ${clinicalData.patient_id || "Unknown"}`}
                        </div>
                        <div className="mt-2 text-[11px] text-gray-400">
                            The MRI scan is fully ready for localization and segmentation.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // 3. Destructure --- everything is optional
    const {
        demographics = {},
        imaging_specs = {},
        lab_results = [],
        risk_factors = {},
        raw_record = {},
        source,
        available_sections = [],
    } = clinicalData;

    // Visibility flags: prefer explicit available_sections, otherwise infer
    const hasDemo = available_sections.includes("demographics") || Object.keys(demographics).length > 0;
    const hasImaging = available_sections.includes("imaging_specs") || Object.keys(imaging_specs).length > 0;
    const hasLabs = available_sections.includes("lab_results") || lab_results.length > 0;
    const hasRisk = available_sections.includes("risk_factors") || Object.keys(risk_factors).length > 0;
    const hasRawRec = Object.keys(raw_record).length > 0;

    // Filtered demographics rows (skip absent fields)
    const extraDemoFields = Object.entries({
        "Category": demographics.category,
        "Severity": demographics.severity,
    }).filter(([, v]) => hasValue(v));

    // Filtered imaging rows
    const imagingFields = Object.entries({
        "Modality": imaging_specs.modality,
        "Dataset": imaging_specs.dataset,
        "Vendor": imaging_specs.vendor,
        "Scanner": imaging_specs.scanner,
        "Field Strength": imaging_specs.field_strength,
        "Centre": imaging_specs.centre,
        "Slice Gap": imaging_specs.gap_between_slices,
    }).filter(([, v]) => hasValue(v));

    return (
        <div className="bg-[#0b131d] border border-[#4aa0ce]/50 rounded-xl overflow-hidden shadow-2xl text-white transition-all duration-300 flex flex-col h-full">

            {/* Header */}
            <div className="bg-[#11202e] px-4 py-3 border-b border-[#4aa0ce]/40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#4aa0ce]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#76c7e8]">
                        Patient Clinical & Lab Profile
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {source && (
                        <span className="text-[9px] bg-[#1a3348] text-[#4aa0ce] px-2 py-0.5 rounded-full border border-[#4aa0ce]/30 truncate max-w-[120px]" title={source}>
                            {source}
                        </span>
                    )}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#1a2f42]"
                    >
                        {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </button>
                    {onClose && (
                        <button onClick={onClose} className="text-gray-400 hover:text-red-400 p-1 text-xs">
                            &#x2715;
                        </button>
                    )}
                </div>
            </div>

            {/* Body */}
            {!isCollapsed && (
                <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-220px)] custom-scrollbar">

                    {/* Demographics & Diagnosis */}
                    {hasDemo && (
                        <div className="bg-[#0f1d2b] p-3 rounded-lg border border-[#4aa0ce]/30 space-y-2">
                            <div className="flex items-center justify-between border-b border-[#4aa0ce]/20 pb-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-full bg-[#1b344d] flex items-center justify-center text-[#76c7e8] font-bold text-[10px]">
                                        {String(demographics.id || "PT").slice(0, 4)}
                                    </div>
                                    <div>
                                        <div className="text-xs font-semibold text-white">
                                            Patient #{demographics.id || clinicalData.patient_id}
                                        </div>
                                        {hasValue(demographics.age) && hasValue(demographics.gender) && (
                                            <div className="text-[11px] text-gray-400">
                                                {demographics.age} yrs &middot; {demographics.gender}
                                            </div>
                                        )}
                                        {hasValue(demographics.age) && !hasValue(demographics.gender) && (
                                            <div className="text-[11px] text-gray-400">{demographics.age} yrs</div>
                                        )}
                                        {!hasValue(demographics.age) && hasValue(demographics.gender) && (
                                            <div className="text-[11px] text-gray-400">{demographics.gender}</div>
                                        )}
                                    </div>
                                </div>
                                {hasValue(demographics.disease_code) && (
                                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${getBadgeStyle(demographics.severity, demographics.disease_code)}`}>
                                        {demographics.disease_code}
                                    </span>
                                )}
                            </div>

                            {hasValue(demographics.diagnosis) && (
                                <div className="pt-1">
                                    <div className="text-[10px] uppercase text-gray-400 tracking-wider">Primary Diagnosis</div>
                                    <div className="text-xs font-semibold text-[#8ed8f8] mt-0.5">
                                        {demographics.diagnosis}
                                    </div>
                                </div>
                            )}

                            {extraDemoFields.map(([label, value]) => (
                                <KVRow key={label} label={label} value={String(value)} />
                            ))}
                        </div>
                    )}

                    {/* Scanner / Imaging Specs */}
                    {hasImaging && imagingFields.length > 0 && (
                        <div className="bg-[#0f1d2b] p-3 rounded-lg border border-[#4aa0ce]/30">
                            <SectionHeader icon={Cpu} title="Scanner & Acquisition" />
                            <div className="bg-[#0a141f] p-2 rounded space-y-1">
                                {imagingFields.map(([label, value]) => (
                                    <KVRow key={label} label={label} value={String(value)} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Blood Tests & Biomarkers */}
                    {hasLabs && lab_results.length > 0 && (
                        <div>
                            <SectionHeader icon={FlaskConical} title="Blood Tests & Cardiac Biomarkers" />
                            <div className="border border-[#4aa0ce]/30 rounded-lg overflow-hidden bg-[#0d1a27]">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-[#14283b] text-[#9bd9f5] text-[10px] uppercase border-b border-[#4aa0ce]/30">
                                        <tr>
                                            <th className="py-2 px-3">Test / Biomarker</th>
                                            <th className="py-2 px-2 text-right">Result</th>
                                            <th className="py-2 px-2">Ref. Range</th>
                                            <th className="py-2 px-2 text-center">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#4aa0ce]/20 text-[11px]">
                                        {lab_results.map((item, idx) => (
                                            <tr key={idx} className="hover:bg-[#132537] transition-colors">
                                                <td className="py-2 px-3 font-medium text-gray-200">{item.test}</td>
                                                <td className="py-2 px-2 text-right font-mono font-semibold text-white">
                                                    {item.value}{" "}
                                                    <span className="text-[10px] text-gray-400">{item.unit}</span>
                                                </td>
                                                <td className="py-2 px-2 text-gray-400 text-[10px]">{item.reference}</td>
                                                <td className="py-2 px-2 text-center">
                                                    <StatusChip status={item.status} />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Risk Factors */}
                    {hasRisk && Object.keys(risk_factors).length > 0 && (
                        <div className="bg-[#0f1d2b] p-3 rounded-lg border border-[#4aa0ce]/30">
                            <SectionHeader icon={Heart} title="Cardiac Risk Factors" />
                            <div className="flex flex-wrap gap-2">
                                {Object.entries(risk_factors).map(([label, value]) => (
                                    <span
                                        key={label}
                                        className="px-2 py-1 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/30"
                                        title={`${label}: ${value}`}
                                    >
                                        {label}
                                        {value && value !== "Y" && value !== "1" ? ` (${value})` : ""}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Raw Source Record (collapsible) */}
                    {hasRawRec && (
                        <div className="bg-[#090f18] p-3 rounded-lg border border-[#4aa0ce]/20">
                            <button
                                onClick={() => setShowRaw(!showRaw)}
                                className="flex items-center gap-2 w-full text-left"
                            >
                                <Info className="w-3.5 h-3.5 text-[#4aa0ce]" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-[#76c7e8]">
                                    Raw Source Record
                                </span>
                                {showRaw
                                    ? <ChevronUp className="w-3.5 h-3.5 ml-auto text-gray-500" />
                                    : <ChevronDown className="w-3.5 h-3.5 ml-auto text-gray-500" />}
                            </button>
                            {showRaw && (
                                <div className="mt-2 space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                                    {Object.entries(raw_record)
                                        .filter(([, v]) => hasValue(v))
                                        .map(([k, v]) => (
                                            <div key={k} className="flex justify-between gap-2 text-[10px] border-b border-[#4aa0ce]/10 py-0.5">
                                                <span className="text-gray-400 shrink-0">{k}</span>
                                                <span className="text-gray-200 text-right font-mono break-all">{String(v)}</span>
                                            </div>
                                        ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Fallback: nothing to show */}
                    {!hasDemo && !hasImaging && !hasLabs && !hasRisk && (
                        <div className="text-center text-gray-500 text-xs py-6">
                            <Tag className="w-6 h-6 mx-auto mb-2 opacity-40" />
                            No clinical metadata is available for this file.
                        </div>
                    )}

                </div>
            )}
        </div>
    );
}
