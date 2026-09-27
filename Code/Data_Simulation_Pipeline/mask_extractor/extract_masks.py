from typing import Dict, List, Tuple, Any
from mask_extractor.MaskExtractor import MaskExtractor
import numpy as np
import logging
def extract_all_masks(base_path: str) -> Dict[str, Any]:
    """
    Extract all masks from the dataset using MaskExtractor.
    
    Args:
        base_path (str): Path to the base directory containing the data
        
    Returns:
        Dict[str, Any]: Dictionary containing all processed masks organized by case
    """
    # Initialize the mask extractor
    extractor = MaskExtractor(base_path)
    
    # Process and extract all masks
    print("Starting mask extraction...")
    all_masks = extractor.process()
    
    # Print summary of extracted masks
    num_cases = len(all_masks)
    if num_cases > 0:
        sample_case = next(iter(all_masks))
        num_slices = len(all_masks[sample_case]['standard_mask'])
        print(f"\nExtraction complete:")
        print(f"- Total cases processed: {num_cases}")
        print(f"- Slices per case: {num_slices}")
        print(f"- Available mask types: {list(all_masks[sample_case].keys())}")
    else:
        print("No masks were extracted!")
        
    return all_masks

def get_random_mask_slice(all_masks: Dict[str, Any], mask_type) -> np.ndarray:
    # Select a random case
    if mask_type == "infarction_masks":
        keys_with_infarction = [key for key in all_masks.keys() if 'P' in key]
        case_id = np.random.choice(list(keys_with_infarction))

    else: 
        case_id = np.random.choice(list(all_masks.keys()))


    # log the selected case ID
    logging.debug(f"Selected case ID: {case_id}")
    
    case_masks = all_masks[case_id]
    
    # Select a random mask type
    mask = case_masks[mask_type]
    blood_pool_mask = case_masks["blood_pool_masks"]
    # Select a random slice
    slice_idx = np.random.randint(len(mask))
    mask_slice = mask[slice_idx]
    blood_pool_mask_slice = blood_pool_mask[slice_idx]
    logging.debug(f"Selected slice index: {slice_idx}")
    # log the unique values of the mask slice   
    if mask_type == "infarction_masks":
        logging.debug(f"Unique values in infarction mask slice: {np.unique(mask_slice)}")
    
    logging.debug(f"Unique values in mask slice: {np.unique(blood_pool_mask_slice)}")
    logging.debug(f"blood_pool_mask_slice shape: {blood_pool_mask_slice.shape}")
    return mask_slice, blood_pool_mask_slice

def save_masks_to_npy(all_masks: Dict[str, Any], np_data_path: str) -> None:
    """
    Save the extracted masks to an npy file.
    
    Args:
        all_masks (Dict[str, Any]): Dictionary containing all processed masks organized by case
        np_data_path (str): Path to save the npy file
    """
    np.save(np_data_path, all_masks)
    print(f"Saved masks to {np_data_path}")

def overlay_masks_on_mask(mask1: np.ndarray, mask2: np.ndarray) -> np.ndarray:
    """
    Overlay mask1 on mask2, removing the old values of mask2 and placing the values of mask1.
    
    Args:
        mask1 (np.ndarray): The first mask to overlay
        mask2 (np.ndarray): The second mask to overlay on
        
    Returns:
        np.ndarray: The resulting overlayed mask
    """
    # Create a copy of mask2 to avoid modifying the original
    overlayed_mask = np.copy(mask2)
    
    # Set the values of mask1 in the overlayed_mask
    overlayed_mask[mask1 > 0] = mask1[mask1 > 0]
    
    return overlayed_mask

def add_blood_pool_to_image(image: np.ndarray, blood_pool_mask: np.ndarray, blood_pool_color: int = 1) -> np.ndarray:
    """
    Overlay the blood pool mask on the image.
    
    Args:
        image: The original image
        blood_pool_mask: The blood pool mask to overlay
        blood_pool_color: Color value for the blood pool
    
    Returns:
        np.ndarray: Image with the blood pool overlayed
    """
    # Create a copy of the image to avoid modifying the original
    overlayed_image = np.copy(image)
    
    # Set the values of the blood pool in the overlayed image
    overlayed_image[blood_pool_mask > 0] = blood_pool_color
    return overlayed_image