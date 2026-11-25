"""Segment one EMIDEC LGE NIfTI volume with a trained fold-0 nnU-Net."""

import argparse
from pathlib import Path

import numpy as np
import SimpleITK as sitk
import torch
from nnunetv2.inference.predict_from_raw_data import nnUNetPredictor


def load_predictor(model_dir: str | Path, checkpoint: str = "checkpoint_best.pth") -> nnUNetPredictor:
    """Load the trained model once for reuse across volumes."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    predictor = nnUNetPredictor(device=device, perform_everything_on_device=device.type == "cuda")
    predictor.initialize_from_trained_model_folder(str(model_dir), use_folds=(0,), checkpoint_name=checkpoint)
    return predictor


def predict_volume(
    image_path: str | Path,
    predictor: nnUNetPredictor,
    label_path: str | Path | None = None,
) -> tuple[sitk.Image, dict[str, float | None] | None]:
    """Return the mask on the input grid and optional whole-volume Dice by class.

    Scores are None without a reference. A class absent from both masks has a None score.
    """
    image = sitk.ReadImage(str(image_path))
    if image.GetDimension() != 3 or image.GetNumberOfComponentsPerPixel() != 1:
        raise ValueError("Expected a single-channel 3D volume.")

    truth = None
    if label_path is not None:
        reference = sitk.ReadImage(str(label_path))
        if reference.GetNumberOfComponentsPerPixel() != 1 or not image.IsSameImageGeometryAs(reference):
            raise ValueError("The label must be a scalar volume on the same grid as the image.")
        truth = sitk.GetArrayFromImage(reference)

    # SimpleITK arrays use (z, y, x). nnU-Net expects (channel, z, y, x) and spacing in array order.
    volume = sitk.GetArrayFromImage(image).astype(np.float32)
    prediction = predictor.predict_single_npy_array(volume[None], {"spacing": image.GetSpacing()[::-1]})
    mask = sitk.GetImageFromArray(prediction)
    mask.CopyInformation(image)

    if truth is None:
        return mask, None

    scores = {}
    for name, value in predictor.dataset_json["labels"].items():
        if value == 0:
            continue
        actual, predicted = truth == value, prediction == value
        count = int(actual.sum() + predicted.sum())
        scores[name] = 2 * np.count_nonzero(actual & predicted) / count if count else None
    return mask, scores


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="Input 3D LGE volume")
    parser.add_argument("--model-dir", required=True, type=Path, help="Folder containing plans.json and fold_0/")
    parser.add_argument("--label", type=Path, help="Optional reference segmentation on the image grid")
    parser.add_argument("--output", type=Path, help="Defaults to <image>_pred.nii.gz beside the image")
    parser.add_argument("--checkpoint", default="checkpoint_best.pth", help="Checkpoint filename inside fold_0/")
    args = parser.parse_args()

    stem = args.image.name.removesuffix(".gz").removesuffix(".nii")
    output = args.output or args.image.with_name(f"{stem}_pred.nii.gz")
    if output.resolve() in {path.resolve() for path in (args.image, args.label) if path is not None}:
        parser.error("Choose an output path different from the input image and reference label.")

    predictor = load_predictor(args.model_dir, args.checkpoint)
    mask, scores = predict_volume(args.image, predictor, args.label)
    output.parent.mkdir(parents=True, exist_ok=True)
    sitk.WriteImage(mask, str(output))
    print(f"Predicted mask: {output}")
    if scores is not None:
        for name, score in scores.items():
            print(f"{name} Dice: {score if score is not None else float('nan'):.4f}")


if __name__ == "__main__":
    main()

# Usage example (from the project root)
#
# from nnunet.predict_volume import load_predictor, predict_volume
# model_dir = "nnUNetTrainer__nnUNetPlans__2d"
# predictor = load_predictor(model_dir)
# image_path = "images/Case_P005.nii.gz"
# label_path = "labels/Case_P005.nii.gz" # Optional reference label for Dice calculation
# mask, dice = predict_volume(image_path, predictor, label_path=label_path)
# print(dice)
# Without a reference label, use: mask, _ = predict_volume(image_path, predictor)
#
# Test from Terminal
# python nnunet/predict_volume.py images/Case_P005.nii.gz \
#   --model-dir nnUNetTrainer__nnUNetPlans__2d \
#   --label labels/Case_P005.nii.gz
