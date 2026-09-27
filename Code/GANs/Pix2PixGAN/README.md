# Pix2Pix GAN 

## Overview

This folder contains multiple **Jupyter Notebooks** used for training various Pix2Pix GAN models designed for **medical image synthesis**, specifically generating **realistic LGE MRI images** from input segmentation masks of the **left ventricle**, which include **infarction** and **no-reflow** regions.

Training experiments explore variations in:
- **Generator/Discriminator architectures**
- **Image resolution**
- **Loss functions**
- **Region-specific weighting**

A subfolder named **Best Models** contains a link to download the top-performing trained models from all experiments.


---

## Folder Structure
```
pix2pix GAN/
│
├── Notebooks/         # Training notebooks for Pix2Pix models
├── Best_Models/       # Drive link to download best 3 models
└── README.md          # Project description (this file)
```

---

## Best Models

The **Best Models** folder includes a **Google Drive link** to download the best 3 models after extensive experimentation.

[Download Best Models](https://drive.google.com/drive/folders/1LhaTrHYSy8vzSi775cPTUQekcp_j13Re?usp=sharing)

---

## Naming Conventions

File and model names use specific abbreviations to concisely describe each configuration:

| Abbreviation    | Meaning                                                       |
|-----------------|---------------------------------------------------------------|
| **pix2pix**     | Pix2Pix GAN architecture (conditional image-to-image translation) |
| **128**         | Image resolution of 128 × 128 pixels                          |
| **G6**          | Generator with 6 downsampling layers                          |
| **G7**          | Generator with 7 downsampling layers (used in some versions)  |
| **D2**          | Discriminator with 2 downsampling layers                      |
| **D4**          | Discriminator with 4 downsampling layers (used in some versions) |
| **OC1**         | Output Channels = 1 (grayscale output)                        |
| **tanh**        | Generator uses tanh activation (output range [-1, 1])         |
| **sigmoid**     | Generator uses sigmoid activation (output range [0, 1]) (used earlier) |
| **weightedL1**  | Loss includes region-specific weighted L1 loss                |
| **INF25/26/40** | Infarction region weight = 25× / 26× / 40×                    |
| **NR/NF90/120**    | No-Reflow region weight = 90× / 120×                          |
| **MY11/12/20**  | Normal Myocardium region weight = 11× / 12× / 20×             |
| **CAV7/10**     | Cavity region weight = 7× / 10×                               |
| **L100**        | Lambda (L1 loss weight) = 100                                 |
| **Adam2e-4**    | Adam optimizer with learning rate 2 × 10⁻⁴                    |
| **beta1_0.5**   | Adam optimizer β₁ = 0.5                                       |

**Example Model Name:** pix2pix_128_G6_D2_OC1_tanh_weightedL1_INF25_NR90_MY12_CAV7_L100_Adam2e-4_beta1_0.5

---

## How to Use

1. Open any notebook in the **Notebooks** folder.
2. Configure parameters or weights as needed.
3. Train the model using GPU if available.
4. Evaluate performance using standard GANs metrics (FID, IS, etc.).
5. For the best pretrained models, refer to the [Best Models](https://github.com/hanaheshamm/GP_InfDE/tree/main/Code/GANs/Pix2Pix%20GAN/Best%20Models) folder.

---

## Notes

- Models were trained on **grayscale medical images**.
- Custom **weighted L1 loss** emphasizes critical regions like infarction and no-reflow zones.
- Region-specific weights were tuned iteratively for optimal performance.



