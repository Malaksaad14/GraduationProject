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
        // Single-file DICOM parsing via parseDicomHeaderAndPixel & assembleDicomSeries
        const item = parseDicomHeaderAndPixel(arrayBuffer, filename);
        return assembleDicomSeries([item], filename);
    }
}

/**
 * Parses individual DICOM file headers and pixel data.
 */
export function parseDicomHeaderAndPixel(arrayBuffer, filename, fileObj = null) {
    const byteArray = new Uint8Array(arrayBuffer);
    const dataset = dicomParser.parseDicom(byteArray);

    const rows = dataset.uint16('x00280010') || 256;
    const cols = dataset.uint16('x00280011') || 256;
    const bitsAllocated = dataset.uint16('x00280100') || 16;
    const pixelRepresentation = dataset.uint16('x00280103') || 0;

    const framesStr = dataset.string('x00280008');
    const numFrames = framesStr ? Math.max(1, parseInt(framesStr, 10)) : 1;

    const pixelDataElement = dataset.elements.x7fe00010;
    if (!pixelDataElement) {
        throw new Error(`No pixel data found in DICOM file ${filename}`);
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

    const cleanStr = (tag) => {
        const val = dataset.string(tag);
        return val ? val.trim() : null;
    };

    return {
        filename,
        file: fileObj,
        cols,
        rows,
        bitsAllocated,
        numFrames,
        pixelData,
        min,
        max,
        wc,
        ww,
        seriesInstanceUID: cleanStr('x0020000e'),
        seriesDescription: cleanStr('x0008103e'),
        seriesNumber: cleanStr('x00200011'),
        studyDescription: cleanStr('x00081030'),
        protocolName: cleanStr('x00181030'),
        patientName: cleanStr('x00100010'),
        patientID: cleanStr('x00100020'),
        modality: cleanStr('x00080060') || 'MR',
        imagePositionPatient: cleanStr('x00200032'),
        imageOrientationPatient: cleanStr('x00200037'),
        sliceLocation: cleanStr('x00201041'),
        sliceThickness: cleanStr('x00180050'),
        pixelSpacing: cleanStr('x00280030'),
        triggerTime: cleanStr('x00181060'),
        nominalInterval: cleanStr('x00181062'),
        cardiacNumberOfImages: cleanStr('x00181090'),
        instanceNumber: cleanStr('x00200013'),
        temporalPositionIdentifier: cleanStr('x00200100'),
        inversionTime: cleanStr('x00180082'),
        echoTime: cleanStr('x00180081'),
        manufacturer: cleanStr('x00080070'),
        scannerModel: cleanStr('x00081090'),
        stationName: cleanStr('x00081010'),
        institutionName: cleanStr('x00080080'),
        fieldStrength: cleanStr('x00180087'),
        heartRate: cleanStr('x00181088'),
    };
}

/**
 * Assembles a collection of DICOM slices into a multi-dimensional volume/CINE sequence.
 */
export function assembleDicomSeries(items, seriesName) {
    if (!items || items.length === 0) return null;

    const first = items[0];
    const cols = first.cols;
    const rows = first.rows;
    let min = Infinity;
    let max = -Infinity;
    for (const item of items) {
        if (item.min < min) min = item.min;
        if (item.max > max) max = item.max;
    }

    // Function to calculate spatial position along slice normal vector
    const getSpatialCoord = (item) => {
        if (item.imagePositionPatient) {
            const coords = item.imagePositionPatient.split('\\').map(Number);
            if (coords.length === 3 && !isNaN(coords[2])) {
                if (item.imageOrientationPatient) {
                    const o = item.imageOrientationPatient.split('\\').map(Number);
                    if (o.length === 6) {
                        const nx = o[1] * o[5] - o[2] * o[4];
                        const ny = o[2] * o[3] - o[0] * o[5];
                        const nz = o[0] * o[4] - o[1] * o[3];
                        return nx * coords[0] + ny * coords[1] + nz * coords[2];
                    }
                }
                return coords[2];
            }
        }
        if (item.sliceLocation !== null && item.sliceLocation !== undefined && !isNaN(parseFloat(item.sliceLocation))) {
            return parseFloat(item.sliceLocation);
        }
        if (item.instanceNumber !== null && item.instanceNumber !== undefined && !item.triggerTime && !item.inversionTime) {
            return parseInt(item.instanceNumber, 10);
        }
        return 0;
    };

    // Cluster items by spatial coordinate (tolerance 0.4mm for grouping identical slice positions)
    const spatialGroups = [];
    for (const item of items) {
        const coord = getSpatialCoord(item);
        let group = spatialGroups.find((g) => Math.abs(g.coord - coord) < 0.4);
        if (!group) {
            group = { coord, items: [] };
            spatialGroups.push(group);
        }
        group.items.push(item);
    }

    // Sort spatial positions ascending (anatomical order base to apex)
    spatialGroups.sort((a, b) => a.coord - b.coord);
    const numSlices = spatialGroups.length;

    // Within each spatial slice, sort temporal frames
    for (const group of spatialGroups) {
        group.items.sort((a, b) => {
            if (a.triggerTime !== null && b.triggerTime !== null) {
                return parseFloat(a.triggerTime) - parseFloat(b.triggerTime);
            }
            if (a.inversionTime !== null && b.inversionTime !== null) {
                return parseFloat(a.inversionTime) - parseFloat(b.inversionTime);
            }
            if (a.echoTime !== null && b.echoTime !== null) {
                return parseFloat(a.echoTime) - parseFloat(b.echoTime);
            }
            if (a.temporalPositionIdentifier !== null && b.temporalPositionIdentifier !== null) {
                return parseInt(a.temporalPositionIdentifier, 10) - parseInt(b.temporalPositionIdentifier, 10);
            }
            if (a.instanceNumber !== null && b.instanceNumber !== null) {
                return parseInt(a.instanceNumber, 10) - parseInt(b.instanceNumber, 10);
            }
            return a.filename.localeCompare(b.filename, undefined, { numeric: true });
        });
    }

    // Temporal frames count
    let numTimeFrames = Math.max(...spatialGroups.map((g) => g.items.length));
    if (items.length === 1 && first.numFrames > 1) {
        numTimeFrames = first.numFrames;
    }

    // Sequence & Dimensionality Detection
    const tis = items.map((it) => it.inversionTime).filter(Boolean);
    const uniqueTIs = new Set(tis);
    const hasVaryingTI = uniqueTIs.size > 1;

    const tes = items.map((it) => it.echoTime).filter(Boolean);
    const uniqueTEs = new Set(tes);
    const hasVaryingTE = uniqueTEs.size > 1;

    const isT1Mapping = hasVaryingTI || /t1.*map|molli|shmolli|sasha/i.test(seriesName);
    const isDense = /dense/i.test(seriesName);
    const isMultiEcho = hasVaryingTE;
    const isCine =
        numTimeFrames > 1 &&
        !isT1Mapping &&
        !isMultiEcho &&
        (items.some((it) => it.triggerTime !== null || (it.cardiacNumberOfImages && parseInt(it.cardiacNumberOfImages, 10) > 1)) ||
            /cine|bssfp|truefisp|fiesta|bffe/i.test(seriesName) ||
            isDense ||
            first.numFrames > 1);

    let dimensionType = '2D';
    let dimDesc = `${cols} × ${rows} (2D Single Slice)`;
    if (numTimeFrames > 1) {
        dimensionType = '4D';
        if (isT1Mapping) {
            dimDesc = `${cols} × ${rows} × ${numSlices} (${numTimeFrames} TIs T1 Map)`;
        } else if (isCine) {
            dimDesc = `${cols} × ${rows} × ${numSlices} × ${numTimeFrames} (4D CINE)`;
        } else {
            dimDesc = `${cols} × ${rows} × ${numSlices} × ${numTimeFrames} (Time Series)`;
        }
    } else if (numSlices > 1) {
        dimensionType = '3D';
        dimDesc = `${cols} × ${rows} × ${numSlices} (3D Volume)`;
    }

    const frameSize = cols * rows;

    // getSliceData(sliceIndex, timeFrameIndex)
    const getSliceData = (sliceIndex = 0, timeFrameIndex = 0) => {
        const z = Math.max(0, Math.min(sliceIndex, numSlices - 1));
        const group = spatialGroups[z];
        if (!group || group.items.length === 0) return null;

        if (group.items.length === 1 && group.items[0].numFrames > 1) {
            const item = group.items[0];
            const t = Math.max(0, Math.min(timeFrameIndex, item.numFrames - 1));
            return item.pixelData.subarray(t * frameSize, (t + 1) * frameSize);
        }

        const t = Math.max(0, Math.min(timeFrameIndex, group.items.length - 1));
        const item = group.items[t];
        return item.pixelData;
    };

    // getTimeFrameMeta(sliceIndex, timeFrameIndex)
    const getTimeFrameMeta = (sliceIndex = 0, timeFrameIndex = 0) => {
        const z = Math.max(0, Math.min(sliceIndex, numSlices - 1));
        const group = spatialGroups[z];
        if (!group || group.items.length === 0) return null;
        const t = Math.max(0, Math.min(timeFrameIndex, group.items.length - 1));
        const item = group.items[t];
        return {
            triggerTime: item.triggerTime ? `${parseFloat(item.triggerTime).toFixed(1)} ms` : null,
            inversionTime: item.inversionTime ? `${parseFloat(item.inversionTime).toFixed(1)} ms` : null,
            echoTime: item.echoTime ? `${parseFloat(item.echoTime).toFixed(1)} ms` : null,
            instanceNumber: item.instanceNumber,
            sliceLocation: item.sliceLocation ? `${parseFloat(item.sliceLocation).toFixed(1)} mm` : null,
            phaseIndex: t + 1,
            totalPhases: numTimeFrames,
            isCine,
            isT1Mapping,
            isDense,
        };
    };

    return {
        type: 'dicom',
        filename: seriesName,
        cols,
        rows,
        numSlices,
        numTimeFrames,
        isCine,
        isT1Mapping,
        isDense,
        isMultiEcho,
        hasVaryingTI,
        dimensionType,
        min,
        max,
        defaultWindowCenter: first.wc,
        defaultWindowWidth: first.ww,
        getSliceData,
        getTimeFrameMeta,
        items,
        metadata: {
            FileType: 'DICOM (.dcm)',
            Filename: seriesName,
            PatientName: first.patientName || 'Anonymous',
            PatientID: first.patientID || 'N/A',
            Modality: first.modality || 'MR',
            Dimensions: dimDesc,
            DimensionType: dimensionType,
            SpatialSlices: numSlices,
            CardiacPhases: numTimeFrames,
            IsCine: isCine ? 'Yes (Dynamic CINE Motion)' : 'No',
            HeartRate: first.heartRate && first.heartRate !== 'N/A' ? `${first.heartRate} bpm` : 'N/A',
            Manufacturer: first.manufacturer || 'N/A',
            ScannerModel: first.scannerModel || 'N/A',
            StationName: first.stationName || 'N/A',
            InstitutionName: first.institutionName || 'N/A',
            FieldStrength: first.fieldStrength ? `${first.fieldStrength} T` : 'N/A',
            StudyDescription: first.studyDescription || 'N/A',
            SeriesDescription: first.seriesDescription || seriesName,
            ProtocolName: first.protocolName || 'N/A',
            BitsAllocated: first.bitsAllocated,
            WindowCenter: first.wc.toFixed(1),
            WindowWidth: first.ww.toFixed(1),
            MinPixelValue: min.toFixed(1),
            MaxPixelValue: max.toFixed(1),
        },
    };
}

/**
 * Group multiple uploaded DICOM files by series and assemble them into 3D/4D series objects.
 */
export async function groupAndAssembleDicomFiles(dicomFiles) {
    if (!dicomFiles || dicomFiles.length === 0) return [];

    const parsedItems = [];
    for (const file of dicomFiles) {
        try {
            const buffer = await file.arrayBuffer();
            const item = parseDicomHeaderAndPixel(buffer, file.name, file);
            parsedItems.push(item);
        } catch (err) {
            console.warn(`Failed parsing DICOM file ${file.name}:`, err);
        }
    }

    if (parsedItems.length === 0) return [];

    // Group items into Series
    const seriesGroups = new Map();
    for (const item of parsedItems) {
        let seriesKey = 'DICOM_Series';
        const file = item.file;
        if (file && file.webkitRelativePath) {
            const parts = file.webkitRelativePath.split('/');
            if (parts.length >= 2) {
                seriesKey = parts[parts.length - 2];
            }
        } else if (item.seriesInstanceUID) {
            seriesKey = item.seriesInstanceUID;
        } else if (item.seriesDescription && item.seriesDescription.trim().length > 0) {
            seriesKey = item.seriesDescription.trim();
        } else {
            const match = item.filename.match(/^([a-zA-Z0-9_\-\s]+?)(?:[_\-\s]?\d+)?\.(?:dcm|dicom)$/i);
            if (match && match[1]) seriesKey = match[1].trim();
        }

        if (!seriesGroups.has(seriesKey)) {
            seriesGroups.set(seriesKey, []);
        }
        seriesGroups.get(seriesKey).push(item);
    }

    const assembledSeriesList = [];
    for (const [key, groupItems] of seriesGroups.entries()) {
        const first = groupItems[0];
        let seriesName = first.seriesDescription || key;
        if (first.file && first.file.webkitRelativePath) {
            const parts = first.file.webkitRelativePath.split('/');
            if (parts.length >= 2) {
                seriesName = parts[parts.length - 2];
            }
        }
        const assembled = assembleDicomSeries(groupItems, seriesName);
        if (assembled) {
            assembledSeriesList.push({
                id: `series_${key}_${groupItems.length}`,
                file: first.file,
                filename: seriesName,
                parsed: assembled,
                thumbnailUrl: generateThumbnailUrl(assembled),
                numSlices: assembled.numSlices,
                numTimeFrames: assembled.numTimeFrames,
                cols: assembled.cols,
                rows: assembled.rows,
                type: 'dicom',
                viewType: seriesName,
                hasLocalization: false,
                localizedResult: null,
            });
        }
    }

    return assembledSeriesList;
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


