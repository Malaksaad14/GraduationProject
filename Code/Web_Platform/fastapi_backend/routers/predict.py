import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from config import UPLOAD_DIR, OUTPUT_DIR

router = APIRouter(prefix="/predict", tags=["Prediction"])


@router.post("/nifti", summary="Run segmentation model on a NIfTI file")
async def predict_nifti(nifti_file: UploadFile = File(...)):
    """
    Upload a NIfTI file (.nii or .nii.gz),
    run the segmentation model, and return the predicted mask as NIfTI.
    """
    filename = nifti_file.filename.lower()
    if not (filename.endswith(".nii") or filename.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="File must be .nii or .nii.gz")

    file_bytes = await nifti_file.read()

    unique_id = uuid.uuid4().hex
    ext = ".nii.gz" if filename.endswith(".nii.gz") else ".nii"
    input_path = UPLOAD_DIR / f"input_{unique_id}{ext}"
    output_path = OUTPUT_DIR / f"predicted_{unique_id}.nii.gz"

    # Save input file
    with open(input_path, "wb") as f:
        f.write(file_bytes)

    try:
        # TODO: Replace with actual model inference
        # from services.model_service import run_nnunet
        # run_nnunet(input_path, output_path)

        # Placeholder: copy input as output
        import shutil
        shutil.copy(input_path, output_path)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")
    finally:
        # Clean up input file
        if input_path.exists():
            input_path.unlink()

    return FileResponse(
        path=str(output_path),
        media_type="application/gzip",
        filename="predicted_segmentation.nii.gz"
    )


@router.post("/dicom", summary="Run segmentation model on a DICOM file")
async def predict_dicom(dicom_file: UploadFile = File(...)):
    """
    Upload a DICOM file, run the segmentation model,
    and return the predicted segmentation mask as a DICOM file.
    """
    filename = dicom_file.filename.lower()
    if not (filename.endswith(".dcm") or filename.endswith(".dicom")):
        raise HTTPException(status_code=400, detail="File must be .dcm or .dicom")

    file_bytes = await dicom_file.read()

    unique_id = uuid.uuid4().hex
    input_path = UPLOAD_DIR / f"input_{unique_id}.dcm"
    output_path = OUTPUT_DIR / f"segmentation_{unique_id}.dcm"

    # Save input file
    with open(input_path, "wb") as f:
        f.write(file_bytes)

    try:
        import pydicom
        import numpy as np

        # Validate DICOM
        ds = pydicom.dcmread(str(input_path))
        if "PixelData" not in ds:
            raise HTTPException(status_code=400, detail="DICOM file has no pixel data.")

        # TODO: Replace with actual model inference
        # from services.model_service import run_segmentation
        # result = run_segmentation(ds.pixel_array)

        # Placeholder: return a blank mask same size as input
        pixel_array = ds.pixel_array
        mock_mask = np.zeros_like(pixel_array, dtype=np.uint16)

        # Build output DICOM
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
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")
    finally:
        if input_path.exists():
            input_path.unlink()

    return FileResponse(
        path=str(output_path),
        media_type="application/dicom",
        filename="segmentation_result.dcm"
    )
