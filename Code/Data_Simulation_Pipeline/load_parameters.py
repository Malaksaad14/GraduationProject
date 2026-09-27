#!/usr/bin/env python3
import os
import shutil

DEFAULT_CONFIG = "/usr/src/app/input_config/input_config_paramters.json.default"
TARGET_CONFIG = "/usr/src/mount_input_output/input_config_paramters.json"

def main():
    if not os.path.isdir("/usr/src/mount_input_output"):
        print("[load_parameters] ERROR: Mount directory /usr/src/mount_input_output does not exist!")
        return

    if not os.path.isfile(TARGET_CONFIG):
        print(f"[load_parameters] Copying default config to {TARGET_CONFIG}")
        shutil.copy(DEFAULT_CONFIG, TARGET_CONFIG)
        print("[load_parameters] Done.")
    else:
        print(f"[load_parameters] Config already exists at {TARGET_CONFIG}, not overwriting.")

if __name__ == "__main__":
    main()
