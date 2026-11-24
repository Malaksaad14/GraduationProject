"""Public Python interface for preprocessing an individual NIfTI volume."""

from dataclasses import replace
from pathlib import Path
import threading
import warnings

import torch

from ._core.model import load_lv_model
from .processing import preprocess_volume
from .profile import PreprocessingProfile


class VolumePreprocessor:
    """Load the profile/model once, then call process() for each input file.

    Bundled model resources are located relative to this package, independently
    of the working directory and the original machine's paths in the profile.
    """

    def __init__(self, profile_path, *, device="cpu", bundle_dir=None, model_path=None):
        profile_path = Path(profile_path).expanduser().resolve()
        if not profile_path.is_file():
            raise FileNotFoundError(
                f"Training profile not found: {profile_path}. "
                "Supply the JSON exported by single_volume fit."
            )
        profile = PreprocessingProfile.load(profile_path)
        bundle = (Path(bundle_dir).expanduser().resolve() if bundle_dir is not None
                  else Path(__file__).resolve().parent / "assets" / "Monai")
        # Only the filename is used from the original machine's model path.
        weight_name = profile.model_path.replace("\\", "/").rsplit("/", 1)[-1]
        weights = (Path(model_path).expanduser().resolve() if model_path is not None
                   else bundle / "models" / weight_name)
        for resource in (bundle / "configs" / "metadata.json",
                         bundle / "configs" / profile.model_config_name, weights):
            if not resource.is_file():
                raise FileNotFoundError(f"Localization model resource not found: {resource}")

        self.profile = replace(profile, bundle_dir=str(bundle), model_path=str(weights))
        self.device = torch.device(device)
        if self.device.type == "cuda" and not torch.cuda.is_available():
            warnings.warn("CUDA is unavailable; using CPU.", UserWarning, stacklevel=2)
            self.device = torch.device("cpu")
        self._net = load_lv_model(str(bundle), profile.model_config_name, str(weights), self.device)
        self._lock = threading.Lock()

    def process(self, input_path, output_path):
        """Save a new .nii.gz file and return its NiBabel image.

        Requires a nonempty 3D image prepared like the training inputs. Retains
        depth and slice order. Raises NoLVCenterError when localization fails;
        existing output files are never overwritten. Calls on one instance are
        serialized so its loaded model can safely be reused by multiple threads.
        """
        with self._lock:
            return preprocess_volume(input_path, output_path, profile=self.profile,
                                     net=self._net, device=self.device)
