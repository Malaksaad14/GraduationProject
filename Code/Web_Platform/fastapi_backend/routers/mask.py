"""
mask.py — Multi-Label Brush Mask Editor Endpoint
Receives a flat binary Uint8Array (values 0, 1, 2, 3...) from the frontend brush tool,
reconstructs the 3D mask, and saves it as a NIfTI .nii.gz file.
"""

import os
import struct
import gzip
from typing import Optional
import numpy as np
from fastapi import APIRouter, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse, FileResponse

router = APIRouter(prefix="/mask", tags=["mask"])

MASK_OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "outputs", "masks")
os.makedirs(MASK_OUTPUT_DIR, exist_ok=True)


def _extract_nifti_spatial_header(raw_bytes: bytes) -> Optional[bytes]:
    """Decompress if .nii.gz and return the 348-byte NIfTI-1 header if valid."""
    try:
        if raw_bytes[:2] == b'\x1f\x8b':
            raw_bytes = gzip.decompress(raw_bytes)
        if len(raw_bytes) >= 348 and raw_bytes[344:348] in (b'n+1\x00', b'ni1\x00'):
            return raw_bytes[:348]
    except Exception:
        pass
    return None


def _write_nifti_gz(data: np.ndarray, out_path: str, ref_header: Optional[bytes] = None):
    """Write a 3D uint8 numpy array (Z, Y, X) as a NIfTI-1 .nii.gz file."""
    nz, ny, nx = data.shape

    # --- NIfTI-1 header (348 bytes) ---
    header = bytearray(348)

    if ref_header is not None and len(ref_header) >= 348:
        # Preserve spatial metadata (pixdim, qform, sform, xyzt_units) from reference NIfTI
        header[:] = ref_header[:348]
        # Reset scl_slope / scl_inter so integer labels (0, 1, 2, 3) are read verbatim
        struct.pack_into('<ff', header, 112, 0.0, 0.0)
    else:
        # pixdim[0..7] = 1.0
        struct.pack_into('<8f', header, 76, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0)

    # sizeof_hdr
    struct.pack_into('<i', header, 0, 348)
    # dim[0..7] -> 3D volume (nx, ny, nz)
    struct.pack_into('<8h', header, 40, 3, nx, ny, nz, 1, 1, 1, 1)
    # datatype = 2 (UINT8), bitpix = 8
    struct.pack_into('<hh', header, 70, 2, 8)
    # vox_offset = 352.0 (header 348 + 4 bytes extension)
    struct.pack_into('<f', header, 108, 352.0)
    # magic = "n+1\0"
    header[344:348] = b'n+1\x00'

    # 4-byte extension block (all zeros = no extensions)
    extension = b'\x00\x00\x00\x00'

    # Data is (Z, Y, X) in C-order, which has X varying fastest -> identical byte layout
    # to NIfTI Fortran-order (X, Y, Z).
    pixel_bytes = np.ascontiguousarray(data, dtype=np.uint8).tobytes()

    raw = bytes(header) + extension + pixel_bytes

    with gzip.open(out_path, 'wb') as f:
        f.write(raw)


@router.post("/save")
async def save_brush_mask(
    mask_data: UploadFile = File(...),
    num_slices: int = Form(...),
    rows: int = Form(...),
    cols: int = Form(...),
    series_name: str = Form("scan"),
    reference_nifti: Optional[UploadFile] = File(None),
):
    """
    Accepts flat Uint8Array binary (num_slices * rows * cols) from the browser brush tool.
    Saves it as a multi-label NIfTI .nii.gz file in outputs/masks/.
    """
    raw_bytes = await mask_data.read()
    expected = num_slices * rows * cols

    if len(raw_bytes) != expected:
        raise HTTPException(
            status_code=400,
            detail=f"Expected {expected} bytes, got {len(raw_bytes)}"
        )

    # Reconstruct 3D array [slices, rows, cols]
    flat = np.frombuffer(raw_bytes, dtype=np.uint8)
    mask_3d = flat.reshape((num_slices, rows, cols))

    ref_header = None
    if reference_nifti is not None:
        ref_bytes = await reference_nifti.read()
        ref_header = _extract_nifti_spatial_header(ref_bytes)

    # Strip existing extensions to build canonical <base>_gt.nii.gz name
    base_name = series_name
    for ext in (".nii.gz", ".nii", ".dcm", ".dicom"):
        if base_name.lower().endswith(ext):
            base_name = base_name[: -len(ext)]
            break
    safe_name = "".join(c if c.isalnum() or c in ('_', '-') else '_' for c in base_name).strip('_') or "scan"
    if not safe_name.lower().endswith("_gt"):
        filename = f"{safe_name}_gt.nii.gz"
    else:
        filename = f"{safe_name}.nii.gz"

    out_path = os.path.join(MASK_OUTPUT_DIR, filename)
    _write_nifti_gz(mask_3d, out_path, ref_header=ref_header)

    unique_vals, counts = np.unique(mask_3d, return_counts=True)
    label_counts = {
        str(int(k)): int(v) for k, v in zip(unique_vals, counts) if int(k) > 0
    }

    return JSONResponse({
        "message": "Mask saved successfully",
        "filename": filename,
        "path": out_path,
        "download_url": f"/mask/download/{filename}",
        "shape": [int(num_slices), int(rows), int(cols)],
        "nonzero_voxels": int(np.count_nonzero(mask_3d)),
        "label_counts": label_counts,
    })


@router.get("/download/{filename}")
async def download_brush_mask(filename: str):
    """Download a saved .nii.gz mask file."""
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(MASK_OUTPUT_DIR, safe_filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Mask file not found")
    return FileResponse(
        path=file_path,
        media_type="application/gzip",
        filename=safe_filename,
    )
