import uuid
from pathlib import Path

import nibabel as nib
import numpy as np
import pydicom
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from config import OUTPUT_DIR, UPLOAD_DIR
from services.segmentation_service import NoLVCenterError, run_segmentation_pipeline

router = APIRouter(prefix="/segment", tags=["Segmentation"])


def _dicom_to_temp_nifti(dicom_bytes: bytes, out_path: Path) -> None:
    """Convert a 2D or multi-frame DICOM into a 3D NIfTI with positive mm spacing."""
    temp_dcm = out_path.with_suffix(".dcm")
    with open(temp_dcm, "wb") as f:
        f.write(dicom_bytes)
    try:
        ds = pydicom.dcmread(str(temp_dcm))
        if "PixelData" not in ds:
            raise ValueError("No pixel data in DICOM.")

        arr = ds.pixel_array.astype(np.float32)
        if arr.ndim == 2:
            arr = arr[:, :, np.newaxis]
        elif arr.ndim == 3:
            # Multi-frame DICOM is (frames, rows, cols) -> transpose to (rows, cols, frames)
            arr = np.transpose(arr, (1, 2, 0))
        else:
            raise ValueError(f"Unsupported DICOM pixel array dimensions: {arr.ndim}D")

        px_spacing = getattr(ds, "PixelSpacing", [1.0, 1.0])
        sy = float(px_spacing[0]) if len(px_spacing) > 0 and float(px_spacing[0]) > 0 else 1.0
        sx = float(px_spacing[1]) if len(px_spacing) > 1 and float(px_spacing[1]) > 0 else 1.0
        sz = float(getattr(ds, "SliceThickness", 1.0) or 1.0)
        if sz <= 0:
            sz = 1.0

        affine = np.diag([sy, sx, sz, 1.0])
        nifti_img = nib.Nifti1Image(arr, affine)
        nifti_img.header.set_xyzt_units("mm")
        nifti_img.header.set_qform(affine, code=1)
        nifti_img.header.set_sform(affine, code=1)
        nib.save(nifti_img, str(out_path))
    finally:
        if temp_dcm.exists():
            temp_dcm.unlink(missing_ok=True)


@router.post("/dicom", summary="Preprocess and segment a DICOM scan")
async def segment_dicom(
    dicom_file: UploadFile = File(...),
    return_file: bool = Query(False, description="Return raw .nii.gz mask file instead of JSON"),
):
    filename = (dicom_file.filename or "").lower()
    if not (filename.endswith(".dcm") or filename.endswith(".dicom")):
        raise HTTPException(status_code=400, detail="File must be .dcm or .dicom")

    file_bytes = await dicom_file.read()
    unique_id = uuid.uuid4().hex
    input_nifti_path = UPLOAD_DIR / f"input_{unique_id}.nii.gz"

    try:
        _dicom_to_temp_nifti(file_bytes, input_nifti_path)
        result = run_segmentation_pipeline(input_nifti_path, unique_id)
    except NoLVCenterError as e:
        raise HTTPException(status_code=422, detail=f"LV localization failed during preprocessing: {str(e)}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")
    finally:
        if input_nifti_path.exists():
            input_nifti_path.unlink(missing_ok=True)

    if return_file:
        return FileResponse(
            path=str(result["full_mask_path"]),
            media_type="application/gzip",
            filename="segmentation_result.nii.gz",
        )

    return JSONResponse(
        content={
            "message": "Segmentation complete",
            "filename": dicom_file.filename,
            "mask_nifti_data": result["mask_nifti_data"],
            "roi_mask_nifti_data": result["roi_mask_nifti_data"],
            "preprocessed_nifti_data": result["preprocessed_nifti_data"],
            "labels": result["labels"],
            "label_counts": result["label_counts"],
            "original_shape": result["original_shape"],
            "preprocessed_shape": result["preprocessed_shape"],
            "crop_start": result["crop_start"],
            "dataset": result["dataset"],
        }
    )


@router.post("/nifti", summary="Preprocess and segment a 3D NIfTI volume")
async def segment_nifti(
    nifti_file: UploadFile = File(...),
    return_file: bool = Query(False, description="Return raw .nii.gz mask file instead of JSON"),
):
    filename = (nifti_file.filename or "").lower()
    if not (filename.endswith(".nii") or filename.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="File must be .nii or .nii.gz")

    file_bytes = await nifti_file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded NIfTI file is empty.")

    unique_id = uuid.uuid4().hex
    # Detect gzip by magic bytes rather than filename alone (handles uncompressed files named .nii.gz)
    is_gzip = file_bytes[:2] == b"\x1f\x8b"
    ext = ".nii.gz" if is_gzip else ".nii"
    input_path = UPLOAD_DIR / f"input_{unique_id}{ext}"

    with open(input_path, "wb") as f:
        f.write(file_bytes)

    try:
        result = run_segmentation_pipeline(input_path, unique_id)
    except NoLVCenterError as e:
        raise HTTPException(status_code=422, detail=f"LV localization failed during preprocessing: {str(e)}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")
    finally:
        if input_path.exists():
            input_path.unlink(missing_ok=True)

    if return_file:
        return FileResponse(
            path=str(result["full_mask_path"]),
            media_type="application/gzip",
            filename="segmentation_result.nii.gz",
        )

    return JSONResponse(
        content={
            "message": "Segmentation complete",
            "filename": nifti_file.filename,
            "mask_nifti_data": result["mask_nifti_data"],
            "roi_mask_nifti_data": result["roi_mask_nifti_data"],
            "preprocessed_nifti_data": result["preprocessed_nifti_data"],
            "labels": result["labels"],
            "label_counts": result["label_counts"],
            "original_shape": result["original_shape"],
            "preprocessed_shape": result["preprocessed_shape"],
            "crop_start": result["crop_start"],
            "dataset": result["dataset"],
        }
    )
