import React, {useState, useRef, useEffect, useCallback} from 'react';
import { Brush, ChevronDown, Download, Circle, Eraser } from 'lucide-react';
import * as cornerstoneTools from 'cornerstone-tools';
import * as cornerstone from 'cornerstone-core';
import { Palette, FileDown, Search, FileText } from "lucide-react";
const brushColors = [
    {
        name: 'Red',
        value: '#FF0000',
        rgbColor: [255, 0, 0, 255]
    },
    {
        name: 'Green',
        value: '#00FF00',
        rgbColor: [0, 255, 0, 255]
    },
    {
        name: 'Blue',
        value: '#0000FF',
        rgbColor: [0, 0, 255, 255]
    },
    {
        name: 'Yellow',
        value: '#FFFF00',
        rgbColor: [255, 255, 0, 255]
    },
    {
        name: 'Purple',
        value: '#800080',
        rgbColor: [128, 0, 128, 255]
    }
];


const BrushColorDropdown = ({ dicomImageRef, isDisabled , segmentationDicomRef}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isSizeMenuOpen, setIsSizeMenuOpen] = useState(false);
    const dropdownRef = useRef(null);
    const sizeDropdownRef = useRef(null);

    const brushSizes = [2, 5, 10, 15, 20];
    const [selectedSize, setSelectedSize] = useState(5); // Default size
    // Add this to your state variables at the top of the component:
    const [eraserActive, setEraserActive] = useState(false);
    const [eraseMenuOpen, setEraseMenuOpen] = useState(false);
    const eraseMenuRef = useRef(null);
    // Add this state variable in the component
    const [showPixelSummary, setShowPixelSummary] = useState(false);
    // Add state to track active segments
    const [activeSegments, setActiveSegments] = useState([]);
    const [selectedColor, setSelectedColor] = useState(brushColors[0]);
    const [extractedPixels, setExtractedPixels] = useState(null);

    const [showCardiacAnalysis, setShowCardiacAnalysis] = useState(false);
    const [cardiacAnalysisData, setCardiacAnalysisData] = useState(null);

    // This function scans all slices of the segmentation volume (labelmap3D) for the active segmentation layer. It loops through
    // every pixel of every slice, identifies which segment indices are present (like 1 for red, 2 for green), maps them to
    // user-friendly colors and labels, and updates the state so the UI knows what segments are currently used.

    //  in React:
    // Every time a component re-renders, functions are re-created.
    // If a child component or useEffect depends on that function, it thinks it’s a new function every time — even if the logic hasn’t changed.
    // This causes unnecessary re-renders
    // in CallBack ---> Only re-create this updateActiveSegments function if dicomImageRef changes.
    const updateActiveSegments = useCallback(() => {
        const element = dicomImageRef.current;
        if (!element) {
            setActiveSegments([]);
            return;
        }

        try {
            const segmentationModule = cornerstoneTools.getModule('segmentation');
            if (!segmentationModule) {
                setActiveSegments([]);
                return;
            }

            let activeLabelmapIndex;
            try {
                activeLabelmapIndex = segmentationModule.getters.activeLabelmapIndex(element);
            } catch (e) {
                console.log('No active labelmap found');
                setActiveSegments([]);
                return;
            }

            // Add safety check here
            if (activeLabelmapIndex === undefined || activeLabelmapIndex === null) {
                setActiveSegments([]);
                return;
            }

            const labelmap3D = segmentationModule.getters.labelmap3D(element, activeLabelmapIndex);

            if (!labelmap3D || !labelmap3D.labelmaps2D) {
                setActiveSegments([]);
                return;
            }

            const foundSegments = new Set();

            // Check all slices, not just current one
            for (let i = 0; i < labelmap3D.labelmaps2D.length; i++) {
                const labelmap2D = labelmap3D.labelmaps2D[i];
                if (!labelmap2D || !labelmap2D.pixelData) continue;

                // Check every pixel in this slice
                const pixelData = labelmap2D.pixelData;
                for (let j = 0; j < pixelData.length; j++) {
                    const segmentIndex = pixelData[j];
                    if (segmentIndex > 0) {
                        foundSegments.add(segmentIndex);
                    }
                }
            }

            const segments = Array.from(foundSegments).map(segmentIndex => ({
                segmentIndex,
                colorName: getColorNameBySegmentIndex(segmentIndex),
                color: brushColors[segmentIndex - 1]?.value || '#888'
            })).sort((a, b) => a.segmentIndex - b.segmentIndex);

            // console.log('Found active segments:', segments);
            setActiveSegments(segments);

        } catch (error) {
            console.error('Error detecting active segments:', error);
            setActiveSegments([]);
        }
    }, [dicomImageRef]); // Add dependencies


    useEffect(() => {
        const element = dicomImageRef.current;
        if (element) {
            // Only listen to brush end event and our custom event
            element.addEventListener('cornerstonetoolsbrushend', updateActiveSegments);
            element.addEventListener('segmentationUpdated', updateActiveSegments);

            // Initial update
            updateActiveSegments();

            return () => {
                element.removeEventListener('cornerstonetoolsbrushend', updateActiveSegments);
                element.removeEventListener('segmentationUpdated', updateActiveSegments);
            };
        }
    }, [dicomImageRef]);

    // Close dropdowns when clicking outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
            if (sizeDropdownRef.current && !sizeDropdownRef.current.contains(event.target)) {
                setIsSizeMenuOpen(false);
            }
            // Add this to your useEffect that handles click outside:
            if (eraseMenuRef.current && !eraseMenuRef.current.contains(event.target)) {
                setEraseMenuOpen(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    // 🖌 Registers the Brush Tool
    // 🎨 Builds a 65535-color lookup table
    // 🧠 Sets that LUT inside the segmentation module
    // 🖱 Activates brush on this DICOM element with custom settings
    // 🔔 Listens for end-of-brush drawing
    // 🧼 Cleans up event listeners on unmount
    useEffect(() => {
        const element = dicomImageRef.current;
        if (!element) return;

        try {
            // Ensure Brush Tool is added
            cornerstoneTools.addTool(cornerstoneTools.BrushTool);

            // Get the segmentation module
            const segmentationModule = cornerstoneTools.getModule('segmentation');
            // Create a comprehensive color LUT with 65535 entries
            const createComprehensiveColorLUT = () => {
                const colorLUT = [];

                // Fill the first 6 entries with our predefined colors
                brushColors.forEach((color, index) => {
                    colorLUT.push(color.rgbColor);
                });

                // Fill the rest with a default color (light gray)
                const defaultColor = [200, 200, 200, 255];
                while (colorLUT.length < 65535) {
                    colorLUT.push(defaultColor);
                }

                return colorLUT;
            };

            // Set comprehensive color LUT
            const comprehensiveColorLUT = createComprehensiveColorLUT();
            segmentationModule.setters.colorLUT(comprehensiveColorLUT);

            // Initial tool configuration
            cornerstoneTools.setToolActiveForElement(
                element,
                'Brush',
                {
                    mouseButtonMask: 1,
                    configuration: {
                        activeSegmentIndex: 1,
                        radius: selectedSize // Use the selected size
                    }
                }
            );

            // Add event listener for end of brush stroke
            element.addEventListener('cornerstonetoolsbrushend', handleBrushEnd);
            console.log('Cornerstone Tools Initialization Complete');
            return () => {
                // Clean up event listener
                element.removeEventListener('cornerstonetoolsbrushend', handleBrushEnd);
            };
        } catch (error) {
            console.error('Error during tool initialization:', error);
        }
    }, [dicomImageRef]);

    // 🎯 Goal of This Effect
    // To detect and respond to any segmentation changes (especially brush strokes), by listening to multiple related events, then calling updateActiveSegments().
    // This ensures your UI is always up-to-date with active segment indices.
    // Real-time detection of brush strokes
    useEffect(() => {
        const element = dicomImageRef.current;
        if (element) {
            // Listen to multiple brush events for better detection
            const events = [
                'cornerstonetoolsbrushend',
                'cornerstonetoolsbrushcomplete',
                'cornerstonetoolsmouseup',
                'cornerstoneimagerendered'
            ];

            const handleSegmentUpdate = () => {
                setTimeout(() => {
                    updateActiveSegments();
                }, 50);
            };

            // Add all event listeners
            events.forEach(eventName => {
                element.addEventListener(eventName, handleSegmentUpdate);
            });

            // Initial update
            updateActiveSegments();

            return () => {
                // Remove all event listeners
                events.forEach(eventName => {
                    element.removeEventListener(eventName, handleSegmentUpdate);
                });
            };
        }
    }, [dicomImageRef]);

    // If one method fails silently (due to version issues), another one might succeed
    // COMPREHENSIVE APPROACH TO UPDATE BRUSH SIZE WHEN IT CHANGES
    useEffect(() => {
        const element = dicomImageRef.current;
        if (!element) return;

        try {
            console.log('Updating brush size to:', selectedSize);

            // APPROACH 1: Update via direct tool reference
            try {
                const brushTool = cornerstoneTools.getToolForElement(element, 'Brush');
                if (brushTool) {
                    brushTool.configuration = brushTool.configuration || {};
                    brushTool.configuration.radius = selectedSize;
                    console.log('Updated brush size via direct tool reference');
                }
            } catch (err) {
                console.warn('Failed to update via direct tool reference:', err);
            }

            // APPROACH 2: Update via brush module state
            try {
                // Try different paths to the brush module
                const brushModule = cornerstoneTools.store.modules.brush;
                if (brushModule) {
                    // Try setter method if available
                    if (brushModule.setters && brushModule.setters.radius) {
                        brushModule.setters.radius(selectedSize);
                        console.log('Updated brush size via module setter');
                    }

                    // Try direct state update
                    if (brushModule.state) {
                        brushModule.state.radius = selectedSize;
                        console.log('Updated brush size via module state');
                    }
                }

                // Alternative path to brush module
                if (cornerstoneTools.store.state.brushModule) {
                    cornerstoneTools.store.state.brushModule.radius = selectedSize;
                    console.log('Updated brush size via store state');
                }
            } catch (err) {
                console.warn('Failed to update via brush module:', err);
            }

            // APPROACH 3: Update via tool state
            try {
                const toolState = cornerstoneTools.getToolState(element, 'Brush');
                if (toolState && toolState.data) {
                    toolState.data.forEach(data => {
                        if (data.configuration) {
                            data.configuration.radius = selectedSize;
                        }
                    });
                    console.log('Updated brush size via tool state');
                }
            } catch (err) {
                console.warn('Failed to update via tool state:', err);
            }

            // APPROACH 4: Update via global state tools array
            try {
                if (cornerstoneTools.store &&
                    cornerstoneTools.store.state &&
                    cornerstoneTools.store.state.tools) {

                    const toolsArray = cornerstoneTools.store.state.tools;
                    const brushTools = toolsArray.filter(tool =>
                        tool.name === 'Brush' &&
                        tool.element === element);

                    if (brushTools.length) {
                        brushTools.forEach(tool => {
                            if (tool.configuration) {
                                tool.configuration.radius = selectedSize;
                            }
                        });
                        console.log('Updated brush size via global state tools array');
                    }
                }
            } catch (err) {
                console.warn('Failed to update via global state:', err);
            }

            // APPROACH 5: Update via segmentation module
            try {
                const segmentationModule = cornerstoneTools.getModule('segmentation');
                if (segmentationModule && segmentationModule.configuration) {
                    segmentationModule.configuration.radius = selectedSize;
                    console.log('Updated brush size via segmentation module');
                }
            } catch (err) {
                console.warn('Failed to update via segmentation module:', err);
            }

            // APPROACH 6: Most aggressive - deactivate and reactivate
            try {
                // Get current segment index
                const segmentationModule = cornerstoneTools.getModule('segmentation');
                let segmentIndex = 1; // Default to first segment

                try {
                    segmentIndex = segmentationModule.getters.activeSegmentIndex(element);
                } catch (e) {
                    // If we can't get the segment index, use the selected color
                    segmentIndex = brushColors.indexOf(selectedColor) + 1;
                }

                // Store current active tools to restore later
                const activeTools = cornerstoneTools.store.state.tools
                    .filter(tool => tool.element === element && tool.mode === 'active')
                    .map(tool => ({
                        name: tool.name,
                        mouseButtonMask: tool.mouseButtonMask
                    }));

                // Disable brush tool
                cornerstoneTools.setToolDisabledForElement(element, 'Brush');

                // Reactivate with new size
                setTimeout(() => {
                    cornerstoneTools.setToolActiveForElement(
                        element,
                        'Brush',
                        {
                            mouseButtonMask: 1,
                            configuration: {
                                activeSegmentIndex: segmentIndex,
                                radius: selectedSize
                            }
                        }
                    );

                    // Force cornerstone to update
                    cornerstone.updateImage(element);
                    console.log('Updated brush size via tool reactivation');
                }, 10);
            } catch (err) {
                console.warn('Failed to update via tool reactivation:', err);
            }

            // Force update the image to ensure changes are reflected
            cornerstone.updateImage(element);

        } catch (error) {
            console.error('Error in brush size update:', error);
        }
    }, [selectedSize, dicomImageRef, selectedColor]);

    const handleEraserToggle = () => {
        const element = dicomImageRef.current;
        if (!element) return;

        try {
            // Toggle eraser mode
            const newEraserState = !eraserActive;
            setEraserActive(newEraserState);

            if (newEraserState) {
                // Since you mentioned Ctrl+Brush works for erasing,
                // We'll create a synthetic Ctrl keydown event
                const keyEvent = new KeyboardEvent('keydown', {
                    key: 'Control',
                    code: 'ControlLeft',
                    ctrlKey: true,
                    bubbles: true
                });
                document.dispatchEvent(keyEvent);

                // Store this information so we can clean up later
                window._eraserKeyEventSimulated = true;

                console.log('Eraser mode activated via synthetic Ctrl keypress');
            } else if (window._eraserKeyEventSimulated) {
                // Release the synthetic Ctrl key
                const keyEvent = new KeyboardEvent('keyup', {
                    key: 'Control',
                    code: 'ControlLeft',
                    ctrlKey: false,
                    bubbles: true
                });
                document.dispatchEvent(keyEvent);

                window._eraserKeyEventSimulated = false;
                console.log('Brush mode restored via synthetic Ctrl keyup');
            }

            // Force cornerstone to update the image
            cornerstone.updateImage(element);
        } catch (error) {
            console.error('Error toggling eraser mode:', error);
        }
    };


    // Replace the eraseAll function with this implementation
    const eraseAll = () => {
        const element = dicomImageRef.current;
        if (!element) return;

        try {
            // Get the segmentation module
            const segmentationModule = cornerstoneTools.getModule('segmentation');

            if (!segmentationModule) {
                console.error('Segmentation module not available');
                return;
            }

            try {
                // Method 1: Try using the built-in clear segmentation function
                const activeLabelmapIndex = segmentationModule.getters.activeLabelmapIndex(element);
                segmentationModule.setters.clearSegmentationForElement(element, activeLabelmapIndex);
                console.log('Cleared segmentation using built-in function');
            } catch (err) {
                console.warn('Built-in clear failed, trying manual clear:', err);

                // Method 2: Manual clearing as fallback
                const activeLabelmapIndex = segmentationModule.getters.activeLabelmapIndex(element);
                const labelmap3D = segmentationModule.getters.labelmap3D(element, activeLabelmapIndex);

                if (labelmap3D && labelmap3D.labelmaps2D) {
                    // Iterate through all 2D labelmaps and clear them
                    for (let i = 0; i < labelmap3D.labelmaps2D.length; i++) {
                        const labelmap2D = labelmap3D.labelmaps2D[i];
                        if (labelmap2D && labelmap2D.pixelData) {
                            // Fill with zeros to clear all segments
                            labelmap2D.pixelData.fill(0);
                        }
                    }
                    console.log('Manual clear of all segments completed');
                }
            }

            // Update the image
            cornerstone.updateImage(element);

            // Clear extracted pixels state
            setExtractedPixels(null);

            console.log('All segmentations erased');
            setEraseMenuOpen(false);
        } catch (error) {
            console.error('Error erasing all segmentations:', error);
        }
    };

    // It lets you remove just one specific segment (color/label) while leaving others intact.
    const eraseSegment = (segmentIndex) => {
        const element = dicomImageRef.current;
        if (!element) return;

        try {
            // Get the segmentation module, This gives you access to the labelmap system — where brush data is stored.
            const segmentationModule = cornerstoneTools.getModule('segmentation');

            // Get the active labelmap index (the "layer" in the segmentation)
            const activeLabelmapIndex = segmentationModule.getters.activeLabelmapIndex(element);

            // Get the 3D labelmap (contains all 2D slices)
            const labelmap3D = segmentationModule.getters.labelmap3D(element, activeLabelmapIndex);

            if (!labelmap3D || !labelmap3D.labelmaps2D) {
                console.error('No labelmap data found');
                return;
            }

            // Iterate through all 2D labelmaps (all slices) and remove the specific segment
            let pixelsErased = 0;

            for (let i = 0; i < labelmap3D.labelmaps2D.length; i++) {
                const labelmap2D = labelmap3D.labelmaps2D[i];
                if (labelmap2D && labelmap2D.pixelData) {
                    for (let j = 0; j < labelmap2D.pixelData.length; j++) {
                        if (labelmap2D.pixelData[j] === segmentIndex) {
                            labelmap2D.pixelData[j] = 0; // 0 means no segment
                            pixelsErased++;
                        }
                    }
                }
            }

            // Update the image
            cornerstone.updateImage(element);

            // Update extracted pixels if any
            if (extractedPixels) {
                extractAllBrushPixels();
            }

            console.log(`Segment ${segmentIndex} (${getColorNameBySegmentIndex(segmentIndex)}) erased - ${pixelsErased} pixels removed`);
            setEraseMenuOpen(false);
        } catch (error) {
            console.error('Error erasing segment:', error);
        }
    };
    // const handleBrushEnd = () => {
    //     // Extract pixel data after each brush stroke ends
    //     extractAllBrushPixels();
    // };

    const handleBrushEnd = () => {
        // Extract pixel data after each brush stroke ends
        extractAllBrushPixels();

        // Force immediate update of active segments
        setTimeout(() => {
            updateActiveSegments();
        }, 100);
    };

    const getColorNameBySegmentIndex = (segmentIndex) => {
        // Segment indices start at 1, array indices at 0
        const colorIndex = segmentIndex - 1;
        if (colorIndex >= 0 && colorIndex < brushColors.length) {
            return brushColors[colorIndex].name;
        }
        return 'Unknown';
    };

    const handleSizeSelect = (size) => {
        console.log('Selected new brush size:', size);
        setSelectedSize(size);
        setIsSizeMenuOpen(false);

        // For extra reliability, directly call the force update
        setTimeout(() => {
            forceUpdateBrushSize(size);
        }, 50);
    };

    // Utility function to force update brush size with all possible methods
    const forceUpdateBrushSize = (size) => {
        const element = dicomImageRef.current;
        if (!element) return;

        console.log('Force updating brush size to:', size);

        // Try all possible methods to update the brush size

        // Method 1: Update via brushTool external API (if available)
        try {
            // This function may not exist in all versions
            if (typeof cornerstoneTools.setBrushSize === 'function') {
                cornerstoneTools.setBrushSize(element, size);
                console.log('Updated size via setBrushSize API');
            }
        } catch (err) {
            console.warn('setBrushSize API not available:', err);
        }

        // Method 2: Update via direct tool reference
        try {
            const brushTool = cornerstoneTools.getToolForElement(element, 'Brush');
            if (brushTool) {
                brushTool.configuration = brushTool.configuration || {};
                brushTool.configuration.radius = size;
                console.log('Updated size via direct tool reference');
            }
        } catch (err) {
            console.warn('Direct tool update failed:', err);
        }

        // Method 3: Update via global state tools array
        try {
            if (cornerstoneTools.store &&
                cornerstoneTools.store.state &&
                cornerstoneTools.store.state.tools) {

                const toolsArray = cornerstoneTools.store.state.tools;
                const brushTools = toolsArray.filter(tool =>
                    tool.name === 'Brush' &&
                    tool.element === element);

                if (brushTools.length) {
                    brushTools.forEach(tool => {
                        if (tool.configuration) {
                            tool.configuration.radius = size;
                        }
                    });
                    console.log('Updated size via global state tools array');
                }
            }
        } catch (err) {
            console.warn('Global state update failed:', err);
        }

        // Method 4: Most aggressive - deactivate and reactivate
        try {
            // Get current segment index
            const segmentationModule = cornerstoneTools.getModule('segmentation');
            let segmentIndex = 1; // Default to first segment

            try {
                segmentIndex = segmentationModule.getters.activeSegmentIndex(element);
            } catch (e) {
                // If we can't get the segment index, use the selected color
                segmentIndex = brushColors.indexOf(selectedColor) + 1;
            }

            // First disable the tool
            cornerstoneTools.setToolDisabledForElement(element, 'Brush');

            // Then reactivate with the new size
            setTimeout(() => {
                cornerstoneTools.setToolActiveForElement(
                    element,
                    'Brush',
                    {
                        mouseButtonMask: 1,
                        configuration: {
                            activeSegmentIndex: segmentIndex,
                            radius: size
                        }
                    }
                );

                // Force cornerstone to update
                cornerstone.updateImage(element);
                console.log('Updated size via tool reactivation');
            }, 10);
        } catch (err) {
            console.warn('Tool reactivation failed:', err);
        }

        // Force update the image
        cornerstone.updateImage(element);
    };


    // Extracts all brushed pixels (from segmentations) from the current image slice, maps them to their x,y positions, segment indices, color names, raw pixel values, and computed values like HU (Hounsfield Units) for CT.
    const extractAllBrushPixels = () => {
        const element = dicomImageRef.current;
        if (!element) {
            console.error('DICOM image reference not available');
            return;
        }

        try {
            // First, check if we have isolated segmentation data , use the other function then instead
            if (isolatedSegmentationData) {
                console.log('Using isolated segmentation data for extraction');
                return extractAllBrushPixelsFromIsolatedData();
            }

            // If no isolated data, proceed with original Cornerstone method
            const segmentationModule = cornerstoneTools.getModule('segmentation');
            if (!segmentationModule) {
                console.error('Segmentation module not available');
                return;
            }

            // Get the active image
            const enabledElement = cornerstone.getEnabledElement(element);
            if (!enabledElement || !enabledElement.image) {
                console.error('No image loaded');
                return;
            }

            // Get the active labelmap index
            const activeLabelmapIndex = segmentationModule.getters.activeLabelmapIndex(element);
            console.log('Active Labelmap Index:', activeLabelmapIndex);

            // Get the 3D labelmap
            const labelmap3D = segmentationModule.getters.labelmap3D(element, activeLabelmapIndex);
            console.log('Labelmap 3D:', labelmap3D);

            if (!labelmap3D) {
                alert('No segmentation data found. Please draw on the image first.');
                return;
            }

            // Get the current image ID
            const imageId = enabledElement.image.imageId;
            console.log('Image ID:', imageId);

            // Try to find the current slice index
            const metadataProvider = cornerstone.metaData;
            let sliceIndex = 0;

            // Try to get slice index from metadata
            if (metadataProvider) {
                const seriesMetadata = metadataProvider.get('instance', imageId);
                if (seriesMetadata && seriesMetadata.sliceIndex !== undefined) {
                    sliceIndex = seriesMetadata.sliceIndex;
                } else {
                    // Extract slice index from imageId if possible (fallback)
                    const parts = imageId.split('/');
                    const lastPart = parts[parts.length - 1];
                    const possibleIndex = parseInt(lastPart.replace(/\D/g, ''));
                    if (!isNaN(possibleIndex)) {
                        sliceIndex = possibleIndex;
                    }
                }
            }

            console.log('Identified Slice Index:', sliceIndex);
            // Find the current 2D labelmap
            let currentLabelmap2D = null;

            // Try to get the labelmap from the 3D labelmap structure
            if (labelmap3D.labelmaps2D && labelmap3D.labelmaps2D.length > 0) {
                // Direct access to the array if we know the index
                if (sliceIndex < labelmap3D.labelmaps2D.length && labelmap3D.labelmaps2D[sliceIndex]) {
                    currentLabelmap2D = labelmap3D.labelmaps2D[sliceIndex];
                } else {
                    // If we can't find it by index, take the first non-null one
                    for (let i = 0; i < labelmap3D.labelmaps2D.length; i++) {
                        if (labelmap3D.labelmaps2D[i]) {
                            currentLabelmap2D = labelmap3D.labelmaps2D[i];
                            console.log(`Found labelmap at index ${i}`);
                            break;
                        }
                    }
                }
            }

            if (!currentLabelmap2D) {
                console.log('No 2D labelmap found for current slice');
                alert('No brush data found for the current image slice. Please draw on this slice first.');
                return;
            }

            console.log('Current 2D Labelmap:', currentLabelmap2D);

            // Now we have the labelmap 2D, extract the pixel data
            const segmentationBuffer = currentLabelmap2D.pixelData;
            if (!segmentationBuffer) {
                console.error('No pixel data in the 2D labelmap');
                return;
            }
            // Get image dimensions
            const { width, height } = enabledElement.image;

            // Create a map to store pixel coordinates for all segments
            const brushPixels = [];

            // Keep track of which segment indices we found
            const foundSegments = new Set();

            // Iterate through the segmentation buffer to find all brushed pixels
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const pixelIndex = y * width + x;

                    // Check if within bounds and is a brushed pixel (segment index > 0)
                    if (pixelIndex < segmentationBuffer.length && segmentationBuffer[pixelIndex] > 0) {
                        const segmentIndex = segmentationBuffer[pixelIndex];
                        foundSegments.add(segmentIndex);

                        // Get the color name for this segment
                        const colorName = getColorNameBySegmentIndex(segmentIndex);

                        // elly betdena el pixel value
                        // Get the original pixel value from the image
                        const imagePixelData = enabledElement.image.getPixelData();
                        let pixelValue = null;

                        if (imagePixelData && pixelIndex < imagePixelData.length) {
                            pixelValue = imagePixelData[pixelIndex];

                            // If it's a CT image, convert to HU if possible
                            const slope = enabledElement.image.slope || 1;
                            const intercept = enabledElement.image.intercept || 0;
                            const modalityPixelValue = pixelValue * slope + intercept;

                            // Store the coordinates, value, and color information
                            brushPixels.push({
                                x,
                                y,
                                segmentIndex,
                                colorName,
                                rawValue: pixelValue,
                                modalityValue: modalityPixelValue // Will be HU for CT images
                            });
                        }
                    }
                }
            }

            // Convert the Set to an Array for the summary
            const segmentsFound = Array.from(foundSegments).map(segmentIndex => ({
                segmentIndex,
                colorName: getColorNameBySegmentIndex(segmentIndex)
            }));


            const extractedData = {
                totalPixelCount: brushPixels.length,
                imageId,
                sliceIndex,
                segmentsFound,
                pixels: brushPixels.map(pixel => ({
                    ...pixel,
                    // Normalize coordinates by pixel spacing for consistent scaling
                    normalizedX: pixel.x / (enabledElement.image.columnPixelSpacing || 1),
                    normalizedY: pixel.y / (enabledElement.image.rowPixelSpacing || 1)
                })),
                // Store the original pixel spacing for reference
                originalPixelSpacing: {
                    column: enabledElement.image.columnPixelSpacing || 1,
                    row: enabledElement.image.rowPixelSpacing || 1
                },
                extractedAt: new Date().toISOString()
            };

            setExtractedPixels(extractedData);

            console.log('Extracted Brush Pixels:', {
                totalPixelCount: brushPixels.length,
                segmentsFound,
                pixelSample: brushPixels.slice(0, 10) // Show first 10 pixels for debugging
            });

            if (brushPixels.length === 0) {
                alert('No brushed pixels found on this slice. Please draw on the image first.');
            } else {
                console.log(`Successfully extracted ${brushPixels.length} pixels`);
                setShowPixelSummary(true); // Show the summary popup when pixels are extracted
            }

        } catch (error) {
            console.error('Error extracting brush pixel data:', error);
            alert('Error extracting brush pixel data. See console for details.');
        }
    };

// Enhanced version of extractAllBrushPixelsFromIsolatedData to match the original function's output format
    const extractAllBrushPixelsFromIsolatedData = () => {
        if (!isolatedSegmentationData) {
            console.error('No isolated segmentation data available');
            alert('No segmentation data found. Please convert DICOM mask first.');
            return null;
        }

        try {
            const element = dicomImageRef.current;
            if (!element) {
                console.error('DICOM image reference not available');
                return null;
            }

            // Get the enabled element to access the original image data
            const enabledElement = cornerstone.getEnabledElement(element);
            if (!enabledElement || !enabledElement.image) {
                console.error('No image loaded');
                return null;
            }

            const { labelmap2D, width, height, imageId } = isolatedSegmentationData;

            if (!labelmap2D || !labelmap2D.pixelData) {
                console.error('No pixel data in isolated segmentation');
                return null;
            }

            const segmentationBuffer = labelmap2D.pixelData;
            const brushPixels = [];
            const foundSegments = new Set();

            // Get the original image pixel data for HU values
            const imagePixelData = enabledElement.image.getPixelData();

            // Iterate through the segmentation buffer to find all brushed pixels
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const pixelIndex = y * width + x;

                    // Check if within bounds and is a brushed pixel (segment index > 0)
                    if (pixelIndex < segmentationBuffer.length && segmentationBuffer[pixelIndex] > 0) {
                        const segmentIndex = segmentationBuffer[pixelIndex];
                        foundSegments.add(segmentIndex);

                        // Get the color name for this segment
                        const colorName = getColorNameBySegmentIndex(segmentIndex);

                        // Get the original pixel value from the image
                        let pixelValue = null;
                        let modalityPixelValue = null;

                        if (imagePixelData && pixelIndex < imagePixelData.length) {
                            pixelValue = imagePixelData[pixelIndex];

                            // If it's a CT image, convert to HU if possible
                            const slope = enabledElement.image.slope || 1;
                            const intercept = enabledElement.image.intercept || 0;
                            modalityPixelValue = pixelValue * slope + intercept;
                        }

                        // Store the coordinates, value, and color information (matching original format)
                        brushPixels.push({
                            x,
                            y,
                            segmentIndex,
                            colorName,
                            rawValue: pixelValue,
                            modalityValue: modalityPixelValue // Will be HU for CT images
                        });
                    }
                }
            }

            // Convert the Set to an Array for the summary (matching original format)
            const segmentsFound = Array.from(foundSegments).map(segmentIndex => ({
                segmentIndex,
                colorName: getColorNameBySegmentIndex(segmentIndex)
            }));


            const extractedData = {
                totalPixelCount: brushPixels.length,
                imageId: imageId,
                sliceIndex: isolatedSegmentationData.sliceIndex || 0,
                segmentsFound,
                pixels: brushPixels.map(pixel => ({
                    ...pixel,
                    // Normalize coordinates by pixel spacing for consistent scaling
                    normalizedX: pixel.x / (enabledElement.image.columnPixelSpacing || 1),
                    normalizedY: pixel.y / (enabledElement.image.rowPixelSpacing || 1)
                })),
                // Store the original pixel spacing for reference
                originalPixelSpacing: {
                    column: enabledElement.image.columnPixelSpacing || 1,
                    row: enabledElement.image.rowPixelSpacing || 1
                },
                extractedAt: new Date().toISOString()
            };

            // Set the extracted pixels using your existing state setter
            setExtractedPixels(extractedData);

            console.log('Extracted Brush Pixels from Isolated Data:', {
                totalPixelCount: brushPixels.length,
                segmentsFound,
                pixelSample: brushPixels.slice(0, 10) // Show first 10 pixels for debugging
            });

            if (brushPixels.length === 0) {
                alert('No brushed pixels found in the converted mask.');
            } else {
                console.log(`Successfully extracted ${brushPixels.length} pixels from isolated data`);
                setShowPixelSummary(true); // Show the summary popup when pixels are extracted
            }

            return extractedData;

        } catch (error) {
            console.error('Error extracting pixels from isolated data:', error);
            alert('Error extracting pixels from isolated data. See console for details.');
            return null;
        }
    };

    const handleColorSelect = (color) => {
        const element = dicomImageRef.current;
        if (!element) return;

        try {
            // Get the segmentation module
            const segmentationModule = cornerstoneTools.getModule('segmentation');

            // Find the index of the selected color (adding 1 because segment indices start at 1)
            const segmentIndex = brushColors.indexOf(color) + 1;

            // Set the active segment index
            segmentationModule.setters.activeSegmentIndex(element, segmentIndex);

            // Reactivate the Brush tool (maintaining current size)
            cornerstoneTools.setToolActiveForElement(
                element,
                'Brush',
                {
                    mouseButtonMask: 1,
                    configuration: {
                        activeSegmentIndex: segmentIndex,
                        radius: selectedSize
                    }
                }
            );

            // Update local state
            setSelectedColor(color);
            setIsOpen(false);

            console.log('Brush color configured:', {
                color: color.name,
                rgbColor: color.rgbColor,
                segmentIndex: segmentIndex,
                size: selectedSize
            });

            // After color selection, force update brush size to ensure it's applied
            setTimeout(() => {
                forceUpdateBrushSize(selectedSize);
            }, 50);

            // Force image update
            cornerstone.updateImage(element);
        } catch (error) {
            console.error('Error configuring brush color:', error);
        }
    };

    const downloadPixelData = () => {
        if (!extractedPixels || !extractedPixels.pixels.length) {
            console.log('No pixel data to download');
            alert('No pixel data to download');
            return;
        }

        // Create a more descriptive filename with proper formatting
        const sliceInfo = extractedPixels.sliceIndex !== undefined ?
            `-slice${extractedPixels.sliceIndex}` : '';

        // Format date and time in a more readable way
        const now = new Date();
        const dateStr = now.toLocaleDateString().replace(/\//g, '-');
        const timeStr = now.toLocaleTimeString().replace(/:/g, '-').replace(/ /g, '');
        const timestamp = `${dateStr}-${timeStr}`;
        const pixelCount = extractedPixels.totalPixelCount;
        const filename = `dicom-brush-${pixelCount}px.json`;
        // Create a JSON string of the pixel data
        const dataStr = JSON.stringify(extractedPixels, null, 2);
        // Create a blob from the data
        const blob = new Blob([dataStr], { type: 'application/json' });
        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // Function to display a summary of extracted pixels by color
    // Modified renderPixelSummary function to be a popup
// Modified pixel summary popup styling
    const renderPixelSummary = () => {
        if (!showPixelSummary || !extractedPixels || !extractedPixels.segmentsFound || extractedPixels.segmentsFound.length === 0) {
            return null;
        }

        // Count pixels by color
        const pixelCountByColor = {};
        extractedPixels.pixels.forEach(pixel => {
            if (!pixelCountByColor[pixel.colorName]) {
                pixelCountByColor[pixel.colorName] = 0;
            }
            pixelCountByColor[pixel.colorName]++;
        });

        return (
            <div className="absolute z-20 right-0 mt-2 p-3 bg-[#101820] text-[#76c7e8] border border-[#4aa0ce] rounded-md shadow-lg backdrop-blur-md w-64">
                <div className="flex justify-between items-center border-b border-[#4aa0ce] pb-2 mb-2">
                    <h3 className="font-medium">Pixels Summary</h3>
                    <button
                        onClick={() => setShowPixelSummary(false)}
                        className="text-[#76c7e8] hover:text-white"
                    >
                        ✕
                    </button>
                </div>
                <div className="text-sm">
                    <div className="mb-2">
                        <span className="font-medium">Total: </span>
                        {extractedPixels.totalPixelCount} pixels
                    </div>
                    <div className="space-y-2">
                        {Object.entries(pixelCountByColor).map(([colorName, count]) => (
                            <div key={colorName} className="flex items-center gap-2">
                                <div
                                    className="w-4 h-4 rounded-full"
                                    style={{
                                        backgroundColor: brushColors.find(c => c.name === colorName)?.value || '#888'
                                    }}
                                />
                                <div className="flex-1 flex justify-between">
                                    <span>{colorName}:</span>
                                    <span>{count} pixels</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-3 pt-2 border-t border-[#4aa0ce]">
                        <button
                            onClick={downloadPixelData}
                            className="flex items-center text-[#76c7e8] hover:text-white text-sm transition-all duration-200"
                        >
                            <Download size={14} className="mr-1" />
                            Download Pixel Data
                        </button>
                    </div>
                </div>
            </div>
        );
    };


// Modified renderEraserButton function to show only active segments
    const renderEraserButton = () => {
        // Get the currently active segments/colors
        // const activeSegments = getActiveSegments();

        return (
            <div className="relative" ref={eraseMenuRef}>
                <button
                    onClick={() => !isDisabled && setEraseMenuOpen(!eraseMenuOpen)}
                    disabled={isDisabled}
                    className={`flex items-center transition-all duration-200 ${
                        isDisabled
                            ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                            : eraserActive
                                ? "text-red-500 hover:text-red-600"
                                : "text-[#76c7e8] hover:text-[#4aa0ce]"
                    }`}
                >
                    <div className="flex flex-col items-center">
                        <div className="flex items-center">
                            <Eraser size={20} className="mt-1"  strokeWidth={1.5} />
                            <ChevronDown size={14} className="ml-1 mt-1" />
                        </div>
                        <span className="text-xs mt-1">
                    {eraserActive ? "Erasing" : "Erase"}
                </span>
                    </div>
                </button>


                {eraseMenuOpen && !isDisabled && (
                    <div className="absolute z-10 mt-2 w-40 bg-[#101820] text-[#76c7e8] border border-[#4aa0ce] rounded-md shadow-lg backdrop-blur-md">
                        <div
                            className="flex items-center px-3 py-2 text-sm hover:bg-[#1a78a7] hover:text-white cursor-pointer transition-all duration-200"
                            onClick={handleEraserToggle}
                        >
                            <span>{eraserActive ? "Disable Eraser" : "Enable Eraser"}</span>
                        </div>
                        <div
                            className="flex items-center px-3 py-2 text-sm hover:bg-[#1a78a7] hover:text-white cursor-pointer transition-all duration-200"
                            onClick={eraseAll}
                        >
                            <span>Erase All Segments</span>
                        </div>

                        {/* Only show segment-specific erase options if there are active segments */}
                        {activeSegments.length > 0 && (
                            <>
                                <div className="border-t border-[#4aa0ce] my-1"></div>
                                <div className="px-3 py-1 text-xs text-[#4aa0ce]">Erase Specific Color:</div>
                                {activeSegments.map(segment => (
                                    <div
                                        key={segment.segmentIndex}
                                        className="flex items-center px-3 py-2 text-sm hover:bg-[#1a78a7] hover:text-white cursor-pointer transition-all duration-200"
                                        onClick={() => eraseSegment(segment.segmentIndex)}
                                    >
                                        <div
                                            className="w-3 h-3 rounded-full mr-2"
                                            style={{ backgroundColor: segment.color }}
                                        />
                                        <span>Erase {segment.colorName}</span>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                )}
            </div>
        );
    };



// Store segmentation data separately from Cornerstone's rendering system
    let isolatedSegmentationData = null;

    const convertDicomMaskToSegmentation = () => {
        // const element = dicomImageRef.current;
        // const element = segmentationDicomRef.current;
        let element = null;
        if(segmentationDicomRef.current)
        {
            element = segmentationDicomRef.current;
        }
        else{
             element = dicomImageRef.current;
        }

        if (!element) {
            console.error('DICOM image reference not available');
            return;
        }

        try {
            // Get the enabled element and image
            const enabledElement = cornerstone.getEnabledElement(element);
            if (!enabledElement || !enabledElement.image) {
                console.error('No image loaded');
                return;
            }

            const { width, height } = enabledElement.image;
            const imagePixelData = enabledElement.image.getPixelData();

            if (!imagePixelData) {
                console.error('No pixel data available');
                return;
            }

            console.log('Converting DICOM mask with pixel values 0, 1, 2 to segmentation');

            // Create segmentation buffer
            const segmentationBuffer = new Uint16Array(width * height);
            for (let i = 0; i < imagePixelData.length; i++) {
                segmentationBuffer[i] = imagePixelData[i];
            }

            const imageId = enabledElement.image.imageId;
            let sliceIndex = 0;

            // Try to get slice index from metadata
            const metadataProvider = cornerstone.metaData;
            if (metadataProvider) {
                const seriesMetadata = metadataProvider.get('instance', imageId);
                if (seriesMetadata && seriesMetadata.sliceIndex !== undefined) {
                    sliceIndex = seriesMetadata.sliceIndex;
                }
            }

            // CREATE COLOR LOOKUP TABLE
            const createColorLUT = () => {
                const colorLUT = [];
                colorLUT.push([0, 0, 0, 0]);           // Background - transparent
                colorLUT.push([255, 0, 0, 255]);       // Segment 1 - red
                colorLUT.push([0, 255, 0, 255]);       // Segment 2 - green

                // Add more colors for safety
                for (let i = 3; i < 256; i++) {
                    colorLUT.push([200, 200, 200, 255]);
                }
                return colorLUT;
            };

            const colorLUT = createColorLUT();

            // Create 2D labelmap
            const labelmap2D = {
                pixelData: segmentationBuffer,
                segmentsOnLabelmap: [1, 2],
                width: width,
                height: height,
                rows: height,
                // columns: columns,
                numberOfFrames: 1,
                colorLUTorIndex: 0,
                imageId: imageId,
                sliceIndex: sliceIndex
            };

            // Create 3D labelmap
            const labelmap3D = {
                buffer: segmentationBuffer.buffer.slice(),
                labelmaps2D: [],
                metadata: {
                    BitsAllocated: 16,
                    BitsStored: 16,
                    HighBit: 15,
                    PixelRepresentation: 0,
                    Rows: height,
                    Columns: width,
                    NumberOfFrames: 1
                },
                activeSegmentIndex: 1,
                colorLUTIndex: 0,
                width: width,
                height: height,
                dimensions: [width, height, 1],
                colorLUT: colorLUT,
                segmentsOnLabelmap: [1, 2],
                imageIds: [imageId],
                currentImageIdIndex: 0
            };

            // Initialize labelmaps2D array properly
            labelmap3D.labelmaps2D = new Array(Math.max(sliceIndex + 1, 1));
            labelmap3D.labelmaps2D[sliceIndex] = labelmap2D;
            labelmap2D.labelmap3D = labelmap3D;

            // Store data in isolated variable instead of Cornerstone's state
            // This prevents automatic rendering
            isolatedSegmentationData = {
                labelmap3D: labelmap3D,
                labelmap2D: labelmap2D,
                colorLUT: colorLUT,
                imageId: imageId,
                sliceIndex: sliceIndex,
                elementUID: element.uuid || element.getAttribute('data-cornerstone-element-id') || 'default-element',
                seriesInstanceUid: imageId || 'generated-segmentation-series',
                pixelBuffer: segmentationBuffer,
                width: width,
                height: height
            };

            console.log('Successfully converted DICOM mask to isolated segmentation data');

            // Count pixels for verification
            const pixelCounts = { 0: 0, 1: 0, 2: 0 };
            for (let i = 0; i < segmentationBuffer.length; i++) {
                const value = segmentationBuffer[i];
                if (pixelCounts.hasOwnProperty(value)) {
                    pixelCounts[value]++;
                }
            }
            console.log('Pixel distribution:', pixelCounts);

            alert(`DICOM mask converted! Found ${pixelCounts[1]} pixels of segment 1, ${pixelCounts[2]} pixels of segment 2. Data stored safely without rendering.`);

            // Try to extract pixels after a short delay
            setTimeout(() => {
                try {
                    extractAllBrushPixelsFromIsolatedData();
                } catch (extractError) {
                    console.log('Extract pixels failed:', extractError);
                }
            }, 1000);

        } catch (error) {
            console.error('Error converting DICOM mask to segmentation:', error);
            alert('Error converting DICOM mask. See console for details.');
        }
    };


// Function to safely integrate with Cornerstone when needed
    const integrateWithCornerstoneWhenSafe = () => {
        if (!isolatedSegmentationData) {
            console.error('No isolated segmentation data to integrate');
            return false;
        }

        const element = dicomImageRef.current;
        if (!element) {
            console.error('No element available for integration');
            return false;
        }

        try {
            // First, make sure no segmentation display is active
            try {
                cornerstoneTools.setToolDisabledForElement(element, 'SegmentationDisplay');
            } catch (e) {
                // Tool might not be active, that's fine
            }

            const segmentationModule = cornerstoneTools.getModule('segmentation');
            if (!segmentationModule) {
                console.error('Segmentation module not available');
                return false;
            }

            const { labelmap3D, colorLUT, seriesInstanceUid, elementUID } = isolatedSegmentationData;

            // Initialize state safely
            const segmentationState = segmentationModule.state;
            segmentationState.series = segmentationState.series || {};
            segmentationState.colorLUT = segmentationState.colorLUT || [];
            segmentationState.globalColorLUT = segmentationState.globalColorLUT || [];
            segmentationState.element = segmentationState.element || {};

            // Set color LUTs
            segmentationState.colorLUT[0] = colorLUT;
            segmentationState.globalColorLUT[0] = colorLUT;

            // Initialize series and element state
            segmentationState.series[seriesInstanceUid] = {
                labelmaps3D: [labelmap3D],
                colorLUT: colorLUT,
                colorLUTIndex: 0
            };

            segmentationState.element[elementUID] = {
                activeLabelmapIndex: 0,
                activeSegmentIndex: 1,
                labelmaps3D: [labelmap3D],
                colorLUTIndex: 0,
                configuration: {
                    renderFill: true,
                    renderOutline: false, // Start with outline disabled
                    fillAlpha: 0.3,
                    outlineWidth: 1
                }
            };

            // Set module setters if available
            if (segmentationModule.setters) {
                if (segmentationModule.setters.colorLUT) {
                    segmentationModule.setters.colorLUT(colorLUT);
                }
                if (segmentationModule.setters.activeLabelmapIndex) {
                    segmentationModule.setters.activeLabelmapIndex(element, 0);
                }
                if (segmentationModule.setters.activeSegmentIndex) {
                    segmentationModule.setters.activeSegmentIndex(element, 1);
                }
            }

            console.log('Successfully integrated isolated data with Cornerstone');
            return true;

        } catch (error) {
            console.error('Error integrating with Cornerstone:', error);
            return false;
        }
    };

// Function to enable display after safe integration
    const enableSegmentationDisplaySafely = () => {
        const element = dicomImageRef.current;
        if (!element) return false;

        try {
            // First integrate the data
            if (!integrateWithCornerstoneWhenSafe()) {
                console.error('Failed to integrate data, cannot enable display');
                return false;
            }

            // Then try to enable display
            cornerstoneTools.setToolEnabledForElement(element, 'SegmentationDisplay', {
                configuration: {
                    renderFill: true,
                    renderOutline: false,
                    fillAlpha: 0.3,
                    outlineWidth: 1
                }
            });

            console.log('Segmentation display enabled safely');
            cornerstone.updateImage(element);
            return true;

        } catch (error) {
            console.error('Error enabling segmentation display:', error);
            // Clean up on error
            try {
                cornerstoneTools.setToolDisabledForElement(element, 'SegmentationDisplay');
            } catch (e) {
                // Ignore cleanup errors
            }
            return false;
        }
    };

// Function to get current segmentation data (for your existing functions)
    const getCurrentSegmentationData = () => {
        return isolatedSegmentationData;
    };

// Function to clear isolated data
    const clearIsolatedSegmentationData = () => {
        isolatedSegmentationData = null;
        console.log('Isolated segmentation data cleared');
    };
    const analyzeMaskPixelValues = () => {
        const element = dicomImageRef.current;
        if (!element) return;

        try {
            const enabledElement = cornerstone.getEnabledElement(element);
            if (!enabledElement || !enabledElement.image) {
                console.error('No image loaded');
                return;
            }

            const imagePixelData = enabledElement.image.getPixelData();
            const pixelValueCounts = {};

            // Count occurrences of each pixel value
            for (let i = 0; i < imagePixelData.length; i++) {
                const value = imagePixelData[i];
                pixelValueCounts[value] = (pixelValueCounts[value] || 0) + 1;
            }

            // Sort by frequency
            const sortedValues = Object.entries(pixelValueCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10); // Top 10 most common values

            console.log('Most common pixel values in mask:');
            sortedValues.forEach(([value, count]) => {
                console.log(`Value ${value}: ${count} pixels (${(count/imagePixelData.length*100).toFixed(2)}%)`);
            });

            // Show alert with the values
            const valuesList = sortedValues.map(([value, count]) =>
                `${value} (${(count/imagePixelData.length*100).toFixed(1)}%)`
            ).join(', ');

            alert(`Most common pixel values: ${valuesList}\nCheck console for full details.`);

        } catch (error) {
            console.error('Error analyzing mask:', error);
        }
    };


    const analyzeCardiacMask = () => {
        // const element = dicomImageRef.current;
        let element = null;

        if (segmentationDicomRef.current) {
            element = segmentationDicomRef.current;
        } else {
            element = dicomImageRef.current;
        }
        if (!element) return null;

        try {
            const enabledElement = cornerstone.getEnabledElement(element);
            if (!enabledElement || !enabledElement.image) {
                console.error('No image loaded');
                return null;
            }

            const image = enabledElement.image;
            const imagePixelData = image.getPixelData();

            // Get pixel spacing from DICOM metadata
            const pixelSpacing = image.data?.string('x00280030') || '1\\1';
            const [rowSpacing, colSpacing] = pixelSpacing.split('\\').map(parseFloat);
            const pixelAreaMm2 = rowSpacing * colSpacing;

            // Define tissue types (updated naming)
            const tissueTypes = {
                1: { name: "Blood Pool", color: "#FF0000", description: "Left ventricular cavity" },
                2: { name: "Normal Myocardium", color: "#00FF00", description: "Healthy heart muscle" },
                3: { name: "Infarction", color: "#0066FF", description: "Infarcted/damaged myocardium" },
                4: { name: "No-Reflow", color: "#FFA500", description: "No-reflow zones within infarction" }
            };

            // Count pixels for each tissue type
            const pixelCounts = {};
            for (let i = 0; i < imagePixelData.length; i++) {
                const value = imagePixelData[i];
                pixelCounts[value] = (pixelCounts[value] || 0) + 1;
            }

            // Calculate areas and percentages
            const totalPixels = imagePixelData.length;
            const results = {};

            Object.keys(tissueTypes).forEach(value => {
                const count = pixelCounts[value] || 0;
                const percentage = (count / totalPixels) * 100;
                const areaMm2 = count * pixelAreaMm2;
                const areaCm2 = areaMm2 / 100;

                results[value] = {
                    ...tissueTypes[value],
                    pixelCount: count,
                    percentage: percentage,
                    areaMm2: areaMm2,
                    areaCm2: areaCm2
                };
            });

            // Calculate cardiac-specific metrics
            const heartPixels = (pixelCounts[1] || 0) + (pixelCounts[2] || 0) + (pixelCounts[3] || 0) + (pixelCounts[4] || 0);
            const myocardiumPixels = (pixelCounts[2] || 0) + (pixelCounts[3] || 0) + (pixelCounts[4] || 0);

            const heartAreaMm2 = heartPixels * pixelAreaMm2;
            const heartAreaCm2 = heartAreaMm2 / 100;
            const myocardiumAreaMm2 = myocardiumPixels * pixelAreaMm2;
            const myocardiumAreaCm2 = myocardiumAreaMm2 / 100;

            // Calculate ratios and clinical metrics
            const infarctToHeartRatio = heartPixels > 0 ? ((pixelCounts[3] || 0) / heartPixels) * 100 : 0;
            const infarctToMyocardiumRatio = myocardiumPixels > 0 ? ((pixelCounts[3] || 0) / myocardiumPixels) * 100 : 0;
            const noReflowToInfarctRatio = (pixelCounts[3] || 0) > 0 ? ((pixelCounts[4] || 0) / (pixelCounts[3] || 0)) * 100 : 0;
            const cavityToHeartRatio = heartPixels > 0 ? ((pixelCounts[1] || 0) / heartPixels) * 100 : 0;


            // Generate clinical interpretation
            // Updated infarct severity assessment - replace the existing logic
            let infarctSeverity = '';
            const infarctToTotalMyocardiumRatio = myocardiumPixels > 0 ? ((pixelCounts[3] || 0) / myocardiumPixels) * 100 : 0;

            if (infarctToTotalMyocardiumRatio > 50) {
                infarctSeverity = 'Massive infarct (>50% of total myocardium) - Extensive cardiac damage';
            } else if (infarctToTotalMyocardiumRatio > 30) {
                infarctSeverity = 'Large infarct (30-50% of total myocardium) - Significant cardiac damage';
            } else if (infarctToTotalMyocardiumRatio > 15) {
                infarctSeverity = 'Moderate infarct (15-30% of total myocardium) - Moderate cardiac damage';
            } else if (infarctToTotalMyocardiumRatio > 5) {
                infarctSeverity = 'Small infarct (5-15% of total myocardium) - Minor cardiac damage';
            } else if (infarctToTotalMyocardiumRatio > 0) {
                infarctSeverity = 'Minimal infarct (<5% of total myocardium) - Very small damage';
            } else {
                infarctSeverity = 'No infarction detected';
            }

            // Calculate no-reflow ratios for assessment
            const noReflowToTotalMyocardiumRatio = myocardiumPixels > 0 ? ((pixelCounts[4] || 0) / myocardiumPixels) * 100 : 0;
            const noReflowToNormalMyocardiumRatio = (pixelCounts[2] || 0) > 0 ? ((pixelCounts[4] || 0) / (pixelCounts[2] || 0)) * 100 : 0;

            let noReflowAssessment = '';
            if (pixelCounts[4] && pixelCounts[4] > 0) {
                if (noReflowToTotalMyocardiumRatio > 10) {
                    noReflowAssessment = `Extensive no-reflow zones (>10% of total myocardium) - Severe reperfusion failure`;
                } else if (noReflowToTotalMyocardiumRatio > 5) {
                    noReflowAssessment = `Significant no-reflow zones (5-10% of total myocardium) - Poor reperfusion`;
                } else if (noReflowToTotalMyocardiumRatio > 2) {
                    noReflowAssessment = `Moderate no-reflow zones (2-5% of total myocardium) - Partial reperfusion issues`;
                } else {
                    noReflowAssessment = `Small no-reflow zones (<2% of total myocardium) - Minimal reperfusion issues`;
                }
            } else {
                noReflowAssessment = 'No no-reflow zones detected - Good reperfusion';
            }

            // let noReflowAssessment = '';
            // if (pixelCounts[4] && pixelCounts[4] > 0) {
            //     if (noReflowToTotalMyocardiumRatio > 10) {
            //         noReflowAssessment = `Extensive no-reflow zones (${noReflowToTotalMyocardiumRatio.toFixed(1)}% of total myocardium, ${noReflowToNormalMyocardiumRatio.toFixed(1)}% of normal myocardium) - Severe reperfusion failure`;
            //     } else if (noReflowToTotalMyocardiumRatio > 5) {
            //         noReflowAssessment = `Significant no-reflow zones (${noReflowToTotalMyocardiumRatio.toFixed(1)}% of total myocardium, ${noReflowToNormalMyocardiumRatio.toFixed(1)}% of normal myocardium) - Poor reperfusion`;
            //     } else if (noReflowToTotalMyocardiumRatio > 2) {
            //         noReflowAssessment = `Moderate no-reflow zones (${noReflowToTotalMyocardiumRatio.toFixed(1)}% of total myocardium, ${noReflowToNormalMyocardiumRatio.toFixed(1)}% of normal myocardium) - Partial reperfusion issues`;
            //     } else {
            //         noReflowAssessment = `Small no-reflow zones (${noReflowToTotalMyocardiumRatio.toFixed(1)}% of total myocardium, ${noReflowToNormalMyocardiumRatio.toFixed(1)}% of normal myocardium) - Minimal reperfusion issues`;
            //     }
            // } else {
            //     noReflowAssessment = 'No no-reflow zones detected - Good reperfusion';
            // }



            return {
                tissueResults: results,
                metrics: {
                    heartAreaCm2,
                    myocardiumAreaCm2,
                    infarctToHeartRatio,
                    infarctToMyocardiumRatio,
                    noReflowToInfarctRatio,
                    cavityToHeartRatio,
                    // Add these new ratios:
                    noReflowToTotalMyocardiumRatio: myocardiumPixels > 0 ? ((pixelCounts[4] || 0) / myocardiumPixels) * 100 : 0,
                    noReflowToNormalMyocardiumRatio: (pixelCounts[2] || 0) > 0 ? ((pixelCounts[4] || 0) / (pixelCounts[2] || 0)) * 100 : 0,
                    normalToTotalMyocardiumRatio: myocardiumPixels > 0 ? ((pixelCounts[2] || 0) / myocardiumPixels) * 100 : 0,
                    infarctToNormalMyocardiumRatio: (pixelCounts[2] || 0) > 0 ? ((pixelCounts[3] || 0) / (pixelCounts[2] || 0)) * 100 : 0
                },
                pixelSpacing: { rowSpacing, colSpacing, pixelAreaMm2 },
                imageInfo: {
                    width: image.width,
                    height: image.height,
                    totalPixels
                },
                clinicalInterpretation: {
                    infarctSeverity,
                    noReflowAssessment
                }
            };

        } catch (error) {
            console.error('Error analyzing cardiac mask:', error);
            return null;
        }
    };

// FIXED: Modal component for displaying cardiac analysis
    const renderCardiacAnalysis = () => {
        if (!showCardiacAnalysis || !cardiacAnalysisData) {
            return null;
        }

        const { tissueResults, metrics, pixelSpacing, imageInfo, clinicalInterpretation } = cardiacAnalysisData;

        // FIXED: Generate HTML report and create a proper downloadable PDF
// FIXED: Generate HTML report and create a proper downloadable PDF
// FIXED: Generate HTML report and create a proper downloadable PDF
        const downloadPDFReport = async () => {
            try {
                // Define the ordered display of tissues (excluding background)
                const orderedTissues = [
                    { key: '1', displayName: 'Blood Pool' },
                    { key: 'totalMyocardium', displayName: 'Total Myocardium', calculated: true },
                    { key: '2', displayName: 'Normal Myocardium' },
                    { key: '3', displayName: 'Infarction' },
                    { key: '4', displayName: 'No-Reflow' }
                ];

                // Calculate total myocardium area and ratios
                const totalMyocardiumAreaCm2 = (tissueResults[2].areaCm2 || 0) + (tissueResults[3].areaCm2 || 0) + (tissueResults[4].areaCm2 || 0);
                const normalMyocardiumRatio = totalMyocardiumAreaCm2 > 0 ? ((tissueResults[2].areaCm2 || 0) / totalMyocardiumAreaCm2) * 100 : 0;
                const infarctToTotalMyoRatio = totalMyocardiumAreaCm2 > 0 ? ((tissueResults[3].areaCm2 || 0) / totalMyocardiumAreaCm2) * 100 : 0;
                const infarctToNormalMyoRatio = (tissueResults[2].areaCm2 || 0) > 0 ? ((tissueResults[3].areaCm2 || 0) / (tissueResults[2].areaCm2 || 0)) * 100 : 0;
                const noReflowToTotalMyoRatio = totalMyocardiumAreaCm2 > 0 ? ((tissueResults[4].areaCm2 || 0) / totalMyocardiumAreaCm2) * 100 : 0;
                const noReflowToNormalMyoRatio = (tissueResults[2].areaCm2 || 0) > 0 ? ((tissueResults[4].areaCm2 || 0) / (tissueResults[2].areaCm2 || 0)) * 100 : 0;

                // Create HTML content for display and download
                const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Cardiac Delayed Enhancement Analysis Report</title>
    <style>
        body {
            margin: 0;
            padding: 40px;
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            background: #fff;
        }
        .header {
            text-align: center;
            border-bottom: 3px solid #2563eb;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .header h1 {
            color: #1e40af;
            margin: 0;
            font-size: 24px;
            font-weight: bold;
        }
        .header .date {
            color: #6b7280;
            font-size: 14px;
            margin-top: 10px;
        }
        .section {
            margin-bottom: 30px;
            padding: 20px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            background: #f9fafb;
        }
        .section h2 {
            color: #1e40af;
            font-size: 18px;
            margin: 0 0 15px 0;
            padding-bottom: 10px;
            border-bottom: 2px solid #ddd;
        }
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-bottom: 15px;
        }
        .info-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 12px;
            background: #fff;
            border: 1px solid #e5e7eb;
            border-radius: 4px;
        }
        .info-label {
            font-weight: 600;
            color: #374151;
        }
        .info-value {
            color: #1f2937;
            font-weight: 500;
        }
        .tissue-item {
            display: flex;
            align-items: center;
            padding: 12px;
            margin-bottom: 10px;
            background: #fff;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
        }
        .tissue-color {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            margin-right: 12px;
            border: 1px solid #ccc;
        }
        .tissue-info {
            flex: 1;
        }
        .tissue-name {
            font-weight: 600;
            color: #1f2937;
            font-size: 14px;
        }
        .tissue-description {
            color: #6b7280;
            font-size: 12px;
            margin-top: 2px;
        }
        .tissue-stats {
            text-align: right;
            font-size: 13px;
        }
        .tissue-area {
            color: #2563eb;
            font-weight: 600;
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }
        .metric-card {
            padding: 15px;
            background: #fff;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            text-align: center;
        }
        .metric-label {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 5px;
        }
        .metric-value {
            font-size: 16px;
            font-weight: bold;
            color: #1e40af;
        }
        .clinical-assessment {
            padding: 15px;
            background: #fff;
            border-left: 4px solid #2563eb;
            margin-bottom: 10px;
        }
        .assessment-title {
            font-weight: 600;
            color: #1e40af;
            margin-bottom: 5px;
        }
        .assessment-text {
            color: #374151;
            font-size: 14px;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 12px;
        }
        .control-buttons {
            position: fixed;
            top: 20px;
            right: 20px;
            display: flex;
            gap: 10px;
            z-index: 1000;
        }
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
        }
        .btn-primary {
            background: #2563eb;
            color: white;
        }
        .btn-secondary {
            background: #6b7280;
            color: white;
        }
        .btn:hover {
            opacity: 0.9;
        }
        @media print {
            .control-buttons { display: none; }
            body { margin: 20px; }
            .section { break-inside: avoid; }
        }
    </style>
</head>
<body>
    <div class="control-buttons">
        <button class="btn btn-primary" onclick="window.print()">Print/Save as PDF</button>
        <button class="btn btn-secondary" onclick="window.close()">Close</button>
    </div>

    <div class="header">
        <h1>Cardiac Delayed Enhancement Analysis Report</h1>
        <div class="date">Generated on: ${new Date().toLocaleString()}</div>
    </div>

<div class="section">
    <h2>Tissue Distribution</h2>
    ${orderedTissues.map(tissue => {
                    let data, color, description, areaCm2, ratioText = '';

                    if (tissue.calculated && tissue.key === 'totalMyocardium') {
                        // Total myocardium calculation
                        data = { name: tissue.displayName };

                        // Determine color based on tissue presence
                        const hasNormal = (tissueResults[2]?.areaCm2 || 0) > 0;
                        const hasInfarct = (tissueResults[3]?.areaCm2 || 0) > 0;
                        const hasNoReflow = (tissueResults[4]?.areaCm2 || 0) > 0;

                        if (!hasNoReflow) {
                            // Use gradient representing blue and green equally
                            color = 'linear-gradient(90deg, #0066FF 50%, #00FF00 50%)';
                        } else {
                            // Use gradient representing green, blue, orange equally
                            color = 'linear-gradient(90deg, #00FF00 33.33%, #0066FF 33.33%, #0066FF 66.66%, #FFA500 66.66%)';
                        }

                        description = 'Total myocardial tissue (equal visualization ratios)';
                        areaCm2 = totalMyocardiumAreaCm2;
                    } else {
                        data = tissueResults[tissue.key];

                        // Update individual tissue colors to match the scheme
                        if (tissue.key === '2') { // Normal Myocardium
                            color = '#00FF00'; // Green
                        } else if (tissue.key === '3') { // Infarction
                            color = '#0066FF'; // Blue  
                        } else if (tissue.key === '4') { // No-Reflow
                            color = '#FFA500'; // Orange
                        } else {
                            color = data?.color || '#999999';
                        }

                        description = data?.description || '';
                        areaCm2 = data?.areaCm2 || 0;

                        // Remove ratio calculations since we're using equal ratios for visualization
                        ratioText = '';
                    }

                    // Only show if there's area > 0
                    if (areaCm2 <= 0) return '';

                    return `
    <div class="tissue-item">
        <div class="tissue-color" style="background: ${color}"></div>
        <div class="tissue-info">
            <div class="tissue-name">${data.name}</div>
            <div class="tissue-description">${description}</div>
        </div>
        <div class="tissue-stats">
            <div class="tissue-area">${areaCm2.toFixed(2)} cm²</div>
        </div>
    </div>
        `;
                }).join('')}
</div>

<div class="section">
    <h2>Clinical Ratios</h2>
    <div class="metrics-grid" style="grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));">
        <div class="metric-card">
            <div class="metric-label">Infarct Size Ratios</div>
            <div style="text-align: left; margin-top: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>% of total heart:</span>
                    <span class="metric-value" style="font-size: 14px;">${metrics.infarctToHeartRatio.toFixed(2)}%</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>% of total myocardium:</span>
                    <span class="metric-value" style="font-size: 14px;">${metrics.infarctToMyocardiumRatio.toFixed(2)}%</span>
                </div>
                ${(tissueResults[2].areaCm2 || 0) > 0 ? `
                <div style="display: flex; justify-content: space-between;">
                    <span>% of normal myocardium:</span>
                    <span class="metric-value" style="font-size: 14px;">${infarctToNormalMyoRatio.toFixed(2)}%</span>
                </div>
                ` : ''}
            </div>
        </div>
        
        ${tissueResults[4].areaCm2 > 0 ? `
        <div class="metric-card">
            <div class="metric-label">No-Reflow Ratios</div>
            <div style="text-align: left; margin-top: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>% of infarct area:</span>
                    <span class="metric-value" style="font-size: 14px;">${metrics.noReflowToInfarctRatio.toFixed(2)}%</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>% of total myocardium:</span>
                    <span class="metric-value" style="font-size: 14px;">${noReflowToTotalMyoRatio.toFixed(2)}%</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>% of normal myocardium:</span>
                    <span class="metric-value" style="font-size: 14px;">${noReflowToNormalMyoRatio.toFixed(2)}%</span>
                </div>
            </div>
        </div>
        ` : ''}
        
        <div class="metric-card">
            <div class="metric-label">Myocardial Distribution</div>
            <div style="text-align: left; margin-top: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>Normal myocardium:</span>
                    <span class="metric-value" style="font-size: 14px;">${normalMyocardiumRatio.toFixed(2)}%</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Blood pool (% of heart):</span>
                    <span class="metric-value" style="font-size: 14px;">${metrics.cavityToHeartRatio.toFixed(2)}%</span>
                </div>
            </div>
        </div>
    </div>
</div>

    <div class="section">
        <h2>Clinical Interpretation</h2>
        <div class="clinical-assessment">
            <div class="assessment-title">Infarct Assessment</div>
            <div class="assessment-text">${clinicalInterpretation.infarctSeverity}</div>
        </div>
        <div class="clinical-assessment">
            <div class="assessment-title">Reperfusion Status</div>
            <div class="assessment-text">${clinicalInterpretation.noReflowAssessment}</div>
        </div>
    </div>

    <div class="footer">
        <p>This report was generated using automated cardiac mask analysis software.</p>
        <p>For clinical use, please validate results with appropriate medical supervision.</p>
    </div>
</body>
</html>`;

                // Create a blob with the HTML content
                const blob = new Blob([htmlContent], { type: 'text/html' });
                const url = URL.createObjectURL(blob);

                // Create a link element and trigger download
                const a = document.createElement('a');
                a.href = url;
                a.download = `cardiac_analysis_report_${new Date().toISOString().split('T')[0]}.html`;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                // Clean up the blob URL
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                }, 1000);

                // Also open in new tab for immediate viewing/printing
                const printWindow = window.open('', '_blank');
                if (printWindow) {
                    printWindow.document.write(htmlContent);
                    printWindow.document.close();
                }

            } catch (error) {
                console.error('Error generating report:', error);
                // Fallback to text download
                const totalMyocardiumAreaCm2 = (tissueResults[2].areaCm2 || 0) + (tissueResults[3].areaCm2 || 0) + (tissueResults[4].areaCm2 || 0);
                const normalMyocardiumRatio = totalMyocardiumAreaCm2 > 0 ? ((tissueResults[2].areaCm2 || 0) / totalMyocardiumAreaCm2) * 100 : 0;
                const infarctToTotalMyoRatio = totalMyocardiumAreaCm2 > 0 ? ((tissueResults[3].areaCm2 || 0) / totalMyocardiumAreaCm2) * 100 : 0;
                const infarctToNormalMyoRatio = (tissueResults[2].areaCm2 || 0) > 0 ? ((tissueResults[3].areaCm2 || 0) / (tissueResults[2].areaCm2 || 0)) * 100 : 0;
                const noReflowToTotalMyoRatio = totalMyocardiumAreaCm2 > 0 ? ((tissueResults[4].areaCm2 || 0) / totalMyocardiumAreaCm2) * 100 : 0;
                const noReflowToNormalMyoRatio = (tissueResults[2].areaCm2 || 0) > 0 ? ((tissueResults[4].areaCm2 || 0) / (tissueResults[2].areaCm2 || 0)) * 100 : 0;

                const reportContent = `
Cardiac Delayed Enhancement Analysis Report
Generated on: ${new Date().toLocaleString()}

TISSUE DISTRIBUTION:
Blood Pool: ${tissueResults[1].areaCm2.toFixed(2)} cm²
Total Myocardium: ${totalMyocardiumAreaCm2.toFixed(2)} cm²
Normal Myocardium: ${tissueResults[2].areaCm2.toFixed(2)} cm² (${normalMyocardiumRatio.toFixed(1)}% of total myocardium)
${tissueResults[3].areaCm2 > 0 ? `Infarction: ${tissueResults[3].areaCm2.toFixed(2)} cm² (${infarctToTotalMyoRatio.toFixed(1)}% of total myocardium, ${infarctToNormalMyoRatio.toFixed(1)}% of normal myocardium)` : ''}
${tissueResults[4].areaCm2 > 0 ? `No-Reflow: ${tissueResults[4].areaCm2.toFixed(2)} cm² (${noReflowToTotalMyoRatio.toFixed(1)}% of total myocardium, ${noReflowToNormalMyoRatio.toFixed(1)}% of normal myocardium)` : ''}

CLINICAL RATIOS:
- Infarct Size (% of total heart): ${metrics.infarctToHeartRatio.toFixed(2)}%
- Infarct Size (% of myocardium): ${metrics.infarctToMyocardiumRatio.toFixed(2)}%
${tissueResults[4].areaCm2 > 0 ? `- No-Reflow (% of infarct): ${metrics.noReflowToInfarctRatio.toFixed(2)}%` : '- No-Reflow: Not detected'}
- Blood Pool (% of heart): ${metrics.cavityToHeartRatio.toFixed(2)}%

CLINICAL INTERPRETATION:
- Infarct Assessment: ${clinicalInterpretation.infarctSeverity}
- Reperfusion Status: ${clinicalInterpretation.noReflowAssessment}
        `;

                const blob = new Blob([reportContent], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `cardiac_analysis_report_${new Date().toISOString().split('T')[0]}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
        };        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-[#101820] text-[#76c7e8] border border-[#4aa0ce] rounded-lg shadow-lg backdrop-blur-md max-w-4xl max-h-[90vh] overflow-y-auto">
                    <div className="sticky top-0 bg-[#101820] border-b border-[#4aa0ce] p-4 flex justify-between items-center">
                        <h2 className="text-xl font-bold">Cardiac Delayed Enhancement Analysis Report</h2>
                        <button
                            onClick={() => setShowCardiacAnalysis(false)}
                            className="text-[#76c7e8] hover:text-white text-xl"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="p-6 space-y-6">

                        {/* Tissue Distribution */}
                        <div className="bg-[#1a2332] p-4 rounded-lg">
                            <h3 className="text-lg font-semibold mb-3 text-[#4aa0ce]">Tissue Distribution</h3>
                            <div className="space-y-3">
                                {/* Blood Pool */}
                                {tissueResults[1].areaCm2 > 0 && (
                                    <div className="flex items-center gap-3 p-3 bg-[#0f1419] rounded">
                                        <div
                                            className="w-4 h-4 rounded-full"
                                            style={{ backgroundColor: tissueResults[1].color }}
                                        />
                                        <div className="flex-1">
                                            <div className="font-medium">Blood Pool</div>
                                            <div className="text-sm text-[#9ca3af]">{tissueResults[1].description}</div>
                                        </div>
                                        <div className="text-right text-sm">
                                            <div className="text-[#4aa0ce]">{tissueResults[1].areaCm2.toFixed(2)} cm²</div>
                                        </div>
                                    </div>
                                )}

                                {/* Total Myocardium */}
                                 {(() => {
                                    const totalMyoArea = (tissueResults[2].areaCm2 || 0) + (tissueResults[3].areaCm2 || 0) + (tissueResults[4].areaCm2 || 0);
                                    const hasNormal = (tissueResults[2].areaCm2 || 0) > 0;
                                    const hasInfarct = (tissueResults[3].areaCm2 || 0) > 0;
                                    const hasNoReflow = (tissueResults[4].areaCm2 || 0) > 0;

                                    // Determine color scheme based on presence of tissues
                                    let backgroundGradient;
                                    if (!hasNoReflow) {
                                        // Only blue and green (equal ratios)
                                        backgroundGradient = `conic-gradient(
                        #0066FF 0deg 180deg,
                        #00FF00 180deg 360deg
                    )`;
                                    } else {
                                        // Green, blue, orange with equal ratios (120deg each)
                                        backgroundGradient = `conic-gradient(
                        #00FF00 0deg 120deg,
                        #0066FF 120deg 240deg,
                        #FFA500 240deg 360deg
                    )`;
                                    }

                                    return totalMyoArea > 0 && (
                                        <div className="flex items-center gap-3 p-3 bg-[#0f1419] rounded">
                                            <div
                                                className="w-4 h-4 rounded-full border border-gray-300"
                                                style={{
                                                    background: backgroundGradient
                                                }}
                                            />
                                            <div className="flex-1">
                                                <div className="font-medium">Total Myocardium</div>
                                                <div className="text-sm text-[#9ca3af]">Total myocardial tissue (normal + infarction + no-reflow)</div>
                                            </div>
                                            <div className="text-right text-sm">
                                                <div className="text-[#4aa0ce]">{totalMyoArea.toFixed(2)} cm²</div>
                                            </div>
                                        </div>
                                    );
                                })()}
                    {/*            {(() => {*/}
                    {/*                const totalMyoArea = (tissueResults[2].areaCm2 || 0) + (tissueResults[3].areaCm2 || 0) + (tissueResults[4].areaCm2 || 0);*/}
                    {/*                const normalRatio = totalMyoArea > 0 ? ((tissueResults[2].areaCm2 || 0) / totalMyoArea) * 100 : 0;*/}
                    {/*                const infarctRatio = totalMyoArea > 0 ? ((tissueResults[3].areaCm2 || 0) / totalMyoArea) * 100 : 0;*/}
                    {/*                const noReflowRatio = totalMyoArea > 0 ? ((tissueResults[4].areaCm2 || 0) / totalMyoArea) * 100 : 0;*/}

                    {/*                return totalMyoArea > 0 && (*/}
                    {/*                    <div className="flex items-center gap-3 p-3 bg-[#0f1419] rounded">*/}
                    {/*                        <div*/}
                    {/*                            className="w-4 h-4 rounded-full border border-gray-300"*/}
                    {/*                            style={{*/}
                    {/*                                background: `conic-gradient(*/}
                    {/*    #00FF00 0deg ${normalRatio * 3.6}deg,*/}
                    {/*    #0066FF ${normalRatio * 3.6}deg ${(normalRatio + infarctRatio) * 3.6}deg,*/}
                    {/*    #FFA500 ${(normalRatio + infarctRatio) * 3.6}deg 360deg*/}
                    {/*)`*/}
                    {/*                            }}*/}
                    {/*                        />*/}
                    {/*                        <div className="flex-1">*/}
                    {/*                            <div className="font-medium">Total Myocardium</div>*/}
                    {/*                            <div className="text-sm text-[#9ca3af]">Total myocardial tissue (normal + infarction + no-reflow)</div>*/}
                    {/*                        </div>*/}
                    {/*                        <div className="text-right text-sm">*/}
                    {/*                            <div className="text-[#4aa0ce]">{totalMyoArea.toFixed(2)} cm²</div>*/}
                    {/*                        </div>*/}
                    {/*                    </div>*/}
                    {/*                );*/}
                    {/*            })()}*/}

                                {/* Normal Myocardium */}
                                {(() => {
                                    const totalMyoArea = (tissueResults[2].areaCm2 || 0) + (tissueResults[3].areaCm2 || 0) + (tissueResults[4].areaCm2 || 0);
                                    const normalRatio = totalMyoArea > 0 ? ((tissueResults[2].areaCm2 || 0) / totalMyoArea) * 100 : 0;
                                    return tissueResults[2].areaCm2 > 0 && (
                                        <div className="flex items-center gap-3 p-3 bg-[#0f1419] rounded">
                                            <div
                                                className="w-4 h-4 rounded-full"
                                                style={{ backgroundColor: tissueResults[2].color }}
                                            />
                                            <div className="flex-1">
                                                <div className="font-medium">Normal Myocardium</div>
                                                <div className="text-sm text-[#9ca3af]">{tissueResults[2].description}</div>
                                            </div>
                                            <div className="text-right text-sm">
                                                <div className="text-[#4aa0ce]">{tissueResults[2].areaCm2.toFixed(2)} cm²</div>
                                                <div className="text-[#9ca3af] text-xs">({normalRatio.toFixed(1)}% of total myocardium)</div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Infarction */}
                                {(() => {
                                    const totalMyoArea = (tissueResults[2].areaCm2 || 0) + (tissueResults[3].areaCm2 || 0) + (tissueResults[4].areaCm2 || 0);
                                    const infarctToTotalRatio = totalMyoArea > 0 ? ((tissueResults[3].areaCm2 || 0) / totalMyoArea) * 100 : 0;
                                    const infarctToNormalRatio = (tissueResults[2].areaCm2 || 0) > 0 ? ((tissueResults[3].areaCm2 || 0) / (tissueResults[2].areaCm2 || 0)) * 100 : 0;
                                    return tissueResults[3].areaCm2 > 0 && (
                                        <div className="flex items-center gap-3 p-3 bg-[#0f1419] rounded">
                                            <div
                                                className="w-4 h-4 rounded-full"
                                                style={{ backgroundColor: tissueResults[3].color }}
                                            />
                                            <div className="flex-1">
                                                <div className="font-medium">Infarction</div>
                                                <div className="text-sm text-[#9ca3af]">{tissueResults[3].description}</div>
                                            </div>
                                            <div className="text-right text-sm">
                                                <div className="text-[#4aa0ce]">{tissueResults[3].areaCm2.toFixed(2)} cm²</div>
                                                <div className="text-[#9ca3af] text-xs">
                                                    ({infarctToTotalRatio.toFixed(1)}% of total, {infarctToNormalRatio.toFixed(1)}% of normal)
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* No-Reflow */}
                                {(() => {
                                    const totalMyoArea = (tissueResults[2].areaCm2 || 0) + (tissueResults[3].areaCm2 || 0) + (tissueResults[4].areaCm2 || 0);
                                    const noReflowToTotalRatio = totalMyoArea > 0 ? ((tissueResults[4].areaCm2 || 0) / totalMyoArea) * 100 : 0;
                                    const noReflowToNormalRatio = (tissueResults[2].areaCm2 || 0) > 0 ? ((tissueResults[4].areaCm2 || 0) / (tissueResults[2].areaCm2 || 0)) * 100 : 0;
                                    return tissueResults[4].areaCm2 > 0 && (
                                        <div className="flex items-center gap-3 p-3 bg-[#0f1419] rounded">
                                            <div
                                                className="w-4 h-4 rounded-full"
                                                style={{ backgroundColor: tissueResults[4].color }}
                                            />
                                            <div className="flex-1">
                                                <div className="font-medium">No-Reflow</div>
                                                <div className="text-sm text-[#9ca3af]">{tissueResults[4].description}</div>
                                            </div>
                                            <div className="text-right text-sm">
                                                <div className="text-[#4aa0ce]">{tissueResults[4].areaCm2.toFixed(2)} cm²</div>
                                                <div className="text-[#9ca3af] text-xs">
                                                    ({noReflowToTotalRatio.toFixed(1)}% of total, {noReflowToNormalRatio.toFixed(1)}% of normal)
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>


                        {/* Clinical Interpretation */}
                        <div className="bg-[#1a2332] p-4 rounded-lg">
                            <h3 className="text-lg font-semibold mb-3 text-[#4aa0ce]">Clinical Interpretation</h3>
                            <div className="space-y-2 text-sm">
                                <div>
                                    <span className="font-medium">Infarct Assessment:</span>
                                    <div className="mt-1 text-[#9ca3af]">{clinicalInterpretation.infarctSeverity}</div>
                                </div>
                                <div>
                                    <span className="font-medium">Reperfusion Status:</span>
                                    <div className="mt-1 text-[#9ca3af]">{clinicalInterpretation.noReflowAssessment}</div>
                                </div>
                            </div>
                        </div>

                        {/* Download Button */}
                        <div className="flex justify-center pt-4">
                            <button
                                onClick={downloadPDFReport}
                                className="flex items-center gap-2 bg-[#4aa0ce] hover:bg-[#3a8fb5] text-white px-6 py-2 rounded-lg transition-colors"
                            >
                                <Download size={16} />
                                Download Report
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };


// Usage function to trigger analysis and show modal (unchanged)
    const performCardiacAnalysis = () => {
        const analysisData = analyzeCardiacMask();
        if (analysisData) {
            setCardiacAnalysisData(analysisData);
            setShowCardiacAnalysis(true);
        } else {
            alert('Error performing cardiac analysis. Please ensure a DICOM mask is loaded.');
        }
    };



    return (
        <div className="relative" ref={dropdownRef}>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => !isDisabled && setIsOpen(!isOpen)}
                    disabled={isDisabled}
                    className={`flex items-center transition-all duration-200 ${
                        isDisabled
                            ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                            : "text-[#76c7e8] hover:text-[#4aa0ce]"
                    }`}
                >
                    <div className="flex flex-col items-center">
                        <div className="flex items-center">
                            <Brush size={20} strokeWidth={1.5} className="mt-1"/>
                            <div
                                className="w-3 h-3 rounded-full ml-1"
                                style={{backgroundColor: selectedColor.value}}
                            />
                            <ChevronDown size={14} className="ml-1 mt-1"/>
                        </div>
                        <span className="text-xs mt-1">Brush</span>
                    </div>
                </button>

                {/* Brush Size Selector */}
                <div className="relative" ref={sizeDropdownRef}>
                    <button
                        onClick={() => !isDisabled && setIsSizeMenuOpen(!isSizeMenuOpen)}
                        disabled={isDisabled}
                        className={`flex items-center transition-all duration-200 ${
                            isDisabled
                                ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                                : "text-[#76c7e8] hover:text-[#4aa0ce]"
                        }`}
                    >
                        <div className="flex flex-col items-center">
                            <div className="flex items-center">
                                <Circle
                                    size={selectedSize > 14 ? 18 : selectedSize > 8 ? 15 : 12}
                                    strokeWidth={1.5}
                                    className="mt-1"
                                />
                                <ChevronDown size={14} className="ml-1 mt-1"/>
                            </div>
                            <span className="text-xs mt-1">{selectedSize}px</span>
                        </div>
                    </button>

                    {isSizeMenuOpen && !isDisabled && (
                        <div
                            className="absolute z-10 mt-2 w-24 bg-[#101820] text-[#76c7e8] border border-[#4aa0ce] rounded-md shadow-lg backdrop-blur-md">
                            {brushSizes.map((size) => (
                                <div
                                    key={size}
                                    className="flex items-center justify-between px-3 py-2 text-sm hover:bg-[#1a78a7] hover:text-white cursor-pointer transition-all duration-200"
                                    onClick={() => handleSizeSelect(size)}
                                >
                                    <span>{size}px</span>
                                    <Circle
                                        size={Math.min(Math.max(size * 0.8, 8), 16)}
                                        strokeWidth={1.5}
                                        className={selectedSize === size ? "text-[#4aa0ce]" : ""}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {renderEraserButton()}

                {/*da button el download elly bytl3 lma ados extract*/}
                {/*{extractedPixels && (*/}
                {/*    <button*/}
                {/*        onClick={downloadPixelData}*/}
                {/*        className="flex flex-col items-center text-[#76c7e8] hover:text-[#4aa0ce] transition-all duration-200"*/}
                {/*        title="Download Brush Pixel Data"*/}
                {/*    >*/}
                {/*        <Download size={20} strokeWidth={1.5} className="mt-1" />*/}
                {/*        <span className="text-xs mt-1">*/}
                {/*            {extractedPixels.totalPixelCount} pixels*/}
                {/*        </span>*/}
                {/*    </button>*/}
                {/*)}*/}

                <button
                    onClick={convertDicomMaskToSegmentation}
                    disabled={isDisabled}
                    className={`flex flex-col items-center transition-all duration-200 ${
                        isDisabled
                            ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                            : "text-[#76c7e8] hover:text-[#4aa0ce]"
                    }`}
                >
                    <Palette size={20} strokeWidth={1.5} className="mt-1"/>
                    <span className="text-xs py-1">Convert Mask</span>
                </button>

                {/*<button*/}
                {/*    onClick={analyzeMaskPixelValues}*/}
                {/*    disabled={isDisabled}*/}
                {/*    className={`flex flex-col items-center transition-all duration-200 ${*/}
                {/*        isDisabled*/}
                {/*            ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"*/}
                {/*            : "text-[#76c7e8] hover:text-[#4aa0ce]"*/}
                {/*    }`}*/}
                {/*>*/}
                {/*    <Search size={20} strokeWidth={1.5} className="mt-1"/>*/}
                {/*    <span className="text-xs py-1">Analyze Mask</span>*/}
                {/*</button>*/}

                           <button
                    onClick={performCardiacAnalysis}
                    disabled={isDisabled}
                    className={`flex flex-col items-center transition-all duration-200 ${
                        isDisabled
                            ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                            : "text-[#76c7e8] hover:text-[#4aa0ce]"
                    }`}
                >
                    <FileText size={20} strokeWidth={1.5} className="mt-1"/>
                    <span className="text-xs py-1">Generate Report</span>
                </button>


                <button
                    onClick={extractAllBrushPixels}
                    disabled={isDisabled}
                    className={`flex flex-col items-center transition-all duration-200 ${
                        isDisabled
                            ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                            : "text-[#76c7e8] hover:text-[#4aa0ce]"
                    }`}
                >
                    <Download size={20} strokeWidth={1.5} className="mt-1"/>
                    <span className="text-xs  py-1">Extract Pixels</span>
                </button>


            </div>

            {isOpen && !isDisabled && (
                <div
                    className="absolute z-10 mt-2 w-32 bg-[#101820] text-[#76c7e8] border border-[#4aa0ce] rounded-md shadow-lg backdrop-blur-md">
                    {brushColors.map((color) => (
                        <div
                            key={color.name}
                            className="flex items-center px-3 py-2 text-sm hover:bg-[#1a78a7] hover:text-white cursor-pointer transition-all duration-200"
                            onClick={() => handleColorSelect(color)}
                        >
                        <div
                                className="w-4 h-4 rounded-full mr-2"
                                style={{ backgroundColor: color.value }}
                            />
                            <span>{color.name}</span>
                        </div>
                    ))}
                </div>
            )}

            {renderPixelSummary()}
            {renderCardiacAnalysis()}
        </div>
    );
};

export default BrushColorDropdown;




