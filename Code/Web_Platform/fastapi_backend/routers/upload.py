import io
import pydicom
import uuid
import nibabel as nib
import gzip
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from services.dicom_service import read_dicom_from_bytes, get_pixel_array, save_dicom_file
from services.clinical_service import extract_patient_id, get_clinical_data, extract_clinical_from_dicom
from config import UPLOAD_DIR

router = APIRouter(prefix="/upload", tags=["Upload"])

def load_nifti_from_bytes(file_bytes: bytes, filename: str):
    """Load NIfTI volume directly from memory buffer (supporting .nii and .nii.gz)."""
    if filename.lower().endswith(".gz"):
        with gzip.GzipFile(fileobj=io.BytesIO(file_bytes), mode="rb") as gz:
            decompressed = gz.read()
        fh = nib.FileHolder(fileobj=io.BytesIO(decompressed))
    else:
        fh = nib.FileHolder(fileobj=io.BytesIO(file_bytes))
    return nib.Nifti1Image.from_file_map({'header': fh, 'image': fh})

@router.post("/dicom", summary="Upload a DICOM file and get its metadata & clinical data")
@router.post("-dicom/", include_in_schema=False)
async def upload_dicom(dicom_file: UploadFile = File(...)):
    filename = dicom_file.filename.lower()
    if not (filename.endswith(".dcm") or filename.endswith(".dicom")):
        raise HTTPException(status_code=400, detail="File must be .dcm or .dicom")
    
    file_bytes = await dicom_file.read()
    try:
        ds = read_dicom_from_bytes(file_bytes)
        pixel_array = get_pixel_array(ds)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or unreadable DICOM file.")

    unique_id = uuid.uuid4().hex
    try:
        save_dicom_file(file_bytes, UPLOAD_DIR / f"{unique_id}_{dicom_file.filename}")
    except Exception:
        pass

    # Extract Patient ID and query clinical dataset directly from authoritative DICOM headers
    patient_id = extract_patient_id(dicom_file.filename, ds=ds)
    clinical_info = extract_clinical_from_dicom(ds=ds, filename=dicom_file.filename)

    def safe_get(tag):
        val = getattr(ds, tag, None)
        return str(val).strip() if val is not None and str(val).strip() not in ("", "None") else None

    num_frames = safe_get("NumberOfFrames")
    is_multi_frame = num_frames is not None and num_frames.isdigit() and int(num_frames) > 1
    trigger_time = safe_get("TriggerTime")
    inversion_time = safe_get("InversionTime")
    slice_loc = safe_get("SliceLocation")
    series_desc = safe_get("SeriesDescription")
    echo_time = safe_get("EchoTime")

    # Dynamic Dimensionality Detection
    if is_multi_frame and (trigger_time or "cine" in str(series_desc).lower() or safe_get("CardiacNumberOfImages")):
        dimensionality = "4D CINE (Multi-frame)"
    elif is_multi_frame:
        dimensionality = "3D/4D Multi-frame Volume"
    elif inversion_time:
        dimensionality = "T1 Mapping (Multi-TI)"
    elif trigger_time or ("cine" in str(series_desc).lower()):
        dimensionality = "4D CINE Timeframe"
    elif slice_loc:
        dimensionality = "3D Volume Slice"
    else:
        dimensionality = "2D Single Slice"

    # Build metadata with only present DICOM tags (skip None/absent ones)
    raw_meta = {
        "PatientName":         safe_get("PatientName"),
        "PatientID":           patient_id if patient_id != "Unknown" else safe_get("PatientID"),
        "StudyDate":           safe_get("StudyDate"),
        "Modality":            safe_get("Modality"),
        "Dimensionality":      dimensionality,
        "SeriesInstanceUID":   safe_get("SeriesInstanceUID"),
        "SeriesDescription":   series_desc,
        "SeriesNumber":        safe_get("SeriesNumber"),
        "Rows":                safe_get("Rows"),
        "Columns":             safe_get("Columns"),
        "ImageShape":          str(pixel_array.shape),
        "SliceLocation":       slice_loc,
        "ImagePositionPatient":safe_get("ImagePositionPatient"),
        "InversionTime":       inversion_time,
        "NumberOfFrames":      num_frames,
        "IsCine":              is_multi_frame or ("cine" in str(series_desc).lower()),
        "HeartRate":           safe_get("HeartRate"),
        "TriggerTime":         trigger_time,
        "NominalInterval":     safe_get("NominalInterval"),
        "RepetitionTime":      safe_get("RepetitionTime"),
        "EchoTime":            echo_time,
    }
    metadata = {k: v for k, v in raw_meta.items() if v is not None}
    metadata["ClinicalData"] = clinical_info  # always include

    return {
        "message": "DICOM uploaded successfully",
        "filename": dicom_file.filename,
        "patient_id": patient_id,
        "clinical_data": clinical_info,
        "metadata": metadata,
    }

@router.post("/nifti", summary="Upload a NIfTI file and get its metadata & clinical data")
async def upload_nifti(nifti_file: UploadFile = File(...)):
    filename = nifti_file.filename.lower()
    if not (filename.endswith(".nii") or filename.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="File must be .nii or .nii.gz")
    
    file_bytes = await nifti_file.read()
    
    try:
        nifti_img = load_nifti_from_bytes(file_bytes, nifti_file.filename)
        header = nifti_img.header
        shape = header.get_data_shape()
        zooms = header.get_zooms()
        dtype = str(header.get_data_dtype())
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid NIfTI file: {str(e)}")

    # Optionally persist for localizer if disk allows
    try:
        unique_id = uuid.uuid4().hex
        ext = ".nii.gz" if filename.endswith(".nii.gz") else ".nii"
        saved_path = UPLOAD_DIR / f"{unique_id}{ext}"
        with open(saved_path, "wb") as f:
            f.write(file_bytes)
    except Exception:
        pass

    dim_count = len(shape)
    cols = shape[0] if dim_count > 0 else 0
    rows = shape[1] if dim_count > 1 else 0
    slices = shape[2] if dim_count > 2 else 1
    time_frames = shape[3] if dim_count > 3 else 1
    is_cine = time_frames > 1

    # Extract Patient ID (e.g. 001 from 001_SA_CINE.nii) and query clinical dataset
    patient_id = extract_patient_id(nifti_file.filename)
    clinical_info = get_clinical_data(patient_id, filename=nifti_file.filename)

    return {
        "message": "NIfTI uploaded successfully",
        "filename": nifti_file.filename,
        "patient_id": patient_id,
        "clinical_data": clinical_info,
        "metadata": {
            "Dimensions": str(shape),
            "TotalSlices": slices,
            "TimeFrames": time_frames,
            "IsCine": is_cine,
            "VoxelSizes": " x ".join(f"{z:.2f}" for z in zooms),
            "TemporalResolution": f"{zooms[3]:.2f} ms" if dim_count > 3 else "N/A",
            "DataType": dtype,
            "PatientID": patient_id,
            "ClinicalData": clinical_info,
        }
    }

@router.get("/clinical/{patient_id}", summary="Lookup patient clinical profile and lab results")
async def lookup_clinical(patient_id: str, filename: str = ""):
    """Directly fetch patient clinical history and laboratory biomarkers by ID."""
    info = get_clinical_data(patient_id, filename=filename)
    return JSONResponse(content=info)

@router.post("/extract-metadata", summary="Extract metadata from a DICOM or NIfTI file")
async def extract_metadata(file: UploadFile = File(None), dicom_file: UploadFile = File(None)):
    target_file = file or dicom_file
    if not target_file:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    filename = target_file.filename.lower()
    file_bytes = await target_file.read()

    if filename.endswith((".dcm", ".dicom")):
        try:
            ds = pydicom.dcmread(io.BytesIO(file_bytes))
            metadata = {}
            for elem in ds:
                if elem.name != 'Pixel Data':
                    tag_str = f"({elem.tag.group:04X}, {elem.tag.element:04X})"
                    metadata[tag_str] = {
                        "name": elem.name,
                        "value": str(elem.value)
                    }
            return JSONResponse(content=metadata)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to extract DICOM metadata: {str(e)}")

    elif filename.endswith((".nii", ".nii.gz")):
        try:
            nifti_img = load_nifti_from_bytes(file_bytes, target_file.filename)
            header = nifti_img.header
            shape = header.get_data_shape()
            zooms = header.get_zooms()
            dtype = str(header.get_data_dtype())

            dim_count = len(shape)
            slices = shape[2] if dim_count > 2 else 1
            time_frames = shape[3] if dim_count > 3 else 1
            is_4d = dim_count >= 4 and time_frames > 1

            metadata = {
                "Dimensions": {
                    "name": "Dimensions (X, Y, Z, T)" if is_4d else "Dimensions (X, Y, Z)",
                    "value": f"{shape} {'[4D CINE Cardiac Cycle]' if is_4d else '[3D Volume]'}"
                },
                "VoxelSizes": {
                    "name": "Voxel Sizes (mm)",
                    "value": " x ".join(f"{z:.2f}" for z in zooms[:3])
                },
                "Total Slices": {
                    "name": "Spatial Slices (Z)",
                    "value": str(slices)
                },
                "Time Frames": {
                    "name": "Cardiac Phases / Time-Frames (T)",
                    "value": str(time_frames) if is_4d else "1 (Static)"
                },
                "Temporal Resolution": {
                    "name": "Temporal Spacing / TR",
                    "value": f"{zooms[3]:.2f} ms" if dim_count > 3 else "N/A"
                },
                "DataType": {
                    "name": "Raw Data Type",
                    "value": dtype
                },
                "Modality": {
                    "name": "Modality / Scan Type",
                    "value": "4D Cardiac CINE MRI" if is_4d else "NIfTI MRI/CT"
                }
            }
            return JSONResponse(content=metadata)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to extract NIfTI metadata: {str(e)}")
    else:
        raise HTTPException(status_code=400, detail="Unsupported file format. Must be .dcm, .dicom, .nii, or .nii.gz")
