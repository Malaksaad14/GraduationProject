import json
import argparse
from pathlib import Path
import numpy as np
import cv2
import matplotlib.pyplot as plt
from typing import Dict, Any
from mask_extractor.MaskExtractor import MaskExtractor
from mask_extractor.extract_masks import extract_all_masks, save_masks_to_npy
from mask_merger.MaskAlignment import MaskAlignment
from mask_simulator.ImageProcessor import ImageProcessor
from mask_merger.merge_masks import generate_multible_merged_masks
from mask_simulator.generate_simulated_mask import generate_multible_cardiac_images

def load_config(json_path: str) -> Dict[str, Any]:
    with open(json_path, 'r') as file:
        config = json.load(file)
    return config

def main(config_path: str):
    # Load configuration from JSON file
    config = load_config(config_path)

    # Paths
    base_path = Path(config['paths']['base_path'])
    np_data_path = Path(config['paths']['np_data_path'])
    output_dir = config['paths']['output_dir']
    
    # Check if npy file exists
    if np_data_path.exists():
        # read the data from the npy file
        all_masks = np.load(np_data_path, allow_pickle=True).item()
        print("Loaded existing masks from file!")
    else:
        # Extract masks and save them
        all_masks = extract_all_masks(base_path)
        print("All masks extracted successfully!")
        # Create parent directory if it doesn't exist
        np_data_path.parent.mkdir(parents=True, exist_ok=True)
        save_masks_to_npy(all_masks, np_data_path)
        print("All masks saved successfully!")

    # Generate merged masks
    merge_params = config['merge_masks_params']
    merged_masks = generate_multible_merged_masks(
        all_masks=all_masks,
        number_of_masks=merge_params['number_of_masks'],
        search_range=merge_params['search_range'],
        rotation_angles=np.arange(0, 360, merge_params['rotation_step']),
        visualize_flag=merge_params['visualize_flag'] ,
        mayocardium_vlue = merge_params['mayocardium_vlue'],
        infarction_value = merge_params['infarction_value'], 
        blood_pool_value = merge_params['blood_pool_value'], 
        no_flow_value = merge_params['no_flow_value'],
        output_dir=output_dir

    )

    # Generate multiple cardiac images
    image_params = config['generate_images_params']
    generate_multible_cardiac_images(
        number_of_images=image_params['number_of_images'],
        output_dir=output_dir,
        all_masks=all_masks,
        mayocardium_type=image_params['mayocardium_type'],
        image_size=tuple(image_params['image_size']),
        number_of_seeds=image_params['number_of_seeds'],
        energy=image_params['energy'],
        max_radius_step=image_params['max_radius_step'],
        max_theta_step=image_params['max_theta_step'],
        min_cluster_size=image_params['min_cluster_size'],
        min_no_flow_size=image_params['min_no_flow_size'],
        ring_thick_max=image_params['ring_thick_max'],
        ring_thick_min=image_params['ring_thick_min'],
        show_plots=image_params['show_plots'],
        background_color=image_params['background_color'],
        blood_pool_color=image_params['blood_pool_color'],
        mayocardium_color=image_params['mayocardium_color'],
        infarction_color=image_params['infarction_color'],
        no_flow_color=image_params['no_flow_color'],
        infarct_to_myo_upper_limit = image_params['infarct_to_myo_upper_limit'],
        infarct_to_myo_lower_limit = image_params['infarct_to_myo_lower_limit'],
        noflow_to_infarct_upper_limit = image_params['noflow_to_infarct_upper_limit'],
        noflow_to_infarct_lower_limit = image_params['noflow_to_infarct_lower_limit']
    )

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process configuration for mask generation and simulation.")
    parser.add_argument('config_path', type=str, help='Path to the JSON configuration file.')
    args = parser.parse_args()
    main(args.config_path)