import io
import uuid
import base64
import nibabel as nib
import numpy as np
import pydicom
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from services.dicom_service import read_dicom_from_bytes, get_pixel_array, save_dicom_file
from services.localizer_service import run_localizer, run_localizer_3d
from config import UPLOAD_DIR, OUTPUT_DIR

router = APIRouter(prefix="/localizer", tags=["Localization"])

WEIGHTS_PATH = Path(__file__).resolve().parent.parent / "weights" / "model.pt"

@router.post("/dicom", summary="Localize LV in a DICOM file")
async def localize_dicom(dicom_file: UploadFile = File(...)):
    filename = dicom_file.filename.lower()
    if not (filename.endswith(".dcm") or filename.endswith(".dicom")):
        raise HTTPException(status_code=400, detail="File must be .dcm or .dicom")
    if not WEIGHTS_PATH.exists():
        raise HTTPException(status_code=503, detail="Localizer model weights not found at weights/model.pt")
    file_bytes = await dicom_file.read()
    try:
        ds = read_dicom_from_bytes(file_bytes)
        pixel_array = get_pixel_array(ds)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid DICOM file.")
    try:
        result = run_localizer(pixel_array, str(WEIGHTS_PATH))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Localizer failed: {str(e)}")
    # Build output DICOM
    unique_id = uuid.uuid4().hex
    out_path = OUTPUT_DIR / f"localized_{unique_id}.dcm"
    new_ds = ds.copy()
    new_ds.PixelData = result.tobytes()
    new_ds.Rows, new_ds.Columns = result.shape[:2]
    new_ds.SeriesDescription = "Localized LV ROI"
    new_ds.save_as(str(out_path))
    with open(out_path, "rb") as f:
        dicom_b64 = base64.b64encode(f.read()).decode("utf-8")
    return JSONResponse(content={
        "message": "Localization complete",
        "filename": dicom_file.filename,
        "dicom_file_data": dicom_b64,
    })

@router.post("/nifti", summary="Localize LV in a NIfTI file")
async def localize_nifti(nifti_file: UploadFile = File(...)):
    filename = nifti_file.filename.lower()
    if not (filename.endswith(".nii") or filename.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="File must be .nii or .nii.gz")
    if not WEIGHTS_PATH.exists():
        raise HTTPException(status_code=503, detail="Localizer model weights not found at weights/model.pt")
    file_bytes = await nifti_file.read()
    unique_id = uuid.uuid4().hex
    ext = ".nii.gz" if filename.endswith(".nii.gz") else ".nii"
    temp_input_path = UPLOAD_DIR / f"temp_{unique_id}{ext}"
    out_path = OUTPUT_DIR / f"localized_{unique_id}{ext}"
    
    with open(temp_input_path, "wb") as f:
        f.write(file_bytes)
        
    try:
        nifti_img = nib.load(str(temp_input_path))
        data = nifti_img.get_fdata().astype(np.float32)
        if data.ndim != 3:
            raise ValueError(f"Expected a 3D NIfTI volume, got shape {data.shape}")
        cropped = run_localizer_3d(data, str(WEIGHTS_PATH))
        out_nii = nib.Nifti1Image(cropped, nifti_img.affine, nifti_img.header)
        nib.save(out_nii, str(out_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Localization failed: {str(e)}")
    finally:
        if temp_input_path.exists():
            temp_input_path.unlink()
            
    return FileResponse(path=str(out_path), media_type="application/gzip",
                        filename=f"localized_{nifti_file.filename}")

