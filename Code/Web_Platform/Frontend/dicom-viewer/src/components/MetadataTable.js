
import React from "react";

function MetadataTable({ isOpen, metadata, onClose }) {
    if (!isOpen || !metadata) return null;

    return (
        // scale-110 to expand background shadiw
        <div className="fixed inset-0 bg-black bg-opacity-50  flex items-center justify-center ">
            <div className="bg-[#101820] p-6 rounded-lg shadow-lg max-w-3xl w-full overflow-hidden border border-[#4aa0ce]">
                {/* Title */}
                <h3 className="text-lg font-semibold text-[#76c7e8] mb-4 uppercase tracking-wide">
                    DICOM Metadata
                </h3>

                {/* Table Wrapper */}
                <div className="overflow-auto max-h-96 rounded-lg">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-[#1a78a7] text-white">
                        <tr>
                            <th className="px-4 py-3 text-sm font-medium text-left">Tag</th>
                            <th className="px-4 py-3 text-sm font-medium text-left">Name</th>
                            <th className="px-4 py-3 text-sm font-medium text-left">Value</th>
                        </tr>
                        </thead>
                        <tbody className="bg-[#0f1e2e]">
                        {Object.entries(metadata).map(([tag, { name, value }], index) => (
                            <tr key={index} className="border-b border-[#4aa0ce]/40">
                                <td className="px-4 py-3 text-[#9bcfe8] text-sm">{tag}</td>
                                <td className="px-4 py-3 text-[#76c7e8] text-sm">{name}</td>
                                <td className="px-4 py-3 text-white text-sm">
                                    {value.length > 500
                                        ? `${value.substring(0, 500)}... [truncated]`
                                        : value}
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>

                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="mt-4 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 active:bg-red-800 transition-all duration-200"
                >
                    Close
                </button>
            </div>
        </div>
    );
}

export default MetadataTable;
