# Detailed Configuration Parameters

## Table of Contents
- [Paths Configuration](#paths-configuration)
  - [JSON Configuration](#json-configuration)
  - [`base_path`](#base_path)
  - [`np_data_path`](#np_data_path)
  - [`output_dir`](#output_dir)
- [Merge Masks Parameters](#merge-masks-parameters)
  - [JSON Configuration](#json-configuration-1)
  - [`number_of_masks`](#number_of_masks)
  - [`search_range`](#search_range)
  - [`rotation_step`](#rotation_step)
  - [`visualize_flag`](#visualize_flag)
  - [`infarction_value` and `mayocardium_vlue`](#infarction_value-and-mayocardium_vlue)

- [Image Generation Parameters](#image-generation-parameters)
  - [`number_of_images`](#number_of_images)
  - [`mayocardium_type`](#mayocardium_type)
  - [`image_size`](#image_size)
  - [Seed and Region Growing Parameters](#seed-and-region-growing-parameters)
      - [`number_of_seeds`](#number_of_seeds)
      - [`energy`](#energy)
      - [`max_radius_step` and `max_theta_step`](#max_radius_step-and-max_theta_step)
  - [Filtering Parameters](#filtering-parameters)
    - [`min_cluster_size` and `min_no_flow_size`](#min_cluster_size-and-min_no_flow_size)
  - [Ring Structure Parameters](#ring-structure-parameters)
    - [`ring_thick_max` and `ring_thick_min`](#ring_thick_max-and-ring_thick_min)
  - [Visualization Parameters](#visualization-parameters)
    - [`show_plots`](#show_plots)
  - [Color Mapping Parameters](#color-mapping-parameters)
      - [`background_color`](#background_color)
      - [`blood_pool_color`](#blood_pool_color)
      - [`mayocardium_color`](#mayocardium_color)
      - [`infarction_color`](#infarction_color)
      - [`no_flow_color`](#no_flow_color)

---

# Detailed Configuration Parameters

## Paths Configuration

### JSON Configuration
```json
"paths": {
    "base_path": "E:\\SBME\\Graduation Project\\Datasets\\reformatted_data",
    "np_data_path": "E:\\SBME\\Graduation Project\\Code\\Simulation\\data_log\\all_masks.npy",
    "output_dir": "E:\\SBME\\Graduation Project\\Datasets\\Simulated_data\\simulated"
}
```

### `base_path`
- **Function**: Used in `MaskExtractor.process()`
- **Technical Details**:
  - Provides the root directory for mask extraction
  - Searches for directories ending with "_Train"
  - Traverses through case directories to extract masks
- **Impact**:
  - Determines the source of original medical image data

### `np_data_path`
- **Function**: Used in mask saving and loading
- **Technical Details**:
  - Serves as a caching mechanism for extracted masks
  - Allows skipping mask extraction if file exists
  - Stores masks in a NumPy `.npy` format for quick loading
- **Impact**:
  - Reduces processing time for repeated runs
  - Provides a persistent storage of extracted masks

### `output_dir`
- **Function**: Used in `generate_multible_cardiac_images()`
- **Technical Details**:
  - Destination for saving generated images
  - Saves both PNG and NPY formats
  - Creates directory if it doesn't exist
- **Impact**:
  - Determines where simulated cardiac images are stored

## Merge Masks Parameters

### JSON Configuration
```json
"merge_masks_params": {
    "number_of_masks": 10,
    "search_range": 10,
    "rotation_step": 30,
    "visualize_flag": 0, 
    "infarction_value": 3,
    "mayocardium_vlue": 2
}
```

### `number_of_masks`
- **Function**: Used in `generate_multible_merged_masks()`
- **Technical Details**:
  - Determines how many merged masks to generate
  - Randomly selects myocardium and infarction masks
- **Code Reference**:
  ```python
  for _ in range(number_of_masks):
      mayocardial_mask = get_random_mask_slice(all_masks, 'mayocardium_masks')
      infarction_mask = get_random_mask_slice(all_masks, 'infarction_masks')
      merged_mask = merge_masks(...)
  ```
- **Impact**:
  - Controls dataset size

### `search_range`
- **Function**: Used in `MaskAlignment.find_optimal_alignment()`
- **Technical Details**:
  - Defines pixel range for searching optimal mask alignment
  - Used in nested loops for x and y shifts
- **Code Reference**:
  ```python
  for shift_x in range(-search_range, search_range + 1):
      for shift_y in range(-search_range, search_range + 1):
          # Alignment optimization
  ```
- **Impact**:
  - Larger range allows more flexible mask alignment
  - Increases computational complexity
  - Helps find better mask overlap

### `rotation_step`
- **Function**: Used in the mask alignment process
- **Technical Details**:
  - Defines angular steps for rotation search
  - Converts to NumPy array of rotation angles
- **Code Reference**:
  ```python
  rotation_angles = np.arange(0, 360, rotation_step)
  ```
- **Impact**:
  - Controls the rotation search
  - Smaller steps provide more precise alignment
  - Increases computational time

### `visualize_flag`
- **Function**: Used in `merge_masks()` and `_get_merged_mask()`
- **Technical Details**:
  - Triggers visualization of alignment process
  - Uses Matplotlib to plot alignment stages
- **Code Reference**:
  ```python
  if visualize_flag:
      self._plot_alignment_results(...)
      self._print_alignment_metrics(...)
  ```
- **Impact**:
  - Helps in debugging and understanding mask alignment
  - Provides visual insight into the merging process

### `infarction_value` and `mayocardium_vlue`
- **Function**: Used in `MaskAlignment.change_mask_pixel_values()`
- **Technical Details**:
  - Reassigns pixel values in the merged mask
- **Code Reference**:
  ```python
  new_mask[new_mask == 2] = infarction_value
  new_mask[new_mask == 1] = mayocardium_vlue
  ```
- **Impact**:
  - Allows custom pixel value assignment
  - Helps in standardizing mask representations


## Image Generation Parameters

### `number_of_images`
- **Technical Function**: Controls image generation quantity
- **Code Interaction**:
  ```python
  for i in range(number_of_images):
      image, results = generate_cardiac_image(...)
      save_image(image)
  ```
- **Effects**:
  - Determines dataset size


### `mayocardium_type`
- **Technical Function**: Myocardium generation method
- **Code Interaction**:
  ```python
  if mayocardium_type == 'simulated':
      array = processor.generate_ring_with_cavity_and_cloud_infarctions(...)
  else:
      mayocardium_mask = get_random_mask_slice(all_masks, 'mayocardium_masks')
  ```
- **Effects**:
  - Determines myocardium source
  - Impacts image generation approach
- **Options**:
  - `'simulated'`: Synthetic generation
  - `'not_simulated'`: Data-driven approach

### `image_size`
- **Technical Function**: Output image dimensions
- **Code Interaction**:
  ```python
  height, width = image_size
  array = processor.generate_ring_with_cavity_and_cloud_infarctions(
      height=height, width=width, ...
  )
  ```
- **Effects**:
  - Controls image resolution
  - Impacts computational resources
## Seed and Region Growing Parameters

### `number_of_seeds`
- **Technical Function**: Controls region growing complexity
- **Code Interaction**:
  ```python
  selected_seeds = processor.generate_seeds(
      number_of_seeds=number_of_seeds, ...
  )
  ```
- **Effects**:
  - Increases region complexity
  - Enhances structural variability
- **Recommended Range**:
  - **Low (20-50)**: Simple structures
  - **Medium (80-120)**: Balanced complexity
  - **High (200-500)**: Highly detailed regions

### `energy`
- **Technical Function**: Region spreading intensity
- **Code Interaction**:
  ```python
  output_array = processor.spread_region_with_bias(
      selected_seeds=selected_seeds,
      energy=energy, ...
  )
  ```
- **Effects**:
  - Controls region growth aggressiveness
  - Impacts infarction and no-flow region size
- **Recommended Values**:
  - **Low (10-20)**: Minimal spreading
  - **Medium (30-50)**: Balanced growth
  - **High (60-100)**: Extensive region expansion

### `max_radius_step` and `max_theta_step`
- **Technical Function**: Seed point distribution control
- **Code Interaction**:
  ```python
  selected_seeds = processor.generate_seeds(
      max_radius_step=max_radius_step,
      max_theta_step=max_theta_step, ...
  )
  ```
- **Effects**:
  - Determines seed point randomness
  - Impacts region growing pattern
- **Recommended Practices**:
  - **Small steps**: Concentrated regions
  - **Large steps**: Dispersed, irregular regions

---

## Filtering Parameters

### `min_cluster_size` and `min_no_flow_size`
- **Technical Function**: Noise and artifact reduction
- **Code Interaction**:
  ```python
  filtered_output = processor.filter_clusters_by_size(
      output, min_cluster_size
  )
  filtered_no_flow = processor.filter_clusters_by_size(
      no_flow_image, min_no_flow_size
  )
  ```
- **Effects**:
  - Removes small, potentially noisy regions
  - Ensures meaningful structural elements
- **Recommended Values**:
  - **Low (30-50)**: More inclusive
  - **Medium (70-100)**: Balanced filtering
  - **High (150-300)**: Strict region retention
## Ring Structure Parameters

### `ring_thick_max` and `ring_thick_min`
- **Technical Function**: Defines the thickness range for the myocardium ring
- **Code Interaction**:
  ```python
  ring_thickness = random.randint(ring_thick_min, ring_thick_max)
  array = processor.create_ring(image, center, outer_radius, ring_thickness)
  ```
- **Effects**:
  - Controls the visual prominence of the myocardium
  - Affects the internal cavity size within the cardiac structure
- **Recommended Values**:
  - **Low (10-20)**: Thin walls, more cavity space
  - **Medium (20-30)**: Balanced wall thickness
  - **High (30-50)**: Thick walls, less cavity space

---

## Visualization Parameters

### `show_plots`
- **Technical Function**: Toggles the display of intermediate and final results
- **Code Interaction**:
  ```python
  if show_plots:
      _plot_results(results)
  ```
- **Effects**:
  - Provides visual feedback during image generation
  - Useful for debugging and understanding the process
- **Usage**:
  - `false`: No plots, faster execution
  - `true`: Display plots, useful for development and analysis

---

## Color Mapping Parameters

### `background_color`
- **Technical Function**: Sets the pixel value for the background
- **Code Interaction**:
  ```python
  final_image[final_image == 0] = background_color
  ```
- **Effects**:
  - Determines the contrast between cardiac structures and the background
  - Affects the overall appearance of the image


### `blood_pool_color`
- **Technical Function**: Sets the pixel value for the blood pool
- **Code Interaction**:
  ```python
  final_image[final_image == 80] = blood_pool_color
  ```
- **Effects**:
  - Defines the visual representation of the blood pool
  - Impacts the differentiation from other structures
 pool

### `mayocardium_color`
- **Technical Function**: Sets the pixel value for the myocardium
- **Code Interaction**:
  ```python
  final_image[final_image == 150] = mayocardium_color
  ```
- **Effects**:
  - Determines the visual prominence of the myocardium
  - Affects the contrast with surrounding regions

### `infarction_color`
- **Technical Function**: Sets the pixel value for infarction areas
- **Code Interaction**:
  ```python
  final_image[final_image == 255] = infarction_color
  ```
- **Effects**:
  - Defines the visual representation of infarction regions
  - Impacts the contrast with healthy tissue

### `no_flow_color`
- **Technical Function**: Sets the pixel value for no-flow regions
- **Code Interaction**:
  ```python
  final_image[final_image == 40] = no_flow_color
  ```
- **Effects**:
  - Determines the visual representation of no-flow areas
  - Affects the differentiation from other regions



