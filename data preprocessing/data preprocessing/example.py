"""Run one volume, or use the same VolumePreprocessor calls in your application."""

import argparse
from pathlib import Path

from .cardiac_preprocessing import VolumePreprocessor


def main():
    parser = argparse.ArgumentParser(description="Preprocess one cardiac MRI volume.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--profile", default=str(Path(__file__).resolve().parent / "profile.json"))
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    # Keep this object alive when processing more than one volume.
    processor = VolumePreprocessor(args.profile, device=args.device)
    volume = processor.process(args.input, args.output)
    print(f"Saved {args.output} | shape: {volume.shape}")


# processor = VolumePreprocessor("profile.json", device="cuda")
# volume = processor.process("input.nii.gz", "output.nii.gz")

if __name__ == "__main__":
    main()
