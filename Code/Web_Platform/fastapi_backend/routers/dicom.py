import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from services.dicom_service import (
    read_dicom_from_bytes,
    extract_metadata,
    save_dicom_file,
    get_pixel_array,
    dicom_to_base64,
)
from config import UPLOAD_DIR

router = APIRouter(prefix="/dicom", tags=["DICOM"])


@router.post("/upload", summary="Upload a DICOM file and get its metadata")
async def upload_dicom(dicom_file: UploadFile = File(...)):
    """
    Upload a DICOM file.
    Returns all DICOM metadata tags (excluding pixel data).
    """
    if not dicom_file.filename.lower().endswith((".dcm", ".dicom")):
        raise HTTPException(status_code=400, detail="File must be a .dcm or .dicom file.")

    file_bytes = await dicom_file.read()

    try:
        ds = read_dicom_from_bytes(file_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid DICOM file.")

    metadata = extract_metadata(ds)
    return JSONResponse(content={"filename": dicom_file.filename, "metadata": metadata})



@router.post("/send-to-localizer", summary="Localize the left ventricle in a single DICOM slice")
async def send_to_localizer(dicom_file: UploadFile = File(...)):
    """
    Upload a single DICOM slice, run the LV localizer model,
    and return the cropped ROI as a base64-encoded DICOM file.
    """
    file_bytes = await dicom_file.read()

    try:
        ds = read_dicom_from_bytes(file_bytes)
        pixel_array = get_pixel_array(ds)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid DICOM file.")

    # Save uploaded file
    unique_id = uuid.uuid4().hex
    save_path = UPLOAD_DIR / f"{unique_id}_{dicom_file.filename}"
    save_dicom_file(file_bytes, save_path)

    LOCALIZER_WEIGHTS_PATH = Path(__file__).resolve().parent.parent / "weights" / "model.pt"
    if not LOCALIZER_WEIGHTS_PATH.exists():
        raise HTTPException(status_code=503, detail="Localizer model weights not found in weights/model.pt")

    try:
        from services.localizer_service import run_localizer
        result = run_localizer(pixel_array, str(LOCALIZER_WEIGHTS_PATH))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Localizer inference failed: {str(e)}")

    # Build response DICOM with result
    new_ds = ds.copy()
    new_ds.PixelData = result.tobytes()
    new_ds.Rows, new_ds.Columns = result.shape[:2]

    output_path = UPLOAD_DIR / f"localized_{unique_id}.dcm"
    new_ds.save_as(str(output_path))

    dicom_b64 = dicom_to_base64(output_path)

    return JSONResponse(content={
        "message": "Localization complete (placeholder)",
        "dicom_file_data": dicom_b64,
        "processed_file_name": output_path.name
    })
