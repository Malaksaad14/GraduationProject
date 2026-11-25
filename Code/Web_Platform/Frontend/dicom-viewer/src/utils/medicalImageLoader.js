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

        const getSliceInfo = () => ({
            cols,
            rows,
            min,
            max,
            wc: min + (max - min) / 2,
            ww: max - min || 1,
            affine: header.affine,
        });

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
            affine: header.affine,
            defaultWindowCenter: min + (max - min) / 2,
            defaultWindowWidth: max - min || 1,
            getSliceData,
            getSliceInfo,
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
    let numSlices = spatialGroups.length;

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

    // Sequence & Dimensionality Detection
    const isLocalizer = /localizer|scout/i.test(seriesName);

    if (isLocalizer) {
        // Localizer images are all distinct spatial scout slices, not cine time frames
        spatialGroups.length = 0;
        for (let i = 0; i < items.length; i++) {
            spatialGroups.push({ coord: i, items: [items[i]] });
        }
    }

    numSlices = spatialGroups.length;

    // Temporal frames count
    let numTimeFrames = isLocalizer ? 1 : Math.max(...spatialGroups.map((g) => g.items.length));
    if (!isLocalizer && items.length === 1 && first.numFrames > 1) {
        numTimeFrames = first.numFrames;
    }

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
        !isLocalizer &&
        numTimeFrames > 1 &&
        !isT1Mapping &&
        !isMultiEcho &&
        (items.some((it) => (it.cardiacNumberOfImages && parseInt(it.cardiacNumberOfImages, 10) > 1)) ||
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
            const itemFrameSize = item.cols * item.rows;
            const t = Math.max(0, Math.min(timeFrameIndex, item.numFrames - 1));
            return item.pixelData.subarray(t * itemFrameSize, (t + 1) * itemFrameSize);
        }

        const t = Math.max(0, Math.min(timeFrameIndex, group.items.length - 1));
        const item = group.items[t];
        return item.pixelData;
    };

    // getSliceInfo(sliceIndex, timeFrameIndex) — returns per-slice dimensions and intensity range
    const getSliceInfo = (sliceIndex = 0, timeFrameIndex = 0) => {
        const z = Math.max(0, Math.min(sliceIndex, numSlices - 1));
        const group = spatialGroups[z];
        if (!group || group.items.length === 0) {
            return {
                cols,
                rows,
                min,
                max,
                wc: first.wc,
                ww: first.ww,
                imageOrientationPatient: first.imageOrientationPatient,
                imagePositionPatient: first.imagePositionPatient,
            };
        }
        const t = Math.max(0, Math.min(timeFrameIndex, group.items.length - 1));
        const item = group.items[t];
        return {
            cols: item.cols || cols,
            rows: item.rows || rows,
            min: item.min ?? min,
            max: item.max ?? max,
            wc: item.wc ?? first.wc,
            ww: item.ww ?? first.ww,
            imageOrientationPatient: item.imageOrientationPatient || first.imageOrientationPatient,
            imagePositionPatient: item.imagePositionPatient || first.imagePositionPatient,
        };
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
        isLocalizer,
        isCine,
        isT1Mapping,
        isDense,
        isMultiEcho,
        hasVaryingTI,
        dimensionType,
        min,
        max,
        imageOrientationPatient: first.imageOrientationPatient,
        imagePositionPatient: first.imagePositionPatient,
        defaultWindowCenter: first.wc,
        defaultWindowWidth: first.ww,
        getSliceData,
        getSliceInfo,
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

    // Palette: [R, G, B] — Unified EMIDEC cardiac segmentation colors
    const getMaskRgb = (val) => {
        const label = Math.round(val);
        // Cardiac anatomical labels: 1 = Cavity, 2 = Myocardium, 3 = Infarction, 4 = No-Reflow
        if (label === 1) return [6, 182, 212];     // Cyan (Cavity)
        if (label === 2) return [168, 85, 247];    // Purple (Myocardium)
        if (label === 3) return [245, 158, 11];    // Amber (Infarction)
        if (label === 4) return [244, 63, 94];     // Rose (No-Reflow)
        if (label > 0) return [6, 182, 212];       // Any other label
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
 * Infer human-friendly cardiac sequence or view name from filename.
 */
export function getSequenceFriendlyName(filename = '') {
    const fn = filename.toUpperCase();
    if (fn.includes('LOCALIZER') || fn.includes('SCOUT')) {
        return { name: 'Localizers', tag: 'LOC', color: 'bg-slate-500/20 text-slate-300 border-slate-500/40' };
    }
    if (fn.includes('_GT') || fn.includes('_MASK') || fn.includes('_SEG')) {
        return { name: 'Ground Truth Mask', tag: 'GT', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
    }
    if (fn.includes('BSSFP') || fn.includes('TRUEFISP') || fn.includes('FIESTA') || fn.includes('SA_CINE') || (fn.includes('SA') && fn.includes('CINE')) || fn.includes('01_BSSFP')) {
        return { name: 'bSSFP Cine', tag: 'CINE', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
    }
    if (fn.includes('T1') || fn.includes('MOLLI') || fn.includes('SHMOLLI') || fn.includes('SASHA') || fn.includes('02_T1')) {
        return { name: 'T1 Parametric Map', tag: 'T1', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
    }
    if (fn.includes('DENSE') || fn.includes('03_DENSE')) {
        return { name: 'DENSE Myocardial Strain', tag: 'DENSE', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' };
    }
    if (fn.includes('LA_2CH') || fn.includes('2CH')) {
        return { name: '2-Chamber View (LA)', tag: '2-CH', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' };
    }
    if (fn.includes('LA_4CH') || fn.includes('4CH')) {
        return { name: '4-Chamber View (LA)', tag: '4-CH', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' };
    }
    if (fn.includes('LA_3CH') || fn.includes('3CH')) {
        return { name: '3-Chamber View (LA)', tag: '3-CH', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' };
    }
    if (fn.includes('LGE') || fn.includes('DE_') || fn.includes('INFARCT') || fn.includes('VIAB') || fn.includes('PSIR') || fn.includes('MDE')) {
        return { name: 'Late Gadolinium (LGE)', tag: 'LGE', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
    }
    if (fn.includes('T2')) {
        return { name: 'T2 Edema Mapping', tag: 'T2', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' };
    }
    if (fn.includes('DIXON') || fn.includes('MDIXON')) {
        return { name: 'mDIXON Water/Fat', tag: 'DIXON', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' };
    }
    if (fn.includes('BFFE') || fn.includes('FFE')) {
        return { name: 'Balanced FFE Cine', tag: 'bFFE', color: 'bg-teal-500/20 text-teal-300 border-teal-500/40' };
    }
    if (fn.includes('SA') || fn.includes('SHORT')) {
        return { name: 'Short Axis (SA)', tag: 'SA', color: 'bg-slate-500/20 text-slate-300 border-slate-500/40' };
    }
    return { name: filename.replace(/(\.nii|\.gz|\.dcm|\.dicom)/gi, '').replace(/^series_/i, ''), tag: 'VIEW', color: 'bg-slate-700/30 text-slate-300 border-slate-700/50' };
}

/**
 * Fast sample of DICOM header tags without parsing heavy pixel data.
 */
export async function sampleDicomHeader(file) {
    if (!file) return null;
    try {
        let byteArray;
        try {
            const slice = file.slice(0, 131072);
            const buffer = await slice.arrayBuffer();
            byteArray = new Uint8Array(buffer);
        } catch {
            const buffer = await file.arrayBuffer();
            byteArray = new Uint8Array(buffer);
        }

        let dataset;
        try {
            dataset = dicomParser.parseDicom(byteArray, { untilTag: 'x7fe00010' });
        } catch {
            const fullBuf = await file.arrayBuffer();
            dataset = dicomParser.parseDicom(new Uint8Array(fullBuf));
        }

        const cleanStr = (tag) => {
            const val = dataset.string(tag);
            return val ? val.trim() : null;
        };

        const formatDate = (dateStr) => {
            if (!dateStr || dateStr.length < 8) return dateStr || 'N/A';
            return `${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}/${dateStr.slice(0, 4)}`;
        };

        const formatTime = (timeStr) => {
            if (!timeStr || timeStr.length < 4) return '';
            const hh = parseInt(timeStr.slice(0, 2), 10);
            const mm = timeStr.slice(2, 4);
            const ampm = hh >= 12 ? 'PM' : 'AM';
            const h12 = hh % 12 || 12;
            return `${h12}:${mm} ${ampm}`;
        };

        const studyDate = cleanStr('x00080020');
        const acqTime = cleanStr('x00080030') || cleanStr('x00080032') || cleanStr('x00080031');
        const formattedDate = formatDate(studyDate);
        const formattedTime = formatTime(acqTime);
        const dateAcquired = formattedDate !== 'N/A' && formattedTime ? `${formattedDate}, ${formattedTime}` : formattedDate;

        return {
            patientName: cleanStr('x00100010'),
            patientID: cleanStr('x00100020'),
            studyDescription: cleanStr('x00081030'),
            seriesDescription: cleanStr('x0008103e'),
            seriesNumber: cleanStr('x00200011'),
            modality: cleanStr('x00080060') || 'MR',
            patientAge: cleanStr('x00101010'),
            patientSex: cleanStr('x00100040'),
            dateAcquired,
            studyDate: formattedDate,
            stationName: cleanStr('x00081010'),
            manufacturer: cleanStr('x00080070'),
            magneticFieldStrength: cleanStr('x00180087')
        };
    } catch (err) {
        return null;
    }
}

/**
 * Build hierarchical study collection for uploaded patient files.
 * Prevents performance lag by grouping files by directory and reading only lightweight headers.
 */
export async function buildHierarchicalStudyTree(filesList) {
    if (!filesList || filesList.length === 0) return null;

    const files = Array.from(filesList);
    const medicalFiles = files.filter((f) => {
        const name = f.name.toLowerCase();
        return (
            name.endsWith('.nii') ||
            name.endsWith('.nii.gz') ||
            name.endsWith('.dcm') ||
            name.endsWith('.dicom')
        );
    });

    if (medicalFiles.length === 0) return null;

    // Detect Root Patient / Folder Name
    let rootPatientName = 'Patient Study';
    const firstRel = medicalFiles[0].webkitRelativePath || medicalFiles[0].relativePath || '';
    if (firstRel.includes('/')) {
        const parts = firstRel.split('/');
        rootPatientName = parts[0].replace(/_/g, ' ');
    } else {
        const match = medicalFiles[0].name.match(/^([A-Za-z0-9_]+?)(?:_SA|_LA|_2CH|_4CH|_LGE|_CINE|\.nii|\.dcm)/i);
        if (match && match[1]) {
            rootPatientName = `Patient ${match[1].replace(/_/g, ' ')}`;
        }
    }

    // Group files by their innermost folder (leaf directory containing the files)
    const groupsMap = new Map();

    for (const file of medicalFiles) {
        const relPath = file.webkitRelativePath || file.relativePath || file.name;
        const parts = relPath.split('/').filter(Boolean);
        const lowerName = file.name.toLowerCase();
        const isNii = lowerName.endsWith('.nii') || lowerName.endsWith('.nii.gz');

        let leafKey = 'Main_Series';
        let leafName = file.name;
        let categoryName = 'General';

        if (isNii) {
            // Every NIfTI file is ALREADY a complete standalone volume (3D/4D).
            // It must always be its own separate study, never lumped with other NIfTI files!
            leafKey = relPath;
            leafName = file.name.replace(/\.nii(\.gz)?$/i, '');
            if (parts.length >= 3) {
                categoryName = parts[1];
            } else if (parts.length === 2) {
                categoryName = parts[0];
            } else {
                categoryName = 'NIfTI Volumes';
            }
        } else {
            // DICOM files: slices belonging to the same innermost subfolder form one volume
            if (parts.length >= 3) {
                leafKey = parts.slice(0, parts.length - 1).join('/');
                leafName = parts[parts.length - 2];
                categoryName = parts[1];
            } else if (parts.length === 2) {
                leafKey = parts[0];
                leafName = parts[0];
                categoryName = parts[0];
            } else {
                // Flat DICOM file
                const match = file.name.match(/^([a-zA-Z0-9_\-\s]+?)(?:[_\-\s]?\d+)?\.(?:dcm|dicom)$/i);
                leafKey = match && match[1] ? match[1].trim() : 'DICOM_Series';
                leafName = leafKey;
                categoryName = 'Root Files';
            }
        }

        if (!groupsMap.has(leafKey)) {
            groupsMap.set(leafKey, {
                leafKey,
                leafName,
                categoryName,
                files: []
            });
        }
        groupsMap.get(leafKey).files.push(file);
    }

    // Sort files naturally within each group
    for (const grp of groupsMap.values()) {
        grp.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }

    // For each leaf group, sample lightweight metadata from the first file
    const studies = [];
    let detectedPatientId = 'N/A';
    let detectedStudyDesc = 'Cardiac MRI';
    const detectedDate = new Date().toLocaleDateString(undefined, {
        month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    for (const [key, grp] of groupsMap.entries()) {
        const sampleFile = grp.files[0];
        const isNii = sampleFile.name.toLowerCase().endsWith('.nii') || sampleFile.name.toLowerCase().endsWith('.nii.gz');
        let meta = null;
        if (!isNii) {
            meta = await sampleDicomHeader(sampleFile);
        }

        if (meta) {
            if (meta.patientName && meta.patientName !== 'Anonymous' && meta.patientName !== 'N/A') {
                rootPatientName = meta.patientName.replace(/\^/g, ' ').trim();
            }
            if (meta.patientID && meta.patientID !== 'N/A') {
                detectedPatientId = meta.patientID.trim();
            }
            if (meta.studyDescription && meta.studyDescription !== 'N/A') {
                detectedStudyDesc = meta.studyDescription.trim();
            }
        }

        const seqFriendly = getSequenceFriendlyName(grp.leafName || sampleFile.name);
        const studyId = `study_${key.replace(/[^a-zA-Z0-9_-]/g, '_')}_${grp.files.length}`;

        studies.push({
            id: studyId,
            subfolderPath: key,
            name: grp.leafName,
            rawName: grp.leafName,
            category: grp.categoryName,
            seriesDescription: meta?.seriesDescription || grp.leafName,
            sequenceName: seqFriendly.name,
            sequenceTag: seqFriendly.tag,
            tagColor: seqFriendly.color,
            imageCount: grp.files.length,
            files: grp.files,
            isNifti: isNii,
            modality: meta?.modality || 'MR',
            dateAcquired: meta?.dateAcquired || 'N/A',
            studyDate: meta?.studyDate || 'N/A',
            patientAge: meta?.patientAge || '',
            patientSex: meta?.patientSex || '',
            studyDescription: meta?.studyDescription || detectedStudyDesc,
            isLoaded: false,
            assembledData: null,
            thumbnailUrl: null
        });
    }

    const tree = buildDirectoryTree(studies, rootPatientName);

    return {
        patientName: rootPatientName,
        patientId: detectedPatientId,
        studyDescription: detectedStudyDesc,
        dateAdded: detectedDate,
        totalFilesCount: medicalFiles.length,
        studies,
        tree
    };
}

/**
 * Constructs a full recursive directory tree reflecting exact filesystem hierarchy.
 */
export function buildDirectoryTree(studies, rootPatientName = 'Patient Study') {
    if (!studies || studies.length === 0) return null;

    // Find common root prefix across all studies if present (e.g. "Stanford3T/")
    const pathSplits = studies.map((s) => (s.subfolderPath || '').split('/').filter(Boolean));
    let commonPrefixLen = 0;
    if (pathSplits.length > 0 && pathSplits[0].length > 1) {
        const first = pathSplits[0];
        for (let i = 0; i < first.length - 1; i++) {
            const seg = first[i];
            if (pathSplits.every((p) => p.length > i + 1 && p[i] === seg)) {
                commonPrefixLen++;
            } else {
                break;
            }
        }
    }

    const root = {
        id: 'node_root',
        name: rootPatientName,
        fullPath: '',
        isFolder: true,
        children: [],
        study: null,
        totalStudies: studies.length,
        totalImages: studies.reduce((sum, s) => sum + (s.imageCount || 0), 0)
    };

    for (const study of studies) {
        const fullParts = (study.subfolderPath || '').split('/').filter(Boolean);
        const parts = commonPrefixLen > 0 ? fullParts.slice(commonPrefixLen) : fullParts;

        if (parts.length === 0) {
            root.children.push({
                id: `study_${study.id}`,
                name: study.name,
                fullPath: study.name,
                isFolder: false,
                study,
                children: [],
                totalStudies: 1,
                totalImages: study.imageCount
            });
            continue;
        }

        let current = root;
        for (let i = 0; i < parts.length; i++) {
            const seg = parts[i];
            const isLast = i === parts.length - 1;
            const nodePath = parts.slice(0, i + 1).join('/');

            let existing = current.children.find((c) => c.name === seg);
            if (!existing) {
                existing = {
                    id: `dir_${nodePath.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
                    name: seg,
                    fullPath: nodePath,
                    isFolder: !isLast,
                    study: isLast ? study : null,
                    children: [],
                    totalStudies: 0,
                    totalImages: 0
                };
                current.children.push(existing);
            } else if (isLast) {
                existing.study = study;
            }

            existing.totalStudies += 1;
            existing.totalImages += (study.imageCount || 0);
            current = existing;
        }
    }

    // Sort children at each level: directories with sub-items first, then natural alphabetical sort
    const sortNode = (node) => {
        if (!node.children || node.children.length === 0) return;
        node.children.sort((a, b) => {
            const aHasChildren = a.children && a.children.length > 0;
            const bHasChildren = b.children && b.children.length > 0;
            if (aHasChildren && !bHasChildren) return -1;
            if (!aHasChildren && bHasChildren) return 1;
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });
        node.children.forEach(sortNode);
    };
    sortNode(root);

    return root;
}

/**
 * Collects all folder/branch node IDs in the tree for auto-expanding.
 */
export function collectAllFolderIds(rootNode) {
    const ids = new Set();
    const traverse = (node) => {
        if (!node) return;
        if (node.children && node.children.length > 0) {
            ids.add(node.id);
            node.children.forEach(traverse);
        }
    };
    traverse(rootNode);
    return ids;
}

/**
 * Lazy loads and assembles only the selected study on demand.
 */
export async function assembleSingleStudy(study) {
    if (!study) return null;
    if (study.isLoaded && study.assembledData) {
        return study.assembledData;
    }

    // 1. NIfTI file loading
    if (study.isNifti) {
        const file = study.files[0];
        const buffer = await file.arrayBuffer();
        const parsed = await parseMedicalFile(buffer, file.name);
        const thumb = generateThumbnailUrl(parsed);
        const seq = getSequenceFriendlyName(file.name);
        const seriesObj = {
            id: study.id,
            file,
            filename: file.name,
            parsed,
            thumbnailUrl: thumb,
            numSlices: parsed.numSlices,
            numTimeFrames: parsed.numTimeFrames,
            cols: parsed.cols,
            rows: parsed.rows,
            type: parsed.type,
            viewType: seq.name,
            hasLocalization: false,
            localizedResult: null
        };
        study.isLoaded = true;
        study.assembledData = seriesObj;
        study.thumbnailUrl = thumb;
        return seriesObj;
    }

    // 2. DICOM files assembly (only for this study's files!)
    const assembledList = await groupAndAssembleDicomFiles(study.files);
    if (!assembledList || assembledList.length === 0) return null;

    const primarySeries = assembledList[0];
    primarySeries.id = study.id;
    primarySeries.filename = study.name;
    primarySeries.viewType = study.sequenceName || study.name;
    primarySeries.seriesDescription = study.seriesDescription || null;

    study.isLoaded = true;
    study.assembledData = primarySeries;
    study.thumbnailUrl = primarySeries.thumbnailUrl;
    study.numSlices = primarySeries.numSlices;
    study.numTimeFrames = primarySeries.numTimeFrames;

    return primarySeries;
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
        const info = parsed.getSliceInfo ? parsed.getSliceInfo(midSlice, midTime) : null;

        const offCanvas = document.createElement('canvas');
        renderSliceToCanvas(
            offCanvas,
            sliceData,
            info?.cols || parsed.cols,
            info?.rows || parsed.rows,
            info?.wc ?? parsed.defaultWindowCenter,
            info?.ww ?? parsed.defaultWindowWidth,
            info?.min ?? parsed.min,
            info?.max ?? parsed.max
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


