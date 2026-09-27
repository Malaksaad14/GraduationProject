import io
import base64
import numpy as np
import pydicom
from pydicom.errors import InvalidDicomError
from pathlib import Path


def read_dicom_from_bytes(file_bytes: bytes) -> pydicom.Dataset:
    """Read a DICOM file from raw bytes."""
    stream = io.BytesIO(file_bytes)
    return pydicom.dcmread(stream)


def extract_metadata(ds: pydicom.Dataset) -> dict:
    """Extract all DICOM tags as a readable dictionary."""
    metadata = {}
    for element in ds:
        if element.tag == (0x7FE0, 0x0010):  # Skip PixelData (too large)
            continue
        tag_key = f"({element.tag.group:04X}, {element.tag.element:04X})"
        metadata[tag_key] = {
            "name": element.name,
            "value": str(element.value)
        }
    return metadata


def dicom_to_base64(file_path: Path) -> str:
    """Read a DICOM file and encode it as base64 string."""
    with open(file_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def save_dicom_file(file_bytes: bytes, save_path: Path) -> Path:
    """Save raw bytes as a DICOM file."""
    with open(save_path, "wb") as f:
        f.write(file_bytes)
    return save_path


def get_pixel_array(ds: pydicom.Dataset) -> np.ndarray:
    """Extract pixel array from DICOM dataset."""
    if "PixelData" not in ds:
        raise ValueError("DICOM file has no pixel data.")
    return ds.pixel_array
