import React, { useState, useEffect, useRef } from 'react';
import { Upload, Trash2, Download, ZoomIn } from 'lucide-react';
import * as cornerstone from 'cornerstone-core';
import * as cornerstoneTools from 'cornerstone-tools';


const DicomBrushOverlay = ({
                               dicomImageRef,
                               onBrushDataLoaded = () => {},
                               canvasWidth = '100%',
                               canvasHeight = '100%',
                               originalImageWidth = null,
                               originalImageHeight = null,
                               isDisabled = false,
                               currentImageIndex = 0,  // Add this prop
                               currentImageMetadata = null  // Add this prop
                           }) => {
    const [brushData, setBrushData] = useState(null);
    const [error, setError] = useState(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef(null);

    // Color map matching your original brush tool
    const colorMap = {
        "Red": { rgba: "rgba(255, 0, 0, 1)", segmentIndex: 1, rgbColor: [255, 0, 0, 255] },
        "Green": { rgba: "rgba(0, 255, 0, 1)", segmentIndex: 2, rgbColor: [0, 255, 0, 255] },
        "Blue": { rgba: "rgba(0, 0, 255, 1)", segmentIndex: 3, rgbColor: [0, 0, 255, 255] },
        "Yellow": { rgba: "rgba(255, 255, 0, 1)", segmentIndex: 4, rgbColor: [255, 255, 0, 255] },
        "Purple": { rgba: "rgba(128, 0, 128, 1)", segmentIndex: 5, rgbColor: [128, 0, 128, 255] }
    };

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

    // Expose functions to the dicomImageRef for external access
    useEffect(() => {
        if (dicomImageRef?.current) {
            dicomImageRef.current.brushOverlayFunctions = {
                handleFileChange,
                clearBrushData,
                exportBrushData,
                resetZoomToFit,
                hasBrushData: () => brushData !== null
            };
        }
    }, [dicomImageRef, brushData]);

    // Add this useEffect to respond when the current image changes
    useEffect(() => {
        if (brushData && dicomImageRef?.current && (currentImageIndex !== undefined || currentImageMetadata)) {
            // Re-apply brush data when image changes but brush data is already loaded
            convertJsonToBrushStrokes(brushData);
        }
    }, [currentImageIndex, currentImageMetadata, dicomImageRef?.current]);

    // Add this function to DicomBrushOverlay component
    const refreshBrushOverlay = () => {
        if (brushData && dicomImageRef?.current) {
            convertJsonToBrushStrokes(brushData);
        }
    };

// Expose this through the ref
    useEffect(() => {
        if (dicomImageRef?.current) {
            dicomImageRef.current.brushOverlayFunctions = {
                handleFileChange,
                clearBrushData,
                exportBrushData,
                resetZoomToFit,
                refreshBrushOverlay  // Add this new function
            };
        }

        return () => {
            if (dicomImageRef?.current) {
                dicomImageRef.current.brushOverlayFunctions = null;
            }
        };
    }, [dicomImageRef?.current, brushData]);

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                setBrushData(data);
                setError(null);
                onBrushDataLoaded(data);

                // Immediately convert the loaded data to brush strokes
                convertJsonToBrushStrokes(data);
            } catch (err) {
                setError("Failed to parse JSON file. Please ensure it's a valid brush data file.");
                setBrushData(null);
            }
        };
        reader.readAsText(file);
    };


        const convertJsonToBrushStrokes = (data) => {
        if (!data || !data.pixels || !dicomImageRef?.current) {
            console.error('No valid brush data or DICOM image reference');
            return;
        }

        const element = dicomImageRef.current;

        try {
            // Make sure cornerstone is enabled on the element
            if (!cornerstone.getEnabledElement(element)) {
                setError('No enabled element found. Please ensure cornerstone is properly initialized.');
                return;
            }

            // Get the enabled element
            const enabledElement = cornerstone.getEnabledElement(element);
            if (!enabledElement || !enabledElement.image) {
                setError('No image is currently loaded in the DICOM viewer.');
                return;
            }

            // Get image dimensions
            const { width, height } = enabledElement.image;

            // Calculate scale factors to map from 0-255 range to actual image dimensions
            const scaleX = width / 256;  // 256 because range is 0-255
            const scaleY = height / 256;

            // Get the segmentation module
            const segmentationModule = cornerstoneTools.getModule('segmentation');
            if (!segmentationModule) {
                setError('Segmentation module not available. Please ensure cornerstone-tools is properly initialized.');
                return;
            }

            // First, ensure the Brush tool is added and activated
            try {
                cornerstoneTools.addTool(cornerstoneTools.BrushTool);

                // Activate the brush tool (this often initializes the labelmap structure)
                cornerstoneTools.setToolActiveForElement(
                    element,
                    'Brush',
                    {
                        mouseButtonMask: 1,
                        configuration: {
                            activeSegmentIndex: 1,
                            radius: 5 // Default brush size
                        }
                    }
                );
            } catch (err) {
                console.warn('Error initializing brush tool:', err);
                // Continue anyway as the labelmap might still work
            }

            // Create a comprehensive color LUT with all our colors
            const createComprehensiveColorLUT = () => {
                const colorLUT = [];

                // Add a placeholder at index 0 (typically not used)
                colorLUT.push([0, 0, 0, 0]);

                // Fill with our predefined colors
                Object.values(colorMap).forEach(color => {
                    const rgbColor = color.rgbColor ||
                        (color.rgba ? color.rgba.replace('OPACITY', '1').match(/\d+/g).map(Number) : [255, 0, 0, 255]);

                    // Make sure we have a value at the correct segment index
                    while (colorLUT.length <= color.segmentIndex) {
                        colorLUT.push([200, 200, 200, 255]); // Default gray for gaps
                    }
                    colorLUT[color.segmentIndex] = rgbColor;
                });

                // Fill the rest with a default color (light gray)
                const defaultColor = [200, 200, 200, 255];
                while (colorLUT.length < 65535) {
                    colorLUT.push([...defaultColor]); // Use spread to create a new array
                }

                return colorLUT;
            };

            // Set the color LUT
            const colorLUT = createComprehensiveColorLUT();

            // Get or create a labelmap
            let activeLabelmapIndex = 0;
            let labelmap3D;

            // First try using the getter
            try {
                // This will initialize the labelmap structure if it doesn't exist
                segmentationModule.setters.activeLabelmapIndex(element, activeLabelmapIndex);
                labelmap3D = segmentationModule.getters.labelmap3D(element, activeLabelmapIndex);
            } catch (e) {
                console.warn('Error getting labelmap3D, trying alternative method:', e);
            }

            // If the first method failed, try to create it manually
            if (!labelmap3D) {
                try {
                    // Force creation of labelmap by reactivating the brush tool
                    cornerstoneTools.setToolDisabledForElement(element, 'Brush');
                    setTimeout(() => {
                        cornerstoneTools.setToolActiveForElement(
                            element,
                            'Brush',
                            {
                                mouseButtonMask: 1,
                                configuration: {
                                    activeSegmentIndex: 1,
                                    radius: 5
                                }
                            }
                        );
                    }, 10);

                    // Try again after a small delay to allow tool activation to complete
                    setTimeout(() => {
                        try {
                            labelmap3D = segmentationModule.getters.labelmap3D(element, activeLabelmapIndex);
                            if (!labelmap3D) {
                                setError('Failed to create labelmap. Please try to draw manually first.');
                                return;
                            }
                            processBrushData(labelmap3D);
                        } catch (e) {
                            console.error('Error creating labelmap after delay:', e);
                            setError('Failed to create labelmap.');
                        }
                    }, 100);
                    return; // Return early as we're handling this asynchronously
                } catch (e) {
                    console.error('Error forcing labelmap creation:', e);
                    setError('Could not create labelmap - incompatible cornerstone-tools version');
                    return;
                }
            }

            // If we got the labelmap immediately, process the data
            processBrushData(labelmap3D);

            function processBrushData(labelmap3D) {
                // Determine current slice
                const imageId = enabledElement.image.imageId;
                const metadataProvider = cornerstone.metaData;
// Inside the convertJsonToBrushStrokes function, replace the slice index determination with:
                let sliceIndex = 0;

// Try to get slice index from props first
                if (currentImageMetadata && currentImageMetadata.sliceIndex !== undefined) {
                    sliceIndex = currentImageMetadata.sliceIndex;
                } else if (currentImageIndex !== undefined) {
                    sliceIndex = currentImageIndex;
                } else if (metadataProvider) {
                    // Fallback to the original method
                    const seriesMetadata = metadataProvider.get('instance', imageId);
                    if (seriesMetadata && seriesMetadata.sliceIndex !== undefined) {
                        sliceIndex = seriesMetadata.sliceIndex;
                    } else {
                        // Extract slice index from imageId if possible
                        const parts = imageId.split('/');
                        const lastPart = parts[parts.length - 1];
                        const possibleIndex = parseInt(lastPart.replace(/\D/g, ''));
                        if (!isNaN(possibleIndex)) {
                            sliceIndex = possibleIndex;
                        }
                    }
                }
                // Get or create the 2D labelmap for the current slice
                let labelmap2D;

                // Determine whether labelmaps2D is an array or object
                if (!labelmap3D.labelmaps2D) {
                    labelmap3D.labelmaps2D = {};
                }

                if (Array.isArray(labelmap3D.labelmaps2D)) {
                    // Array-based structure
                    while (labelmap3D.labelmaps2D.length <= sliceIndex) {
                        labelmap3D.labelmaps2D.push(null);
                    }

                    labelmap2D = labelmap3D.labelmaps2D[sliceIndex];

                    if (!labelmap2D) {
                        labelmap2D = {
                            pixelData: new Uint16Array(width * height),
                            segmentsOnLabelmap: []
                        };
                        labelmap3D.labelmaps2D[sliceIndex] = labelmap2D;
                    }
                } else {
                    // Object-based structure
                    labelmap2D = labelmap3D.labelmaps2D[sliceIndex];

                    if (!labelmap2D) {
                        labelmap2D = {
                            pixelData: new Uint16Array(width * height),
                            segmentsOnLabelmap: []
                        };
                        labelmap3D.labelmaps2D[sliceIndex] = labelmap2D;
                    }
                }

                // Initialize the segmentations metadata if not present
                if (!labelmap3D.metadata) {
                    labelmap3D.metadata = {
                        colorLUT: colorLUT
                    };
                } else {
                    // Make sure the colorLUT is set in metadata
                    labelmap3D.metadata.colorLUT = colorLUT;
                }

                // Apply the transformation to get the proper coordinates
                const centerX = width / 2;
                const centerY = height / 2;

                // Get pixel data for editing
                const pixelData = labelmap2D.pixelData;

                // Group pixels by color
                const pixelsByColor = {};
                const segmentIndexByColor = {};

                // First pass - collect and transform all pixels
                data.pixels.forEach(pixel => {
                    if (!pixel.colorName || !colorMap[pixel.colorName]) {
                        return; // Skip pixels with unknown colors
                    }

                    // Apply mapping from normalized coordinates to actual image coordinates
                    // const x = Math.round(pixel.x * scaleX);
                    // const y = Math.round(pixel.y * scaleY);

                    // Get current image pixel spacing
                    const currentPixelSpacing = {
                        column: enabledElement.image.columnPixelSpacing || 1,
                        row: enabledElement.image.rowPixelSpacing || 1
                    };

// Calculate coordinates accounting for pixel spacing differences
                    let x, y;

                    if (pixel.normalizedX !== undefined && pixel.normalizedY !== undefined && data.originalPixelSpacing) {
                        // Use normalized coordinates if available
                        x = Math.round(pixel.normalizedX * currentPixelSpacing.column);
                        y = Math.round(pixel.normalizedY * currentPixelSpacing.row);
                    } else {
                        // Fallback: try to adjust based on pixel spacing ratio
                        const spacingRatioX = data.originalPixelSpacing ?
                            data.originalPixelSpacing.column / currentPixelSpacing.column : 1;
                        const spacingRatioY = data.originalPixelSpacing ?
                            data.originalPixelSpacing.row / currentPixelSpacing.row : 1;

                        x = Math.round(pixel.x * spacingRatioX);
                        y = Math.round(pixel.y * spacingRatioY);
                    }

                    // Skip if outside the image boundaries
                    if (x < 0 || x >= width || y < 0 || y >= height) {
                        return;
                    }

                    const colorName = pixel.colorName;
                    if (!pixelsByColor[colorName]) {
                        pixelsByColor[colorName] = [];
                        segmentIndexByColor[colorName] = colorMap[colorName].segmentIndex;
                    }
                    pixelsByColor[colorName].push({ x, y });
                });

                // CRITICAL: Make sure all segment indices are registered with the segmentation module
                const allSegmentIndices = Object.values(segmentIndexByColor);

                // Try both methods of setting segment visibility and colors
                try {
                    // Method 1: Using explicit setter methods if available
                    allSegmentIndices.forEach(segmentIndex => {
                        if (typeof segmentationModule.setters.setSegmentVisibility === 'function') {
                            segmentationModule.setters.setSegmentVisibility(element, segmentIndex, true);
                        }

                        // Ensure color is set for the segment
                        if (typeof segmentationModule.setters.setSegmentColor === 'function') {
                            const color = colorLUT[segmentIndex] || [255, 0, 0, 255];
                            segmentationModule.setters.setSegmentColor(element, segmentIndex, color);
                        }
                    });
                } catch (err) {
                    console.warn('Error setting segment visibility and colors via setters:', err);

                    // Method 2: Direct state modification
                    try {
                        if (segmentationModule.state) {
                            if (!segmentationModule.state.visibleSegments) {
                                segmentationModule.state.visibleSegments = {};
                            }

                            allSegmentIndices.forEach(segmentIndex => {
                                segmentationModule.state.visibleSegments[segmentIndex] = true;
                            });

                            // Ensure color LUT is set in state
                            segmentationModule.state.colorLUT = colorLUT;
                        }
                    } catch (e) {
                        console.warn('Error setting segment visibility and colors via state:', e);
                    }
                }

                // Process each color group to connect points into regions
                for (const colorName in pixelsByColor) {
                    const segmentIndex = segmentIndexByColor[colorName];
                    const pixels = pixelsByColor[colorName];

                    // Skip if no pixels for this color
                    if (!pixels || pixels.length === 0) continue;

                    // Create a temporary 2D grid to mark pixel locations
                    const grid = Array(height).fill().map(() => Array(width).fill(false));

                    // Mark all initial points in the grid
                    pixels.forEach(p => {
                        grid[p.y][p.x] = true;
                    });

                    // Fill gaps between nearby points to create contiguous regions
                    connectRegions(grid, pixels);

                    // Apply the connected regions to the labelmap
                    for (let y = 0; y < height; y++) {
                        for (let x = 0; x < width; x++) {
                            if (grid[y][x]) {
                                const pixelIndex = y * width + x;
                                pixelData[pixelIndex] = segmentIndex;
                            }
                        }
                    }

                    // Add segment to labelmap if not already there
                    if (!labelmap2D.segmentsOnLabelmap.includes(segmentIndex)) {
                        labelmap2D.segmentsOnLabelmap.push(segmentIndex);
                    }

                    console.log(`Processed region for color ${colorName} with segment index ${segmentIndex}`);
                }

                function connectRegions(grid, points) {
                    // Phase 1: Dilate points to connect close neighbors - REDUCED RADIUS
                    const dilationRadius = 1; // Reduced from 2 to 1 for tighter connections
                    const tempGrid = Array(height).fill().map(() => Array(width).fill(false));

                    // Create a copy of existing points in tempGrid
                    for (let y = 0; y < height; y++) {
                        for (let x = 0; x < width; x++) {
                            tempGrid[y][x] = grid[y][x];
                        }
                    }

                    // Dilate points by radius to connect close neighbors
                    // Using weighted distance to create more circular connections
                    for (const point of points) {
                        for (let dy = -dilationRadius; dy <= dilationRadius; dy++) {
                            for (let dx = -dilationRadius; dx <= dilationRadius; dx++) {
                                const nx = point.x + dx;
                                const ny = point.y + dy;

                                // Check if within bounds and use elliptical distance for smoother edges
                                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                    // More precise circle calculation using weighted squared distance
                                    const distance = (dx*dx + dy*dy) / (dilationRadius*dilationRadius);
                                    if (distance <= 0.75) { // Stricter threshold (reduced from 0.85 to 0.75)
                                        tempGrid[ny][nx] = true;
                                    }
                                }
                            }
                        }
                    }

                    // Phase 2: Find connected components and fill holes - same as before
                    const regions = [];
                    const visited = Array(height).fill().map(() => Array(width).fill(false));

                    for (let y = 0; y < height; y++) {
                        for (let x = 0; x < width; x++) {
                            if (tempGrid[y][x] && !visited[y][x]) {
                                // Found a new region, flood fill it
                                const region = [];
                                const queue = [{x, y}];
                                visited[y][x] = true;

                                while (queue.length > 0) {
                                    const p = queue.shift();
                                    region.push(p);

                                    // Check 4-connected neighbors
                                    const neighbors = [
                                        {x: p.x+1, y: p.y},
                                        {x: p.x-1, y: p.y},
                                        {x: p.x, y: p.y+1},
                                        {x: p.x, y: p.y-1}
                                    ];

                                    for (const neighbor of neighbors) {
                                        const nx = neighbor.x;
                                        const ny = neighbor.y;

                                        if (nx >= 0 && nx < width && ny >= 0 && ny < height &&
                                            tempGrid[ny][nx] && !visited[ny][nx]) {
                                            queue.push({x: nx, y: ny});
                                            visited[ny][nx] = true;
                                        }
                                    }
                                }

                                // Only keep significant regions (increased minimum size for regions)
                                if (region.length > 8) { // Increased from 5 to 8 to avoid small isolated areas
                                    regions.push(region);
                                }
                            }
                        }
                    }

                    // Apply the regions directly without excessive hole filling
                    for (const region of regions) {
                        for (const p of region) {
                            grid[p.y][p.x] = true;
                        }
                    }
                }

                // Try multiple methods to ensure colors are applied
                // Method 1: Directly assign colorLUT to segmentation module
                try {
                    if (segmentationModule.state && segmentationModule.state.colorLUT) {
                        segmentationModule.state.colorLUT = colorLUT;
                    }
                } catch (err) {
                    console.warn('Failed to set color LUT directly on state:', err);
                }

                // Method 2: Use setter method if available
                try {
                    if (typeof segmentationModule.setters.colorLUT === 'function') {
                        segmentationModule.setters.colorLUT(colorLUT);
                    }
                } catch (err) {
                    console.warn('Failed to set color LUT via setter:', err);
                }

                // Method 3: Set brush colors for each segment individually
                try {
                    labelmap2D.segmentsOnLabelmap.forEach(segmentIndex => {
                        const color = colorLUT[segmentIndex];
                        if (color && typeof cornerstoneTools.store.state.brushTools !== 'undefined') {
                            if (cornerstoneTools.store.state.brushTools.segmentationColors) {
                                cornerstoneTools.store.state.brushTools.segmentationColors[segmentIndex] = color;
                            }
                        }
                    });
                } catch (err) {
                    console.warn('Failed to set colors on brushTools state:', err);
                }

                // Make sure all segments are visible
                labelmap2D.segmentsOnLabelmap.forEach(segmentIndex => {
                    try {
                        // Try different ways to set segment visibility
                        if (typeof segmentationModule.setters.setSegmentVisibility === 'function') {
                            segmentationModule.setters.setSegmentVisibility(element, segmentIndex, true);
                        }
                        else if (segmentationModule.state && segmentationModule.state.visibleSegments) {
                            segmentationModule.state.visibleSegments[segmentIndex] = true;
                        }
                    } catch (e) {
                        console.warn(`Failed to set visibility for segment ${segmentIndex}`, e);
                    }
                });

                // Force cornerstone tools to update rendering
                try {
                    if (typeof cornerstoneTools.store.state.renderingTools !== 'undefined' &&
                        typeof cornerstoneTools.store.state.renderingTools.renderLabelMapImage === 'function') {
                        cornerstoneTools.store.state.renderingTools.renderLabelMapImage(element);
                    }
                } catch (err) {
                    console.warn('Failed to force labelmap rendering:', err);
                }

                // Update the cornerstone image
                cornerstone.updateImage(element);

                console.log(`Successfully converted and connected brush strokes into cohesive regions with colors.`);
                setError(null);
            }
        } catch (err) {
            console.error('Error converting JSON to brush strokes:', err);
            setError(`Error converting to brush strokes: ${err.message}`);
        }
    };


    // Clear the brush data
    const clearBrushData = () => {
        setBrushData(null);
        setError(null);

        // Clear the brush tool if possible
        try {
            if (dicomImageRef?.current) {
                const segmentationModule = cornerstoneTools.getModule('segmentation');
                const element = dicomImageRef.current;

                // Reset the labelmap if the API supports it
                if (segmentationModule && segmentationModule.setters &&
                    typeof segmentationModule.setters.resetLabelmaps === 'function') {
                    segmentationModule.setters.resetLabelmaps(element);
                }

                // Force redraw
                cornerstone.updateImage(element);
            }
        } catch (err) {
            console.warn('Error clearing brush data:', err);
        }
    };

    // Export brush data as JSON file
    const exportBrushData = () => {
        if (!brushData) return;

        const dataStr = JSON.stringify(brushData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `brush-data-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const resetZoomToFit = () => {
        if (!dicomImageRef?.current) return;

        try {
            // Reset the viewport to fit the image
            cornerstone.reset(dicomImageRef.current);

            // You could also set a specific zoom level if needed:
            const viewport = cornerstone.getViewport(dicomImageRef.current);
            viewport.scale = 1.0; // 1.0 represents 100% zoom
            cornerstone.setViewport(dicomImageRef.current, viewport);

            cornerstone.updateImage(dicomImageRef.current);
            console.log("Zoom reset to fit image");
        } catch (err) {
            console.error("Error resetting zoom:", err);
        }
    };

    // Using the BrushNavbarControls UI style
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

            {/* Show error message if any */}
            {error && (
                <div className="text-red-300 text-xs bg-red-900 bg-opacity-50 p-1 rounded mt-2">
                    {error}
                </div>
            )}

            {/* Show info message when brush data is loaded */}
            {brushData && !error && (
                <div className="text-xs text-green-400 mt-1">
                    {brushData.totalPixelCount || 0} pixels loaded
                </div>
            )}
        </div>
    );
};

export default DicomBrushOverlay;

