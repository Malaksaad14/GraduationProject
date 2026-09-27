import React from 'react';

function ToolButtons({ toolList, activeTool, onToolClick }) {
    return (
        // 3mlt mawdo3 el width da 3ashan el dicom viewer el geded beta3 send to model
        <div className="flex flex-wrap my-4 gap-2 w-[750px]">
        {/*<div className="flex flex-wrap my-4 gap-2">*/}
            {toolList.map(tool => (
                <button
                    key={tool.name}
                    className={`px-4 py-2 rounded border border-gray-400 ${
                        activeTool === tool.name ? 'bg-blue-600 text-white' : 'bg-white text-black'
                    } hover:bg-blue-100 transition duration-200`}
                    onClick={() => onToolClick(tool.name)}
                >
                    {tool.label}
                </button>
            ))}
        </div>
    );
}

export default ToolButtons;
