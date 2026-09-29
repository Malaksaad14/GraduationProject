from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
import uuid
import pydicom
import nibabel as nib
import numpy as np
from pathlib import Path
from config import UPLOAD_DIR, OUTPUT_DIR
import io

router = APIRouter(prefix="/convert", tags=["Conversion"])

@router.post("/dicom-to-nifti", summary="Convert a DICOM file to NIfTI")
async def dicom_to_nifti(dicom_file: UploadFile = File(...)):
    file_bytes = await dicom_file.read()
    unique_id = uuid.uuid4().hex
    input_path = UPLOAD_DIR / f"temp_{unique_id}.dcm"
    output_path = OUTPUT_DIR / f"converted_{unique_id}.nii.gz"
    
    with open(input_path, "wb") as f:
        f.write(file_bytes)
        
    try:
        ds = pydicom.dcmread(str(input_path))
        if "PixelData" not in ds:
            raise ValueError("No pixel data in DICOM")
            
        pixel_array = ds.pixel_array.astype(np.float32)
        # NIfTI is usually 3D, so we add a dummy Z dimension to the 2D DICOM
        if pixel_array.ndim == 2:
            pixel_array = np.expand_dims(pixel_array, axis=-1)
            
        affine = np.eye(4) # Default matrix
        nifti_img = nib.Nifti1Image(pixel_array, affine)
        nib.save(nifti_img, str(output_path))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if input_path.exists():
            input_path.unlink()
            
    return FileResponse(path=str(output_path), media_type="application/gzip", filename="converted.nii.gz")


@router.post("/nifti-to-dicom", summary="Convert a NIfTI file to DICOM")
async def nifti_to_dicom(nifti_file: UploadFile = File(...)):
    file_bytes = await nifti_file.read()
    unique_id = uuid.uuid4().hex
    output_path = OUTPUT_DIR / f"converted_{unique_id}.dcm"
    
    try:
        file_obj = io.BytesIO(file_bytes)
        fh = nib.FileHolder(fileobj=file_obj)
        nifti_img = nib.Nifti1Image.from_file_map({"header": fh, "image": fh})
        data = nifti_img.get_fdata().astype(np.float32)
        
        # Take middle slice if it's a 3D NIfTI
        if data.ndim == 3:
            mid = data.shape[2] // 2
            pixel_array = data[:, :, mid]
        else:
            pixel_array = data
            
        # Normalize to 16-bit uint for DICOM
        pixel_array = pixel_array - np.min(pixel_array)
        if np.max(pixel_array) > 0:
            pixel_array = (pixel_array / np.max(pixel_array)) * 65535
        pixel_array = pixel_array.astype(np.uint16)
            
        # Create a basic DICOM from scratch
        ds = pydicom.dataset.FileDataset(str(output_path), {}, file_meta=pydicom.dataset.FileMetaDataset())
        ds.is_little_endian = True
        ds.is_implicit_VR = True
        ds.SOPClassUID = '1.2.840.10008.5.1.4.1.1.7'
        ds.SOPInstanceUID = '1.2.3'
        ds.PatientName = "Converted_From_NIfTI"
        ds.Modality = "MR"
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.Rows, ds.Columns = pixel_array.shape
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0
        ds.PixelData = pixel_array.tobytes()
        
        ds.save_as(str(output_path))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    return FileResponse(path=str(output_path), media_type="application/dicom", filename="converted.dcm")
