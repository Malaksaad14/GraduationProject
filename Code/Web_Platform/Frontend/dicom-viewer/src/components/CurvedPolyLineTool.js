import csTools from 'cornerstone-tools';
import * as cornerstone from 'cornerstone-core';

// Import required internal modules properly
const BaseTool = csTools.importInternal('base/BaseTool');
const drawHandles = csTools.importInternal('drawing/drawHandles');
const getNewContext = csTools.importInternal('drawing/getNewContext');
const external = csTools.external;
const store = csTools.store;
const addToolState = csTools.addToolState;
const getToolState = csTools.getToolState;

// Create a point tool that connects points with smooth curves
class PointPlacerTool extends BaseTool {
    constructor(props = {}) {
        const defaultProps = {
            name: 'PointPlacer',
            supportedInteractionTypes: ['Mouse'],
            configuration: {
                drawHandlesOnHover: false,
                hideHandlesIfMoving: false,
                pointColor: 'red',
                lineColor: 'blue',
                activeColor: 'red',
                handleRadius: 6,
                lineWidth: 2,
                showPoints: true,
                // If you want to adjust how "curved" the lines are, you can modify the curveTension
                curveTension: 0.9  // Controls curve smoothness (0 = straight, 1 = very curved)
                // curveTension: 0.8  // Controls curve smoothness (0 = straight, 1 = very curved)

            }
        };

        super(props, defaultProps);
    }

    // This is called when the tool is activated and the user clicks
    preMouseDownCallback(evt) {
        console.log('PointPlacer: preMouseDownCallback called');
        const eventData = evt.detail;
        const element = eventData.element;

        // Get the current image
        const image = cornerstone.getImage(element);
        if (!image) return false;

        // Get existing tool state or create a new one
        let toolState = getToolState(element, this.name);

        if (!toolState) {
            // If no tool state exists at all, initialize it first
            toolState = {
                data: []
            };
            addToolState(element, this.name, toolState);
        }

        // Check if we have any data objects
        if (!toolState.data || toolState.data.length === 0) {
            // Create our first data object for points
            toolState.data.push({
                visible: true,
                active: true,
                color: this.configuration.pointColor,
                lineColor: this.configuration.lineColor,
                lineWidth: this.configuration.lineWidth,
                handles: {
                    points: [] // Array to store all points
                }
            });
        }

        // Get the first data object (our curve)
        const data = toolState.data[0];

        // Initialize points array if it doesn't exist
        if (!data.handles) {
            data.handles = {};
        }
        if (!data.handles.points) {
            data.handles.points = [];
        }

        // Add the new point to our points array
        data.handles.points.push({
            x: eventData.currentPoints.image.x,
            y: eventData.currentPoints.image.y,
            active: true,
            highlight: true
        });

        console.log('Added point. Total points:', data.handles.points.length);

        // Update the image to show the new point and curve
        cornerstone.updateImage(element);

        // Prevent further event propagation
        evt.stopImmediatePropagation();
        return true;
    }

    // Helper function to draw a curved line between two points
    drawCurvedLine(context, p1, p2, tension = 0.5) {
        // Calculate control points for the curve
        const cp1x = p1.x + (p2.x - p1.x) / 3;
        const cp1y = p1.y + (p2.y - p1.y) / 6 * tension;
        const cp2x = p2.x - (p2.x - p1.x) / 3;
        const cp2y = p2.y - (p2.y - p1.y) / 6 * tension;

        // Draw the bezier curve
        context.beginPath();
        context.moveTo(p1.x, p1.y);
        context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        context.stroke();
    }

    // This is called on every image render
    renderToolData(evt) {
        const eventData = evt.detail;
        const element = eventData.element;

        // Get tool state
        const toolState = getToolState(element, this.name);
        if (!toolState || !toolState.data || !toolState.data.length) return;

        // Get canvas context
        const context = getNewContext(eventData.canvasContext.canvas);

        // For each data object in our toolState
        toolState.data.forEach(data => {
            // Handle cases where data structure might be missing
            if (!data || !data.handles) return;

            const points = data.handles.points || [];

            // Only proceed if we have points
            if (!points.length) return;

            // Draw points if enabled
            if (this.configuration.showPoints) {
                drawHandles(context, eventData, points, {
                    handleRadius: this.configuration.handleRadius,
                    color: data.color || this.configuration.pointColor,
                    fill: true
                });
            }

            // Draw curved segments between consecutive points
            if (points.length >= 2) {
                // Set line properties
                context.strokeStyle = data.lineColor || this.configuration.lineColor;
                context.lineWidth = data.lineWidth || this.configuration.lineWidth;

                // Draw curved segments between consecutive points
                for (let i = 0; i < points.length - 1; i++) {
                    // Get current and next point in canvas coordinates
                    const current = cornerstone.pixelToCanvas(element, points[i]);
                    const next = cornerstone.pixelToCanvas(element, points[i + 1]);

                    // Draw a curved line between consecutive points
                    this.drawCurvedLine(
                        context,
                        current,
                        next,
                        this.configuration.curveTension
                    );
                }
            }
        });
    }

    // Method to clear all points
    clearPoints(element) {
        // Remove the existing toolState
        const toolState = getToolState(element, this.name);
        if (toolState && toolState.data) {
            toolState.data = [{
                visible: true,
                active: true,
                color: this.configuration.pointColor,
                lineColor: this.configuration.lineColor,
                lineWidth: this.configuration.lineWidth,
                handles: {
                    points: [] // Empty points array
                }
            }];
        }

        // Update the image
        cornerstone.updateImage(element);
    }
}

export default PointPlacerTool;