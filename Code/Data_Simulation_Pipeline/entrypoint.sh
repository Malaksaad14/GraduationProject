#!/bin/sh
# entrypoint.sh

CONFIG_PATH="/usr/src/mount_input_output/input_config_paramters.json"

if [ ! -f "$CONFIG_PATH" ]; then
    echo "[entrypoint] Config file not found at $CONFIG_PATH, copying default."
    cp "/usr/src/app/input_config/input_config_paramters.json.default" "$CONFIG_PATH"
    echo "[entrypoint] Default config copied to $CONFIG_PATH."
fi

echo "[entrypoint] Running full pipeline now..."
python /usr/src/app/run_app.py
