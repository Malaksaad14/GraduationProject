import { useState } from 'react';

function Sidebar({ groupedSeries, processedGroupedSeries, onDicomSelect, currentFileIndex }) {
    const [expandedSeries, setExpandedSeries] = useState({});

    const toggleSeries = (seriesNumber) => {
        setExpandedSeries((prev) => ({
            ...prev,
            [seriesNumber]: !prev[seriesNumber],
        }));
    };

    const renderSeries = (series, title, onSelect) => (
        <div>
            <h2 className="font-semibold text-md text-[#4aa0ce] mb-2 uppercase tracking-wide">{title}</h2>
            {Object.entries(series).map(([seriesNumber, dicomFiles]) => (
                <div key={seriesNumber} className="mb-3">
                    <div
                        className={`cursor-pointer p-2 rounded transition-all duration-200 flex flex-col items-center ${
                            dicomFiles.some((dicomFile) => dicomFile.currentFileIndex === currentFileIndex)
                                ? 'border border-[#4aa0ce] bg-[#0d5e87] text-[#ffffff]' // Active
                                : 'hover:bg-[#0d5e87] hover:border hover:border-[#4aa0ce] text-[#4aa0ce]'
                        }`}
                        onClick={() => toggleSeries(seriesNumber)}
                    >
                        {dicomFiles[0].thumbnail && (
                            <img
                                src={dicomFiles[0].thumbnail}
                                alt={`Series ${seriesNumber}`}
                                className={`w-36 h-24 rounded-md shadow-md ${
                                    dicomFiles.some((dicomFile) => dicomFile.currentFileIndex === currentFileIndex)
                                        ? 'border border-[#4aa0ce]' // Highlight active selection
                                        : 'border border-transparent'
                                }`}
                            />
                        )}
                        <p className="mt-2 text-sm font-medium">Series: {seriesNumber} ({dicomFiles.length} Images)</p>
                    </div>

                    {expandedSeries[seriesNumber] && (
                        <ul className="mt-2 space-y-1">
                            {dicomFiles.map((dicomFile) => (
                                <li
                                    key={dicomFile.currentFileIndex}
                                    onClick={() => onSelect(dicomFile.currentFileIndex)}
                                    className={`cursor-pointer p-2 rounded text-sm transition-all duration-200 ${
                                        currentFileIndex === dicomFile.currentFileIndex
                                            ? 'bg-[#0d5e87] text-white border border-[#4aa0ce]' // Active Image
                                            : 'hover:bg-[#0d5e87] text-[#4aa0ce]'
                                    }`}
                                >
                                    {dicomFile.fileName} (Instance: {dicomFile.instanceNumber})
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ))}
        </div>
    );

    return (
        <div
            className="sidebar p-4 bg-[#040404] text-[#4aa0ce]"
            style={{
                width: '220px',
                overflowY: 'auto',
                height: '95vh',
                boxSizing: 'border-box',
                borderRight: '1px solid rgba(74, 160, 206, 0.3)', // Softer sidebar separator
            }}
        >
            {/* Render "Original Series" only if groupedSeries has data */}
            {Object.keys(groupedSeries).length > 0 &&
                renderSeries(groupedSeries, "Original Series", onDicomSelect)}

            {/* Render "Processed Series" only if processedGroupedSeries has data */}
            {processedGroupedSeries && Object.keys(processedGroupedSeries).length > 0 &&
                renderSeries(processedGroupedSeries, "Processed Series", (index) =>
                    console.log(`Show processed series in processedDicomRef: ${index}`)
                )}
        </div>
    );
}

export default Sidebar;

