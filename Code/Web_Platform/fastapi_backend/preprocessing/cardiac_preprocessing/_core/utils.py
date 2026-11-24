"""Shared image and model helpers used by every dataset stage."""
import random
from dataclasses import dataclass
from statistics import median

import cv2
import matplotlib.pyplot as plt
import numpy as np
import torch
from scipy.ndimage import label as connected_components
from scipy.spatial.distance import euclidean

from .volumes import CaseMetadata


@dataclass
class SliceRecord:
    filename: str
    case_id: str
    slice_num: int
    image: np.ndarray
    label: np.ndarray = None
    metadata: CaseMetadata = None
    crop_start: tuple = (0, 0)


def remap_mask(raw_mask_slice, value_map):
    """Apply a dataset's raw -> unified value map to one mask slice."""
    remapped = raw_mask_slice.copy()
    for old, new in value_map.items():
        remapped[raw_mask_slice == old] = new
    return remapped


def find_lv_center(image, net, device):
    """Run the localization model on one slice, return LV center in original coords."""
    og_y, og_x = image.shape
    resized = cv2.resize(image, (256, 256), interpolation=cv2.INTER_LINEAR)
    normalized = resized / resized.max()
    tensor = torch.from_numpy(normalized.astype(np.float32))[None, None, :, :].to(device) # (1,1,256,256)

    with torch.no_grad():
        pred = net(tensor)
    seg = torch.argmax(torch.softmax(pred[0], dim=0), dim=0).cpu().numpy()

    roi_mask = (seg == 1) | (seg == 2)
    labeled, num_features = connected_components(roi_mask)
    largest = max(
        [(np.sum(labeled == i), i) for i in range(1, num_features + 1)],
        default=(0, None),
    )[1]
    if largest is None:
        return None

    coords = np.argwhere(labeled == largest)
    center_y, center_x = coords.mean(axis=0)
    scale_y, scale_x = og_y / resized.shape[0], og_x / resized.shape[1]
    return center_x * scale_x, center_y * scale_y


def median_center_correction(centers, threshold=0):
    """Replace each center with the case's median unless within threshold of it."""
    valid = [c for c in centers if c is not None]
    if not valid:
        return centers
    med = (median(c[0] for c in valid), median(c[1] for c in valid))
    return [med if (c is None or euclidean(c, med) > threshold) else c for c in centers]


def roi_bounds(shape, center, roi_size=128):
    """Return crop bounds in array-axis order, retaining boundary truncation."""
    half = roi_size // 2
    start_y, start_x = int(center[1] - half), int(center[0] - half)
    end_y, end_x = start_y + roi_size, start_x + roi_size
    start_y, start_x = max(0, start_y), max(0, start_x)
    end_y, end_x = min(shape[0], end_y), min(shape[1], end_x)
    return start_y, start_x, end_y, end_x


def crop_roi(image, mask, center, roi_size=128):
    start_y, start_x, end_y, end_x = roi_bounds(image.shape, center, roi_size)

    cropped_image = image[start_y:end_y, start_x:end_x]
    cropped_mask = mask[start_y:end_y, start_x:end_x] if mask is not None else None
    return cropped_image, cropped_mask


def save_overlay(roi_image, roi_label, path):
    if roi_label is not None:
        fig, axs = plt.subplots(1, 2, figsize=(12, 6))
        axs[0].imshow(roi_image, cmap="gray", interpolation="none")
        axs[0].set_title("Cropped CMR Image")
        axs[0].axis("off")
        axs[1].imshow(roi_image, cmap="gray", interpolation="none")
        axs[1].imshow(roi_label, cmap="jet", alpha=0.5, interpolation="none")
        axs[1].set_title("CMR with Labels Overlay")
        axs[1].axis("off")
    else:
        fig, axs = plt.subplots(1, 1, figsize=(6, 6))
        axs.imshow(roi_image, cmap="gray", interpolation="none")
        axs.set_title("Cropped CMR Image (no labels available)")
        axs.axis("off")

    plt.savefig(path, bbox_inches="tight")
    plt.close(fig)


def save_histogram(pixels, low_thresh, high_thresh, split_name, path):
    plt.figure(figsize=(10, 5))
    plt.hist(pixels, bins=100, color="blue", alpha=0.7)
    plt.title(f"{split_name}: Histogram After Clipping ({low_thresh:.1f} - {high_thresh:.1f})")
    plt.xlabel("Pixel Intensity")
    plt.ylabel("Frequency")
    plt.yscale("log")
    plt.savefig(path, bbox_inches="tight")
    plt.close()


def save_sample_comparison(records, clipped_by_filename, path, num_samples=5, seed=None):
    """Save a random original-vs-clipped comparison figure."""
    num_samples = min(num_samples, len(records))
    if num_samples == 0:
        return

    rng = random.Random(seed)
    chosen = rng.sample(records, num_samples)

    fig, axes = plt.subplots(num_samples, 2, figsize=(10, 3 * num_samples))
    if num_samples == 1:
        axes = axes.reshape(1, 2)

    for i, record in enumerate(chosen):
        clipped = clipped_by_filename[record.filename]
        axes[i, 0].imshow(record.image, cmap="gray")
        axes[i, 0].set_title(f"Original: {record.filename}")
        axes[i, 0].axis("off")
        axes[i, 1].imshow(clipped, cmap="gray")
        axes[i, 1].set_title(f"Clipped: {record.filename}")
        axes[i, 1].axis("off")

    plt.tight_layout()
    plt.savefig(path, bbox_inches="tight")
    plt.close(fig)
