/**
 * Utility to calculate Anatomical Patient Orientation (A/P/L/R/S/I)
 * for DICOM and NIfTI slices, including interactive view rotation.
 */

// Helper to convert a 3D direction vector in DICOM patient coordinates to anatomical letters
// In DICOM: +X = Left (L), -X = Right (R), +Y = Posterior (P), -Y = Anterior (A), +Z = Superior (S), -Z = Inferior (I)
function vectorToDicomDirection(v) {
    if (!v || v.length < 3) return '';
    const [x, y, z] = v;
    const absX = Math.abs(x);
    const absY = Math.abs(y);
    const absZ = Math.abs(z);

    const axes = [
        { letter: x < 0 ? 'R' : 'L', val: absX },
        { letter: y < 0 ? 'A' : 'P', val: absY },
        { letter: z < 0 ? 'I' : 'S', val: absZ },
    ];
    axes.sort((a, b) => b.val - a.val);

    let res = '';
    if (axes[0].val > 0.15) {
        res += axes[0].letter;
    }
    // Secondary axis if slice is oblique
    if (axes[1].val > 0.4 && axes[1].val > axes[0].val * 0.45) {
        res += axes[1].letter;
    }
    return res;
}

// Helper to convert a 3D direction vector in NIfTI RAS coordinates to anatomical letters
// In NIfTI RAS: +X = Right (R), -X = Left (L), +Y = Anterior (A), -Y = Posterior (P), +Z = Superior (S), -Z = Inferior (I)
function vectorToNiftiDirection(v) {
    if (!v || v.length < 3) return '';
    const [x, y, z] = v;
    const absX = Math.abs(x);
    const absY = Math.abs(y);
    const absZ = Math.abs(z);

    const axes = [
        { letter: x > 0 ? 'R' : 'L', val: absX },
        { letter: y > 0 ? 'A' : 'P', val: absY },
        { letter: z > 0 ? 'S' : 'I', val: absZ },
    ];
    axes.sort((a, b) => b.val - a.val);

    let res = '';
    if (axes[0].val > 0.15) {
        res += axes[0].letter;
    }
    if (axes[1].val > 0.4 && axes[1].val > axes[0].val * 0.45) {
        res += axes[1].letter;
    }
    return res;
}

/**
 * Detect anatomical plane name from normal vector and series filename
 */
function detectAnatomicalPlane(norm, filename = '') {
    const fn = (filename || '').toLowerCase();
    if (fn.includes('sa') || fn.includes('short_axis') || fn.includes('short axis')) return 'Short Axis (SA)';
    if (fn.includes('4ch') || fn.includes('4_chamber') || fn.includes('four_chamber')) return '4-Chamber (4CH)';
    if (fn.includes('2ch') || fn.includes('2_chamber') || fn.includes('two_chamber')) return '2-Chamber (2CH)';
    if (fn.includes('3ch') || fn.includes('lvot')) return '3-Chamber / LVOT';
    if (fn.includes('localizer') || fn.includes('scout')) return 'Localizer';

    if (norm && norm.length >= 3) {
        const [nx, ny, nz] = norm.map(Math.abs);
        if (nz >= nx && nz >= ny) return 'Axial';
        if (nx >= ny && nx >= nz) return 'Sagittal';
        if (ny >= nx && ny >= nz) return 'Coronal';
    }
    return 'Axial';
}

/**
 * Calculate anatomical labels (Top, Bottom, Left, Right) and plane name.
 * 
 * @param {Object} parsed - Parsed image object
 * @param {number} sliceIndex - Current slice index
 * @param {number} timeFrameIndex - Current time frame index
 * @param {number} rotation - Current rotation in degrees (0, 90, 180, 270)
 * @returns {Object} { top, bottom, left, right, plane, rotation, angleDesc, fullLabels }
 */
export function getAnatomicalOrientation(parsed, sliceIndex = 0, timeFrameIndex = 0, rotation = 0) {
    const normRot = ((rotation % 360) + 360) % 360;

    // Default base labels for cardiac short axis / radiological axial view
    let baseTop = 'A';
    let baseBottom = 'P';
    let baseLeft = 'R';
    let baseRight = 'L';
    let plane = detectAnatomicalPlane(null, parsed?.filename);

    const sliceInfo = parsed?.getSliceInfo ? parsed.getSliceInfo(sliceIndex, timeFrameIndex) : null;

    if (parsed?.type === 'dicom') {
        const iopStr = sliceInfo?.imageOrientationPatient || parsed?.imageOrientationPatient;
        if (iopStr) {
            const o = typeof iopStr === 'string' ? iopStr.split('\\').map(Number) : iopStr;
            if (Array.isArray(o) && o.length >= 6 && o.some((v) => v !== 0)) {
                const r = [o[0], o[1], o[2]]; // row vector (left to right)
                const c = [o[3], o[4], o[5]]; // col vector (top to bottom)

                baseRight = vectorToDicomDirection(r) || 'L';
                baseLeft = vectorToDicomDirection([-r[0], -r[1], -r[2]]) || 'R';
                baseBottom = vectorToDicomDirection(c) || 'P';
                baseTop = vectorToDicomDirection([-c[0], -c[1], -c[2]]) || 'A';

                const nx = r[1] * c[2] - r[2] * c[1];
                const ny = r[2] * c[0] - r[0] * c[2];
                const nz = r[0] * c[1] - r[1] * c[0];
                plane = detectAnatomicalPlane([nx, ny, nz], parsed.filename);
            }
        }
    } else if (parsed?.type === 'nifti') {
        const affine = sliceInfo?.affine || parsed?.affine;
        if (affine && Array.isArray(affine) && affine.length >= 3) {
            const r = [affine[0][0], affine[1][0], affine[2][0]];
            const c = [affine[0][1], affine[1][1], affine[2][1]];

            baseRight = vectorToNiftiDirection(r) || 'L';
            baseLeft = vectorToNiftiDirection([-r[0], -r[1], -r[2]]) || 'R';
            baseBottom = vectorToNiftiDirection(c) || 'P';
            baseTop = vectorToNiftiDirection([-c[0], -c[1], -c[2]]) || 'A';

            const nx = r[1] * c[2] - r[2] * c[1];
            const ny = r[2] * c[0] - r[0] * c[2];
            const nz = r[0] * c[1] - r[1] * c[0];
            plane = detectAnatomicalPlane([nx, ny, nz], parsed.filename);
        }
    }

    // Apply viewport rotation to anatomical markers
    let top = baseTop;
    let right = baseRight;
    let bottom = baseBottom;
    let left = baseLeft;

    if (normRot === 90) {
        // Rotated 90 deg clockwise: Left becomes Top, Top becomes Right, Right becomes Bottom, Bottom becomes Left
        top = baseLeft;
        right = baseTop;
        bottom = baseRight;
        left = baseBottom;
    } else if (normRot === 180) {
        top = baseBottom;
        right = baseLeft;
        bottom = baseTop;
        left = baseRight;
    } else if (normRot === 270) {
        top = baseRight;
        right = baseBottom;
        bottom = baseLeft;
        left = baseTop;
    }

    const ANATOMICAL_NAMES = {
        A: 'Anterior',
        P: 'Posterior',
        L: 'Left',
        R: 'Right',
        S: 'Superior',
        I: 'Inferior',
        H: 'Head',
        F: 'Feet',
    };

    const getFullDesc = (code) => {
        if (!code) return '';
        return code.split('').map((c) => ANATOMICAL_NAMES[c] || c).join('-');
    };

    return {
        top,
        bottom,
        left,
        right,
        plane,
        rotation: normRot,
        angleDesc: normRot === 0 ? 'Standard (0°)' : `${normRot}° CW`,
        fullLabels: {
            top: getFullDesc(top),
            bottom: getFullDesc(bottom),
            left: getFullDesc(left),
            right: getFullDesc(right),
        },
    };
}

/**
 * Inverse-transform screen mouse coordinates to original image voxel coordinates,
 * taking into account CSS scale (zoom), pan, and rotation (0°, 90°, 180°, 270°).
 *
 * @param {number} clientX - Pointer clientX
 * @param {number} clientY - Pointer clientY
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {number} cols - Matrix columns
 * @param {number} rows - Matrix rows
 * @param {number} rotDeg - Rotation in degrees
 * @returns {{ px: number, py: number } | null}
 */
export function getCanvasImageCoords(clientX, clientY, canvas, cols, rows, rotDeg = 0) {
    if (!canvas || !cols || !rows) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;

    const rad = (-rotDeg * Math.PI) / 180;
    const unrotatedDx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const unrotatedDy = dx * Math.sin(rad) + dy * Math.cos(rad);

    const normRot = ((rotDeg % 360) + 360) % 360;
    const isSwapped = normRot === 90 || normRot === 270;
    const unrotatedWidth = isSwapped ? rect.height : rect.width;
    const unrotatedHeight = isSwapped ? rect.width : rect.height;

    const uX = unrotatedDx + unrotatedWidth / 2;
    const uY = unrotatedDy + unrotatedHeight / 2;

    if (uX < 0 || uX > unrotatedWidth || uY < 0 || uY > unrotatedHeight) {
        return null;
    }

    const px = Math.min(cols - 1, Math.max(0, Math.floor((uX / unrotatedWidth) * cols)));
    const py = Math.min(rows - 1, Math.max(0, Math.floor((uY / unrotatedHeight) * rows)));
    return { px, py };
}
