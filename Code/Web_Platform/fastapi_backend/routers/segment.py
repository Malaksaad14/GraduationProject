import io
import uuid
import shutil
import nibabel as nib
import numpy as np
import pydicom
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from config import UPLOAD_DIR, OUTPUT_DIR

router = APIRouter(prefix="/segment", tags=["Segmentation"])

@router.post("/dicom", summary="Segment a DICOM file (placeholder)")
async def segment_dicom(dicom_file: UploadFile = File(...)):
    filename = dicom_file.filename.lower()
    if not (filename.endswith(".dcm") or filename.endswith(".dicom")):
        raise HTTPException(status_code=400, detail="File must be .dcm or .dicom")
    file_bytes = await dicom_file.read()
    unique_id = uuid.uuid4().hex
    input_path = UPLOAD_DIR / f"input_{unique_id}.dcm"
    output_path = OUTPUT_DIR / f"segmentation_{unique_id}.dcm"
    with open(input_path, "wb") as f:
        f.write(file_bytes)
    try:
        ds = pydicom.dcmread(str(input_path))
        if "PixelData" not in ds:
            raise HTTPException(status_code=400, detail="No pixel data in DICOM.")
        # TODO: Replace with actual model → from services.model_service import run_segmentation
        mock_mask = np.zeros_like(ds.pixel_array, dtype=np.uint16)
        out_ds = ds.copy()
        out_ds.PixelData = mock_mask.tobytes()
        out_ds.SeriesDescription = "Segmentation Result (Placeholder)"
        out_ds.BitsAllocated = 16
        out_ds.BitsStored = 16
        out_ds.HighBit = 15
        out_ds.PixelRepresentation = 0
        out_ds.save_as(str(output_path))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")
    finally:
        if input_path.exists():
            input_path.unlink()
    return FileResponse(path=str(output_path), media_type="application/dicom",
                        filename="segmentation_result.dcm")

@router.post("/nifti", summary="Segment a NIfTI file (placeholder)")
async def segment_nifti(nifti_file: UploadFile = File(...)):
    filename = nifti_file.filename.lower()
    if not (filename.endswith(".nii") or filename.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="File must be .nii or .nii.gz")
    file_bytes = await nifti_file.read()
    unique_id = uuid.uuid4().hex
    ext = ".nii.gz" if filename.endswith(".nii.gz") else ".nii"
    input_path = UPLOAD_DIR / f"input_{unique_id}{ext}"
    output_path = OUTPUT_DIR / f"predicted_{unique_id}{ext}"
    with open(input_path, "wb") as f:
        f.write(file_bytes)
    try:
        # TODO: Replace with actual model
        shutil.copy(input_path, output_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")
    finally:
        if input_path.exists():
            input_path.unlink()
    return FileResponse(path=str(output_path), media_type="application/gzip",
                        filename="segmentation_result.nii.gz")
