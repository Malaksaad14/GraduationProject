"""Case metadata and spatially aligned 3D NIfTI exports."""

from dataclasses import dataclass
from pathlib import Path
import warnings

import nibabel as nib
import numpy as np


@dataclass
class CaseMetadata:
    affine: np.ndarray
    image_header: nib.Nifti1Header
    depth: int
    category: str = None
    label_header: nib.Nifti1Header = None


def training_category(case_id):
    """Use the dataset's case naming convention, never mask contents."""
    if case_id.startswith("Case_N"):
        return "normal"
    if case_id.startswith("Case_P"):
        return "pathologic"
    raise ValueError(f"Unknown training category for {case_id}: expected Case_N... or Case_P...")


def _shared_qform(image, label):
    """Recognize matching voxel grids with conflicting scale-only sforms."""
    image_qform = image.get_qform()
    label_qform = label.get_qform()
    if not (image.header["qform_code"] or label.header["qform_code"]):
        return None
    if not np.allclose(image_qform, label_qform, rtol=0, atol=1e-5):
        return None
    if not np.allclose(image.header.get_zooms(), label.header.get_zooms(), rtol=0, atol=1e-5):
        return None
    units = {header.get_xyzt_units()[0] for header in (image.header, label.header)}
    if len(units - {"unknown"}) > 1:
        return None

    # Agreement of array shape alone cannot establish spatial alignment.
    qscale = np.linalg.norm(image_qform[:3, :3], axis=0)
    if not np.all(np.isfinite(image_qform)) or np.any(qscale <= 0):
        return None
    for affine in (image.affine, label.affine):
        scale = np.linalg.norm(affine[:3, :3], axis=0)
        if not np.all(np.isfinite(affine)) or np.any(scale <= 0):
            return None
        if not np.allclose(affine[:3, 3], image_qform[:3, 3], rtol=0, atol=1e-5):
            return None
        if not np.allclose(affine[:3, :3] / scale, image_qform[:3, :3] / qscale,
                           rtol=0, atol=1e-5):
            return None
    return image_qform


def _pixdim_metadata(image, label, category):
    """Use EMIDEC's millimetre spacing and stored qform orientation/origin."""
    source = image.get_filename() or "in-memory image"
    headers = []
    affines = []
    for volume in (image, label):
        if volume is None:
            continue
        header = volume.header.copy()
        spacing = np.asarray(header.get_zooms()[:3])
        if not np.all(np.isfinite(spacing)) or np.any(spacing <= 0):
            raise ValueError(f"{source}: pixdim spacing must be finite and positive")
        unit, time_unit = header.get_xyzt_units()
        if unit not in ("unknown", "mm"):
            raise ValueError(f"{source}: EMIDEC pixdim policy expects mm, got {unit}")

        # Reconstruct even when qform_code is zero: this is the explicit EMIDEC
        # policy. pixdim supplies spacing; quaternion/qoffset supply pose.
        affine = header.get_qform()
        if not np.all(np.isfinite(affine)):
            raise ValueError(f"{source}: qform orientation/origin must be finite")
        header.set_qform(affine, code=2)
        header.set_sform(affine, code=2)
        header.set_xyzt_units("mm", time_unit)
        headers.append(header)
        affines.append(affine)

    if label is not None and not np.allclose(affines[0], affines[1], rtol=0, atol=1e-5):
        raise ValueError(
            f"{source}: image and label disagree in pixdim spacing or qform "
            "orientation/origin; ignoring sform cannot resolve this mismatch"
        )
    return CaseMetadata(
        affine=affines[0],
        image_header=headers[0],
        depth=image.shape[2],
        category=category,
        label_header=headers[1] if label is not None else None,
    )


def case_metadata(image, label=None, category=None, *, use_pixdim=False):
    """Validate geometry; optionally apply EMIDEC's explicit pixdim policy."""
    source = image.get_filename() or "in-memory image"
    if len(image.shape) != 3 or any(size == 0 for size in image.shape):
        raise ValueError(f"{source}: expected a nonempty 3D image, got {image.shape}")

    if label is not None and label.shape != image.shape:
        raise ValueError(
            f"{source}: image and label must have matching shapes; "
            f"image={image.shape}, label={label.shape}"
        )
    if use_pixdim:
        return _pixdim_metadata(image, label, category)

    affine = image.affine.copy()
    image_header = image.header.copy()
    label_header = label.header.copy() if label is not None else None
    if label is not None:
        if not np.allclose(label.affine, image.affine, rtol=0, atol=1e-5):
            shared = _shared_qform(image, label)
            if shared is None:
                raise ValueError(
                    f"{source}: image and label have different spatial coordinates "
                    "and no compatible shared qform. Check their upstream alignment."
                )
            affine = shared.copy()
            spatial_unit = image_header.get_xyzt_units()[0]
            if spatial_unit == "unknown":
                spatial_unit = label_header.get_xyzt_units()[0]
            # Correct copies only; source files and voxel values are untouched.
            for header in (image_header, label_header):
                header.set_qform(affine, code=2)
                header.set_sform(affine, code=2)
                header.set_xyzt_units(spatial_unit, header.get_xyzt_units()[1])
            warnings.warn(
                f"{source}: conflicting affine scales; using the shared qform "
                "for image and label exports (matching shape, spacing, origin, "
                "and directions). No voxel resampling was performed.",
                UserWarning,
                stacklevel=2,
            )
    return CaseMetadata(
        affine=affine,
        image_header=image_header,
        depth=image.shape[2],
        category=category,
        label_header=label_header,
    )


def save_cropped_nifti(data, metadata, crop_start, path, is_label=False):
    """Translate voxel coordinates after cropping without resampling data."""
    source_header = metadata.label_header if is_label else metadata.image_header
    header = source_header.copy()
    if is_label:
        if not np.all(np.isfinite(data)) or not np.all(data == np.rint(data)):
            raise ValueError("Segmentation labels must contain finite integer values")
        data = data.astype(np.int32)
    header.set_data_dtype(data.dtype)
    header.set_slope_inter(1, 0)

    # New voxel (0, 0, 0) occupies the original crop-start voxel's location.
    translation = np.eye(4)
    translation[:3, 3] = (*crop_start, 0)
    affine = metadata.affine @ translation
    image_type = nib.Nifti2Image if isinstance(header, nib.Nifti2Header) else nib.Nifti1Image
    result = image_type(data, affine, header=header)

    # qform and sform may describe different spaces; shift each original form.
    qform, qcode = source_header.get_qform(coded=True)
    sform, scode = source_header.get_sform(coded=True)
    result.set_qform(qform @ translation if qcode else None, int(qcode))
    if scode:
        result.set_sform(sform @ translation, int(scode))
    elif qcode:
        result.set_sform(None, 0)
    else:
        result.set_sform(affine, 2)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    nib.save(result, path)


def save_case_volumes(records, clipped_by_filename, output_dir, split_name):
    """Stack complete cases in original slice order and save image/label pairs."""
    split_dir = Path(output_dir) / split_name
    is_train = split_name.endswith("_Train")
    if is_train:
        for category in ("normal", "pathologic"):
            for kind in ("images", "labels"):
                (split_dir / category / kind).mkdir(parents=True, exist_ok=True)
    else:
        (split_dir / "images").mkdir(parents=True, exist_ok=True)

    cases = {}
    for record in records:
        cases.setdefault(record.case_id, []).append(record)

    for case_id, slices in cases.items():
        slices.sort(key=lambda record: record.slice_num)
        metadata = slices[0].metadata
        if metadata is None:
            raise ValueError(f"Missing NIfTI metadata for {case_id}")
        if [record.slice_num for record in slices] != list(range(1, metadata.depth + 1)):
            raise ValueError(f"Incomplete or duplicate slices for {case_id}")
        crop_start = slices[0].crop_start
        shape = slices[0].image.shape
        for record in slices:
            if record.metadata is not metadata or record.crop_start != crop_start:
                raise ValueError(f"Inconsistent case geometry for {case_id}")
            if record.image.shape != shape or clipped_by_filename[record.filename].shape != shape:
                raise ValueError(f"Inconsistent slice shapes for {case_id}")
            if (record.label is not None) != (metadata.label_header is not None):
                raise ValueError(f"Incomplete labels for {case_id}")
            if record.label is not None and record.label.shape != shape:
                raise ValueError(f"Image/label shape mismatch for {case_id}")

        case_dir = split_dir
        if is_train:
            category = training_category(case_id)
            if metadata.category != category:
                raise ValueError(f"Inconsistent training category for {case_id}")
            case_dir /= category

        image = np.stack([clipped_by_filename[record.filename] for record in slices], axis=2)
        filename = f"{case_id}.nii.gz"
        save_cropped_nifti(image, metadata, crop_start, case_dir / "images" / filename)
        if metadata.label_header is not None:
            label = np.stack([record.label for record in slices], axis=2)
            save_cropped_nifti(label, metadata, crop_start, case_dir / "labels" / filename, is_label=True)
        print(f"Saved 3D case {case_id}: {image.shape} -> {case_dir}")
