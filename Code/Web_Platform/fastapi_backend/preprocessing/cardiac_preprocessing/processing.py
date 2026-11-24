"""Fit clipping once on training ROIs, then process independent test volumes."""

from pathlib import Path
import warnings

import nibabel as nib
import numpy as np

from ._core.utils import (
    crop_roi, find_lv_center, median_center_correction, roi_bounds,
)
from ._core.volumes import case_metadata, save_cropped_nifti, training_category
from .profile import PreprocessingProfile


class NoLVCenterError(ValueError):
    """The complete case is skipped when no slice has a valid LV center."""


def _crop_case(image_path, dataset, roi_size, net, device, label_path=None):
    image = nib.load(Path(image_path).expanduser())
    label = nib.load(label_path) if label_path is not None else None
    metadata = case_metadata(image, label, use_pixdim=(dataset == "EMIDEC"))
    data = image.get_fdata()
    if not np.all(np.isfinite(data)):
        raise ValueError(f"{image_path}: image contains NaN or infinite values.")

    centers = [find_lv_center(data[:, :, index], net, device)
               for index in range(metadata.depth)]
    centers = median_center_correction(centers)
    if all(center is None for center in centers):
        raise NoLVCenterError(f"Skipping {image_path}: no valid LV center in any slice.")

    # The batch pipeline's default correction gives every slice the same center.
    center = centers[0]
    crop_start = roi_bounds(data.shape, center, roi_size)[:2]
    slices = [crop_roi(data[:, :, index], None, center, roi_size)[0]
              for index in range(metadata.depth)]
    crop = np.stack(slices, axis=2)
    if any(size == 0 for size in crop.shape) or crop.shape[2] != metadata.depth:
        raise ValueError(f"{image_path}: empty crop or incomplete depth.")
    return crop, metadata, crop_start


def preprocess_volume(image_path, output_path, *, profile, net, device="cpu"):
    """Save and return one preprocessed NIfTI image using fixed training thresholds.

    Pass a loaded localization model to reuse it across calls. No labels or case
    naming convention are required, and no statistics are fitted on this image.
    """
    if not isinstance(profile, PreprocessingProfile):
        profile = PreprocessingProfile.load(profile)
    image_path = Path(image_path).expanduser().resolve()
    output_path = Path(output_path).expanduser().resolve()
    if output_path == image_path:
        raise ValueError("Choose an output path different from the input image.")
    if not output_path.name.endswith(".nii.gz"):
        raise ValueError("The output filename must end in .nii.gz.")
    if output_path.exists():
        raise FileExistsError(f"Output already exists: {output_path}")

    crop, metadata, crop_start = _crop_case(
        image_path, profile.dataset, profile.roi_size, net, device,
    )
    clipped = np.clip(crop, profile.clip_low, profile.clip_high)
    save_cropped_nifti(clipped, metadata, crop_start, output_path)
    return nib.load(output_path)


def fit_profile(config, net, device="cpu"):
    """Fit the same pooled training-ROI percentiles as the batch providers.

    Uses training images only. Optional training masks are read for the same
    geometry validation as the batch loader; they never drive localization.
    """
    dataset = config.dataset.value
    if config.roi_size <= 0 or not 0 <= config.low_percentile < config.high_percentile <= 100:
        raise ValueError("Invalid ROI size or training percentiles.")
    training_root = Path(config.raw_dataset_dir).expanduser() / f"{dataset}_Train"
    if not training_root.is_dir():
        raise ValueError(f"Training folder not found: {training_root}")
    pixels = []
    for case_dir in sorted(path for path in training_root.iterdir() if path.is_dir()):
        training_category(case_dir.name)
        image_path = case_dir / "Images" / f"{case_dir.name}.nii.gz"
        mask_path = case_dir / "Contours" / f"{case_dir.name}.nii.gz"
        try:
            crop, _, _ = _crop_case(
                image_path, dataset, config.roi_size, net, device,
                label_path=mask_path if mask_path.is_file() else None,
            )
        except NoLVCenterError as error:
            warnings.warn(str(error), UserWarning, stacklevel=2)
            continue
        pixels.append(crop.ravel())
        print(f"Training ROI: {case_dir.name} {crop.shape}")
    if not pixels:
        raise ValueError("No training ROIs available to compute clipping thresholds.")
    low, high = np.percentile(np.concatenate(pixels),
                              [config.low_percentile, config.high_percentile])
    bundle = Path(config.bundle_dir).expanduser().resolve()
    model = (Path(config.model_path).expanduser().resolve() if config.model_path
             else bundle / "models" / "model.pt")
    return PreprocessingProfile(
        dataset=dataset, roi_size=config.roi_size, clip_low=float(low), clip_high=float(high),
        bundle_dir=str(bundle), model_config_name=config.model_config_name,
        model_path=str(model), low_percentile=config.low_percentile,
        high_percentile=config.high_percentile,
    )
