from pathlib import Path
import os
import numpy as np
import cv2
import matplotlib.pyplot as plt
from typing import Dict, List, Tuple, Any
from mask_simulator.ImageProcessor import ImageProcessor
from  mask_extractor.extract_masks import get_random_mask_slice, add_blood_pool_to_image
import logging
import time
from datetime import datetime
from stats_calculator.stats_calculator import StatsCalculator



def generate_cardiac_image(
    all_masks: Dict[str, Any] = None,
    mayocardium_type = 'simulated',
    image_size: Tuple[int, int] = (250, 250),
    number_of_seeds: int = 80,
    energy: int = 30,
    max_radius_step: float = 2,
    max_theta_step: float = np.pi / 4,
    min_cluster_size: int = 70,
    min_no_flow_size: int = 30,
    ring_thick_max: int = 20,
    ring_thick_min: int = 15,
    show_plots: bool = True,
    background_color: int = 0,
    blood_pool_color: int = 1,
    mayocardium_color: int = 2,
    infarction_color: int = 3,
    no_flow_color: int = 4,
) -> Tuple[np.ndarray, dict]:
    """
    Generate a complete cardiac image with infarctions and no-flow regions.
    
    Args:
        image_size: Tuple of (height, width) for the image
        number_of_seeds: Number of seeds for region growing
        energy: Energy level for region spreading
        max_radius_step: Maximum step in radial direction
        max_theta_step: Maximum step in angular direction
        min_cluster_size: Minimum size for infarction clusters
        min_no_flow_size: Minimum size for no-flow regions
        show_plots: Whether to display the intermediate results
        background_color: Pixel value for the background
        blood_pool_color: Pixel value for the blood pool
        mayocardium_color: Pixel value for the myocardium
        infarction_color: Pixel value for the infarctions
        no_flow_color: Pixel value for the no-flow regions

    
    Returns:
        Tuple containing:
            - Final processed image
            - Dictionary of intermediate results
    """
    # Initialize processor
    processor = ImageProcessor()
    if mayocardium_type == 'simulated':
        # Generate initial cardiac structure
        height, width = image_size
        array = processor.generate_ring_with_cavity_and_cloud_infarctions(
            height=height,
            width=width,
            outer_radius_max=min(height, width) // 3,
            outer_radius_min=min(height, width) // 4,
            ring_thick_max=ring_thick_max,
            ring_thick_min=ring_thick_min
        )

    else:
        # Load a random myocardium mask
        mayocardium_mask, blood_pool_mask = get_random_mask_slice(all_masks, 'mayocardium_masks')
        # map the value from 2 to 150
        array = np.copy(mayocardium_mask)
        array[array == 2] = 150

    
    # Select initial seed and generate additional seeds
    initial_seed, center_x, center_y = processor.select_initial_seed(array=array)
    #
    selected_seeds = processor.generate_seeds(
        initial_seed=initial_seed,
        center_x=center_x,
        center_y=center_y,
        number_of_seeds=number_of_seeds,
        max_radius_step=max_radius_step,
        max_theta_step=max_theta_step,
        array=array
    )
    
    # Generate and process regions
    output_array = processor.spread_region_with_bias(
        selected_seeds=selected_seeds,
        energy=energy,
        array=array
    )
    
    infarction_mask = output_array == 255
    cv_closed_output = processor.morphological_processing(output_array)
    filtered_output = processor.filter_clusters_by_size(cv_closed_output, min_cluster_size)
    
    # Add and process no-flow regions
    image_with_no_flow = processor.add_no_flow(filtered_output)
    filtered_no_flow_output = processor.filter_clusters_by_size(
        image_with_no_flow, 
        min_no_flow_size
    )
    
    # Create final image
    final_image = np.copy(array)
    final_image[filtered_output == 255] = 255
    final_image[filtered_no_flow_output == 255] = 40


    # change the the pixel values to the specified colors
    final_image[final_image == 0] = background_color
    final_image[final_image == 255] = infarction_color
    final_image[final_image == 40] = no_flow_color
    final_image[final_image == 150] = mayocardium_color
    final_image[final_image == 80] = blood_pool_color

    # Overlay blood pool mask if available
    if mayocardium_type != 'simulated':
        final_image = add_blood_pool_to_image(
            final_image, 
            blood_pool_mask, 
            blood_pool_color=blood_pool_color
        )
    
    # Store intermediate results
    results = {
        'original_image': array,
        'output_array': output_array,
        'infarction_mask': infarction_mask,
        'closed_output': cv_closed_output,
        'filtered_output': filtered_output,
        'no_flow_image': image_with_no_flow,
        'filtered_no_flow': filtered_no_flow_output,
        'final_image': final_image
    }
    
    if show_plots:
        _plot_results(results)
    
    return final_image, results

def _plot_results(results: dict):
    """
    Plot the intermediate and final results of the cardiac image generation.
    
    Args:
        results: Dictionary containing the intermediate images
    """
    plt.figure(figsize=(20, 10))
    
    # Define plot configuration
    plots = [
        ('original_image', "Original Image"),
        ('output_array', "Region Growing Result"),
        ('infarction_mask', "Infarction Mask"),
        ('closed_output', "Morphological Closing"),
        ('filtered_output', "Filtered Infarctions"),
        ('no_flow_image', "No Flow Regions"),
        ('filtered_no_flow', "Filtered No Flow"),
        ('final_image', "Final Image")
    ]
    
    # Create subplots
    for idx, (key, title) in enumerate(plots, 1):
        plt.subplot(2, 4, idx)
        plt.imshow(results[key], cmap='gray')
        plt.title(title)
        plt.axis('off')
    
    plt.tight_layout()
    plt.show()


    
def generate_multible_cardiac_images(
    number_of_images: int,
    output_dir: str,
    all_masks: Dict[str, Any] = None,
    mayocardium_type = 'simulated',
    image_size: Tuple[int, int] = (250, 250),
    number_of_seeds: int = 80,
    energy: int = 30,
    max_radius_step: float = 2,
    max_theta_step: float = np.pi / 4,
    min_cluster_size: int = 70,
    min_no_flow_size: int = 30,
    ring_thick_max: int = 20,
    ring_thick_min: int = 15,
    show_plots: bool = True,
    background_color: int = 0,
    blood_pool_color: int = 1,
    mayocardium_color: int = 2,
    infarction_color: int = 3,
    no_flow_color: int = 4,
    infarct_to_myo_upper_limit: float = 0.6,
    infarct_to_myo_lower_limit: float = 0.2,
    noflow_to_infarct_upper_limit: float = 0.4,
    noflow_to_infarct_lower_limit: float = 0.1
    ):
    
    simulated_directory_path ="simulated_masks"
    output_dir = os.path.join(output_dir, simulated_directory_path)
    os.makedirs(output_dir, exist_ok=True)
    stats_calculator = StatsCalculator(
        infarction_val=infarction_color,
        myocardium_val=mayocardium_color,
        no_flow_val=no_flow_color
    )

    for i in range(number_of_images):
        accurate_gen = False
        while not accurate_gen:
            try:
                # Generate a single cardiac image
                custom_image, custom_results = generate_cardiac_image ( 
                    all_masks=all_masks,    
                    mayocardium_type=mayocardium_type,
                    image_size=image_size,
                    number_of_seeds=number_of_seeds,
                    energy=energy,
                    max_radius_step=max_radius_step,
                    max_theta_step=max_theta_step,
                    min_cluster_size=min_cluster_size,
                    min_no_flow_size=min_no_flow_size,
                    ring_thick_max=ring_thick_max,
                    ring_thick_min=ring_thick_min,
                    show_plots=show_plots,
                    background_color=background_color,
                    blood_pool_color=blood_pool_color,
                    mayocardium_color=mayocardium_color,
                    infarction_color=infarction_color,
                    no_flow_color=no_flow_color
                )
                # Check if the generated image meets the criteria
                stats = stats_calculator.process_mask(custom_image, infarct_to_myo_upper_limit=infarct_to_myo_upper_limit, infarct_to_myo_lower_limit=infarct_to_myo_lower_limit,
                                                       noflow_to_infarct_upper_limit=noflow_to_infarct_upper_limit, noflow_to_infarct_lower_limit=noflow_to_infarct_lower_limit)
                if stats["has_significant_infarct_or_noflow"]:
                    logging.warning(f"Image {i} has significant no-flow or infarct area, regenerating...")
                    continue
                accurate_gen = True
            except Exception as e:
                logging.error(f"Error generating image {i}: {e}")
                time.sleep(1)
        
        # save the time the image was generated
        timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M-%S-%f")
        # Save the image with a timestamp
        print (int((stats['infarct_to_myo']*100)), int((stats['noflow_to_infarct']*100)))
        cv2.imwrite(os.path.join(output_dir, f"{mayocardium_type}_simulated_{int(stats['infarct_to_myo']*100)}_{int(stats['noflow_to_infarct']*100)}_{timestamp}.png"), custom_image)
        # save npy
        np.save(os.path.join(output_dir, f"{mayocardium_type}_simulated_{int(stats['infarct_to_myo']*100)}_{int(stats['noflow_to_infarct']*100)}_{timestamp}.npy"), custom_image)
        print(f"Image {i} saved successfully!")
        # Save the image
