import os
import numpy as np
import torch
import monai
import cv2
from django.conf import settings
from scipy.ndimage import label
import pydicom  # For reading DICOM files
from monai.networks.nets import UNet
import matplotlib.pyplot as plt
from scipy.ndimage import label
from statistics import median


def load_model():
    # Check if the paths are correct
    model_weights_path = os.path.join(settings.MODELS_DIR, "model.pt")

    # Define network structure (UNet)
    network_def = {
        "spatial_dims": 2,
        "in_channels": 1,
        "out_channels": 4,
        "channels": [16, 32, 64, 128, 256],
        "strides": [2, 2, 2, 2],
        "num_res_units": 2
    }
    # Create the model
    net = UNet(**network_def)

    # Load the model weights
    try:
        net.load_state_dict(torch.load(model_weights_path, map_location="cpu"))
        net.eval()
        print("Model loaded successfully.")
        return net
    except Exception as e:
        print(f"Error loading model weights: {e}")
        raise e




# Function to preprocess the input image
def preprocess_image(input_array):
    print("Preprocessing image...")

    # Resize the image to 256x256
    resized_image = cv2.resize(input_array, (256, 256), interpolation=cv2.INTER_LINEAR)

    # Normalize the image to the [0, 1] range
    normalized_image = resized_image / resized_image.max()

    # Convert to float32 type
    normalized_image = normalized_image.astype(np.float32)

    # Add batch and channel dimensions (shape: [1, 1, H, W])
    input_tensor = torch.from_numpy(normalized_image)[None, None, :, :]
    print(f"Preprocessing complete. Resized shape: {resized_image.shape}")

    return input_tensor, resized_image.shape


# Function to postprocess the segmentation result
def postprocess_segmentation(segmentation, input_array, resized_shape):
    print("Postprocessing segmentation...")

    # Keep only the left ventricle (value 3)
    lv_segmentation = segmentation.copy()
    lv_segmentation[(lv_segmentation != 1) & (lv_segmentation != 2)] = 0

    # Find the largest connected component (ROI)
    roi_mask = (lv_segmentation == 1) | (lv_segmentation == 2)
    labeled_array, num_features = label(roi_mask)

    largest_component = None
    max_size = 0
    for i in range(1, num_features + 1):  # Labels start at 1
        component_size = np.sum(labeled_array == i)
        if component_size > max_size:
            max_size = component_size
            largest_component = (labeled_array == i)

    if largest_component is None:
        print("No valid ROI found in segmentation.")
        raise ValueError("No valid ROI found in segmentation.")

    # Get ROI bounding box
    roi_coords = np.argwhere(largest_component)
    y_min, x_min = roi_coords.min(axis=0)
    y_max, x_max = roi_coords.max(axis=0)

    # Calculate center of the largest ROI
    center_y, center_x = roi_coords.mean(axis=0)

    # Map center coordinates back to the original size
    scale_y = input_array.shape[0] / resized_shape[0]
    scale_x = input_array.shape[1] / resized_shape[1]
    center_y_original = center_y * scale_y
    center_x_original = center_x * scale_x

    # Define a fixed ROI size (128x128)
    roi_height, roi_width = 128, 128
    top_left_y = max(0, int(center_y_original - roi_height / 2))
    top_left_x = max(0, int(center_x_original - roi_width / 2))
    bottom_right_y = min(input_array.shape[0], int(center_y_original + roi_height / 2))
    bottom_right_x = min(input_array.shape[1], int(center_x_original + roi_width / 2))

    # Crop the ROI from the original image (input_array)
    fixed_roi = input_array[top_left_y:bottom_right_y, top_left_x:bottom_right_x]
    print(f"Postprocessing complete. Cropped ROI shape: {fixed_roi.shape}")

    return fixed_roi


# Main function to process the input image
def process_image(input_array):
    try:
        print("Starting image processing...")

        # Preprocessing
        input_tensor, resized_shape = preprocess_image(input_array)

        # Load the model
        print("Loading model...")
        model = load_model()
        print("Model loaded successfully.")

        # Perform inference
        with torch.no_grad():
            print("Running inference...")
            pred = model(input_tensor)  # Forward pass
            pred = torch.softmax(pred[0], dim=0)  # Apply softmax activation
            seg = torch.argmax(pred, dim=0).cpu().numpy()  # Get segmentation map
        print("Segmentation completed.")

        # Postprocessing
        cropped_roi = postprocess_segmentation(seg, input_array, resized_shape)
        print("Postprocessing done.")
        return cropped_roi

    except Exception as e:
        print(f"Error in processing image: {e}")
        raise e


# ##########################################################################
# series model


import os
from scipy.spatial.distance import euclidean

import numpy as np
import torch
import cv2
from scipy.ndimage import label
from statistics import median


# Function to process a single slice
def process_slice(im, net):
    og_y, og_x = im.shape
    # Resize image for inference
    im_resized = cv2.resize(im, (256, 256), interpolation=cv2.INTER_LINEAR)
    # Normalize and prepare for inference
    im_normalized = im_resized / im_resized.max()
    inputd = torch.from_numpy(im_normalized.astype(np.float32))[None, None, :, :]  # Add batch and channel dimensions
    # Run the model
    with torch.no_grad():
        pred = net(inputd)
    pred = torch.softmax(pred[0], dim=0)
    seg = torch.argmax(pred, dim=0).cpu().numpy()
    # Process segmentation to find ROI and center
    roi_mask = (seg == 1) | (seg == 2)  # Mask for values 1 and 2
    labeled_array, num_features = label(roi_mask)
    largest_component = max([(np.sum(labeled_array == i), i) for i in range(1, num_features + 1)], default=(0, None))[1]
    if largest_component is not None:
        roi_coords = np.argwhere(labeled_array == largest_component)
        center_y, center_x = roi_coords.mean(axis=0)
        scale_y, scale_x = og_y / im_resized.shape[0], og_x / im_resized.shape[1]
        return center_x * scale_x, center_y * scale_y
    return None


# Function to crop ROI from an image
def draw_roi(image, center, roi_size=128):
    half_size = roi_size // 2
    start_y, start_x = int(center[1] - half_size), int(center[0] - half_size)
    end_y, end_x = start_y + roi_size, start_x + roi_size
    start_y, start_x = max(0, start_y), max(0, start_x)
    end_y, end_x = min(image.shape[0], end_y), min(image.shape[1], end_x)
    return image[start_y:end_y, start_x:end_x]


# Function to process a list of CMR slices as a group
def process_slices_group(slices_data):
    centers = []
    net = load_model()


    # Step 1: Process slices and calculate centers
    for cmr_image in slices_data:
        center = process_slice(cmr_image, net)
        centers.append(center)


    # Step 2: Median centerization
    valid_centers = [c for c in centers if c is not None]
    if valid_centers:
        # Calculate the median center
        median_x = median([c[0] for c in valid_centers])
        median_y = median([c[1] for c in valid_centers])
        median_center = (median_x, median_y)


        # Correct centers based on the median center
        corrected_centers = [
            median_center if (c is None or euclidean(c, median_center) > 0) else c
            for c in centers
        ]
    else:
        corrected_centers = centers  # No valid centers, no correction

    # Step 3: Crop ROIs and return as a list
    cropped_rois = []
    for cmr_image, corrected_center in zip(slices_data, corrected_centers):
        if corrected_center is None:
            print("Skipping slice due to missing corrected center.")
            continue

        # Crop ROI
        cropped_roi = draw_roi(cmr_image, corrected_center)
        cropped_rois.append(cropped_roi)

    return cropped_rois
