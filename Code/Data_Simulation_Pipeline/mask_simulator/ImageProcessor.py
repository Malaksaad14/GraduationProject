from typing import Tuple, List
import numpy as np
import cv2
import random
import logging
import time

class ImageProcessor:
    """
    A class for processing and generating medical imaging-like structures,
    particularly focused on cardiac-like features.
    """

    def __init__(self):
        """Initialize the ImageProcessor."""
        pass

    # ----------------------
    # Basic Image Operations
    # ----------------------
    
    def create_blank_image(self, height: int, width: int) -> np.ndarray:
        """
        Create a blank black image with specified dimensions.
        
        Args:
            height (int): Height of the image
            width (int): Width of the image
        
        Returns:
            np.ndarray: A 2D black image (all pixel values are 0)
        """
        return np.zeros((height, width), dtype=np.uint8)

    def apply_random_deformation(self, mask: np.ndarray, max_offset: int = 5) -> np.ndarray:
        """
        Apply random deformation to a binary mask.
        
        Args:
            mask (np.ndarray): Binary mask to deform
            max_offset (int): Maximum pixel shift in both directions
        
        Returns:
            np.ndarray: Deformed mask
        """
        deformation_mask = np.zeros_like(mask)
        height, width = mask.shape
        
        for y in range(height):
            for x in range(width):
                if mask[y, x] > 0:
                    offset_x = random.randint(-max_offset, max_offset)
                    offset_y = random.randint(-max_offset, max_offset)
                    new_x = min(max(x + offset_x, 0), width - 1)
                    new_y = min(max(y + offset_y, 0), height - 1)
                    deformation_mask[new_y, new_x] = mask[y, x]
                    
        return deformation_mask

    # ----------------------
    # Coordinate Transformations
    # ----------------------

    def cartesian_to_polar(self, x: int, y: int, center_x: float, center_y: float) -> Tuple[float, float]:
        """
        Convert Cartesian to polar coordinates.
        
        Args:
            x, y: Cartesian coordinates
            center_x, center_y: Center point coordinates
        
        Returns:
            Tuple[float, float]: (radius, theta) in polar coordinates
        """
        dx = x - center_x
        dy = y - center_y
        radius = np.sqrt(dx**2 + dy**2)
        theta = np.arctan2(dy, dx)
        return radius, theta

    def polar_to_cartesian(self, radius: float, theta: float, 
                          center_x: float, center_y: float) -> Tuple[int, int]:
        """
        Convert polar to Cartesian coordinates.
        
        Args:
            radius, theta: Polar coordinates
            center_x, center_y: Center point coordinates
        
        Returns:
            Tuple[int, int]: (x, y) in Cartesian coordinates
        """
        x = int(center_x + radius * np.cos(theta))
        y = int(center_y + radius * np.sin(theta))
        return x, y

    # ----------------------
    # Cardiac Structure Generation
    # ----------------------

    def create_ring(self, image: np.ndarray, center: Tuple[int, int], 
                   outer_radius: int, ring_thickness: int) -> np.ndarray:
        """
        Generate a ring structure (myocardium).
        
        Args:
            image: Base image
            center: Ring center coordinates
            outer_radius: Outer radius of the ring
            ring_thickness: Thickness of the ring wall
        
        Returns:
            np.ndarray: Image with ring structure
        """
        ring_mask = np.zeros_like(image)
        cv2.circle(ring_mask, center, outer_radius, (255), thickness=ring_thickness)
        ring_mask = self.apply_random_deformation(ring_mask, max_offset=1)
        ring_mask = cv2.GaussianBlur(ring_mask, (9, 9), 0)
        image[ring_mask > 0] = 150
        return image

    def create_filled_cavity(self, image: np.ndarray, center: Tuple[int, int],
                           outer_radius: int, ring_thickness: int) -> np.ndarray:
        """
        Generate an inner circle (cavity) within the ring.
        
        Args:
            image: Base image
            center: Cavity center coordinates
            outer_radius: Outer radius of the surrounding ring
            ring_thickness: Thickness of the ring wall
        
        Returns:
            np.ndarray: Image with cavity added
        """
        cavity_radius = outer_radius - ring_thickness // 2
        cavity_mask = np.zeros_like(image)
        cv2.circle(cavity_mask, center, cavity_radius, (255), thickness=-1)
        cavity_mask = self.apply_random_deformation(cavity_mask, max_offset=3)
        cavity_mask = cv2.GaussianBlur(cavity_mask, (9, 9), 0)
        image[cavity_mask > 0] = 80
        return image

    # ----------------------
    # Advanced Processing
    # ----------------------

    def morphological_processing(self, array: np.ndarray, 
                               morph_shape: int = cv2.MORPH_ELLIPSE,
                               kernel_size_close: Tuple[int, int] = (8, 8),
                               kernel_size_blur: Tuple[int, int] = (5, 5),
                               sigmaX: int = 2,
                               apply_blur: bool = True,
                               look_for_value: int = 255) -> np.ndarray:
        """
        Apply morphological operations and optional blurring.
        
        Args:
            array: Input image array
            morph_shape: Morphological operation shape
            kernel_size_close: Kernel size for closing operation
            kernel_size_blur: Kernel size for Gaussian blur
            sigmaX: Sigma X for Gaussian blur
            apply_blur: Whether to apply Gaussian blur
            look_for_value: Target pixel value
        
        Returns:
            np.ndarray: Processed image
        """
        closed = cv2.morphologyEx(
            (array == look_for_value).astype(np.uint8),
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(morph_shape, kernel_size_close)
        )
        
        if apply_blur:
            closed = cv2.GaussianBlur(closed, kernel_size_blur, sigmaX=sigmaX)
            
        return closed

    # ----------------------
    # Seed Point Operations
    # ----------------------

    def select_initial_seed(self, array: np.ndarray, value: int = 150, mayocardium_type = "simulated") -> Tuple[tuple, float, float]:
        """
        Select an initial seed point from pixels matching specified value.
        
        Args:
            array: Input image array
            value: Target pixel value to search for
        
        Returns:
            Tuple containing:
                - Initial seed coordinates (row, col)
                - Center coordinates (center_x, center_y)
        """
        if mayocardium_type == "not_simulated":
            value = 2
        
        coordinates = np.argwhere(array == value)
        initial_seed = random.choice(coordinates)
        center_x, center_y = np.mean(coordinates, axis=0)
        logging.debug(f"Initial seed point: {initial_seed}, Center: ({center_x}, {center_y})")
        return initial_seed, center_x, center_y

    def generate_seeds(self, initial_seed: float, center_x: float, center_y: float, 
                  number_of_seeds: int, max_radius_step: float, max_theta_step: float, 
                  array: np.ndarray) -> List[Tuple[float, float]]:
        """
        Generate seed points using polar coordinate random walk.
        
        Args:
            initial_seed: Starting seed point
            center_x, center_y: Center coordinates
            number_of_seeds: Number of seeds to generate
            max_radius_step: Maximum step size in radial direction
            max_theta_step: Maximum step size in angular direction
            array: Input image array
        
        Returns:
            List of seed points in Cartesian coordinates
        """
        selected_seeds = []
        r, theta = self.cartesian_to_polar(initial_seed[0], initial_seed[1], center_x, center_y)
        
        for _ in range(number_of_seeds - 1):
            r += random.uniform(-max_radius_step, max_radius_step)
            theta += random.uniform(-max_theta_step, max_theta_step)
            next_x, next_y = self.polar_to_cartesian(r, theta, center_x, center_y)
            
            if (0 <= next_x < array.shape[0] and 
                0 <= next_y < array.shape[1] and 
                array[next_x, next_y] == 150):
                selected_seeds.append((next_x, next_y))
                
        logging.info(f"Generated {len(selected_seeds)} seed points")
        return selected_seeds

    # ----------------------
    # Region Growing and Spreading
    # ----------------------

    def spread_region_with_bias(self, selected_seeds: List[Tuple[int, int]], 
                               energy: int, array: np.ndarray) -> np.ndarray:
        """
        Spread region from seeds using biased random walk.
        
        Args:
            selected_seeds: List of seed points
            energy: Initial energy for spreading
            array: Input image array
        
        Returns:
            np.ndarray: Array with spread regions
        """
        output_array = np.copy(array)
        queue = [(point[0], point[1], energy) for point in selected_seeds]
        
        while queue:
            x, y, e = queue.pop(0)
            if e <= 0:
                continue
                
            output_array[x, y] = 255
            directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]
            chosen_directions = random.choices(
                directions, 
                weights=[0.3, 0.2, 0.2, 0.2], 
                k=2
            )
            
            for dx, dy in chosen_directions:
                nx, ny = x + dx, y + dy
                if (0 <= nx < output_array.shape[0] and 
                    0 <= ny < output_array.shape[1] and 
                    output_array[nx, ny] == 150):
                    new_energy = e - random.randint(1, 3)
                    queue.append((nx, ny, new_energy))
                    
        return output_array

    # ----------------------
    # Filtering and Post-processing
    # ----------------------

    def filter_clusters_by_size(self, image: np.ndarray, min_size: int) -> np.ndarray:
        """
        Remove clusters smaller than specified size.
        
        Args:
            image: Binary image with clusters
            min_size: Minimum cluster size to retain
        
        Returns:
            np.ndarray: Filtered image
        """
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(image, connectivity=8)
        filtered_image = np.zeros_like(image)
        
        for label in range(1, num_labels):
            if stats[label, cv2.CC_STAT_AREA] >= min_size:
                filtered_image[labels == label] = 255
                
        return filtered_image


    def generate_ring_with_cavity_and_cloud_infarctions(
            self, height: int, width: int, 
            outer_radius_max: int, outer_radius_min: int,
            ring_thick_max: int, ring_thick_min: int) -> np.ndarray:
        """
        Generate complete cardiac-like structure with infarctions.
        
        Args:
            height, width: Image dimensions
            outer_radius_max, outer_radius_min: Range for outer radius
            ring_thick_max, ring_thick_min: Range for ring thickness
        
        Returns:
            np.ndarray: Generated image
        """
        logging.info(f"Generating image {height}x{width}")
        image = self.create_blank_image(height, width)
        center = (width // 2, height // 2)
        
        # Generate ring
        outer_radius = random.randint(outer_radius_min, outer_radius_max)
        ring_thickness = random.randint(ring_thick_min, ring_thick_max)
        image = self.create_ring(image, center, outer_radius, ring_thickness)
        offset_safty_factor = 5
        # Add cavity with offset``
        cavity_offset_x = random.randint(-(ring_thick_min // 2), (ring_thick_min // 2))
        cavity_offset_y = random.randint(-(ring_thick_min // 2), (ring_thick_min // 2))
        cavity_center = (center[0] + cavity_offset_x, center[1] + cavity_offset_y)
        image = self.create_filled_cavity(image, cavity_center, outer_radius, ring_thickness)
        
        return image

    def add_no_flow(self, image: np.ndarray, value_to_be_set: int = 20, 
                    number_of_seeds: int = 10) -> np.ndarray:
        """
        Add no-flow regions to the image.
        
        Args:
            image: Input image
            value_to_be_set: Pixel value for no-flow regions
            number_of_seeds: Number of seed points per cluster
        
        Returns:
            np.ndarray: Image with no-flow regions
        """
        image_with_no_flow = np.copy(image)
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(image, connectivity=8)
        
        # Select random clusters
        num_clusters = num_labels - 1
        if num_clusters <= 0:
            logging.warning("No clusters found in the image.")
            closed_output = np.copy(image_with_no_flow)
            
        else:
            selected_num_clusters = random.randint(1, num_clusters)
            selected_clusters = random.sample(range(1, num_labels), selected_num_clusters)
            output_array = np.copy(image_with_no_flow)
            
            # Process each selected cluster
            for cluster in selected_clusters:
                cluster_coordinates = np.argwhere(labels == cluster)
                selected_points = random.sample(list(cluster_coordinates), number_of_seeds)
                
                # Calculate energy based on cluster size
                energy_ratio = random.uniform(0.05, 0.2)
                relative_energy = int(energy_ratio * len(cluster_coordinates))
                
                # Spread no-flow region
                queue = [(point[0], point[1], relative_energy) for point in selected_points]
                while queue:
                    x, y, e = queue.pop(0)
                    if e <= 0:
                        continue
                        
                    output_array[x, y] = value_to_be_set
                    directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]
                    chosen_directions = random.choices(
                        directions, 
                        weights=[0.3, 0.2, 0.2, 0.2], 
                        k=2
                    )
                    
                    for dx, dy in chosen_directions:
                        nx, ny = x + dx, y + dy
                        if (0 <= nx < output_array.shape[0] and 
                            0 <= ny < output_array.shape[1] and 
                            labels[nx, ny] == cluster and 
                            output_array[nx, ny] == 255):
                            new_energy = e - random.randint(1, 3)
                            queue.append((nx, ny, new_energy))
            
            # Post-processing
            closed_output = cv2.morphologyEx(
                (output_array == value_to_be_set).astype(np.uint8),
                cv2.MORPH_CLOSE,
                cv2.getStructuringElement(cv2.MORPH_RECT, (8, 8))
            )
            
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        eroded_output = cv2.erode(closed_output, kernel)
        
        return eroded_output