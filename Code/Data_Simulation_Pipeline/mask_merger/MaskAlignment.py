from pathlib import Path
import os
import numpy as np
import cv2
import matplotlib.pyplot as plt
from typing import Dict, List, Tuple, Any
import logging

class MaskAlignment:
    """
    Class for handling mask alignment operations including shifting, rotation, and correlation calculations.
    """
    
    @staticmethod
    def shift_mask(mask: np.ndarray, shift_x: int = 0, shift_y: int = 0) -> np.ndarray:
        """
        Shifts a mask by the specified x and y values.
        
        Args:
            mask (np.ndarray): Input mask to be shifted
            shift_x (int): Number of pixels to shift in x direction (positive = right)
            shift_y (int): Number of pixels to shift in y direction (positive = down)
            
        Returns:
            np.ndarray: Shifted mask
        """
        shifted_mask = np.zeros_like(mask)
        h, w = mask.shape
        src_coords, dst_coords = MaskAlignment._calculate_shift_coordinates(h, w, shift_x, shift_y)
        shifted_mask[dst_coords['y1']:dst_coords['y2'], 
                    dst_coords['x1']:dst_coords['x2']] = mask[src_coords['y1']:src_coords['y2'], 
                                                             src_coords['x1']:src_coords['x2']]
        return shifted_mask

    @staticmethod
    def _calculate_shift_coordinates(h: int, w: int, shift_x: int, shift_y: int) -> Tuple[Dict, Dict]:
        """
        Calculates source and destination coordinates for mask shifting.
        
        Args:
            h (int): Height of the mask
            w (int): Width of the mask
            shift_x (int): X-axis shift amount
            shift_y (int): Y-axis shift amount
            
        Returns:
            Tuple[Dict, Dict]: Source and destination coordinates for shifting
        """
        src_coords = {'x1': 0, 'x2': 0, 'y1': 0, 'y2': 0}
        dst_coords = {'x1': 0, 'x2': 0, 'y1': 0, 'y2': 0}

        if shift_x >= 0:
            src_coords['x1'], src_coords['x2'] = 0, w - shift_x
            dst_coords['x1'], dst_coords['x2'] = shift_x, w
        else:
            src_coords['x1'], src_coords['x2'] = -shift_x, w
            dst_coords['x1'], dst_coords['x2'] = 0, w + shift_x
            
        if shift_y >= 0:
            src_coords['y1'], src_coords['y2'] = 0, h - shift_y
            dst_coords['y1'], dst_coords['y2'] = shift_y, h
        else:
            src_coords['y1'], src_coords['y2'] = -shift_y, h
            dst_coords['y1'], dst_coords['y2'] = 0, h + shift_y

        return src_coords, dst_coords

    @staticmethod
    def rotate_mask_around_point(mask: np.ndarray, 
                               angle: float, 
                               center: Tuple[int, int] = None, 
                               keep_size: bool = True) -> np.ndarray:
        """
        Rotates a mask around a specified point.
        
        Args:
            mask (np.ndarray): Input mask to be rotated
            angle (float): Rotation angle in degrees
            center (Tuple[int, int]): Center point for rotation (default: mask center)
            keep_size (bool): Whether to maintain original mask size
            
        Returns:
            np.ndarray: Rotated mask
        """
        h, w = mask.shape
        center = center if center is not None else (w // 2, h // 2)
        rotation_matrix = cv2.getRotationMatrix2D(center, -angle, 1.0)
        
        if keep_size:
            return MaskAlignment._rotate_keep_size(mask, rotation_matrix, (w, h))
        else:
            return MaskAlignment._rotate_adjust_size(mask, rotation_matrix, center, h, w)

    @staticmethod
    def _rotate_keep_size(mask: np.ndarray, 
                         rotation_matrix: np.ndarray, 
                         dimensions: Tuple[int, int]) -> np.ndarray:
        """
        Rotates mask while maintaining original dimensions.
        
        Args:
            mask (np.ndarray): Input mask
            rotation_matrix (np.ndarray): 2D rotation matrix
            dimensions (Tuple[int, int]): Original mask dimensions
            
        Returns:
            np.ndarray: Rotated mask with original dimensions
        """
        rotated = cv2.warpAffine(mask, rotation_matrix, dimensions, flags=cv2.INTER_NEAREST)
        return rotated.astype(np.uint8)

    @staticmethod
    def _rotate_adjust_size(mask: np.ndarray, 
                          rotation_matrix: np.ndarray, 
                          center: Tuple[int, int], 
                          h: int, 
                          w: int) -> np.ndarray:
        """
        Rotates mask and adjusts size to fit rotated content.
        
        Args:
            mask (np.ndarray): Input mask
            rotation_matrix (np.ndarray): 2D rotation matrix
            center (Tuple[int, int]): Rotation center point
            h (int): Original height
            w (int): Original width
            
        Returns:
            np.ndarray: Rotated mask with adjusted dimensions
        """
        cos = np.abs(rotation_matrix[0, 0])
        sin = np.abs(rotation_matrix[0, 1])
        new_w = int((h * sin) + (w * cos))
        new_h = int((h * cos) + (w * sin))
        
        rotation_matrix[0, 2] += (new_w / 2) - center[0]
        rotation_matrix[1, 2] += (new_h / 2) - center[1]
        
        rotated = cv2.warpAffine(mask.astype(np.float32), rotation_matrix, (new_w, new_h))
        return (rotated > 0.5).astype(np.uint8)

    def find_optimal_alignment(self, mayocardial_mask: np.ndarray, infarction_mask: np.ndarray, 
                             mayocardium_center: Tuple[float, float],
                             search_range: int = 20, 
                             rotation_angles: np.ndarray = np.arange(0, 360, 30)) -> Dict[str, Any]:
        """
        Find optimal alignment parameters between two masks.
        
        Args:
            mayocardial_mask (np.ndarray): Target mask
            infarction_mask (np.ndarray): Mask to be aligned
            mayocardium_center (Tuple[float, float]): Center point for rotation
            search_range (int): Range of pixels to search for alignment
            rotation_angles (np.ndarray): Array of rotation angles to try
            
        Returns:
            Dict[str, Any]: Dictionary containing best alignment parameters
        """
        best_correlation = 0
        best_params = {'shift_x': 0, 'shift_y': 0, 'angle': 0, 'metrics': None}
        
        rotation_center = (int(mayocardium_center[0]), int(mayocardium_center[1]))
        
        print("Starting alignment optimization...")
        
        for shift_x in range(-search_range, search_range + 1):
            for shift_y in range(-search_range, search_range + 1):
                shifted_mask = self.shift_mask(infarction_mask, shift_x, shift_y)
                
                for angle in rotation_angles:
                    print(f"Testing shift ({shift_x}, {shift_y}), rotation {angle}°")
                    
                    rotated_mask = self.rotate_mask_around_point(
                        shifted_mask, angle, rotation_center
                    )
                    
                    correlation_metrics = self.calculate_mask_correlation(
                        rotated_mask, mayocardial_mask
                    )
                    current_correlation = correlation_metrics['dice_coefficient']
                    
                    if current_correlation > best_correlation:
                        best_correlation = current_correlation
                        best_params = {
                            'shift_x': shift_x,
                            'shift_y': shift_y,
                            'angle': angle,
                            'metrics': correlation_metrics
                        }
        
        return best_params

    def _get_merged_mask(self, mayocardial_mask: np.ndarray, infarction_mask: np.ndarray,
                        mayocardium_center: Tuple[float, float],
                        search_range: int = 20,
                        rotation_angles: np.ndarray = np.arange(0, 360, 30), visualize_flag: bool = 1) -> np.ndarray:
        """
        Align and merge two masks together.
        
        Args:
            mayocardial_mask (np.ndarray): Base mask that stays in place
            infarction_mask (np.ndarray): Mask to be aligned and merged
            mayocardium_center (Tuple[float, float]): Center point for rotation
            search_range (int): Range of pixels to search for alignment
            rotation_angles (np.ndarray): Array of rotation angles to try
            
        Returns:
            np.ndarray: Final merged mask
        """
        # Find optimal alignment parameters
        best_params = self.find_optimal_alignment(
            mayocardial_mask, infarction_mask, mayocardium_center, search_range, rotation_angles
        )
        
        # Align the infarction mask
        shifted_mask = self.shift_mask(
            infarction_mask, best_params['shift_x'], best_params['shift_y']
        )
        # log the unique values of the shifted mask
        logging.debug(f"Unique values in shifted mask: {np.unique(shifted_mask)}")
        
        aligned_infarction_mask = self.rotate_mask_around_point(
            shifted_mask, 
            best_params['angle'], 
            (int(mayocardium_center[0]), int(mayocardium_center[1]))
        )
        # log the unique values of the aligned infarction mask
        logging.debug(f"Unique values in aligned infarction mask: {np.unique(aligned_infarction_mask)}")
        # Merge the maskse
        merged_mask = self._merge_masks(mayocardial_mask, aligned_infarction_mask)
        logging.debug(f"Unique values in merged mask: {np.unique(merged_mask)}")
        
        # Visualize results
        if visualize_flag:
            self._plot_alignment_results(infarction_mask, mayocardial_mask, shifted_mask, aligned_infarction_mask, best_params)
            self._print_alignment_metrics(best_params)
        
        return merged_mask

    def _merge_masks(self, mayocardial_mask: np.ndarray, aligned_infarction_mask: np.ndarray) -> np.ndarray:
        """
        Merge the aligned infarction mask with the mayocardial mask.
        Only keep infarction mask pixels that overlap with the mayocardial mask.
        
        Args:
            mayocardial_mask (np.ndarray): Base mask
            aligned_infarction_mask (np.ndarray): Aligned infarction mask
            
        Returns:
            np.ndarray: Merged mask
        """
        # Create a binary mask of the mayocardial region
        mayocardial_region = (mayocardial_mask > 0).astype(np.uint8)
        # log the unique values of the aligned infarction mask
        logging.debug(f"Unique values in aligned infarction mask: {np.unique(aligned_infarction_mask)}")
        # Create the merged mask starting with the mayocardial mask
        merged_mask = mayocardial_mask.copy()
        
        # Only keep infarction pixels that overlap with mayocardial region
        valid_infarction = aligned_infarction_mask * mayocardial_region
        
        # Add the valid infarction pixels to the merged mask
        # This preserves both the mayocardial and infarction values
        merged_mask = np.where(valid_infarction > 0, valid_infarction, merged_mask)
        
        return merged_mask

    def _plot_alignment_results(self, infarction_mask: np.ndarray, mayocardial_mask: np.ndarray, 
                              shifted_mask: np.ndarray, final_mask: np.ndarray, 
                              params: Dict[str, Any]) -> None:
        """
        Plot the results of mask alignment.
        
        Args:
            infarction_mask (np.ndarray): Original mask
            mayocardial_mask (np.ndarray): Target mask
            shifted_mask (np.ndarray): Mask after shifting
            final_mask (np.ndarray): Final aligned mask
            params (Dict[str, Any]): Alignment parameters
        """
        plt.figure(figsize=(15, 5))
        
        plt.subplot(131)
        plt.imshow(infarction_mask, cmap='gray', alpha=0.5)
        plt.imshow(mayocardial_mask, cmap='jet', alpha=0.5)
        plt.title("Original Alignment")
        plt.axis('off')
        
        plt.subplot(132)
        plt.imshow(mayocardial_mask, cmap='gray', alpha=0.5)
        plt.imshow(shifted_mask, cmap='jet', alpha=0.5)
        plt.title(f"After Shift\n({params['shift_x']}, {params['shift_y']})")
        plt.axis('off')
        
        plt.subplot(133)
        plt.imshow(mayocardial_mask, cmap='gray', alpha=0.5)
        plt.imshow(final_mask, cmap='jet', alpha=0.5)
        plt.title(f"Final Alignment\n{params['angle']}°")
        plt.axis('off')
        
        plt.tight_layout()
        plt.show()

    def _print_alignment_metrics(self, params: Dict[str, Any]) -> None:
        """
        Print the metrics from mask alignment.
        
        Args:
            params (Dict[str, Any]): Alignment parameters and metrics
        """
        print("\nAlignment Results:")
        print(f"Best shift: ({params['shift_x']}, {params['shift_y']})")
        print(f"Best rotation: {params['angle']}°")
        print(f"Final metrics:")
        print(f"- Dice coefficient: {params['metrics']['dice_coefficient']:.3f}")
        print(f"- Intersection ratio: {params['metrics']['intersection_ratio']:.3f}")
        print(f"- Overlapping pixels: {params['metrics']['intersection_pixels']}")
    @staticmethod

    def calculate_mask_correlation(mayocardial_mask: np.ndarray, infarction_mask: np.ndarray) -> Dict[str, float]:
        """
        Calculates correlation metrics between two masks.
        
        Args:
            mask1 (np.ndarray): First mask
            mask2 (np.ndarray): Second mask
            
        Returns:
            Dict[str, float]: Dictionary containing correlation metrics:
                - intersection_pixels: Number of overlapping pixels
                - intersection_ratio: Ratio of overlap to total area
                - dice_coefficient: Dice similarity coefficient
        """
        mayocardial_mask_binary = (mayocardial_mask > 0).astype(np.uint8)
        infarction_binary = (infarction_mask > 0).astype(np.uint8)
        
        intersection = MaskAlignment._calculate_intersection(mayocardial_mask_binary, infarction_binary)
        areas = MaskAlignment._calculate_areas(mayocardial_mask_binary, infarction_binary)
        metrics = MaskAlignment._calculate_metrics(intersection, areas)
        
        return metrics

    @staticmethod
    def _calculate_intersection(mask1: np.ndarray, mask2: np.ndarray) -> Dict[str, int]:
        """
        Calculates intersection metrics between two masks.
        
        Args:
            mask1 (np.ndarray): First binary mask
            mask2 (np.ndarray): Second binary mask
            
        Returns:
            Dict[str, int]: Dictionary containing:
                - intersection_pixels: Number of overlapping pixels
                - union_pixels: Total number of pixels in union
        """
        intersection = np.logical_and(mask1, mask2)
        union = np.logical_or(mask1, mask2)
        return {
            'intersection_pixels': int(np.sum(intersection)),
            'union_pixels': int(np.sum(union))
        }

    @staticmethod
    def _calculate_areas(mask1: np.ndarray, mask2: np.ndarray) -> Dict[str, int]:
        """
        Calculates areas of two masks.
        
        Args:
            mask1 (np.ndarray): First binary mask
            mask2 (np.ndarray): Second binary mask
            
        Returns:
            Dict[str, int]: Dictionary containing areas of both masks
        """
        return {
            'area_mask1': int(np.sum(mask1)),
            'area_mask2': int(np.sum(mask2))
        }

    @staticmethod
    def _calculate_metrics(intersection: Dict[str, int], 
                         areas: Dict[str, int]) -> Dict[str, float]:
        """
        Calculates final correlation metrics from intersection and areas.
        
        Args:
            intersection (Dict[str, int]): Intersection metrics
            areas (Dict[str, int]): Area metrics
            
        Returns:
            Dict[str, float]: Final correlation metrics including:
                - intersection_pixels
                - intersection_ratio
                - dice_coefficient
        """
        intersection_ratio = (intersection['intersection_pixels'] / 
                            intersection['union_pixels'] if intersection['union_pixels'] > 0 else 0)
        
        dice = (2.0 * intersection['intersection_pixels'] / 
               (areas['area_mask1'] + areas['area_mask2']) 
               if (areas['area_mask1'] + areas['area_mask2']) > 0 else 0)
        
        return {
            'intersection_pixels': intersection['intersection_pixels'],
            'intersection_ratio': float(intersection_ratio),
            'dice_coefficient': float(dice)
        }
    
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
        (x, y), radius = cv2.minEnclosingCircle(largest_contour)

        return (x, y), radius

    def change_mask_pixel_values(self, mask: np.ndarray, mayocardium_vlue: int, infarction_value: int , no_flow_value : int) -> np.ndarray:
        """
        Change pixel values of a mask to specified values.
        
        Args:
            mask (np.ndarray): Input mask
            mayocardium_vlue (int): New value for mayocardium pixels
            infarction_value (int): New value for infarction pixels
            
        Returns:
            np.ndarray: Mask with updated pixel values
        """
        new_mask = mask.copy()
        new_mask[new_mask == 4] = no_flow_value
        new_mask[new_mask == 3] = infarction_value
        new_mask[new_mask == 2] = mayocardium_vlue

        return new_mask