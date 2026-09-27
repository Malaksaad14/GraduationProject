from mask_merger.MaskAlignment import MaskAlignment
from pathlib import Path
import os
import numpy as np
import cv2
from typing import Dict, List, Tuple, Any
from mask_extractor.extract_masks import get_random_mask_slice, add_blood_pool_to_image
import logging
import time
from datetime import datetime


logging.basicConfig(level=logging.DEBUG, 
                    format='%(asctime)s - %(levelname)s - %(message)s',
                    filename='app.log',  # Save logs to a file
                    filemode='w')  # Overwrite file on each run (use 'a' to append)


def merge_masks(mayocardial_mask: np.ndarray, infarction_mask: np.ndarray, search_range: int = 10,
                 rotation_angles: np.ndarray = np.arange(0, 360, 30), visualize_flag: bool = 0,
                   mayocardium_vlue: int =2, infarction_value: int = 3, no_flow_value: int = 4 ) -> np.ndarray:
    """
    Generate a merged mask by aligning the input masks.

    Args:
        mayocardial_mask (np.ndarray): Myocardial mask
        infarction_mask (np.ndarray): Infarction mask
        search_range (int): Search range for alignment
        rotation_angles (np.ndarray): Range of rotation angles to search
        visualize_flag (bool): Flag to visualize the alignment process
    
    Returns:
        np.ndarray: Result of merging the input masks

    
    """
    
    mask_alignment = MaskAlignment()
    mayocardium_center = mask_alignment.calculate_mask_rad_and_position(mayocardial_mask)[0]
    print("mayocardium_center", mayocardium_center)
    # log the unique values of both of the masks
    logging.debug(f"Unique values in mayocardial_mask: {np.unique(mayocardial_mask)}")
    logging.debug(f"Unique values in infarction_mask: {np.unique(infarction_mask)}")
    merged_mask = mask_alignment._get_merged_mask(mayocardial_mask, infarction_mask, mayocardium_center, search_range, rotation_angles, visualize_flag)
    processed_mask = mask_alignment.change_mask_pixel_values(mask= merged_mask, mayocardium_vlue= mayocardium_vlue, infarction_value= infarction_value, no_flow_value= no_flow_value)
    # log the values of the infarction and mayocardium value
    logging.debug(f"infarction_value: {infarction_value}, mayocardium_vlue: {mayocardium_vlue}, no_flow_value: {no_flow_value}")
    logging.debug(f"Unique values in merged_mask: {np.unique(merged_mask)}")
    return processed_mask


def generate_multible_merged_masks(all_masks: Dict[str, Any], number_of_masks: int, search_range, 
                                   rotation_angles, visualize_flag, mayocardium_vlue: int = 2, infarction_value: int = 3, 
                                   blood_pool_value: int =1, no_flow_value: int = 4 , output_dir : str = None) -> List[np.ndarray]:
    """
    Generate a number of merged masks using the input masks.
    
    Args:
        all_masks (Dict[str, Any]): Dictionary containing all masks organized by case
        number_of_masks (int): Number of merged masks to generate
        search_range (int): Search range for alignment
        rotation_angles (np.ndarray): Range of rotation angles to search
        visualize_flag (bool): Flag to visualize the alignment process

        
    Returns:
        List[np.ndarray]: List of merged masks
    """
    merged_masks = []
    merged_directory_path ='merged_masks'
    output_dir = os.path.join(output_dir, merged_directory_path)
    # Ensure the directory exists
    os.makedirs(output_dir, exist_ok=True)

    
    for _ in range(number_of_masks):
        # Select two random masks
        mayocardial_mask, blood_pool_mask = get_random_mask_slice(all_masks, 'mayocardium_masks')
        infarction_mask, _ = get_random_mask_slice(all_masks, 'infarction_masks')
        # Merge the masks
        merged_mask = merge_masks(mayocardial_mask= mayocardial_mask, infarction_mask= infarction_mask,
                                   search_range= search_range, rotation_angles= rotation_angles,
                                     visualize_flag= visualize_flag, mayocardium_vlue= mayocardium_vlue, infarction_value= infarction_value,
                                     no_flow_value= no_flow_value)
        merged_mask = add_blood_pool_to_image(merged_mask, blood_pool_mask, blood_pool_value)
        
        merged_masks.append(merged_mask)
        
        # timestamp = time.strftime("%Y-%m-%d-%H-%M")
        timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M-%S-%f")
        # calculate the precetage of infarction to mayocardium
        # infarction_percentage = int(np.sum(merged_mask == infarction_value) / np.sum( merged_mask != 0) * 100)

        np.save(os.path.join(output_dir, f"real_real_{timestamp}.npy"), merged_mask)
        cv2.imwrite(os.path.join(output_dir, f"real_real_{timestamp}.png"), merged_mask)
        print(f"Merged mask {timestamp} saved successfully!")


    # # Save the merged masks to the specified directory
    # for i, merged_mask in enumerate(merged_masks):
    #     cv2.imwrite(os.path.join(output_dir, f"merged_mask_{i}.png"), merged_mask)
    #     # save as npy
    #     np.save(os.path.join(output_dir, f"merged_mask_{i}.npy"), merged_mask)
    #     print(f"Merged mask {i} saved successfully!")

    return merged_masks
