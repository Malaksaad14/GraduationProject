# Attention Res-UNet – Segmentation Experiments

## Overview

This folder contains experiments using the **Attention Res-UNet** architecture for **left ventricle segmentation**, including infarcted myocardium and no-reflow area detection.

Two different data training strategies were explored:
- **Real-Only Data**: Using 10,000 samples generated from original clinical data with augmentation.
- **Real + Synthetic Data**: Using 5,000 original samples combined with 5,000 synthetic samples (generated using our data generation module) to assess the impact of synthetic data on segmentation performance.

A file named **Weights Drive Link.txt** contains download links for the best models from each trial.

---

## Folder Structure

```
Segmentation/
└── Attention Res Unet/
├── Original_Data_Only_Augmented_10000/
│ ├── training/ # Notebook to train model on real data only
│ └── evaluation/ # Notebook to evaluate model (Dice score)
│
├── Full_5000_Augmented_Original_With_5000_Generated_Data_10000/
│ ├── training/ # Notebook to train model using real + synthetic data
│ └── evaluation/ # Notebook to evaluate model (Dice score)
│
└── Weights Drive Link.txt # Google Drive link to best two models for each case
```

---

## Training Details

- **Model Architecture**: Attention Res-UNet
- **Input**: Binary segmentation masks of the left ventricle (including infarction and no-reflow regions)
- **Evaluation Metric**: Dice Coefficient (Dice Score)
- **Two Training Scenarios**:
  - **Original_Data_Only_Augmented_10000**: Trained using 10,000 augmented samples from real data.
  - **Full_5000_Augmented_Original_With_5000_Generated_Data_10000**: Trained using a balanced dataset (5,000 real + 5,000 synthetic samples).

---

## Results (Dice Score on Test Data)

| Description            | Real Only | Real + GAN |
|------------------------|-----------|------------|
| **LV Cavity**          | 0.9350    | 0.9365     |
| **Normal Myocardium**  | 0.8222    | 0.8319     |
| **Infarcted Myocardium** | 0.6126  | 0.6651     |
| **No-Reflow Area**     | 0.5376    | 0.6676     |
| **Mean Dice Score**    | 0.7268    | 0.7752     |

**Key Observation**: Using synthetic data improved segmentation performance across all regions, especially for **no-reflow areas** and **infarcted myocardium**, which are typically harder to segment.

---

## Best Models

Download the best models for each experiment from the **Weights Drive Link.txt** file.

---

## How to Use

1. Navigate to the desired folder:
   - For Real-Only training: `Original_Data_Only_Augmented_10000/`
   - For Real + Synthetic training: `Full_5000_Augmented_Original_With_5000_Generated_Data_10000/`
2. Use the `training` notebook to train an Attention Res-UNet model.
3. Use the `evaluation` notebook to evaluate the trained model using Dice scores.
4. Pretrained models can be downloaded from the provided drive link for direct evaluation.

---

## Notes

- Synthetic data was generated using our **Pix2Pix GAN-based generation module**.
- Training and evaluation were conducted using standardized preprocessing and augmentation pipelines.
- Models were optimized to handle the class imbalance present in clinical segmentation tasks.

