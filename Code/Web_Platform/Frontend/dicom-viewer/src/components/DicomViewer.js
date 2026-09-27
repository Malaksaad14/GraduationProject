import React, { useRef, useEffect, useState } from 'react';
import * as cornerstone from 'cornerstone-core';
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import * as dicomParser from 'dicom-parser';
import * as cornerstoneTools from 'cornerstone-tools';
import * as cornerstoneMath from 'cornerstone-math';
import Hammer from 'hammerjs';


// import { Move } from 'lucide-react';
import {
    Move,
    Search,
    Sun,
    Ruler,
    Square,
    Circle,
    DraftingCompass,
    BookOpenText,
    Upload,
    ArrowUpWideNarrow,
    ArrowUp,
    SlidersHorizontal,
    CircleChevronLeft,
    CircleChevronRight,
    Grid2x2,
    RefreshCcw,
    Brush,
    SquareDashedMousePointer,
    ZoomIn,
    X
} from "lucide-react";


import ToolButtons from './ToolButtons';
import MetadataTable from './MetadataTable';
import Sidebar from './Sidebar';
import PointPlacerTool from "./CurvedPolyLineTool";
import BrushColorDropdown from "./viewer-tools/BrushColorDropdown";
import SegmentationController from "./viewer-tools/BrushColorDropdown";
import DicomBrushOverlay from "./viewer-tools/DicomBrushOverlay";
import BrushNavbarControls from "./viewer-tools/BrushNavbarControls";
// import PointPlacerTool, { addPointRenderListener } from "./CurvedPolyLineTool";

// Set external dependencies
cornerstoneTools.external.cornerstone = cornerstone;
cornerstoneTools.external.Hammer = Hammer;
cornerstoneTools.external.cornerstoneMath = cornerstoneMath;
cornerstoneTools.init();

cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

function DicomViewer() {
    const dicomImageRef = useRef(null);
    const [activeTool, setActiveTool] = useState(null);  //Tracks the currently active tool (e.g., zoom, pan).
    const [metadata, setMetadata] = useState(null);     // Holds metadata of the displayed image.
    const [uploadedFiles, setUploadedFiles] = useState([]);  //Stores uploaded DICOM files.
    const [currentFileIndex, setCurrentFileIndex] = useState(0);  //Tracks which file is currently displayed.
    const [uids, setUids] = useState([]); // Array to store unique identifiers (UID) info for each file
    const [groupedSeries, setGroupedSeries] = useState({});

    const processedDicomRef = useRef(null); // Processed DICOM viewer
    const [IsProcessedDicomVisible, setIsProcessedDicomVisible] = useState(false);

    const [processedMetadata, setProcessedMetadata] = useState(null);
    const [isOriginalMetadataTableOpen, setIsOriginalMetadataTableOpen] = useState(false);
    const [isProcessedMetadataTableOpen, setIsProcessedMetadataTableOpen] = useState(false);
    const dicomCanvasRef = useRef(null);  // Ref for the canvas
    const [cursorPos, setCursorPos] = useState({x: 0, y: 0});
    const [showCanvasText, setShowCanvasText] = useState(true);
    const [processedSeries, setProcessedSeries] = useState([]);
    const [processedCurrentIndex, setProcessedCurrentIndex] = useState(0);
    const [processedGroupedSeries, setProcessedGroupedSeries] = useState({});

    // nav bar
    const [showUploadDropdown, setShowUploadDropdown] = useState(false);
    const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
    const isDisabled = uploadedFiles.length === 0;

    // split screens
    const [isSplitView, setIsSplitView] = useState(false);
    // const [activeViewer, setActiveViewer] = useState("main"); // "main" or "split"
    const [splitScreenImage, setSplitScreenImage] = useState(null); // Holds the image for the split viewer
    const [splitScreen1Metadata, setSplitScreen1Metadata] = useState(null);
    const [splitScreen1CursorPos, setSplitScreen1CursorPos] = useState({ x: 0, y: 0 });
    const [isVerticalSplit, setIsVerticalSplit] = useState(false); // false = 1x2 (side-by-side), true = 2x1 (stacked)

    const [isFourSplitView, setIsFourSplitView] = useState(false);  // Controls 4-screen mode
    const [activeViewer, setActiveViewer] = useState("main");  // Can be "main", "split1", "split2", or "split3"
    const [splitScreen2Metadata, setSplitScreen2Metadata] = useState(null);
    const [splitScreen3Metadata, setSplitScreen3Metadata] = useState(null);

    const [splitScreen2CursorPos, setSplitScreen2CursorPos] = useState({ x: 0, y: 0 });
    const [splitScreen3CursorPos, setSplitScreen3CursorPos] = useState({ x: 0, y: 0 });

    const splitScreen1Ref = useRef(null); // Ref for the new split-screen viewer
    const splitScreen1CanvasRef = useRef(null); // Overlay canvas for Split Viewer 1
    const splitScreen2Ref = useRef(null);
    const splitScreen2CanvasRef = useRef(null); // Overlay canvas for Split Viewer 1
    const splitScreen3Ref = useRef(null);
    const splitScreen3CanvasRef = useRef(null); // Overlay canvas for Split Viewer 1
    const [viewerKey, setViewerKey] = useState(0); // Key to force re-render
    // const [mainViewerIndex, setMainViewerIndex] = useState(0);
    const [splitViewer1Index, setSplitViewer1Index] = useState(0);
    const [splitViewer2Index, setSplitViewer2Index] = useState(0);
    const [splitViewer3Index, setSplitViewer3Index] = useState(0);
    const [isSynced, setIsSynced] = useState(false);
    const [showSplitDropdown, setShowSplitDropdown] = useState(false);
    const [selectedMode, setSelectedMode] = useState("Single View");
    const [stack, setStack] = useState({ imageIds: [], currentImageIndex: 0 });

    const [points, setPoints] = useState([]);
    const [isPointsActive, setIsPointsActive] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    // Add these state variables to your component
    const [IsSegmentationVisible, setIsSegmentationVisible] = useState(false);
    const [segmentationMetadata, setSegmentationMetadata] = useState(null);
    const segmentationDicomRef = useRef(null);



    // name: Internal name of the tool, used by cornerstone-tools.
    // label: User-friendly label (for buttons).
    const toolList = [
        { name: "Pan", label: "Pan", icon: Move },
        { name: "Zoom", label: "Zoom", icon: Search },
        { name: "Wwwc", label: "Brightness/Contrast", icon: Sun },
        { name: "Length", label: "Measure Length", icon: Ruler },
        { name: "RectangleRoi", label: "Rectangle ROI", icon: Square },
        { name: "EllipticalRoi", label: "Elliptical ROI", icon: Circle },
        { name: "Angle", label: "Angle", icon: DraftingCompass  },
        // { name: "FreehandRoi", label: "Polyline", icon: SquareDashedMousePointer }, // Add Polyline Tool

    ];

    // Event listener for mouse movement
    useEffect(() => {
        function updateMousePosition(event) {
            const bounds = dicomImageRef.current.getBoundingClientRect();
            const x = event.clientX - bounds.left;
            const y = event.clientY - bounds.top;
            setCursorPos({x, y});
        }

        const element = dicomImageRef.current;
        element.addEventListener('mousemove', updateMousePosition);

        return () => element.removeEventListener('mousemove', updateMousePosition);
    }, []);

//     // 🎯 NEW: Separate Cursor Tracking for Split-Screen Viewer
    useEffect(() => {
        function attachMouseMove(viewerRef, setCursorPos) {
            function updateCursorPosition(event) {
                if (!viewerRef.current) return;
                const bounds = viewerRef.current.getBoundingClientRect();
                const x = Math.max(0, Math.min(event.clientX - bounds.left, bounds.width));
                const y = Math.max(0, Math.min(event.clientY - bounds.top, bounds.height));
                setCursorPos({ x, y });
            }

            if (viewerRef.current) {
                viewerRef.current.addEventListener('mousemove', updateCursorPosition);
            }

            return () => {
                if (viewerRef.current) {
                    viewerRef.current.removeEventListener('mousemove', updateCursorPosition);
                }
            };
        }

        const removeMain = attachMouseMove(dicomImageRef, setCursorPos);
        const removeSplit1 = attachMouseMove(splitScreen1Ref, setSplitScreen1CursorPos);
        const removeSplit2 = attachMouseMove(splitScreen2Ref, setSplitScreen2CursorPos);
        const removeSplit3 = attachMouseMove(splitScreen3Ref, setSplitScreen3CursorPos);

        return () => {
            removeMain();
            removeSplit1();
            removeSplit2();
            removeSplit3();
        };
    }, [isFourSplitView, isSplitView]);


    useEffect(() => {
        if (!activeTool) return;

        const allViewers = [dicomImageRef, splitScreen1Ref, splitScreen2Ref, splitScreen3Ref];

        allViewers.forEach(viewerRef => {
            if (viewerRef.current && cornerstone.getEnabledElements().some(el => el.element === viewerRef.current)) {
                cornerstoneTools.setToolActiveForElement(viewerRef.current, activeTool, { mouseButtonMask: 1 });
            }
        });

        console.log(`Reapplied ${activeTool} to all viewers`);

    }, [activeTool, isFourSplitView, isSplitView]); // Runs when tool or mode changes



    const drawOverlayText = (canvasRef, viewerRef, metadata, cursorPos) => {
        if (!canvasRef.current || !viewerRef.current) return;

        const canvasElement = canvasRef.current;
        const viewerElement = viewerRef.current;

        if (!(canvasElement instanceof HTMLCanvasElement)) {
            console.warn("Canvas element is not properly initialized:", canvasRef);
            return;
        }

        const ctx = canvasElement.getContext('2d');
        if (!ctx) {
            console.warn("Could not get 2D context for canvas:", canvasElement);
            return;
        }

        const { width, height } = viewerElement.getBoundingClientRect();
        canvasElement.width = width;
        canvasElement.height = height;

        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        if (!showCanvasText || !metadata) return;

        ctx.font = '14px Arial';
        ctx.fillStyle = "rgba(74, 160, 206)";

        const leftTexts = [
            `Image: ${metadata['(0020, 0013)']?.value || 'N/A'}`,
            `Series: ${metadata['(0020, 0011)']?.value || 'N/A'}`,
            `Total Instances: ${groupedSeries[metadata['(0020, 0011)']?.value]?.length || '1'}`
        ];
        const leftPadding = 15;
        const textBaseY = 20;
        const lineHeight = 20;

        leftTexts.forEach((text, index) => {
            ctx.fillText(text, leftPadding, textBaseY + (lineHeight * index));
        });

        const rightTexts = [
            `${metadata['(0010, 0010)']?.value || ' '}`,
            `${metadata['(0010, 0020)']?.value || ' '}`,
            `${metadata['(0020, 0010)']?.value || ' '}`,
            `${metadata['(0008, 1030)']?.value || ' '}`,
            `${metadata['(0008, 103E)']?.value || ' '}`
        ];
        const rightPadding = 10;

        rightTexts.forEach((text, index) => {
            const textWidth = ctx.measureText(text).width;
            const x = width - textWidth - rightPadding;
            const y = textBaseY + (lineHeight * index);
            ctx.fillText(text, x, y);
        });

        const bottomLeftTexts = [
            `T: ${metadata['(0018, 0050)']?.value || 'N/A'}, L: ${metadata['(0020, 1041)']?.value || 'N/A'}`,
            `WL: ${metadata['(0028, 1050)']?.value || 'N/A'}, WW: ${metadata['(0028, 1051)']?.value || 'N/A'}`,
            `X=${cursorPos.x.toFixed(0)}, Y=${cursorPos.y.toFixed(0)}`
        ];

        bottomLeftTexts.forEach((text, index) => {
            ctx.fillText(text, leftPadding, height - 15 - (index * lineHeight));
        });

        const bottomRightTexts = [
            `${metadata['(0008, 002A)']?.value || metadata['(0008, 0022)']?.value + ' ' + metadata['(0008, 0032)']?.value || 'N/A'}`,
            `TR: ${metadata['(0018, 0080)']?.value || 'N/A'}  TE: ${metadata['(0018, 0081)']?.value || 'N/A'}`
        ];
        const rightPadding2 = 10;
        const bottomPadding2 = 15;

        bottomRightTexts.forEach((text, index) => {
            const textWidth = ctx.measureText(text).width;
            const x = width - textWidth - rightPadding2;
            const y = height - bottomPadding2 - (index * lineHeight);
            ctx.fillText(text, x, y);
        });
    };

    function resizeAllViewers() {
        const allViewers = [dicomImageRef, splitScreen1Ref, splitScreen2Ref, splitScreen3Ref];

        allViewers.forEach(viewerRef => {
            if (viewerRef.current) {
                cornerstone.resize(viewerRef.current, true);
            }
        });
    }



    useEffect(() => {
        function enableViewer(viewerRef) {
            if (viewerRef.current && !cornerstone.getEnabledElements().some(el => el.element === viewerRef.current)) {
                cornerstone.enable(viewerRef.current);
            }
        }

        function disableViewer(viewerRef) {
            if (viewerRef.current && cornerstone.getEnabledElements().some(el => el.element === viewerRef.current)) {
                cornerstone.disable(viewerRef.current);
            }
        }

        setTimeout(() => { // Ensure that enabling and disabling happens after mode switch
            if (isFourSplitView) {
                enableViewer(splitScreen1Ref);
                enableViewer(splitScreen2Ref);
                enableViewer(splitScreen3Ref);
                enableViewer(dicomImageRef);
                resizeAllViewers();
            } else if (isSplitView) {
                enableViewer(splitScreen1Ref);
                enableViewer(dicomImageRef);
                disableViewer(splitScreen2Ref);
                disableViewer(splitScreen3Ref);
                resizeAllViewers();
            } else {
                // Switching back to single screen
                enableViewer(dicomImageRef); // 🔥 Ensure main viewer is enabled
                disableViewer(splitScreen1Ref);
                disableViewer(splitScreen2Ref);
                disableViewer(splitScreen3Ref);
                resizeAllViewers(); // 🔥 Force resize to fix layout issues
            }
        }, 500); // Small delay ensures mode switch completes before enabling/disabling viewers
    }, [isSplitView, isFourSplitView, viewerKey]);



    useEffect(() => {
        // Ensure the canvas exists before drawing
        if (dicomCanvasRef.current && dicomImageRef.current) {
            drawOverlayText(dicomCanvasRef, dicomImageRef, metadata, cursorPos);
        }

        if (isFourSplitView) {
            if (splitScreen1CanvasRef.current && splitScreen1Ref.current) {
                drawOverlayText(splitScreen1CanvasRef, splitScreen1Ref, splitScreen1Metadata, splitScreen1CursorPos);
            }
            if (splitScreen2CanvasRef.current && splitScreen2Ref.current) {
                drawOverlayText(splitScreen2CanvasRef, splitScreen2Ref, splitScreen2Metadata, splitScreen2CursorPos);
            }
            if (splitScreen3CanvasRef.current && splitScreen3Ref.current) {
                drawOverlayText(splitScreen3CanvasRef, splitScreen3Ref, splitScreen3Metadata, splitScreen3CursorPos);
            }
        } else if (isSplitView) {
            if (splitScreen1CanvasRef.current && splitScreen1Ref.current) {
                drawOverlayText(splitScreen1CanvasRef, splitScreen1Ref, splitScreen1Metadata, splitScreen1CursorPos);
            }
        }
    }, [
        metadata, cursorPos, showCanvasText, isSplitView, isFourSplitView,
        splitScreen1Metadata, splitScreen2Metadata, splitScreen3Metadata,
        splitScreen1CursorPos, splitScreen2CursorPos, splitScreen3CursorPos
    ]);



    useEffect(() => {
        if (dicomImageRef.current) {
            cornerstone.enable(dicomImageRef.current);
            toolList.forEach(tool => {
                cornerstoneTools.addTool(cornerstoneTools[`${tool.name}Tool`]);
            });

            cornerstoneTools.init({
                // Any global configuration
            });

            // Add specific tools
            cornerstoneTools.addTool(cornerstoneTools.BrushTool);


            const element = dicomImageRef.current;
            // Add our custom PointPlacerTool
            cornerstoneTools.addTool(PointPlacerTool);

            // IMPORTANT: Register event listener for rendering
            element.addEventListener('cornerstoneimagerendered', function(evt) {
                // Get tool instance
                const toolInstance = cornerstoneTools.getToolForElement(element, 'PointPlacer');
                if (toolInstance) {
                    // Call renderToolData manually
                    toolInstance.renderToolData(evt);
                }
            });

            // Set up a console log to debug tool activation
            const activatePointPlacerTool = () => {
                cornerstoneTools.setToolActiveForElement(element, 'PointPlacer', { mouseButtonMask: 1 });
                console.log('PointPlacer tool activated');
            };


        }
    }, []);

    const drawPoints = (canvasRef, points) => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height); // Clear previous drawings

        context.fillStyle = 'red'; // Set the color for the points
        points.forEach(point => {
            context.beginPath();
            context.arc(point.x, point.y, 5, 0, 2 * Math.PI); // Draw circle for each point
            context.fill();
        });

        // Trigger Cornerstone to update the view
        const enabledElement = cornerstone.getEnabledElement(dicomImageRef.current);
        if (enabledElement && enabledElement.image) {
            cornerstone.updateImage(dicomImageRef.current);
        }
    };

    useEffect(() => {
        if (points.length > 0) {
            drawPoints(dicomCanvasRef, points); // Assuming 'points' is your state holding the array of points
        }
    }, [points]); // Redraw whenever the points array changes


// Effect hook to enable the processed DICOM viewer after the component is mounted
    useEffect(() => {
        if (processedDicomRef.current) {
            cornerstone.enable(processedDicomRef.current); // Enable the viewer
        }
    }, [processedDicomRef]); // Only run when the ref is attached

    useEffect(() => {
        if (splitScreen1Ref.current) {
            cornerstone.enable(splitScreen1Ref.current); // Enable the second viewer

        }
    }, [isSplitView]); // Only run when split-screen mode changes



    useEffect(() => {
        if (processedSeries.length > 0) {
            displayProcessedDicom(processedSeries[processedCurrentIndex]);
        }
    }, [processedCurrentIndex, processedSeries]); // Trigger display when index or series changes


    // Debounced Key Press Handling
    const handleKeyDown = (event) => {
        // Check if event is related to navigation (left or right arrow keys)
        if (event.key === 'ArrowLeft') {
            console.log("Left Arrow pressed");
            handlePreviousImage();
        } else if (event.key === 'ArrowRight') {
            console.log("Right Arrow pressed");
            handleNextImage();
        }
    };

    useEffect(() => {
        // Listen for keydown events on window
        window.addEventListener('keydown', handleKeyDown);

        // Cleanup the event listener when the component unmounts
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [currentFileIndex, uploadedFiles]);  // Re-run the effect when these values change


    const handleNextImage = () => {
        if (isSynced) {
            console.log("Sync mode: Incrementing all viewers together");

            // if (currentFileIndex < uploadedFiles.length - 1) {
            setCurrentFileIndex(prevIndex => prevIndex + 1);
            // }

            // if (splitViewer1Index < uploadedFiles.length - 1) {
            setSplitViewer1Index(prevIndex => prevIndex + 1);
            // }

            // if (splitViewer2Index < uploadedFiles.length - 1) {
            setSplitViewer2Index(prevIndex => prevIndex + 1);
            // }

            // if (splitViewer3Index < uploadedFiles.length - 1) {
            setSplitViewer3Index(prevIndex => prevIndex + 1);
            // }

        } else {
            if (activeViewer === "main" && currentFileIndex < uploadedFiles.length - 1) {
                setCurrentFileIndex(prevIndex => prevIndex + 1);
            } else if (activeViewer === "split1" && splitViewer1Index < uploadedFiles.length - 1) {
                setSplitViewer1Index(prevIndex => prevIndex + 1);
            } else if (activeViewer === "split2" && splitViewer2Index < uploadedFiles.length - 1) {
                setSplitViewer2Index(prevIndex => prevIndex + 1);
            } else if (activeViewer === "split3" && splitViewer3Index < uploadedFiles.length - 1) {
                setSplitViewer3Index(prevIndex => prevIndex + 1);
            }
        }
    };

    const handlePreviousImage = () => {
        if (isSynced) {
            console.log("Sync mode: Decrementing all viewers together");

            if (currentFileIndex > 0) {
                setCurrentFileIndex(prevIndex => prevIndex - 1);
            }

            if (splitViewer1Index > 0) {
                setSplitViewer1Index(prevIndex => prevIndex - 1);
            }

            if (splitViewer2Index > 0) {
                setSplitViewer2Index(prevIndex => prevIndex - 1);
            }

            if (splitViewer3Index > 0) {
                setSplitViewer3Index(prevIndex => prevIndex - 1);
            }

        } else {
            if (activeViewer === "main" && currentFileIndex > 0) {
                setCurrentFileIndex(prevIndex => prevIndex - 1);
            } else if (activeViewer === "split1" && splitViewer1Index > 0) {
                setSplitViewer1Index(prevIndex => prevIndex - 1);
            } else if (activeViewer === "split2" && splitViewer2Index > 0) {
                setSplitViewer2Index(prevIndex => prevIndex - 1);
            } else if (activeViewer === "split3" && splitViewer3Index > 0) {
                setSplitViewer3Index(prevIndex => prevIndex - 1);
            }
        }
    };




    function activateTool(toolName) {
        // Determine which viewer is active
        const viewerElement = activeViewer === "main" ? dicomImageRef.current : splitScreen1Ref.current;

        if (!viewerElement) {
            console.error("Viewer element is null, cannot activate tool.");
            return;
        }

        // Ensure the viewer is enabled in Cornerstone
        if (!cornerstone.getEnabledElements().some(el => el.element === viewerElement)) {
            console.log(`Enabling viewer: ${activeViewer}`);
            cornerstone.enable(viewerElement);
        }

        // Remove passive mode from all tools for this specific viewer
        toolList.forEach(tool => {
            cornerstoneTools.setToolPassiveForElement(viewerElement, tool.name);
        });

        // Activate the selected tool for the active viewer
        console.log(`Activating tool: ${toolName} on ${activeViewer}`);
        cornerstoneTools.setToolActiveForElement(viewerElement, toolName, { mouseButtonMask: 1 });

        // Save the active tool
        setActiveTool(toolName);
    }

    useEffect(() => {
        if (uploadedFiles.length > 0) {
            console.log(`Loading image ${currentFileIndex} in main viewer`);
            loadDicomImage(uploadedFiles[currentFileIndex]); // Main viewer
        }
    }, [currentFileIndex, uploadedFiles]);



    useEffect(() => {
        if ((isSplitView || isFourSplitView) && uploadedFiles.length > 0) {
            console.log(`Loading image ${splitViewer1Index} in split viewer 1`);
            loadDicomImageToSplitViewer(splitScreen1Ref, uploadedFiles[splitViewer1Index], setSplitScreen1Metadata);
        }
    }, [splitViewer1Index, uploadedFiles, isSplitView, isFourSplitView]);


    useEffect(() => {
        if (isFourSplitView && uploadedFiles.length > 0) {
            console.log(`Loading image ${splitViewer2Index} in split viewer 2`);
            loadDicomImageToSplitViewer(splitScreen2Ref, uploadedFiles[splitViewer2Index], setSplitScreen2Metadata);
        }
    }, [splitViewer2Index, uploadedFiles, isFourSplitView]);

    useEffect(() => {
        if (isFourSplitView && uploadedFiles.length > 0) {
            console.log(`Loading image ${splitViewer3Index} in split viewer 3`);
            loadDicomImageToSplitViewer(splitScreen3Ref, uploadedFiles[splitViewer3Index], setSplitScreen3Metadata);
        }
    }, [splitViewer3Index, uploadedFiles, isFourSplitView]);






    function checkEnabledViewers() {
        const allViewers = [dicomImageRef, splitScreen1Ref, splitScreen2Ref, splitScreen3Ref];

        allViewers.forEach((viewerRef, index) => {
            if (viewerRef.current) {
                const isEnabled = cornerstone.getEnabledElements().some(el => el.element === viewerRef.current);
                console.log(`Viewer ${index + 1}: ${isEnabled ? "Enabled" : "Disabled"}`);
            }
        });
    }



// Call this in a button or inside an effect:
    useEffect(() => {
        checkEnabledViewers();
    }, [isFourSplitView, isSplitView]);




    useEffect(() => {
        if (!activeTool || !activeViewer) return;

        const viewerElement = activeViewer === "main" ? dicomImageRef.current : splitScreen1Ref.current;
        console.log(viewerElement)

        if (!viewerElement) return;

        // Ensure the viewer is enabled in cornerstone
        if (!cornerstone.getEnabledElements().some(el => el.element === viewerElement)) {
            cornerstone.enable(viewerElement);
        }

        // Apply the active tool to the correct viewer
        cornerstoneTools.setToolActiveForElement(viewerElement, activeTool, { mouseButtonMask: 1 });

        console.log(`Reapplied ${activeTool} to ${activeViewer} viewer`);

    }, [activeViewer, activeTool]); // Runs when switching viewers or changing tools


    async function generateThumbnail(file) {
        try {
            const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(file);
            const image = await cornerstone.loadImage(imageId);

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');

            const thumbnailWidth = 100;
            const thumbnailHeight = 100;
            canvas.width = thumbnailWidth;
            canvas.height = thumbnailHeight;

            const scale = Math.min(thumbnailWidth / image.width, thumbnailHeight / image.height);
            const scaledWidth = image.width * scale;
            const scaledHeight = image.height * scale;

            const offsetX = (thumbnailWidth - scaledWidth) / 2;
            const offsetY = (thumbnailHeight - scaledHeight) / 2;

            context.fillStyle = 'black';
            context.fillRect(0, 0, thumbnailWidth, thumbnailHeight);
            cornerstone.renderToCanvas(canvas, image);

            return canvas.toDataURL(); // Return the thumbnail as a data URL
        } catch (error) {
            console.error("Error generating thumbnail:", error);
            return null;
        }
    }


    function groupFilesBySeries(uids, uploadedFiles) {
        return uids.reduce((acc, item) => {
            const seriesNumber = item.seriesNumber || 'Unknown Series';
            if (!acc[seriesNumber]) {
                acc[seriesNumber] = [];
            }
            acc[seriesNumber].push({
                fileName: item.fileName,
                instanceNumber: item.instanceNumber || 'Unknown Instance',
                currentFileIndex: item.currentFileIndex, // Include index for navigation
                thumbnail: item.thumbnail || null, // Include thumbnail
            });
            return acc;
        }, {});
    }

    // de elly bet7sb el metadta elly betgm3ha ll b3den 3ashan te3ml series
    async function extractMetadataForFiles(files) {
        const newUids = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const formData = new FormData();
            formData.append('dicom_file', file);

            try {
                const response = await fetch('http://127.0.0.1:8000/api/upload-dicom/', {
                    method: 'POST',
                    body: formData,
                });
                const data = await response.json();

                const instanceNumber = data['(0020, 0013)']?.value || 'Unknown Instance';
                const seriesNumber = data['(0020, 0011)']?.value || 'Unknown Series';

                // Generate thumbnail for the first instance of the series
                const thumbnail = await generateThumbnail(file);

                // elly betb2a b3den grouped series
                newUids.push({
                    fileName: file.name,
                    instanceNumber,
                    seriesNumber,
                    currentFileIndex: i, // Index in the uploaded files array
                    thumbnail, // Store the thumbnail
                });
            } catch (error) {
                console.error(`Error processing file ${file.name}:`, error);
            }
        }

        setUids(newUids); // Store metadata for all files
        const grouped = groupFilesBySeries(newUids, files); // Group files by series
        console.log("Grouped Files by Series:", grouped); // Log the grouped files
        setGroupedSeries(grouped); // Update the grouped series state
    }




    async function loadDicomImageToSplitViewer(viewerRef, file, setMetadataFunction) {
        if (!file || !viewerRef.current) return;

        if (!cornerstone.getEnabledElements().some(el => el.element === viewerRef.current)) {
            cornerstone.enable(viewerRef.current);
        }

        const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(file);

        try {
            const image = await cornerstone.loadImage(imageId);
            cornerstone.displayImage(viewerRef.current, image);

            // Fetch metadata
            const formData = new FormData();
            formData.append('dicom_file', file);

            const response = await fetch('http://127.0.0.1:8000/api/extract-metadata/', {
                method: 'POST',
                body: formData,
            });

            const metadata = await response.json();
            if (!metadata.error) {
                setMetadataFunction(metadata);
            } else {
                console.error("Error fetching metadata:", metadata.error);
            }
        } catch (err) {
            console.error("Error loading image:", err);
        }
    }



    function handleDicomSelect(fileIndex) {
        switch (activeViewer) {
            case "main":
                setCurrentFileIndex(fileIndex);
                break;
            case "split1":
                setSplitViewer1Index(fileIndex);
                loadDicomImageToSplitViewer(splitScreen1Ref, uploadedFiles[fileIndex], setSplitScreen1Metadata);
                break;
            case "split2":
                setSplitViewer2Index(fileIndex);
                loadDicomImageToSplitViewer(splitScreen2Ref, uploadedFiles[fileIndex], setSplitScreen2Metadata);
                break;
            case "split3":
                setSplitViewer3Index(fileIndex);
                loadDicomImageToSplitViewer(splitScreen3Ref, uploadedFiles[fileIndex], setSplitScreen3Metadata);
                break;
            default:
                console.warn("Unknown active viewer:", activeViewer);
        }
    }


    async function handleSingleFileChange(event) {
        const file = event.target.files[0]; // Get the single selected file
        if (file && file.name.endsWith('.dcm')) {
            // Clear the previous file and reset the viewer
            setUploadedFiles([file]); // Replace the uploaded files with the new one
            setCurrentFileIndex(0); // Reset to the first file (since we're uploading only one)
            setMetadata(null); // Clear metadata from the previous file

            // Extract metadata and generate thumbnail for the new file
            await extractMetadataForFiles([file]); // Extract metadata for the new file
        } else {
            alert("Please select a valid .dcm file.");
        }
    }


    function handleFolderChange(event) {
        const files = Array.from(event.target.files).filter(file => file.name.endsWith('.dcm'));
        if (files.length > 0) {
            setUploadedFiles(files);
            setCurrentFileIndex(0); // Add this line to reset the current file index
            extractMetadataForFiles(files);
        } else {
            alert("No valid .dcm files found in the selected folder.");
        }
    }


        function loadDicomImage(file) {
            resetImageDisplay(); // Add this line at the beginning

            setMetadata(null); // Clear metadata for the new image

        // Creates a FormData object to package the file for upload
        const formData = new FormData();
        formData.append('dicom_file', file);  // Appends the DICOM file to the form data under the key 'dicom_file'

        fetch('http://127.0.0.1:8000/api/upload-dicom/', {
            method: 'POST',
            body: formData,
        })
            .then(response => response.json())  // Converts the response to JSON format
            .then(data => {   // Backend response data
                setMetadata(data);

                // Extract metadata values from the response
                // const seriesInstanceUID = data['(0020, 000E)']?.value || 'Not available';
                // const sopInstanceUID = data['(0008, 0018)']?.value || 'Not available';
                const instanceNumber = data['(0020, 0013)']?.value || 'Not available';
                const seriesNumber = data['(0020, 0011)']?.value || 'Not available';
                const studyInstanceUID = data['(0020, 000D)']?.value || 'Not available';

                const height = data['(0028, 0010)']?.value || 'Unknown';  // Rows
                const width = data['(0028, 0011)']?.value || 'Unknown';  // Columns

                console.log("height", height);
                console.log("width", width);


                // Add to UIDs list with the correct values
                const newUids = [
                    ...uids,
                    {
                        fileName: file.name,
                        // seriesInstanceUID,
                        // sopInstanceUID,
                        instanceNumber,
                        seriesNumber,
                        studyInstanceUID,


                    }
                ];
                setUids(newUids);

                // Print the UIDs for this file
                // console.log(`File: ${file.name},Instance Number: ${instanceNumber}, Series Number: ${seriesNumber} , Study Instance UID: ${studyInstanceUID} `);

                console.log(`File: ${file.name}
                Instance Number: ${instanceNumber}
                Series Number: ${seriesNumber}
                Study Instance UID: ${studyInstanceUID}`);


            })
            .catch(error => console.error('Error:', error));

        const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(file);
// Replace this section in loadDicomImage:
            cornerstone.loadImage(imageId).then(image => {
                cornerstone.displayImage(dicomImageRef.current, image);

                // Add these lines to reset viewport settings for each image
                const viewport = cornerstone.getDefaultViewportForImage(dicomImageRef.current, image);
                cornerstone.setViewport(dicomImageRef.current, viewport);

                // Initialize the stack state
                const newImageIds = [imageId];
                setStack({ imageIds: newImageIds, currentImageIndex: 0 });

                // Set up stack and brush tool
                initializeStackAndBrushTool(newImageIds);
            }).catch(err => console.error(err));
    }

    function resetImageDisplay() {
        const element = dicomImageRef.current;
        if (element) {
            // Reset any applied tools or overlays
            cornerstone.reset(element);
        }
    }

    function initializeStackAndBrushTool(imageIds) {
        const stackState = {
            currentImageIdIndex: 0, // Start at the first image
            imageIds: imageIds, // Array of all image IDs in the stack
        };

        // Initialize stack and brush tool state managers
        cornerstoneTools.addStackStateManager(dicomImageRef.current, ["stack", "brush"]);
        cornerstoneTools.addToolState(dicomImageRef.current, "stack", stackState);

        console.log("Initialized stack and brush tool with image IDs:", imageIds);
    }


    // beta3t button save processed
    function sendProcessedData() {
        const element = cornerstone.getEnabledElement(dicomImageRef.current);
        if (element && element.image) {
            const pixelData = new Uint16Array(element.image.getPixelData());
            const formData = new FormData();

            formData.append('original_dicom_path', `uploads/${uploadedFiles[currentFileIndex].name}`);
            formData.append('modified_pixel_data', new Blob([pixelData.buffer], {type: 'application/octet-stream'}), 'pixel_data.raw');

            fetch('http://127.0.0.1:8000/api/save-processed-dicom/', {
                method: 'POST',
                body: formData,
            })
                .then(response => response.json())
                .then(data => console.log('Processed DICOM saved:', data))
                .catch(error => console.error('Error:', error));
        } else {
            console.error('No valid image to process');
        }
    }


    async function sendDicomToModel(file) {
        const formData = new FormData();
        formData.append('dicom_file', file);

        try {
            const response = await fetch('http://127.0.0.1:8000/api/send-to-localizer/', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();
            setIsProcessedDicomVisible(true);

            if (data.dicom_file_data) {
                console.log("Processed DICOM file received!");

                // Decode the base64-encoded DICOM file
                const byteArray = new Uint8Array(atob(data.dicom_file_data).split("").map(char => char.charCodeAt(0)));
                const dicomBlob = new Blob([byteArray], {type: 'application/dicom'});

                // Extract metadata for the processed DICOM
                const processedMetadata = await fetchMetadata(dicomBlob);  // Call a function to fetch the metadata
                setProcessedMetadata(processedMetadata);  // Store the metadata in state

                // Display the image in the viewer
                if (processedDicomRef.current) {
                    cornerstone.enable(processedDicomRef.current);
                    const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(dicomBlob);
                    cornerstone.loadImage(imageId).then(image => {
                        cornerstone.displayImage(processedDicomRef.current, image);
                    }).catch(err => console.error(err));

                }
            } else if (data.error) {
                console.error("Error:", data.error);
            }
        } catch (error) {
            console.error("Error sending DICOM to model:", error);
        }
    }

    // Function to extract metadata for the processed DICOM
    async function fetchMetadata(dicomBlob) {
        const formData = new FormData();
        formData.append('dicom_file', dicomBlob);

        try {
            const response = await fetch('http://127.0.0.1:8000/api/extract-metadata/', {
                method: 'POST',
                body: formData,
            });

            const metadata = await response.json();

            if (metadata.error) {
                console.error('Error extracting metadata:', metadata.error);
                return null;
            }

            return metadata;

        } catch (error) {
            console.error('Error extracting metadata:', error);
            return null;
        }
    }

    function handleShowMetadata() {
        setIsOriginalMetadataTableOpen(true)
        setShowCanvasText(false)
    }

    function handleCloseMetadata() {
        setIsOriginalMetadataTableOpen(false)
        setShowCanvasText(true)
    }


    function handleShowMetadataModel() {
        if (!processedMetadata) {
            alert("No metadata available for the processed file.");
            return;
        }
        setIsProcessedMetadataTableOpen(true);
        setShowCanvasText(false);
    }


    function handleCloseMetadataModel() {
        setIsProcessedMetadataTableOpen(false)
        setShowCanvasText(true)
    }


    const sendSeriesToModel = async (groupedSeries, currentFileIndex) => {
        const originalSeriesNumber = Object.keys(groupedSeries).find((series) =>
            groupedSeries[series].some((file) => file.currentFileIndex === currentFileIndex)
        );

        if (!originalSeriesNumber) {
            alert("Could not find the series for the current file.");
            return;
        }

        const seriesFiles = groupedSeries[originalSeriesNumber].map(
            (dicomFile) => uploadedFiles[dicomFile.currentFileIndex]
        );

        if (seriesFiles.length === 0) {
            alert("No files found in the series.");
            return;
        }

        const formData = new FormData();
        seriesFiles.forEach((file, index) => {
            formData.append(`dicom_file_${index}`, file);
        });

        try {
            const response = await fetch('http://127.0.0.1:8000/api/send-series-to-model/', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();
            setIsProcessedDicomVisible(true);

            if (data.processed_files) {
                console.log("Processed series received!");

                // Generate thumbnails for processed files and group by new series number
                const processedGroupedSeriesData = {};
                await Promise.all(
                    data.processed_files.map(async (file) => {
                        // Decode the base64 file data
                        const byteArray = new Uint8Array(
                            atob(file.file_data).split("").map((char) => char.charCodeAt(0))
                        );
                        const dicomBlob = new Blob([byteArray], {type: "application/dicom"});

                        // Generate a thumbnail for the processed file
                        const thumbnail = await generateThumbnail(dicomBlob);

                        // Use the new series number for grouping
                        const seriesNumber = file.metadata.series_number;
                        if (!processedGroupedSeriesData[seriesNumber]) {
                            processedGroupedSeriesData[seriesNumber] = [];
                        }

                        processedGroupedSeriesData[seriesNumber].push({
                            fileName: file.file_name,
                            instanceNumber: file.metadata.instance_number,
                            seriesNumber: file.metadata.series_number,
                            currentFileIndex: uploadedFiles.length + processedGroupedSeriesData[seriesNumber].length, // Ensure index does not overlap
                            thumbnail, // Store the generated thumbnail
                        });
                    })
                );

                setProcessedGroupedSeries(processedGroupedSeriesData); // Update processedGroupedSeries state
                setProcessedSeries(data.processed_files); // Update processed series for navigation

                // Display the first file from the processed series
                displayProcessedDicom(data.processed_files[0]);
            } else if (data.error) {
                console.error("Error:", data.error);
            }
        } catch (error) {
            console.error("Error sending series to model:", error);
        }
    };


    const displayProcessedDicom = async (processedFile) => {
        try {
            // Decode the base64-encoded file data
            const byteArray = new Uint8Array(
                atob(processedFile.file_data).split("").map((char) => char.charCodeAt(0))
            );
            const dicomBlob = new Blob([byteArray], {type: "application/dicom"});

            // Extract metadata for the processed DICOM
            const metadata = await fetchMetadata(dicomBlob);
            setProcessedMetadata(metadata); // Update metadata state

            if (processedDicomRef.current) {
                cornerstone.enable(processedDicomRef.current);
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(dicomBlob);
                cornerstone.loadImage(imageId).then((image) => {
                    cornerstone.displayImage(processedDicomRef.current, image);
                }).catch((err) => console.error("Error loading image:", err));
            }
        } catch (error) {
            console.error("Error displaying processed DICOM:", error);
        }
    };

    const handleNextImageProcessed = () => {
        if (processedCurrentIndex < processedSeries.length - 1) {
            const nextIndex = processedCurrentIndex + 1;
            setProcessedCurrentIndex(nextIndex);
            displayProcessedDicom(processedSeries[nextIndex]); // Update displayed image and metadata
        }
    };

    const handlePreviousImageProcessed = () => {
        if (processedCurrentIndex > 0) {
            const prevIndex = processedCurrentIndex - 1;
            setProcessedCurrentIndex(prevIndex);
            displayProcessedDicom(processedSeries[prevIndex]); // Update displayed image and metadata
        }
    };



    const getViewerSize = (isMainViewer) => {
        if (isVerticalSplit) {
            return "h-[50%]"; // 2x1 Matrix (Stacked Mode)
        }

        // Side-by-Side Mode
        if (isSplitView) {
            return isMainViewer
                ? (IsProcessedDicomVisible ? "w-[75%]" : "w-1/2")
                : (IsProcessedDicomVisible ? "w-[25%]" : "w-1/2");
        }

        return "w-full"; // No split screen, Main Viewer takes full width
    };

    const handleSelection = (mode) => {
        if (mode === "1x2") {
            setIsSplitView(true);
            setIsVerticalSplit(false);
            setIsFourSplitView(false);
            setSelectedMode("1x2 Split View");
        } else if (mode === "2x1") {
            setIsSplitView(false);
            setIsVerticalSplit(true);
            setIsFourSplitView(false);
            setSelectedMode("2x1 Split View");
        } else if (mode === "2x2") {
            setIsSplitView(false);
            setIsVerticalSplit(false);
            setIsFourSplitView(true);
            setSelectedMode("2x2 Split View");
        } else {
            setIsSplitView(false);
            setIsVerticalSplit(false);
            setIsFourSplitView(false);
            setSelectedMode("Single View");
        }
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


        // hena bet7ot el output fl segemnation viewer zy el localizer keda
    async function sendDicomToNnunet(file) {
        const formData = new FormData();
        formData.append('dicom_file', file);

        // Optional: Show loading state
        console.log("Sending DICOM to nnU-Net model...");

        try {
            const response = await fetch('http://127.0.0.1:8000/api/predict-dicom/', {
                method: 'POST',
                body: formData,
            });

            // Check if the response is successful
            if (!response.ok) {
                // Try to parse error message
                try {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
                } catch (parseError) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
            }

            // Check if response is a file (DICOM segmentation) or JSON error
            const contentType = response.headers.get('content-type');

            if (contentType && contentType.includes('application/dicom')) {
                // Response is the predicted segmentation DICOM file
                const blob = await response.blob();

                console.log("nnU-Net prediction completed successfully!");
                console.log("Segmentation DICOM file size:", blob.size, "bytes");

                // Show the segmentation viewer panel
                setIsSegmentationVisible(true);

                // Extract metadata for the segmentation DICOM (optional)
                const segmentationMetadata = await fetchMetadata(blob);
                setSegmentationMetadata(segmentationMetadata);

                // Load and display the segmentation DICOM in the separate viewer
                await loadAndDisplayDicomSegmentation(blob);

                // Create download link for the segmentation file (optional)
                const downloadUrl = URL.createObjectURL(blob);

                return {
                    success: true,
                    segmentationBlob: blob,
                    downloadUrl: downloadUrl,
                    message: "Segmentation completed and displayed successfully"
                };

            } else {
                // Response might be JSON with error
                const data = await response.json();
                if (data.error) {
                    throw new Error(data.error);
                }

                // Unexpected response format
                throw new Error("Unexpected response format from server");
            }

        } catch (error) {
            console.error("Error sending DICOM to nnU-Net:", error);

            // Return error information
            return {
                success: false,
                error: error.message,
                message: "Failed to process DICOM with nnU-Net"
            };
        }
    }

// Function to load and display DICOM segmentation in the separate viewer
    async function loadAndDisplayDicomSegmentation(segmentationBlob) {
        try {
            // Display the segmentation in the separate viewer
            if (segmentationDicomRef.current) {
                // Enable cornerstone for the segmentation viewer - use try/catch for enabling
                try {
                    cornerstone.getEnabledElement(segmentationDicomRef.current);
                    console.log("Segmentation viewer already enabled");
                } catch (error) {
                    // Element is not enabled, so enable it
                    console.log("Enabling segmentation viewer element");
                    cornerstone.enable(segmentationDicomRef.current);
                }

                // Create image ID for cornerstone
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(segmentationBlob);

                // Load and display the image
                cornerstone.loadImage(imageId).then(image => {
                    cornerstone.displayImage(segmentationDicomRef.current, image);

                    // Optional: Apply appropriate window/level for segmentation visualization
                    const viewport = cornerstone.getViewport(segmentationDicomRef.current);

                    // Adjust viewport for better segmentation visualization
                    viewport.voi.windowWidth = image.windowWidth || 256;
                    viewport.voi.windowCenter = image.windowCenter || 128;

                    cornerstone.setViewport(segmentationDicomRef.current, viewport);

                    console.log("Segmentation DICOM loaded and displayed successfully in separate viewer");
                }).catch(err => {
                    console.error("Error displaying segmentation image:", err);
                });
            } else {
                console.error("Segmentation DICOM viewer element not found");
                throw new Error("Cannot display segmentation: viewer element not available");
            }

        } catch (error) {
            console.error("Error loading segmentation DICOM:", error);
            throw error;
        }
    }
    // Update your button click handler
    const handleSendToNnunet = async () => {
        try {
            // Show loading state (optional)
            setIsProcessing(true); // You might want to add this state

            const result = await sendDicomToNnunet(uploadedFiles[currentFileIndex]);

            if (result.success) {
                console.log("Segmentation completed:", result.message);
                // The segmentation is already displayed in the main viewer

            } else {
                console.error("Segmentation failed:", result.error);

            }

        } catch (error) {
            console.error("Error processing segmentation:", error);


        } finally {
            // Hide loading state
            setIsProcessing(false);
        }
    };






// one button gwah drop down menu
    return (
        <div className="flex flex-col w-full h-screen">

            <nav className="bg-[#101820] text-[#76c7e8] py-2 px-4 flex items-center border-b border-[#4aa0ce] justify-between w-full">
                {/* Upload Button - Stays on Left */}
                <div className="relative mr-10"> {/* Margin to push buttons left */}
                    <button
                        onClick={() => setShowUploadDropdown(!showUploadDropdown)}
                        className="flex flex-col items-center text-[#76c7e8] transition-all duration-200 hover:text-[#4aa0ce]"
                    >
                        <Upload size={20} strokeWidth={1.5}/>
                        <span className="text-xs mt-1">Upload</span>
                    </button>

                    {showUploadDropdown && (
                        <div
                            className="absolute mt-2 bg-[#101820] text-[#76c7e8] rounded-md shadow-lg border border-[#4aa0ce] backdrop-blur-md w-40">
                            <div className="flex flex-col gap-1 py-2 px-3 text-sm">
                                <label
                                    className="flex items-center gap-2 p-2 rounded cursor-pointer transition-all duration-200 hover:bg-[#1a78a7] hover:text-white">
                                    <input
                                        type="file"
                                        onChange={(event) => {
                                            handleSingleFileChange(event);
                                            setShowUploadDropdown(false);
                                        }}
                                        accept=".dcm"
                                        className="hidden"
                                    />
                                    📂 Upload File
                                </label>
                                <label
                                    className="flex items-center gap-2 p-2 rounded cursor-pointer transition-all duration-200 hover:bg-[#1a78a7] hover:text-white">
                                    <input
                                        type="file"
                                        onChange={(event) => {
                                            handleFolderChange(event);
                                            setShowUploadDropdown(false);
                                        }}
                                        accept=".dcm"
                                        multiple
                                        webkitdirectory=""
                                        className="hidden"
                                    />
                                    📁 Upload Folder
                                </label>
                            </div>
                        </div>
                    )}
                </div>

                {/* All Buttons Shifted Left */}
                <div className="flex items-center space-x-4 justify-start">

                    {/* Tool Buttons */}
                    <div className="flex space-x-4">
                        {toolList.map((tool) => {
                            const Icon = tool.icon;
                            return (
                                <button
                                    key={tool.name}
                                    onClick={() => activateTool(tool.name)}
                                    disabled={isDisabled}
                                    className={`flex flex-col items-center transition-all duration-200 mt-1 ${
                                        isDisabled
                                            ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                                            : activeTool === tool.name
                                                ? "text-[#1a78a7]"
                                                : "text-[#76c7e8] hover:text-[#4aa0ce]"
                                    }`}
                                >
                                    <Icon size={20} strokeWidth={1.5}/>
                                    <span className="text-xs mt-1">{tool.label}</span>
                                </button>
                            );
                        })}


                        <button
                            onClick={() => {
                                const element = dicomImageRef.current;
                                cornerstoneTools.setToolActiveForElement(element, 'PointPlacer', {mouseButtonMask: 1});
                                setIsPointsActive(true);
                                console.log('PointPlacer tool activated');
                            }}
                            disabled={isDisabled}
                            className={`flex flex-col items-center transition-all duration-200 ${
                                isDisabled
                                    ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                                    : "text-[#76c7e8] hover:text-[#4aa0ce]"
                            }`}
                        >
                            <SquareDashedMousePointer size={20} strokeWidth={1.5} className="mt-1"/>
                            <span className="text-xs mt-1">Points</span>
                        </button>

                        {isPointsActive && (
                            <button
                                onClick={() => {
                                    try {
                                        const element = dicomImageRef.current;
                                        const toolInstance = cornerstoneTools.getToolForElement(element, 'PointPlacer');
                                        if (toolInstance) {
                                            toolInstance.clearPoints(element);
                                            setIsPointsActive(false); // Hide clear button after clearing
                                            console.log('Points cleared');
                                        } else {
                                            console.log('PointPlacer tool not found');
                                        }
                                    } catch (error) {
                                        console.error('Error clearing points:', error);
                                    }
                                }}
                                disabled={isDisabled}
                                className={`flex flex-col items-center transition-all duration-200 ${
                                    isDisabled
                                        ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                                        : "text-red-400 hover:text-red-300"
                                }`}
                            >
                                <X size={20} strokeWidth={1.5} className="mt-1"/>
                                <span className="text-xs mt-1">Clear</span>
                            </button>
                        )}


                        <BrushColorDropdown
                            dicomImageRef={dicomImageRef}
                            isDisabled={isDisabled}
                            segmentationDicomRef={segmentationDicomRef}
                        />


                        <BrushNavbarControls
                            dicomImageRef={dicomImageRef}
                            isDisabled={isDisabled}
                        />

                    </div>



                    {/* Show Metadata Button */}
                    <button
                        onClick={handleShowMetadata}
                        disabled={isDisabled}
                        className={`flex flex-col items-center transition-all duration-200 ${
                            isDisabled
                                ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                                : "text-[#76c7e8] hover:text-[#4aa0ce]"
                        }`}
                    >
                        <BookOpenText size={20} strokeWidth={1.5} className="mt-1"/>
                        <span className="text-xs mt-1">Metadata</span>
                    </button>

                    {/* Send Buttons */}
                    <button
                        onClick={() => sendDicomToModel(uploadedFiles[currentFileIndex])}
                        disabled={isDisabled}
                        className={`flex flex-col items-center transition-all duration-200 ${
                            isDisabled
                                ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                                : "text-[#76c7e8] hover:text-[#4aa0ce]"
                        }`}
                    >
                        <ArrowUp size={20} strokeWidth={1.5} className="mt-1"/>
                        <span className="text-xs mt-1">Send Image</span>
                    </button>

                    <button
                        onClick={() => sendSeriesToModel(groupedSeries, currentFileIndex)}
                        disabled={isDisabled}
                        className={`flex flex-col items-center transition-all duration-200 ${
                            isDisabled
                                ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                                : "text-[#76c7e8] hover:text-[#4aa0ce]"
                        }`}
                    >
                        <ArrowUpWideNarrow size={20} strokeWidth={1.5} className="mt-1"/>
                        <span className="text-xs mt-1">Send Series</span>
                    </button>


                    <button
                        onClick={handleSendToNnunet}
                        disabled={isDisabled || isProcessing}
                        className={`flex flex-col items-center transition-all duration-200 ${
                            isDisabled || isProcessing
                                ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                                : "text-[#76c7e8] hover:text-[#4aa0ce]"
                        }`}
                    >
                        {isProcessing ? (
                            <>
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#76c7e8]"></div>
                                <span className="text-xs mt-1">Processing...</span>
                            </>
                        ) : (
                            <>
                                <ArrowUp size={20} strokeWidth={1.5} className="mt-1"/>
                                <span className="text-xs mt-1">Segment Image</span>
                            </>
                        )}
                    </button>


                    <div className="relative">
                        <button
                            onClick={() => setShowSplitDropdown(!showSplitDropdown)}
                            disabled={isDisabled}
                            className={`flex flex-col items-center transition-all duration-200 ${
                                isDisabled ? "text-[#a1c4d8] opacity-70 cursor-not-allowed" : "text-[#76c7e8] hover:text-[#4aa0ce]"
                            }`}
                        >
                            <Grid2x2 size={20} strokeWidth={1.5} className="mt-1"/>
                            <span className="text-xs mt-1">Split View</span>
                        </button>

                        {showSplitDropdown && (
                            <div
                                className="absolute mt-2 bg-[#101820] text-[#76c7e8] rounded-md shadow-lg border border-[#4aa0ce] w-40 z-50">
                                <div className="flex flex-col gap-1 py-2 px-3 text-sm">
                                    <button
                                        onClick={() => {
                                            setIsSplitView(!isSplitView);
                                            setActiveViewer("main");
                                            setSplitScreenImage(null);
                                            setShowSplitDropdown(false);
                                        }}
                                        className="p-2 rounded transition-all duration-200 hover:bg-[#1a78a7] hover:text-white"
                                    >
                                        {isSplitView ? "Single View" : "1×2 Split"}
                                    </button>

                                    <button
                                        onClick={() => {
                                            setIsVerticalSplit(!isVerticalSplit);
                                            setShowSplitDropdown(false);
                                        }}
                                        className="p-2 rounded transition-all duration-200 hover:bg-[#1a78a7] hover:text-white"
                                    >
                                        {isVerticalSplit ? "Single View" : "2×1 Split"}
                                    </button>

                                    <button
                                        onClick={() => {
                                            if (isFourSplitView) {
                                                setIsSplitView(false);
                                                setIsVerticalSplit(false);

                                                if (splitScreen1Ref.current) cornerstone.disable(splitScreen1Ref.current);
                                                if (splitScreen2Ref.current) cornerstone.disable(splitScreen2Ref.current);
                                                if (splitScreen3Ref.current) cornerstone.disable(splitScreen3Ref.current);

                                                if (splitScreen1CanvasRef.current) splitScreen1CanvasRef.current.getContext('2d').clearRect(0, 0, splitScreen1CanvasRef.current.width, splitScreen1CanvasRef.current.height);
                                                if (splitScreen2CanvasRef.current) splitScreen2CanvasRef.current.getContext('2d').clearRect(0, 0, splitScreen2CanvasRef.current.width, splitScreen2CanvasRef.current.height);
                                                if (splitScreen3CanvasRef.current) splitScreen3CanvasRef.current.getContext('2d').clearRect(0, 0, splitScreen3CanvasRef.current.width, splitScreen3CanvasRef.current.height);

                                                setActiveViewer("main");
                                                setViewerKey(prevKey => prevKey + 1);
                                            }

                                            setIsFourSplitView(!isFourSplitView);
                                            setShowSplitDropdown(false);
                                        }}
                                        className="p-2 rounded transition-all duration-200 hover:bg-[#1a78a7] hover:text-white"
                                    >
                                        {isFourSplitView ? "Single View" : "2×2 Split"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Only show Sync button when any split view is active */}
                    {(isSplitView || isVerticalSplit || isFourSplitView) && (
                        <button
                            onClick={() => setIsSynced(!isSynced)}
                            disabled={isDisabled}
                            className={`flex flex-col items-center transition-all duration-200 ${
                                isDisabled
                                    ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                                    : isSynced
                                        ? "text-green-500"
                                        : "text-[#76c7e8] hover:text-[#4aa0ce]"
                            }`}
                        >
                            <RefreshCcw size={20} strokeWidth={1.5}/>
                            <span className="text-xs mt-1">
           {isSynced ? "Sync On" : "Sync Off"}
        </span>
                        </button>
                    )}


                    {/*Settings Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
                            disabled={isDisabled}
                            className={`flex flex-col items-center transition-all duration-200 ${
                                isDisabled
                                    ? "text-[#a1c4d8] opacity-70 cursor-not-allowed"
                                    : "text-[#76c7e8] hover:text-[#4aa0ce]"
                            }`}
                        >
                            <SlidersHorizontal size={20} strokeWidth={1.5}/>
                            <span className="text-xs mt-1">Settings</span>
                        </button>


                        {showSettingsDropdown && (
                            <div
                                className="absolute right-0 mt-2 bg-[#101820] text-[#76c7e8] rounded-md shadow-lg border border-[#4aa0ce] w-48 z-50"
                                style={{position: "absolute", top: "100%", right: "0", zIndex: 50}}
                            >
                                <div className="flex flex-col gap-2 py-2 px-3 text-sm">
                                    {/* Overlay Toggle */}
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-medium">Overlay</label>
                                        <div
                                            onClick={() => setShowCanvasText(!showCanvasText)}
                                            className={`w-8 h-4 flex items-center rounded-full p-1 cursor-pointer transition-all ${
                                                showCanvasText ? "bg-[#4aa0ce]" : "bg-gray-600"
                                            }`}
                                        >
                                            <div
                                                className={`w-3 h-3 bg-white rounded-full shadow-md transform transition-transform ${
                                                    showCanvasText ? "translate-x-4" : "translate-x-0"
                                                }`}
                                            />
                                        </div>
                                    </div>

                                    {/* Additional Settings */}
                                    <div className="text-xs opacity-50">More settings coming soon...</div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </nav>


            {/* Main Viewer Section */}
            <div className="flex flex-grow overflow-hidden">
                {/* Sidebar */}
                <div className="flex-shrink-0 w-52 h-full bg-[#101820] overflow-hidden border-r border-[#4aa0ce]">
                    <Sidebar
                        groupedSeries={groupedSeries}
                        processedGroupedSeries={processedGroupedSeries}
                        onDicomSelect={handleDicomSelect}
                        currentFileIndex={currentFileIndex}
                    />
                </div>


                {/*Viewer Layout */}
                <div className="flex flex-grow overflow-hidden">
                    {isFourSplitView ? (
                        <div className="grid grid-cols-2 grid-rows-2 w-full h-full relative ">
                            {/* Viewer 1 */}
                            <div
                                ref={splitScreen1Ref}
                                className={`border relative bg-black  ${activeViewer === "split1" ? "border-[#4aa0ce]" : "border-transparent"}`}
                                onClick={() => {
                                    console.log("split1 selected");
                                    setActiveViewer("split1");
                                }}
                            >
                                <canvas ref={splitScreen1CanvasRef}
                                        className="absolute top-0 left-0 z-10 pointer-events-none"/>


                            </div>

                            {/* Viewer 2 */}
                            <div
                                ref={splitScreen2Ref}
                                className={`border relative bg-black ${activeViewer === "split2" ? "border-[#4aa0ce]" : "border-transparent"}`}
                                onClick={() => setActiveViewer("split2")}
                            >
                                <canvas ref={splitScreen2CanvasRef}
                                        className="absolute top-0 left-0 z-10 pointer-events-none"/>
                            </div>

                            {/* Viewer 3 */}
                            <div
                                ref={splitScreen3Ref}
                                className={`border relative bg-black  ${activeViewer === "split3" ? "border-[#4aa0ce]" : "border-transparent"}`}
                                onClick={() => setActiveViewer("split3")}
                            >
                                <canvas ref={splitScreen3CanvasRef}
                                        className="absolute top-0 left-0 z-10 pointer-events-none"/>
                            </div>

                            {/* Main Viewer */}
                            <div
                                ref={dicomImageRef}
                                className={`border relative bg-black  ${activeViewer === "main" ? "border-[#4aa0ce]" : "border-transparent"}`}
                                onClick={() => setActiveViewer("main")}
                            >
                                <canvas ref={dicomCanvasRef}
                                        className="absolute top-0 left-0 z-10 pointer-events-none"/>
                            </div>
                        </div>
                    ) : (
                        <div
                            className={`flex ${isVerticalSplit ? "flex-col" : "flex-row"} flex-grow overflow-hidden`}>


                            {/* Main Viewer */}
                            <div
                                className={`transition-all duration-300 bg-black border relative
                    ${activeViewer === "main" ? "border-[#4aa0ce]" : "border-gray-500"}
                    ${getViewerSize(true)}`}
                                style={{overflow: 'hidden', position: 'relative'}}
                                onClick={() => setActiveViewer("main")}
                            >
                                <div ref={dicomImageRef} className="w-full h-full"></div>

                                <canvas ref={dicomCanvasRef}
                                        className="absolute top-0 left-0 z-10 pointer-events-none"/>

                                <DicomBrushOverlay
                                    dicomImageRef={dicomImageRef}
                                    currentImageIndex={activeViewer === "main" ? currentFileIndex :
                                        activeViewer === "split1" ? splitViewer1Index :
                                            activeViewer === "split2" ? splitViewer2Index :
                                                splitViewer3Index}
                                />
                            </div>

                            {/*Split Screen Viewer (Appears in Split Mode)*/}
                            {isSplitView && (
                                <div
                                    className={`transition-all duration-300 bg-[#101820] border relative
                        ${activeViewer === "split1" ? "border-[#4aa0ce]" : "border-transparent"}
                        ${getViewerSize(false)} flex items-center justify-center relative cursor-pointer`}
                                    style={{overflow: 'hidden', position: 'relative'}}
                                    onClick={() => setActiveViewer("split1")}
                                >
                                    <div ref={splitScreen1Ref} className="w-full h-full"
                                         onClick={() => setActiveViewer("split1")}></div>
                                    <canvas ref={splitScreen1CanvasRef}
                                            className="absolute top-0 left-0 z-10 pointer-events-none"/>
                                </div>
                            )}




                        </div>
                    )}


                    {/* Processed Viewer (Right Panel) */}
                    {IsProcessedDicomVisible && (
                        <div
                            className="flex flex-col justify-between items-center flex-shrink-0 bg-[#101820] border border-[#4aa0ce] relative"
                            style={{
                                width: isSplitView || isFourSplitView ? '25%' : '25%',
                                height: '100%',
                                overflow: 'hidden',
                            }}
                        >
                            {/* Close Button */}
                            <button
                                onClick={() => setIsProcessedDicomVisible(false)}
                                className="absolute top-2 right-2 bg-red-600 text-white px-3 py-1 text-xs rounded hover:bg-red-700"
                            >
                                ✖
                            </button>

                            {/* Processed Image Viewer */}
                            <div ref={processedDicomRef} style={{
                                width: '100%',
                                height: 'calc(100% - 60px)',
                            }}></div>

                            {/* Processed Image Navigation */}
                            <div
                                className="flex justify-center mt-2 space-x-2 p-2 bg-[#101820] w-full border-t border-[#4aa0ce]">
                                <button onClick={handlePreviousImageProcessed}
                                        className="flex items-center text-[#76c7e8] transition-all duration-200 hover:text-[#4aa0ce] mr-3">
                                    <CircleChevronLeft size={24} strokeWidth={1.5}/>
                                </button>
                                <button onClick={handleNextImageProcessed}
                                        className="flex items-center text-[#76c7e8] transition-all duration-200 hover:text-[#4aa0ce]">
                                    <CircleChevronRight size={24} strokeWidth={1.5}/>
                                </button>

                                {/* Metadata Icon */}
                                <div className="w-8"/>
                                <button onClick={handleShowMetadataModel}
                                        className="flex items-center text-[#76c7e8] transition-all duration-200 hover:text-[#4aa0ce]">
                                    <BookOpenText size={24} strokeWidth={1.5}/>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Segmentation Viewer Panel */}
                    {IsSegmentationVisible && (
                        <div
                            className="flex flex-col justify-between items-center flex-shrink-0 bg-[#101820] border border-[#4aa0ce] relative"
                            style={{
                                width: isSplitView || isFourSplitView ? '25%' : '25%',
                                height: '100%',
                                overflow: 'hidden',
                            }}
                        >
                            {/* Close Button */}
                            <button
                                onClick={() => setIsSegmentationVisible(false)}
                                className="absolute top-2 right-2 bg-red-600 text-white px-3 py-1 text-xs rounded hover:bg-red-700 z-10"
                            >
                                ✖
                            </button>


                            {/* Segmentation Image Viewer */}
                            <div
                                ref={segmentationDicomRef}
                                style={{
                                    width: '100%',
                                    height: 'calc(100% - 60px)',
                                }}
                            ></div>

                            {/* Optional: Metadata or Controls Section */}
                            <div className="w-full p-2 bg-[#0a0f14] border-t border-[#4aa0ce] text-white text-xs">
                                <div>Segmentation Result</div>
                                {segmentationMetadata && (
                                    <div className="mt-1 text-gray-400">
                                        {segmentationMetadata.studyDescription || 'nnU-Net Segmentation'}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>


            </div>


            {/* Footer */}
            <div
                className="bg-[#101820] py-2 px-4 flex justify-center space-x-16 flex-grow-0 border-t border-[#4aa0ce]">
                <button
                    onClick={handlePreviousImage}
                    disabled={currentFileIndex === 0}
                    className={`flex items-center text-[#76c7e8] transition-all duration-200 mr-11 ${
                        currentFileIndex === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:text-[#4aa0ce]'
                    }`}
                >
                    <CircleChevronLeft size={24} strokeWidth={1.5}/>
                </button>

                <button
                    onClick={handleNextImage}
                    disabled={currentFileIndex === uploadedFiles.length - 1}
                    className={`flex items-center text-[#76c7e8] transition-all duration-200 ${
                        currentFileIndex === uploadedFiles.length - 1 ? 'opacity-50 cursor-not-allowed' : 'hover:text-[#4aa0ce]'
                    }`}
                >
                    <CircleChevronRight size={24} strokeWidth={1.5}/>
                </button>

                {/* Metadata Tables */}
                <MetadataTable isOpen={isOriginalMetadataTableOpen} metadata={metadata}
                               onClose={handleCloseMetadata}/>
                <MetadataTable isOpen={isProcessedMetadataTableOpen} metadata={processedMetadata}
                               onClose={handleCloseMetadataModel}/>
            </div>


        </div>


    );


}

export default DicomViewer;
