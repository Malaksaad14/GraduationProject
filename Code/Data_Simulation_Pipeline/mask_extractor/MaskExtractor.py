from pathlib import Path
import os
import numpy as np
import cv2
import matplotlib.pyplot as plt
from typing import Dict, List, Tuple, Any

class MaskExtractor:
    """
    Class for extracting and processing different types of masks from medical image data.
    Handles mask extraction, processing, and visualization.
    """

    def __init__(self, base_path: str):
        """
        Initialize the MaskExtractor with a base path.
        
        Args:
            base_path (str): Path to the directory containing the medical image data
        """
        self.base_path = Path(base_path)
        self.all_masks = {}
        # self.mask_alignment = MaskAlignment()

    def process(self) -> Dict[str, Any]:
        """
        Main entry point for processing all masks in the dataset.
        
        Returns:
            Dict[str, Any]: Dictionary containing all processed masks organized by case
        """
        return self.extract_masks_all_folders()

    def extract_masks_all_folders(self) -> Dict[str, Any]:
        """
        Process all folders in the base path to extract masks.
        
        Returns:
            Dict[str, Any]: Dictionary containing all processed masks organized by case
        """
        for train_dir in self._get_train_directories():
            self._process_train_directory(train_dir)
        return self.all_masks

    def _get_train_directories(self) -> List[Path]:
        """
        Get all training directories from the base path.
        
        Returns:
            List[Path]: List of paths to training directories
        """
        return [d for d in self.base_path.glob("*train_data") if d.is_dir()]

    def _process_train_directory(self, train_dir: Path) -> None:
        """
        Process a single training directory containing multiple cases.
        
        Args:
            train_dir (Path): Path to the training directory
        """
        for case_dir in train_dir.iterdir():
            if case_dir.is_dir():
                self._process_case_directory(case_dir)

    def _process_case_directory(self, case_dir: Path) -> None:
        """
        Process a single case directory to extract masks.
        
        Args:
            case_dir (Path): Path to the case directory
        """
        slices_path = case_dir / "Slices"
        name = case_dir.name
        nd_arrays = self.read_nd_array_from_directory(str(slices_path))
        masks = self.extract_masks_from_nd_arrays(nd_arrays)
        self.all_masks[name] = masks
        print(f"Processed {slices_path}")

    def read_nd_array_from_directory(self, directory: str) -> List[np.ndarray]:
        """
        Read all .npy files from a directory into numpy arrays.
        
        Args:
            directory (str): Path to directory containing .npy files
            
        Returns:
            List[np.ndarray]: List of numpy arrays from the .npy files
        """
        return [np.load(os.path.join(directory, f)) 
                for f in os.listdir(directory) 
                if f.endswith(".npy")]

    def extract_masks_from_nd_arrays(self, nd_arrays: List[np.ndarray]) -> Dict[str, List[np.ndarray]]:
        """
        Extract different types of masks from a list of numpy arrays.
        
        Args:
            nd_arrays (List[np.ndarray]): List of input numpy arrays
            
        Returns:
            Dict[str, List[np.ndarray]]: Dictionary containing different types of masks:
                - masks: Original masks
                - blood_pool_masks: Blood pool masks
                - mayocardium_masks: Mayocardium masks
                - infarction_masks: Infarction masks
        """
        mask_lists = {
            'standard_mask': [],
            'blood_pool_masks': [],
            'mayocardium_masks': [],
            'infarction_masks': []
        }
        
        for nd_array in nd_arrays:
            self._process_single_array(nd_array, mask_lists)
        
        return mask_lists

    def _process_single_array(self, nd_array: np.ndarray, 
                            mask_lists: Dict[str, List[np.ndarray]]) -> None:
        """
        Process a single numpy array and extract various masks.
        
        Args:
            nd_array (np.ndarray): Input numpy array
            mask_lists (Dict[str, List[np.ndarray]]): Dictionary to store extracted masks
        """
        mask = nd_array[:,:,1]
        # print("processing single array")                 
        masks = self._create_specific_masks(mask)
        for key, value in masks.items():
            mask_lists[key].append(value)

    def _create_specific_masks(self, mask: np.ndarray) -> Dict[str, np.ndarray]:
        """
        Create specific types of masks from a base mask.
        
        Args:
            mask (np.ndarray): Input base mask
            
        Returns:
            Dict[str, np.ndarray]: Dictionary containing different types of masks
        """
        blood_pool_mask = self._create_blood_pool_mask(mask.copy())
        mayocardium_mask = self._create_mayocardium_mask(mask.copy())
        infarction_mask = self._create_infarction_mask(mask.copy())
        
        return {
            'standard_mask': mask.astype(np.uint8),
            'blood_pool_masks': blood_pool_mask,
            'mayocardium_masks': mayocardium_mask,
            'infarction_masks': infarction_mask
        }

    @staticmethod
    def _create_blood_pool_mask(mask: np.ndarray) -> np.ndarray:
        """
        Create blood pool mask from base mask.
        
        Args:
            mask (np.ndarray): Input mask
            
        Returns:
            np.ndarray: Blood pool mask
        """
        mask[mask != 1] = 0
        return mask.astype(np.uint8)

    @staticmethod
    def _create_mayocardium_mask(mask: np.ndarray) -> np.ndarray:
        """
        Create mayocardium mask from base mask.
        
        Args:
            mask (np.ndarray): Input mask
            
        Returns:
            np.ndarray: Mayocardium mask
        """
        mask[mask == 1] = 0
        mask[mask != 0] = 2
        return mask.astype(np.uint8)

    @staticmethod
    def _create_infarction_mask(mask: np.ndarray) -> np.ndarray:
        """
        Create infarction mask from base mask.
        
        Args:
            mask (np.ndarray): Input mask
            
        Returns:
            np.ndarray: Infarction mask
        """
        mask[(mask < 3)] = 0
        return mask.astype(np.uint8)
    
    def calculate_contour(self, mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
            """
            Calculate contour of a mask and create a filled contour mask.
            
            Args:
                mask (np.ndarray): Input mask
                
            Returns:
                Tuple[np.ndarray, np.ndarray]: (filled mask, largest contour)
            """
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            largest_contour = max(contours, key=cv2.contourArea)
            filled_mask = np.zeros_like(mask)
            cv2.fillPoly(filled_mask, [largest_contour], 1)
            return filled_mask, largest_contour

    def calculate_mask_rad_and_position(self, mask: np.ndarray) -> Tuple[Tuple[float, float], float]:
        """
        Calculate radius and center position of a mask.
        
        Args:
            mask (np.ndarray): Input mask
            
        Returns:
            Tuple[Tuple[float, float], float]: ((center_x, center_y), radius)
        """
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        largest_contour = max(contours, key=cv2.contourArea)
        return cv2.minEnclosingCircle(largest_contour)
   