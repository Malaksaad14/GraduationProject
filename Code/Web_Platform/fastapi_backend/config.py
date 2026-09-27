import os
from pathlib import Path

# Base directory of the backend
BASE_DIR = Path(__file__).resolve().parent

# Upload directories
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"

# Create directories if they don't exist
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Model settings
MODEL_WEIGHTS_PATH = os.getenv("MODEL_WEIGHTS_PATH", "")
TASK_NAME = os.getenv("NNUNET_TASK", "Dataset033_EMDIC")

# CORS settings
ALLOWED_ORIGINS = [
    "http://localhost:3000",  # React frontend
    "http://localhost:5173",  # Vite frontend
]
