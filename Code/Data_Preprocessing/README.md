## Getting Started

### Step 1: Download the Dataset

1. Click [here to download the dataset](https://drive.google.com/drive/folders/1FBuTpm0AekDZUEfBpTYaYga6CL2XSvS4?usp=drive_link).
2. Extract the folder after downloading. Note the directory path, as it will be required in the notebooks.

---

### Step 2: Process the Data

#### Notebook 1: Split NIFTI into Slices

1. Navigate to `GP_InfDE/Code/1-Split_NIFTI_Into_Slices.ipynb`.
2. Open the notebook in your Python environment (e.g., Jupyter Notebook).
3. Set the path to the dataset directory in the first cell:

   ```python
   dataset_path = "your/data/folder/path"
   ```

4. Run all cells sequentially.

**Output**: Creates `.npy` slices for each patient in their respective folders.

---

#### Notebook 2: Unify Mask Values

1. Navigate to `GP_InfDE/Code/2-Unify_Masks_Values.ipynb`.
2. Open the notebook in your Python environment.
3. Set the path to the dataset directory in the first cell:

   ```python
   dataset_path = "your/data/folder/path"
   ```

4. Run all cells sequentially.

**Output**:

- Renames and unifies mask values using the following convention:
  - **0**: Background  
  - **1**: Cavity  
  - **2**: Normal Myocardium  
  - **3**: Infarction  
  - **4**: No-Reflow  
- Creates two new directories:
  - `All Train Slices`
  - `All Test Slices`

---

### Step 3: Left Ventricle Localization

1. Download the model from [here](https://github.com/Project-MONAI/model-zoo/releases/download/hosting_storage_v1/ventricular_short_axis_3label_v0.3.2.zip) and extract it.
2. Download the notebook `GP_InfDE/Code/4-Left_Ventricle_Localisation.ipynb` and place it inside the `docs` directory of the downloaded model.
3. Open the notebook in your Python environment.
4. Set the following paths in the second cell:

   ```python
   # Input and output directories
   input_dir = r"Set this to the directory where your slices are stored"
   output_rois_dir = r"Set this to the directory where you want to store the localized slices"
   output_labels_dir = r"Set this to the directory where you want to store the localized labels"
   output_visual_dir = r"Set this to the directory where you want to store the visualisations of the localized data"

---

### Step 4: Intensity Clipping

After localizing the left ventricle, this step helps standardize the pixel intensity distribution by clipping the values to a fixed percentile range (e.g., 2nd–98th percentile).

#### Notebook: Clip Image Intensities Based on Percentiles

1. Navigate to `GP_InfDE/Code/4-Percentile_Clipping.ipynb`.
2. Open the notebook in your Python environment.
3. Set the input and output paths for the `.npy` images in the first cell:

   ```python
   input_path = r"your/input/images/folder"
   output_path = r"your/output/clipped_images/folder"
---

## 📁 Output After Preprocessing

After completing the preprocessing pipeline, we organized the data as follows for training (you can split it as you want):

- `images/`
  - `train/`
  - `val/`
  - `test/`
- `masks/`
  - `train/`
  - `val/`
  - `test/`

## Dependencies

Ensure you have the following installed:

- Python 3.x
- Libraries: `numpy`, `skimage`, `matplotlib`, etc.

To install dependencies, use the following command:

```bash
pip install -r requirements.txt
```

(Include a `requirements.txt` file with the necessary dependencies if not already present.)

---

## Notes

- For dataset-specific instructions, check the `Data/README.md`.

