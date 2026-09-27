#!/usr/bin/env python3
import os
import subprocess

MAIN_PY_PATH = "/usr/src/app/main.py"
CONFIG_PATH = "/usr/src/mount_input_output/input_config_paramters.json"
GENERATOR_SCRIPT = "/usr/src/app/generator_runner.py"
MODEL_PATH = "/usr/src/app/ckpt-173.h5"  
MERGED_MASKS_PATH = "/usr/src/mount_input_output/merged_masks"
SIMULATED_MASKS_PATH = "/usr/src/mount_input_output/simulated_masks"
FINAL_GEN_MERGED = "/usr/src/mount_input_output/final_generated_merged"
FINAL_GEN_SIMULATED = "/usr/src/mount_input_output/final_generated_simulated"

def main():
    if not os.path.isfile(MAIN_PY_PATH):
        raise FileNotFoundError(f"[run_app] main.py not found at {MAIN_PY_PATH}")

    if not os.path.isfile(CONFIG_PATH):
        print(f"[run_app] WARNING: Config not found at {CONFIG_PATH} — app may fail.")

    print(f"[run_app] Running simulator...")
    subprocess.run(["python", MAIN_PY_PATH, CONFIG_PATH], check=True)

    print(f"[run_app] Running generator model on both masks...")
    subprocess.run([
        "python", GENERATOR_SCRIPT,
        MERGED_MASKS_PATH,
        SIMULATED_MASKS_PATH,
        MODEL_PATH,
        FINAL_GEN_MERGED,
        FINAL_GEN_SIMULATED
    ], check=True)

if __name__ == "__main__":
    main()
