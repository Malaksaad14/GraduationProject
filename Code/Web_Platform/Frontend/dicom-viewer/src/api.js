/**
 * api.js — Centralized API service for the FastAPI backend.
 *
 * Base URL: http://127.0.0.1:8000
 */

const BASE_URL = 'http://127.0.0.1:8000';

/**
 * Upload a DICOM file and receive its metadata and patient clinical data.
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
    return {
        ...(data.metadata || {}),
        clinical_data: data.clinical_data || data.metadata?.ClinicalData,
        patient_id: data.patient_id,
        filename: data.filename,
        message: data.message
    };
}

/**
 * Upload a NIfTI file and receive its metadata and patient clinical data.
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

    const data = await response.json();
    return {
        ...data,
        clinical_data: data.clinical_data || data.metadata?.ClinicalData,
    };
}

/**
 * Direct lookup for clinical data & lab results by patient ID.
 */
export async function getClinicalData(patientId) {
    const response = await fetch(`${BASE_URL}/upload/clinical/${patientId}`);
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Clinical lookup failed (${response.status})`);
    }
    return response.json();
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

export const sendToLocalizer = localizeDicom;

/**
 * Run segmentation on a DICOM file.
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
 * Health check.
 */
export async function healthCheck() {
    const response = await fetch(`${BASE_URL}/health`);
    return response.json();
}


/**
 * Check Gemini Chatbot health and active model configuration.
 */
export async function getChatbotHealth() {
    try {
        const response = await fetch(`${BASE_URL}/chatbot/health`);
        if (!response.ok) return { status: 'offline', model: 'gemini-3.5-flash', api_key_set: false };
        return await response.json();
    } catch {
        return { status: 'offline', model: 'gemini-3.5-flash', api_key_set: false };
    }
}

/**
 * Send a message to the Gemini AI chatbot.
 * @param {string} message - User query.
 * @param {object|null} scanContext - Optional scan metadata.
 * @param {boolean} isLocalized - Whether LV localizer has run.
 * @returns {{ reply: string, model: string }}
 */
export async function askChatbot(message, scanContext = null, isLocalized = false) {
    const response = await fetch(`${BASE_URL}/chatbot/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            scan_context: scanContext,
            is_localized: isLocalized,
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Chatbot request failed (${response.status})`);
    }

    return response.json();
}
