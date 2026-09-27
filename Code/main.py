import sys
import os
import shutil
import numpy as np
from PyQt5.QtWidgets import (
    QApplication, QWidget, QLabel, QPushButton,
    QHBoxLayout, QVBoxLayout, QFileDialog, QMessageBox
)
from PyQt5.QtGui import QPixmap, QImage
from PyQt5.QtCore import Qt

class ImageFilterTool(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("MRI NPY Viewer and Filter")
        self.setGeometry(100, 100, 1200, 600)
        self.setFocusPolicy(Qt.StrongFocus)

        self.image_dir = None
        self.mask_dir = None
        self.image_files = []
        self.mask_files = []
        self.index = 0

        self.image_label = QLabel("Image Preview")
        self.image_label.setAlignment(Qt.AlignCenter)
        self.image_label.setFixedSize(450, 450)
        self.image_label.setStyleSheet("border: 1px solid black;")

        self.mask_label = QLabel("Mask Preview")
        self.mask_label.setAlignment(Qt.AlignCenter)
        self.mask_label.setFixedSize(450, 450)
        self.mask_label.setStyleSheet("border: 1px solid black;")

        self.overlay_label = QLabel("Overlay Preview")
        self.overlay_label.setAlignment(Qt.AlignCenter)
        self.overlay_label.setFixedSize(450, 450)
        self.overlay_label.setStyleSheet("border: 1px solid black;")

        

        self.import_img_btn = QPushButton("Import Image Folder")
        self.import_mask_btn = QPushButton("Import Mask Folder")
        self.back_btn = QPushButton("Back")
        self.next_btn = QPushButton("Next")
        self.keep_btn = QPushButton("Keep (K)")
        self.discard_btn = QPushButton("Discard (D)")

        self.import_img_btn.clicked.connect(self.import_image_folder)
        self.import_mask_btn.clicked.connect(self.import_mask_folder)
        self.back_btn.clicked.connect(self.show_previous)
        self.next_btn.clicked.connect(self.show_next)
        self.keep_btn.clicked.connect(lambda: self.handle_decision("keep"))
        self.discard_btn.clicked.connect(lambda: self.handle_decision("discard"))

        top_buttons = QHBoxLayout()
        top_buttons.addWidget(self.import_img_btn)
        top_buttons.addWidget(self.import_mask_btn)

        image_layout = QHBoxLayout()
        image_layout.addWidget(self.image_label)
        image_layout.addWidget(self.mask_label)
        image_layout.addWidget(self.overlay_label)


        nav_buttons = QHBoxLayout()
        nav_buttons.addWidget(self.back_btn)
        nav_buttons.addWidget(self.next_btn)

        decision_buttons = QHBoxLayout()
        decision_buttons.addWidget(self.keep_btn)
        decision_buttons.addWidget(self.discard_btn)

        main_layout = QVBoxLayout()
        main_layout.addLayout(top_buttons)
        main_layout.addLayout(image_layout)
        main_layout.addLayout(nav_buttons)
        main_layout.addLayout(decision_buttons)

        self.setLayout(main_layout)

    # Add keyboard shortcuts
    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Right:
            self.show_next()
        elif event.key() == Qt.Key_Left:
            self.show_previous()
        elif event.key() == Qt.Key_K:
            self.handle_decision("keep")
        elif event.key() == Qt.Key_D:
            self.handle_decision("discard")

    def import_image_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Image NPY Folder")
        if folder:
            self.image_dir = folder
            self.image_files = sorted([f for f in os.listdir(folder) if f.endswith('.npy')])
            self.index = 0
            self.show_current_pair()

    def import_mask_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Mask NPY Folder")
        if folder:
            self.mask_dir = folder
            self.mask_files = sorted([f for f in os.listdir(folder) if f.endswith('.npy')])
            self.index = 0
            self.show_current_pair()

    def create_overlay_pixmap(self, image_array, mask_array):
        # Normalize image to 0–255
        norm_img = ((image_array + 1) / 2 * 255).clip(0, 255).astype(np.uint8)
        if norm_img.ndim == 2:
            norm_img = np.stack([norm_img]*3, axis=-1)
        elif norm_img.shape[-1] == 1:
            norm_img = np.repeat(norm_img, 3, axis=-1)

        # Create RGB mask from labels
        height, width = mask_array.shape
        color_map = {
            0: (0, 0, 0),
            1: (64, 64, 64),
            2: (128, 128, 128),
            3: (255, 0, 0),
            4: (255, 255, 0)
        }
        mask_rgb = np.zeros((height, width, 3), dtype=np.uint8)
        for val, color in color_map.items():
            mask_rgb[mask_array == val] = color

        # Blend with transparency
        alpha = 0.3
        blended = (norm_img * (1 - alpha) + mask_rgb * alpha).astype(np.uint8)

        h, w, ch = blended.shape
        bytes_per_line = ch * w
        qimg = QImage(blended.data, w, h, bytes_per_line, QImage.Format_RGB888)
        return QPixmap.fromImage(qimg).scaled(450, 450, Qt.KeepAspectRatio)

    def show_current_pair(self):
        if not (self.image_files and self.mask_files):
            return

        if self.index < 0 or self.index >= len(self.image_files):
            return

        img_path = os.path.join(self.image_dir, self.image_files[self.index])
        mask_path = os.path.join(self.mask_dir, self.mask_files[self.index])

        if os.path.exists(img_path):
            img_arr = np.load(img_path)
            img_pixmap = self.array_to_qpixmap(img_arr, is_mask=False)
            self.image_label.setPixmap(img_pixmap)

        if os.path.exists(mask_path):
            mask_arr = np.load(mask_path)
            mask_pixmap = self.array_to_qpixmap(mask_arr, is_mask=True)
            self.mask_label.setPixmap(mask_pixmap)
        
        if os.path.exists(img_path) and os.path.exists(mask_path):
            overlay_pixmap = self.create_overlay_pixmap(img_arr, mask_arr)
            self.overlay_label.setPixmap(overlay_pixmap)


    def array_to_qpixmap(self, array, is_mask=False):
        if is_mask:
            height, width = array.shape
            color_map = {
                0: (0, 0, 0),         # black
                1: (64, 64, 64),   # dark gray
                2: (128, 128, 128),      # gray
                3: (255, 0, 0),       # red
                4: (255, 255, 0)      # yellow
            }
            rgb = np.zeros((height, width, 3), dtype=np.uint8)
            for val, color in color_map.items():
                rgb[array == val] = color
        else:
            # Normalize to 0-255
            array = ((array + 1) / 2 * 255).clip(0, 255).astype(np.uint8)
            if array.ndim == 2:
                rgb = np.stack([array] * 3, axis=-1)
            elif array.shape[-1] == 3:
                rgb = array
            else:
                rgb = np.stack([array[:, :, 0]] * 3, axis=-1)

        h, w, ch = rgb.shape
        bytes_per_line = ch * w
        qimg = QImage(rgb.data, w, h, bytes_per_line, QImage.Format_RGB888)
        return QPixmap.fromImage(qimg).scaled(450, 450, Qt.KeepAspectRatio)

    def show_next(self):
        if self.index < len(self.image_files) - 1:
            self.index += 1
            self.show_current_pair()

    def show_previous(self):
        if self.index > 0:
            self.index -= 1
            self.show_current_pair()

    def handle_decision(self, decision):
        if not (self.image_files and self.mask_files):
            return

        image_name = self.image_files[self.index]
        mask_name = self.mask_files[self.index]

        target_img_dir = os.path.join(self.image_dir, decision)
        target_mask_dir = os.path.join(self.mask_dir, decision)

        os.makedirs(target_img_dir, exist_ok=True)
        os.makedirs(target_mask_dir, exist_ok=True)

        shutil.move(os.path.join(self.image_dir, image_name),
                    os.path.join(target_img_dir, image_name))
        shutil.move(os.path.join(self.mask_dir, mask_name),
                    os.path.join(target_mask_dir, mask_name))

        self.image_files.pop(self.index)
        self.mask_files.pop(self.index)

        if self.index >= len(self.image_files):
            self.index = max(0, len(self.image_files) - 1)

        if self.image_files:
            self.show_current_pair()
        else:
            self.image_label.clear()
            self.mask_label.clear()
            QMessageBox.information(self, "Done", "All npy files have been processed.")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = ImageFilterTool()
    window.show()
    sys.exit(app.exec_())
