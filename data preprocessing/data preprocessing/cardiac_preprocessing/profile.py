"""Persist the training settings needed to preprocess a test volume."""

from dataclasses import asdict, dataclass
import json
import math
from pathlib import Path


@dataclass(frozen=True)
class PreprocessingProfile:
    dataset: str
    roi_size: int
    clip_low: float
    clip_high: float
    bundle_dir: str
    model_config_name: str
    model_path: str
    low_percentile: float = 2
    high_percentile: float = 98
    version: int = 1

    def __post_init__(self):
        if self.version != 1 or self.dataset not in {"EMIDEC", "MyoPS"}:
            raise ValueError("Expected profile version 1 and dataset EMIDEC or MyoPS.")
        if type(self.roi_size) is not int or self.roi_size <= 0:
            raise ValueError("roi_size must be a positive integer.")
        if not all(math.isfinite(v) for v in (self.clip_low, self.clip_high)):
            raise ValueError("Clipping thresholds must be finite.")
        if self.clip_low > self.clip_high:
            raise ValueError("clip_low must not exceed clip_high.")
        if not 0 <= self.low_percentile < self.high_percentile <= 100:
            raise ValueError("Invalid training percentiles.")
        if not all(isinstance(v, str) and v.strip() for v in
                   (self.bundle_dir, self.model_config_name, self.model_path)):
            raise ValueError("The profile must identify the localization bundle and weights.")

    def save(self, path):
        path = Path(path).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2, allow_nan=False) + "\n")

    @classmethod
    def load(cls, path):
        return cls(**json.loads(Path(path).expanduser().read_text()))
