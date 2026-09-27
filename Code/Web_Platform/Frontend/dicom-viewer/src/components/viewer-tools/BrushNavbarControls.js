import React, { useState, useRef, useEffect } from 'react';
import { Upload, Trash2, ChevronDown, Paintbrush } from 'lucide-react';

const BrushNavbarControls = ({ dicomImageRef, isDisabled = false }) => {
    const [brushDataLoaded, setBrushDataLoaded] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Check if brush data exists on mount and when dicomImageRef changes
    useEffect(() => {
        if (dicomImageRef?.current?.brushOverlayFunctions) {
            // Check if brush data exists
            const hasBrushData = dicomImageRef.current.brushOverlayFunctions.hasBrushData?.() || false;
            setBrushDataLoaded(hasBrushData);
        }
    }, [dicomImageRef]);

    const handleFileChange = (event) => {
        if (dicomImageRef?.current?.brushOverlayFunctions) {
            const result = dicomImageRef.current.brushOverlayFunctions.handleFileChange(event);
            setBrushDataLoaded(true);
            setShowDropdown(false);
            return result;
        }
    };

    const clearBrushData = () => {
        if (dicomImageRef?.current?.brushOverlayFunctions) {
            // Clear the brush data
            dicomImageRef.current.brushOverlayFunctions.clearBrushData();

            // Force a redraw/refresh of the canvas if needed
            if (dicomImageRef.current.forceUpdate) {
                dicomImageRef.current.forceUpdate();
            }

            // Reset any stored brush data in state
            if (dicomImageRef.current.brushOverlayFunctions.resetBrushState) {
                dicomImageRef.current.brushOverlayFunctions.resetBrushState();
            }

            setBrushDataLoaded(false);
            setShowDropdown(false);
        }
    };

    return (
        <div className="flex flex-col items-center">
            <label
                className={`flex flex-col items-center cursor-pointer transition-all duration-200 ${
                    isDisabled
                        ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                        : "text-[#76c7e8] hover:text-[#4aa0ce]"
                }`}
            >
                <Upload size={20} strokeWidth={1.5} className="mt-1" />
                <span className="text-xs mt-1">Upload JSON</span>
                <input
                    type="file"
                    accept=".json"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={isDisabled}
                />
            </label>
        </div>
    );
};

export default BrushNavbarControls;