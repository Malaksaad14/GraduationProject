import React, { useState } from "react";
import {
    ChevronDown, ChevronUp,
    AlertCircle, FlaskConical
} from "lucide-react";

/** Returns true if a value is real (not null/undefined/empty/N/A). */
const hasValue = (v) =>
    v !== null && v !== undefined && String(v).trim() !== "" && String(v).trim().toUpperCase() !== "N/A";

/** Inline chip for lab result status */
const StatusChip = ({ status }) => {
    if (status === "critical" || status === "high") {
        return (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/10 text-white/90 border border-white/20">
                High
            </span>
        );
    }
    if (status === "low") {
        return (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-white/60 border border-white/10">
                Low
            </span>
        );
    }
    return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono text-white/40 border border-white/10">
            Normal
        </span>
    );
};

/** Generic key/value row */
const KVRow = ({ label, value }) => (
    <div className="flex justify-between items-start gap-2 py-1 border-b border-white/5 last:border-0 font-mono">
        <span className="text-[10px] text-white/40 shrink-0">{label}</span>
        <span className="text-[11px] text-white/80 text-right break-all">{value}</span>
    </div>
);

/** Section header */
const SectionHeader = ({ icon: Icon, title }) => (
    <div className="flex items-center gap-1.5 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-white/40" />}
        <h4 className="text-[10px] uppercase font-mono tracking-wider text-white/50">{title}</h4>
    </div>
);

const ClinicalDataPanel = React.memo(function ClinicalDataPanel({ clinicalData, onClose }) {
    const [isCollapsed, setIsCollapsed] = useState(false);

    // 1. Nothing uploaded yet
    if (!clinicalData) {
        return (
            <div className="bg-[#152238] border border-white/10 rounded-lg p-3 text-white/50 text-xs font-mono">
                <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-white/30" />
                    <span>Upload a DICOM or NIfTI scan to view patient clinical data.</span>
                </div>
            </div>
        );
    }

    // 2. Record not found
    if (!clinicalData.found) {
        return (
            <div className="bg-[#152238] border border-white/10 rounded-lg overflow-hidden text-white/70 font-mono text-xs flex flex-col">
                <div className="bg-[#0d1b2a] px-3 py-2 border-b border-white/10 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-white/80">Patient Profile</span>
                    {onClose && (
                        <button onClick={onClose} className="text-white/30 hover:text-white p-1 text-xs">✕</button>
                    )}
                </div>
                <div className="p-3 space-y-2">
                    <p className="text-[11px] text-white/50 leading-relaxed">
                        {clinicalData.message || "Metadata sourced from DICOM/NIfTI headers only."}
                    </p>
                </div>
            </div>
        );
    }

    const {
        demographics = {},
        lab_results = [],
        risk_factors = {},
        available_sections = [],
    } = clinicalData;

    const hasDemo = available_sections.includes("demographics") || Object.keys(demographics).length > 0;
    const hasLabs = available_sections.includes("lab_results") || lab_results.length > 0;
    const hasRisk = available_sections.includes("risk_factors") || Object.keys(risk_factors).length > 0;

    const extraDemoFields = Object.entries({
        "Patient Name": demographics.name,
        "Patient ID": demographics.id,
        "Age": demographics.age ? `${demographics.age} yrs` : null,
        "Gender": demographics.gender,
        "Weight": demographics.weight,
        "Height": demographics.height,
        "Category": demographics.category,
        "Severity": demographics.severity,
        "Clinical Notes": demographics.clinical_notes,
    }).filter(([, v]) => hasValue(v));

    return (
        <div className="bg-[#152238] border border-white/10 rounded-lg overflow-hidden text-white/80 font-mono text-xs flex flex-col">
            {/* Header */}
            <div className="bg-[#0d1b2a] px-3 py-2 border-b border-white/10 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-white/80">Patient Profile</span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="text-white/30 hover:text-white p-1 rounded"
                    >
                        {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                    </button>
                    {onClose && (
                        <button onClick={onClose} className="text-white/30 hover:text-white p-1 text-xs">✕</button>
                    )}
                </div>
            </div>

            {/* Body */}
            {!isCollapsed && (
                <div className="p-3 space-y-3 overflow-y-auto max-h-[calc(100vh-220px)] custom-scrollbar">
                    {/* Demographics & Diagnosis */}
                    {hasDemo && (
                        <div className="bg-[#091422] p-2.5 rounded border border-white/10 space-y-2">
                            <div className="flex items-center justify-between border-b border-white/10 pb-2">
                                <div>
                                    <div className="text-xs font-medium text-white/90">
                                        {demographics.name || (demographics.id ? `Patient #${demographics.id}` : "Patient Record")}
                                    </div>
                                    {hasValue(demographics.age) && (
                                        <div className="text-[10px] text-white/40">
                                            {demographics.age} yrs {demographics.gender ? `· ${demographics.gender}` : ''}
                                        </div>
                                    )}
                                </div>
                                {hasValue(demographics.disease_code) && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono border border-white/15 text-white/80 bg-white/5">
                                        {demographics.disease_code}
                                    </span>
                                )}
                            </div>

                            {hasValue(demographics.diagnosis) && (
                                <div className="pt-1">
                                    <div className="text-[9px] uppercase text-white/35">Primary Diagnosis</div>
                                    <div className="text-[11px] font-medium text-white/80 mt-0.5">
                                        {demographics.diagnosis}
                                    </div>
                                </div>
                            )}

                            {extraDemoFields.map(([label, value]) => (
                                <KVRow key={label} label={label} value={String(value)} />
                            ))}
                        </div>
                    )}

                    {/* Blood Tests & Lab Biomarkers */}
                    {hasLabs && lab_results.length > 0 && (
                        <div className="bg-[#091422] p-2.5 rounded border border-white/10">
                            <SectionHeader icon={FlaskConical} title="Blood Tests & Biomarkers" />
                            <div className="border border-white/10 rounded overflow-hidden">
                                <table className="w-full text-left text-[10px]">
                                    <thead className="bg-white/5 text-white/40 uppercase border-b border-white/10">
                                        <tr>
                                            <th className="py-1 px-2">Test</th>
                                            <th className="py-1 px-1 text-right">Result</th>
                                            <th className="py-1 px-1">Ref</th>
                                            <th className="py-1 px-1 text-center">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 text-[10px]">
                                        {lab_results.map((item, idx) => (
                                            <tr key={idx} className="hover:bg-white/5 transition-colors">
                                                <td className="py-1 px-2 text-white/70">{item.test}</td>
                                                <td className="py-1 px-1 text-right font-mono text-white/90">
                                                    {item.value} <span className="text-white/30 text-[9px]">{item.unit}</span>
                                                </td>
                                                <td className="py-1 px-1 text-white/30 text-[9px]">{item.reference}</td>
                                                <td className="py-1 px-1 text-center">
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
                        <div className="bg-[#091422] p-2.5 rounded border border-white/10">
                            <SectionHeader title="Risk Factors" />
                            <div className="flex flex-wrap gap-1.5">
                                {Object.entries(risk_factors).map(([label, value]) => (
                                    <span
                                        key={label}
                                        className="px-2 py-0.5 rounded text-[10px] bg-white/5 text-white/60 border border-white/10"
                                    >
                                        {label}{value && value !== "Y" && value !== "1" ? ` (${value})` : ""}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

export default ClinicalDataPanel;
