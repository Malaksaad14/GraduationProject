import numpy as np
import torch
import monai
import cv2
from scipy.ndimage import label
from monai.networks.nets import UNet

_model = None

def get_localizer_model(weights_path: str):
    global _model
    if _model is None:
        print("Loading Localizer model...")
        network_def = {
            "spatial_dims": 2,
            "in_channels": 1,
            "out_channels": 4,
            "channels": [16, 32, 64, 128, 256],
            "strides": [2, 2, 2, 2],
            "num_res_units": 2
        }
        _model = UNet(**network_def)
        _model.load_state_dict(torch.load(weights_path, map_location="cpu", weights_only=True))
        _model.eval()
        print("Localizer model loaded successfully.")
    return _model

def preprocess_image(input_array: np.ndarray):
    resized_image = cv2.resize(input_array, (256, 256), interpolation=cv2.INTER_LINEAR)
    max_val = resized_image.max()
    if max_val > 0:
        normalized_image = resized_image / max_val
    else:
        normalized_image = resized_image
    
    normalized_image = normalized_image.astype(np.float32)
    input_tensor = torch.from_numpy(normalized_image)[None, None, :, :]
    return input_tensor, resized_image.shape

def postprocess_segmentation(segmentation: np.ndarray, input_array: np.ndarray, resized_shape: tuple):
    lv_segmentation = segmentation.copy()
    lv_segmentation[(lv_segmentation != 1) & (lv_segmentation != 2)] = 0
    roi_mask = (lv_segmentation == 1) | (lv_segmentation == 2)
    labeled_array, num_features = label(roi_mask)

    largest_component = None
    max_size = 0
    for i in range(1, num_features + 1):
        component_size = np.sum(labeled_array == i)
        if component_size > max_size:
            max_size = component_size
            largest_component = (labeled_array == i)

    if largest_component is None:
        raise ValueError("No valid ROI found in segmentation. Model could not find the heart.")

    roi_coords = np.argwhere(largest_component)
    center_y, center_x = roi_coords.mean(axis=0)

    scale_y = input_array.shape[0] / resized_shape[0]
    scale_x = input_array.shape[1] / resized_shape[1]
    center_y_original = center_y * scale_y
    center_x_original = center_x * scale_x

    roi_height, roi_width = 128, 128
    top_left_y = max(0, int(center_y_original - roi_height / 2))
    top_left_x = max(0, int(center_x_original - roi_width / 2))
    bottom_right_y = min(input_array.shape[0], int(center_y_original + roi_height / 2))
    bottom_right_x = min(input_array.shape[1], int(center_x_original + roi_width / 2))

    fixed_roi = input_array[top_left_y:bottom_right_y, top_left_x:bottom_right_x]
    return fixed_roi

def run_localizer(input_array: np.ndarray, weights_path: str) -> np.ndarray:
    model = get_localizer_model(weights_path)
    input_tensor, resized_shape = preprocess_image(input_array)
    
    with torch.no_grad():
        pred = model(input_tensor)
        pred = torch.softmax(pred[0], dim=0)
        seg = torch.argmax(pred, dim=0).cpu().numpy()
        
    cropped_roi = postprocess_segmentation(seg, input_array, resized_shape)
    return cropped_roi


def run_localizer_3d(volume_array: np.ndarray, weights_path: str) -> np.ndarray:
    """
    Takes a 3D volume (H, W, D).
    Runs the localizer on the middle slice to find the center.
    Crops all slices to 128x128 around that center.
    """
    model = get_localizer_model(weights_path)
    
    # Get middle slice
    mid_idx = volume_array.shape[2] // 2
    mid_slice = volume_array[:, :, mid_idx]
    
    input_tensor, resized_shape = preprocess_image(mid_slice)
    
    with torch.no_grad():
        pred = model(input_tensor)
        pred = torch.softmax(pred[0], dim=0)
        seg = torch.argmax(pred, dim=0).cpu().numpy()
        
    # Find bounding box based on the middle slice segmentation
    lv_segmentation = seg.copy()
    lv_segmentation[(lv_segmentation != 1) & (lv_segmentation != 2)] = 0
    roi_mask = (lv_segmentation == 1) | (lv_segmentation == 2)
    labeled_array, num_features = label(roi_mask)

    largest_component = None
    max_size = 0
    for i in range(1, num_features + 1):
        component_size = np.sum(labeled_array == i)
        if component_size > max_size:
            max_size = component_size
            largest_component = (labeled_array == i)

    if largest_component is None:
        raise ValueError("No valid ROI found. Model could not find the heart.")

    roi_coords = np.argwhere(largest_component)
    center_y, center_x = roi_coords.mean(axis=0)

    scale_y = mid_slice.shape[0] / resized_shape[0]
    scale_x = mid_slice.shape[1] / resized_shape[1]
    center_y_original = center_y * scale_y
    center_x_original = center_x * scale_x

    roi_height, roi_width = 128, 128
    top_left_y = max(0, int(center_y_original - roi_height / 2))
    top_left_x = max(0, int(center_x_original - roi_width / 2))
    bottom_right_y = min(mid_slice.shape[0], int(center_y_original + roi_height / 2))
    bottom_right_x = min(mid_slice.shape[1], int(center_x_original + roi_width / 2))

    # Crop the whole 3D volume using the coordinates from the middle slice
    cropped_volume = volume_array[top_left_y:bottom_right_y, top_left_x:bottom_right_x, :]
    return cropped_volume

