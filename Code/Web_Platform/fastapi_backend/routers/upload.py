import io
import uuid
import nibabel as nib
import gzip
from fastapi import APIRouter, UploadFile, File, HTTPException
from services.dicom_service import read_dicom_from_bytes, get_pixel_array, save_dicom_file
from config import UPLOAD_DIR

router = APIRouter(prefix="/upload", tags=["Upload"])

@router.post("/dicom", summary="Upload a DICOM file and get its metadata")
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
    save_dicom_file(file_bytes, UPLOAD_DIR / f"{unique_id}_{dicom_file.filename}")
    def safe_get(tag):
        val = getattr(ds, tag, None)
        return str(val) if val is not None else "N/A"
    return {
        "message": "DICOM uploaded successfully",
        "filename": dicom_file.filename,
        "metadata": {
            "PatientName": safe_get("PatientName"),
            "PatientID": safe_get("PatientID"),
            "StudyDate": safe_get("StudyDate"),
            "Modality": safe_get("Modality"),
            "Rows": safe_get("Rows"),
            "Columns": safe_get("Columns"),
            "ImageShape": str(pixel_array.shape),
        }
    }

@router.post("/nifti", summary="Upload a NIfTI file and get its metadata")
async def upload_nifti(nifti_file: UploadFile = File(...)):
    filename = nifti_file.filename.lower()
    if not (filename.endswith(".nii") or filename.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="File must be .nii or .nii.gz")
    file_bytes = await nifti_file.read()
    unique_id = uuid.uuid4().hex
    ext = ".nii.gz" if filename.endswith(".nii.gz") else ".nii"
    saved_path = UPLOAD_DIR / f"{unique_id}{ext}"
    with open(saved_path, "wb") as f:
        f.write(file_bytes)
    try:
        nifti_img = nib.load(str(saved_path))
        header = nifti_img.header
        shape = header.get_data_shape()
        zooms = header.get_zooms()
        dtype = str(header.get_data_dtype())
    except Exception as e:
        if saved_path.exists():
            saved_path.unlink()
        raise HTTPException(status_code=400, detail=f"Invalid NIfTI file: {str(e)}")
    return {
        "message": "NIfTI uploaded successfully",
        "filename": nifti_file.filename,
        "metadata": {
            "Dimensions": str(shape),
            "VoxelSizes": str(zooms),
            "DataType": dtype,
        }
    }

