import dicomParser from 'dicom-parser';
import * as nifti from 'nifti-reader-js';

/**
 * Utility to parse DICOM or NIfTI array buffer into unified slice data provider.
 * Supports:
 * - 3D NIfTI (cols x rows x slices)
 * - 4D NIfTI CINE (cols x rows x slices x timeFrames) e.g. 001_SA_CINE.nii
 * - 2D Single-frame DICOM
 * - Multi-frame DICOM CINE / Volumes (NumberOfFrames > 1)
 */
export async function parseMedicalFile(arrayBuffer, filename) {
    const lowerName = filename.toLowerCase();
    const isNifti = lowerName.endsWith('.nii') || lowerName.endsWith('.nii.gz');

    if (isNifti) {
        let dataBuffer = arrayBuffer;
        if (nifti.isCompressed(dataBuffer)) {
            dataBuffer = nifti.decompress(dataBuffer);
        }
        if (!nifti.isNIFTI(dataBuffer)) {
            throw new Error('Invalid NIfTI file format.');
        }

        const header = nifti.readHeader(dataBuffer);
        const rawImage = nifti.readImage(header, dataBuffer);

        const cols = header.dims[1];
        const rows = header.dims[2];
        const numSlices = header.dims[3] || 1;
        // 4th dimension in NIfTI is time frames / cardiac phases
        const numTimeFrames = (header.dims[0] >= 4 && header.dims[4] > 0) ? header.dims[4] : 1;
        const isCine = numTimeFrames > 1;

        let typedData;
        switch (header.datatypeCode) {
            case nifti.NIFTI1.TYPE_INT8:
                typedData = new Int8Array(rawImage);
                break;
            case nifti.NIFTI1.TYPE_UINT8:
                typedData = new Uint8Array(rawImage);
                break;
            case nifti.NIFTI1.TYPE_INT16:
                typedData = new Int16Array(rawImage);
                break;
            case nifti.NIFTI1.TYPE_UINT16:
                typedData = new Uint16Array(rawImage);
                break;
            case nifti.NIFTI1.TYPE_INT32:
                typedData = new Int32Array(rawImage);
                break;
            case nifti.NIFTI1.TYPE_UINT32:
                typedData = new Uint32Array(rawImage);
                break;
            case nifti.NIFTI1.TYPE_FLOAT32:
                typedData = new Float32Array(rawImage);
                break;
            case nifti.NIFTI1.TYPE_FLOAT64:
                typedData = new Float64Array(rawImage);
                break;
            default:
                typedData = new Float32Array(rawImage);
        }

        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < typedData.length; i++) {
            const v = typedData[i];
            if (v < min) min = v;
            if (v > max) max = v;
        }

        const sliceSize = cols * rows;
        const volumeSize = sliceSize * numSlices;

        /**
         * Get 2D slice pixel data for a given spatial slice (z) and time frame (t).
         * For 3D: timeFrameIndex is ignored (defaults to 0).
         * For 4D CINE: (t * volumeSize) + (z * sliceSize).
         */
        const getSliceData = (sliceIndex = 0, timeFrameIndex = 0) => {
            const z = Math.max(0, Math.min(sliceIndex, numSlices - 1));
            const t = Math.max(0, Math.min(timeFrameIndex, numTimeFrames - 1));
            const start = (t * volumeSize) + (z * sliceSize);
            return typedData.subarray(start, start + sliceSize);
        };

        const voxelSizes = header.pixDims
            ? header.pixDims.slice(1, 4).map((v) => Number(v).toFixed(2)).join(' × ') + ' mm'
            : 'N/A';
        const temporalRes = (header.dims[0] >= 4 && header.pixDims && header.pixDims[4])
            ? `${Number(header.pixDims[4]).toFixed(2)} ms`
            : null;

        const dimDesc = isCine
            ? `${cols} × ${rows} × ${numSlices} × ${numTimeFrames} (4D CINE)`
            : `${cols} × ${rows} × ${numSlices} (3D Volume)`;

        return {
            type: 'nifti',
            filename,
            cols,
            rows,
            numSlices,
            numTimeFrames,
            isCine,
            min,
            max,
            defaultWindowCenter: min + (max - min) / 2,
            defaultWindowWidth: max - min || 1,
            getSliceData,
            metadata: {
                FileType: 'NIfTI (.nii/.nii.gz)',
                Filename: filename,
                Dimensions: dimDesc,
                SpatialSlices: numSlices,
                CardiacPhases: numTimeFrames,
                IsCine: isCine ? 'Yes (Dynamic Motion)' : 'No (Static 3D)',
                VoxelSizes: voxelSizes,
                TemporalResolution: temporalRes || 'N/A',
                DatatypeCode: header.datatypeCode,
                MinPixelValue: min.toFixed(1),
                MaxPixelValue: max.toFixed(1),
            },
        };
    } else {
        // DICOM parsing via dicom-parser
        const byteArray = new Uint8Array(arrayBuffer);
        const dataset = dicomParser.parseDicom(byteArray);

        const rows = dataset.uint16('x00280010') || 256;
        const cols = dataset.uint16('x00280011') || 256;
        const bitsAllocated = dataset.uint16('x00280100') || 16;
        const pixelRepresentation = dataset.uint16('x00280103') || 0; // 0 = unsigned, 1 = signed

        // Check for Multi-frame DICOM (CINE loop or 3D multi-frame)
        const framesStr = dataset.string('x00280008');
        const numFrames = framesStr ? Math.max(1, parseInt(framesStr, 10)) : 1;
        const isCine = numFrames > 1;

        const patientName = dataset.string('x00100010') || 'Anonymous';
        const patientID = dataset.string('x00100020') || 'N/A';
        const modality = dataset.string('x00080060') || 'MR';
        const heartRate = dataset.string('x00181088') || 'N/A';
        const manufacturer = dataset.string('x00080070');
        const scannerModel = dataset.string('x00081090');
        const stationName = dataset.string('x00081010');
        const institutionName = dataset.string('x00080080');
        const fieldStrength = dataset.string('x00180087');
        const studyDesc = dataset.string('x00081030');
        const seriesDesc = dataset.string('x0008103e');

        const pixelDataElement = dataset.elements.x7fe00010;
        if (!pixelDataElement) {
            throw new Error('No pixel data found in DICOM file.');
        }

        let pixelData;
        if (bitsAllocated === 8) {
            pixelData = new Uint8Array(byteArray.buffer, pixelDataElement.dataOffset, pixelDataElement.length);
        } else if (pixelRepresentation === 1) {
            pixelData = new Int16Array(byteArray.buffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
        } else {
            pixelData = new Uint16Array(byteArray.buffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
        }

        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < pixelData.length; i++) {
            const v = pixelData[i];
            if (v < min) min = v;
            if (v > max) max = v;
        }

        const wcStr = dataset.string('x00281050');
        const wwStr = dataset.string('x00281051');

        const wc = wcStr ? parseFloat(wcStr) : min + (max - min) / 2;
        const ww = wwStr ? parseFloat(wwStr) : max - min || 1;

        const frameSize = cols * rows;

        // If multi-frame, each frame is accessed sequentially:
        const getSliceData = (sliceIndex = 0, timeFrameIndex = 0) => {
            if (numFrames <= 1) {
                return pixelData;
            }
            // For multi-frame cine, index by timeFrameIndex or sliceIndex
            const idx = Math.max(0, Math.min(timeFrameIndex || sliceIndex, numFrames - 1));
            const start = idx * frameSize;
            return pixelData.subarray(start, start + frameSize);
        };

        return {
            type: 'dicom',
            filename,
            cols,
            rows,
            numSlices: 1,
            numTimeFrames: numFrames,
            isCine,
            min,
            max,
            defaultWindowCenter: wc,
            defaultWindowWidth: ww,
            getSliceData,
            metadata: {
                FileType: 'DICOM (.dcm)',
                Filename: filename,
                PatientName: patientName,
                PatientID: patientID,
                Modality: modality,
                Dimensions: isCine ? `${cols} × ${rows} (${numFrames} Frames CINE)` : `${cols} × ${rows}`,
                NumberOfFrames: numFrames,
                IsCine: isCine ? 'Yes (Multi-frame Cine)' : 'No (Single frame)',
                HeartRate: heartRate !== 'N/A' ? `${heartRate} bpm` : 'N/A',
                Manufacturer: manufacturer || 'N/A',
                ScannerModel: scannerModel || 'N/A',
                StationName: stationName || 'N/A',
                InstitutionName: institutionName || 'N/A',
                FieldStrength: fieldStrength ? `${fieldStrength} T` : 'N/A',
                StudyDescription: studyDesc || 'N/A',
                SeriesDescription: seriesDesc || 'N/A',
                BitsAllocated: bitsAllocated,
                WindowCenter: wc.toFixed(1),
                WindowWidth: ww.toFixed(1),
                MinPixelValue: min.toFixed(1),
                MaxPixelValue: max.toFixed(1),
            },
        };
    }
}

/**
 * Check if a filename represents a Ground Truth segmentation mask.
 */
export function isGroundTruthMask(filename = '') {
    const fn = filename.toLowerCase();
    return (
        fn.includes('_gt.') ||
        fn.includes('_gt_') ||
        fn.endsWith('_gt.nii') ||
        fn.endsWith('_gt.nii.gz') ||
        fn.endsWith('_gt') ||
        fn.includes('_mask.') ||
        fn.includes('_seg.') ||
        fn.includes('_label.')
    );
}

/**
 * Extract canonical base name of scan (stripping extension and any _gt / _mask suffix).
 */
export function getBaseScanName(filename = '') {
    return filename
        .replace(/\.nii\.gz$/i, '')
        .replace(/\.nii$/i, '')
        .replace(/\.dcm$/i, '')
        .replace(/\.dicom$/i, '')
        .replace(/_gt$/i, '')
        .replace(/_mask$/i, '')
        .replace(/_seg$/i, '')
        .replace(/_label$/i, '');
}

/**
 * Render slice pixel data onto canvas with Window / Level adjustment and optional segmentation mask overlay.
 */
export function renderSliceToCanvas(
    canvas,
    sliceData,
    cols,
    rows,
    windowCenter,
    windowWidth,
    minVal,
    maxVal,
    maskSliceData = null,
    maskOpacity = 0.5,
    maskPalette = 'groundTruth' // 'groundTruth' | 'ai'
) {
    if (!canvas || !sliceData || cols <= 0 || rows <= 0) return;

    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(cols, rows);
    const data = imgData.data;

    const wc = windowCenter ?? minVal + (maxVal - minVal) / 2;
    const ww = (windowWidth ?? maxVal - minVal) || 1;
    const lower = wc - ww / 2;
    const upper = wc + ww / 2;
    const range = upper - lower || 1;

    // Palette: [R, G, B]
    const getMaskRgb = (val, palette) => {
        const isGt = palette === 'groundTruth';
        const label = Math.round(val);
        // Cardiac anatomical labels: 1 = LV Myo, 2 = LV Cavity / Blood Pool, 3 = RV
        if (label === 1) return isGt ? [16, 185, 129] : [6, 182, 212];    // Emerald (GT) vs Cyan (AI)
        if (label === 2) return isGt ? [239, 68, 68] : [168, 85, 247];    // Red (GT) vs Purple (AI)
        if (label === 3) return isGt ? [245, 158, 11] : [59, 130, 246];   // Amber (GT) vs Blue (AI)
        if (label > 0) return isGt ? [16, 185, 129] : [6, 182, 212];      // Any other label
        return null;
    };

    const hasMask = Boolean(maskSliceData && maskSliceData.length === sliceData.length);
    const alpha = Math.max(0, Math.min(1, maskOpacity));

    for (let i = 0; i < sliceData.length; i++) {
        const val = sliceData[i];
        let norm;
        if (val <= lower) norm = 0;
        else if (val >= upper) norm = 255;
        else norm = ((val - lower) / range) * 255;

        const idx = i * 4;

        if (hasMask && maskSliceData[i] > 0) {
            const rgb = getMaskRgb(maskSliceData[i], maskPalette);
            if (rgb) {
                data[idx] = Math.round(norm * (1 - alpha) + rgb[0] * alpha);
                data[idx + 1] = Math.round(norm * (1 - alpha) + rgb[1] * alpha);
                data[idx + 2] = Math.round(norm * (1 - alpha) + rgb[2] * alpha);
                data[idx + 3] = 255;
                continue;
            }
        }

        data[idx] = norm;
        data[idx + 1] = norm;
        data[idx + 2] = norm;
        data[idx + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
}

/**
 * Convert Base64 string from FastAPI localizer response to ArrayBuffer.
 */
export function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Generate a thumbnail Data URL from a parsed medical file.
 */
export function generateThumbnailUrl(parsed, targetSize = 128) {
    if (!parsed || !parsed.getSliceData) return null;
    try {
        const midSlice = Math.floor((parsed.numSlices || 1) / 2);
        const midTime = Math.floor((parsed.numTimeFrames || 1) / 2);
        const sliceData = parsed.getSliceData(midSlice, midTime);
        if (!sliceData || sliceData.length === 0) return null;

        const offCanvas = document.createElement('canvas');
        renderSliceToCanvas(
            offCanvas,
            sliceData,
            parsed.cols,
            parsed.rows,
            parsed.defaultWindowCenter,
            parsed.defaultWindowWidth,
            parsed.min,
            parsed.max
        );

        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = targetSize;
        thumbCanvas.height = targetSize;
        const ctx = thumbCanvas.getContext('2d');
        ctx.drawImage(offCanvas, 0, 0, targetSize, targetSize);
        return thumbCanvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
        console.warn('Error generating thumbnail:', e);
        return null;
    }
}


