import os
import torch
import numpy as np
import nibabel as nib
from monai.networks.nets import UNet

# Create weights directory
os.makedirs("weights", exist_ok=True)
weights_path = "weights/model.pt"

network_def = {
    "spatial_dims": 2,
    "in_channels": 1,
    "out_channels": 4,
    "channels": [16, 32, 64, 128, 256],
    "strides": [2, 2, 2, 2],
    "num_res_units": 2
}
model = UNet(**network_def)
torch.save(model.state_dict(), weights_path)
print(f"Saved weights to {weights_path}")

# Create test 3D NIfTI volume (256 x 256 x 10)
volume_data = np.zeros((256, 256, 10), dtype=np.float32)
# Draw a synthetic bright circular structure in center (simulating cardiac ventricle)
y, x = np.ogrid[:256, :256]
center_y, center_x = 128, 128
mask = (x - center_x)**2 + (y - center_y)**2 <= 40**2

for z in range(10):
    volume_data[:, :, z] = mask * (100 + z * 10)

nifti_img = nib.Nifti1Image(volume_data, np.eye(4))
nifti_path = "test_sample.nii.gz"
nib.save(nifti_img, nifti_path)
print(f"Saved test NIfTI file to {nifti_path}")
