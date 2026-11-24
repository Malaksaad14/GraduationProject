"""Loads the trained MONAI LV-localization model, shared by every dataset."""
import torch


def load_lv_model(bundle_dir, config_name, model_path, device):
    import monai

    parser = monai.bundle.load_bundle_config(bundle_dir, config_name)
    net = parser.get_parsed_content("network_def")
    net.load_state_dict(torch.load(model_path, map_location=device))
    net.to(device)
    net.eval()
    print(f"Model loaded from {model_path} and ready for inference on {device}.")
    return net
