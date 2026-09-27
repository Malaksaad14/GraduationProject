import os
import numpy as np
import tensorflow as tf
import matplotlib.pyplot as plt

def run_generator(masks_dir, model_path, output_dir):
    def load_mask_dataset(masks_path):
        masks = []
        filenames = []
        mask_files = sorted(f for f in os.listdir(masks_path) if f.endswith('.npy'))

        for mask_file in mask_files:
            mask_path = os.path.join(masks_path, mask_file)
            mask = np.load(mask_path).astype(np.float32)
            if mask.ndim == 2:
                mask = np.expand_dims(mask, axis=-1)
            masks.append(mask)
            filenames.append(mask_file)

        masks = tf.convert_to_tensor(masks, dtype=tf.float32)
        return masks, filenames

    masks_tensor, filenames = load_mask_dataset(masks_dir)
    test_dataset = tf.data.Dataset.from_tensor_slices(masks_tensor).batch(1).prefetch(tf.data.AUTOTUNE)

    generator = tf.keras.models.load_model(model_path, compile=False)
    os.makedirs(output_dir, exist_ok=True)

    for mask_tensor, filename in zip(test_dataset, filenames):
        generated = generator(mask_tensor, training=False)[0]
        raw_generated_np = generated.numpy()

        npy_path = os.path.join(output_dir, filename.replace('.npy', '_generated.npy'))
        np.save(npy_path, raw_generated_np)

        vis_img = (generated + 1.0) / 2.0
        if vis_img.shape[-1] == 1:
            vis_img = tf.squeeze(vis_img, axis=-1)
        vis_np = vis_img.numpy()

        png_path = os.path.join(output_dir, filename.replace('.npy', '_generated.png'))
        plt.imsave(png_path, vis_np, cmap='gray')

        print(f"✅ Saved: {npy_path} (raw) and {png_path} (visual)")

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 6:
        print("Usage: python generator_runner.py <merged_masks> <simulated_masks> <model_path> <output_merged> <output_simulated>")
        sys.exit(1)

    merged_masks = sys.argv[1]
    simulated_masks = sys.argv[2]
    model_path = sys.argv[3]
    output_merged = sys.argv[4]
    output_simulated = sys.argv[5]

    print(f"[generator_runner] Generating from: {merged_masks}")
    run_generator(merged_masks, model_path, output_merged)

    print(f"[generator_runner] Generating from: {simulated_masks}")
    run_generator(simulated_masks, model_path, output_simulated)
