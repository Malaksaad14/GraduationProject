/**
 * api.js — Centralized API service for the FastAPI backend.
 *
 * Base URL: http://127.0.0.1:8000
 *
 * FastAPI route map:
 *   POST /upload/dicom              – upload a DICOM file, returns { filename, metadata }
 *   POST /upload/nifti              – upload a NIfTI file, returns { filename, metadata }
 *   POST /upload/extract-metadata    – extract metadata, returns flat metadata dict
 *   POST /localizer/dicom           – LV localizer for DICOM, returns { message, filename, dicom_file_data }
 *   POST /localizer/nifti           – LV localizer for NIfTI, returns { message, filename, nifti_file_data }
 *   POST /segment/dicom             – nnU-Net segmentation for DICOM, returns DICOM blob
 *   POST /segment/nifti             – nnU-Net segmentation for NIfTI, returns NIfTI blob
 *   POST /convert/dicom-to-nifti      – convert DICOM to NIfTI blob
 *   POST /convert/nifti-to-dicom      – convert NIfTI to DICOM blob
 */

const BASE_URL = 'http://127.0.0.1:8000';

/**
 * Upload a DICOM file and receive its metadata.
 */
export async function uploadDicom(file) {
    const formData = new FormData();
    formData.append('dicom_file', file);

    const response = await fetch(`${BASE_URL}/upload/dicom`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Upload failed (${response.status})`);
    }

    const data = await response.json();
    return data.metadata ?? data;
}

/**
 * Extract metadata from a DICOM file without saving it.
 */
export async function extractDicomMetadata(file) {
    const formData = new FormData();
    formData.append('dicom_file', file);

    const response = await fetch(`${BASE_URL}/upload/extract-metadata`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Metadata extraction failed (${response.status})`);
    }

    return response.json();
}

/**
 * Send a DICOM file to the LV localizer model.
 * Returns { message, filename, dicom_file_data (base64) }
 */
export async function localizeDicom(file) {
    const formData = new FormData();
    formData.append('dicom_file', file);

    const response = await fetch(`${BASE_URL}/localizer/dicom`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `DICOM Localizer request failed (${response.status})`);
    }

    return response.json();
}

/**
 * Send a NIfTI file to the LV localizer model.
 * Returns { message, filename, nifti_file_data (base64) }
 */
export async function localizeNifti(file) {
    const formData = new FormData();
    formData.append('nifti_file', file);

    const response = await fetch(`${BASE_URL}/localizer/nifti`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `NIfTI Localizer request failed (${response.status})`);
    }

    return response.json();
}

// Backward compatibility alias
export const sendToLocalizer = localizeDicom;

/**
 * Run segmentation on a DICOM file.
 * Returns DICOM file blob
 */
export async function predictDicom(file) {
    const formData = new FormData();
    formData.append('dicom_file', file);

    const response = await fetch(`${BASE_URL}/segment/dicom`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Prediction failed (${response.status})`);
    }

    return response;
}

/**
 * Run segmentation on a NIfTI file.
 * Returns NIfTI file blob
 */
export async function predictNifti(file) {
    const formData = new FormData();
    formData.append('nifti_file', file);

    const response = await fetch(`${BASE_URL}/segment/nifti`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `NIfTI prediction failed (${response.status})`);
    }

    return response;
}

/**
 * Upload a NIfTI file and receive its metadata.
 */
export async function uploadNifti(file) {
    const formData = new FormData();
    formData.append('nifti_file', file);

    const response = await fetch(`${BASE_URL}/upload/nifti`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `NIfTI upload failed (${response.status})`);
    }

    return response.json();
}

/**
 * Convert a NIfTI file to DICOM.
 */
export async function niftiToDicom(file) {
    const formData = new FormData();
    formData.append('nifti_file', file);

    const response = await fetch(`${BASE_URL}/convert/nifti-to-dicom`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `NIfTI-to-DICOM conversion failed (${response.status})`);
    }

    return response;
}

/**
 * Convert a DICOM file to NIfTI.
 */
export async function dicomToNifti(file) {
    const formData = new FormData();
    formData.append('dicom_file', file);

    const response = await fetch(`${BASE_URL}/convert/dicom-to-nifti`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `DICOM-to-NIfTI conversion failed (${response.status})`);
    }

    return response;
}

/**
 * Health check — verify the backend is reachable.
 * Returns { status: "ok" } on success.
 */
export async function healthCheck() {
    const response = await fetch(`${BASE_URL}/health`);
    return response.json();
}
