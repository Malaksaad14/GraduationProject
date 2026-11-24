"""Segmentation service combining EMIDEC preprocessing and nnU-Net fold-0 inference."""

from __future__ import annotations

import base64
import threading
from pathlib import Path
from typing import Any

import nibabel as nib
import numpy as np
import SimpleITK as sitk
import torch

from config import OUTPUT_DIR
from inference.predict_volume import load_predictor, predict_volume
from preprocessing.cardiac_preprocessing import NoLVCenterError, VolumePreprocessor

BACKEND_DIR = Path(__file__).resolve().parent.parent
PREPROCESSING_DIR = BACKEND_DIR / "preprocessing"
PROFILE_PATH = PREPROCESSING_DIR / "profile.json"
MODEL_DIR = BACKEND_DIR / "inference" / "nnUNetTrainer__nnUNetPlans__2d"

_model_lock = threading.Lock()
_processor: VolumePreprocessor | None = None
_processor_mtime: float | None = None
_predictor = None


def _get_device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def get_preprocessor() -> VolumePreprocessor:
    """Return a cached VolumePreprocessor, reloading automatically if profile.json changes."""
    global _processor, _processor_mtime
    if not PROFILE_PATH.is_file():
        raise FileNotFoundError(f"Preprocessing profile not found at {PROFILE_PATH}")

    current_mtime = PROFILE_PATH.stat().st_mtime
    with _model_lock:
        if _processor is None or _processor_mtime != current_mtime:
            _processor = VolumePreprocessor(PROFILE_PATH, device=_get_device())
            _processor_mtime = current_mtime
        return _processor


def get_predictor():
    """Return a cached nnUNetPredictor instance."""
    global _predictor
    if not MODEL_DIR.is_dir():
        raise FileNotFoundError(f"nnU-Net model folder not found at {MODEL_DIR}")

    with _model_lock:
        if _predictor is None:
            _predictor = load_predictor(MODEL_DIR)
        return _predictor


def _prepare_3d_nifti(input_path: Path, work_dir: Path, unique_id: str) -> tuple[Path, nib.Nifti1Image, Path | None]:
    """Ensure the input NIfTI is a 3D volume; squeeze singleton 4th dimension if present."""
    orig_img = nib.load(str(input_path))
    if orig_img.ndim == 3:
        return input_path, orig_img, None

    if orig_img.ndim == 4 and orig_img.shape[3] == 1:
        data_3d = np.asarray(orig_img.dataobj)[:, :, :, 0]
        header_3d = orig_img.header.copy()
        header_3d.set_data_shape(data_3d.shape)
        img_3d = nib.Nifti1Image(data_3d, orig_img.affine, header=header_3d)
        temp_3d_path = work_dir / f"squeezed_{unique_id}.nii.gz"
        nib.save(img_3d, str(temp_3d_path))
        return temp_3d_path, nib.load(str(temp_3d_path)), temp_3d_path

    raise ValueError(
        f"Segmentation expects a 3D volume (e.g., LGE MRI), got {orig_img.ndim}D shape {orig_img.shape}."
    )


def _align_roi_mask_to_original(
    orig_img: nib.Nifti1Image,
    preprocessed_img: nib.Nifti1Image,
    roi_mask_path: Path,
    full_mask_path: Path,
    dataset_name: str,
) -> tuple[np.ndarray, list[int]]:
    """Map the cropped 128x128xD ROI mask back onto the original volume grid."""
    roi_mask_img = nib.load(str(roi_mask_path))
    roi_mask_arr = np.asarray(roi_mask_img.dataobj, dtype=np.uint8)

    orig_shape = orig_img.shape[:3]
    full_mask = np.zeros(orig_shape, dtype=np.uint8)

    base_affine = orig_img.header.get_qform() if dataset_name == "EMIDEC" else orig_img.affine
    try:
        rel_transform = np.linalg.inv(base_affine) @ preprocessed_img.affine
        start_0 = int(round(float(rel_transform[0, 3])))
        start_1 = int(round(float(rel_transform[1, 3])))
        start_2 = int(round(float(rel_transform[2, 3])))
    except np.linalg.LinAlgError:
        start_0, start_1, start_2 = 0, 0, 0

    src_0_start = max(0, -start_0)
    src_1_start = max(0, -start_1)
    src_2_start = max(0, -start_2)

    dst_0_start = max(0, start_0)
    dst_1_start = max(0, start_1)
    dst_2_start = max(0, start_2)

    len_0 = min(roi_mask_arr.shape[0] - src_0_start, orig_shape[0] - dst_0_start)
    len_1 = min(roi_mask_arr.shape[1] - src_1_start, orig_shape[1] - dst_1_start)
    len_2 = min(roi_mask_arr.shape[2] - src_2_start, orig_shape[2] - dst_2_start)

    if len_0 > 0 and len_1 > 0 and len_2 > 0:
        full_mask[
            dst_0_start:dst_0_start + len_0,
            dst_1_start:dst_1_start + len_1,
            dst_2_start:dst_2_start + len_2,
        ] = roi_mask_arr[
            src_0_start:src_0_start + len_0,
            src_1_start:src_1_start + len_1,
            src_2_start:src_2_start + len_2,
        ]

    header = orig_img.header.copy()
    header.set_data_dtype(np.uint8)
    header.set_slope_inter(1, 0)
    full_img = nib.Nifti1Image(full_mask, orig_img.affine, header=header)
    nib.save(full_img, str(full_mask_path))

    return full_mask, [start_0, start_1, start_2]


def _encode_file_b64(path: Path) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def run_segmentation_pipeline(input_path: Path, unique_id: str) -> Dict[str, Any]:
    """Run full preprocessing + nnU-Net inference on a 3D NIfTI volume."""
    processor = get_preprocessor()
    predictor = get_predictor()

    prep_input_path, orig_img, temp_3d_path = _prepare_3d_nifti(input_path, OUTPUT_DIR, unique_id)
    preprocessed_path = OUTPUT_DIR / f"preprocessed_{unique_id}.nii.gz"
    roi_mask_path = OUTPUT_DIR / f"seg_roi_{unique_id}.nii.gz"
    full_mask_path = OUTPUT_DIR / f"predicted_{unique_id}.nii.gz"

    try:
        # 1. Full preprocessing (LV localization, cropping, percentile clipping)
        preprocessed_img = processor.process(prep_input_path, preprocessed_path)

        # 2. nnU-Net inference on the preprocessed ROI volume
        with _model_lock:
            mask_sitk, _ = predict_volume(preprocessed_path, predictor)
        sitk.WriteImage(mask_sitk, str(roi_mask_path))

        # 3. Map ROI mask back to the original volume grid
        full_mask, crop_start = _align_roi_mask_to_original(
            orig_img=orig_img,
            preprocessed_img=preprocessed_img,
            roi_mask_path=roi_mask_path,
            full_mask_path=full_mask_path,
            dataset_name=processor.profile.dataset,
        )

        # 4. Compute class statistics using dataset.json labels
        dataset_labels = predictor.dataset_json.get("labels", {})
        labels_by_id = {str(int(v)): k for k, v in dataset_labels.items()}
        unique_vals, counts = np.unique(full_mask, return_counts=True)
        voxel_counts = {int(k): int(v) for k, v in zip(unique_vals, counts)}

        label_counts: Dict[str, int] = {}
        for name, val in dataset_labels.items():
            int_val = int(val)
            if int_val == 0:
                continue
            label_counts[name] = voxel_counts.get(int_val, 0)

        return {
            "preprocessed_path": preprocessed_path,
            "roi_mask_path": roi_mask_path,
            "full_mask_path": full_mask_path,
            "mask_nifti_data": _encode_file_b64(full_mask_path),
            "roi_mask_nifti_data": _encode_file_b64(roi_mask_path),
            "preprocessed_nifti_data": _encode_file_b64(preprocessed_path),
            "labels": labels_by_id,
            "label_counts": label_counts,
            "original_shape": [int(x) for x in orig_img.shape[:3]],
            "preprocessed_shape": [int(x) for x in preprocessed_img.shape[:3]],
            "crop_start": crop_start,
            "dataset": processor.profile.dataset,
        }
    finally:
        if temp_3d_path is not None and temp_3d_path.exists():
            temp_3d_path.unlink(missing_ok=True)


__all__ = [
    "NoLVCenterError",
    "get_preprocessor",
    "get_predictor",
    "run_segmentation_pipeline",
]

