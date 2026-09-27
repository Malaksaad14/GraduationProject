# myocardial-viability-assessment-platform

## 🌐 Frontend Setup Instructions for DICOM Viewer Platform

This guide helps you run the frontend application of the DICOM Viewer platform.

---

### 📁 Folder Structure

The repo has this layout:

```
/Repo
├── Backend/
   └── dicom-project/                      # Main Django backend folder
└── Frontend/
    └── dicom-viewer/              # Main frontend project folder
```

---

### ▶️ Step-by-Step: Running the Frontend

1. **Navigate to the frontend project folder**:

```bash
cd Frontend\dicom-viewer
```

2. **Install dependencies**:

```bash
npm install
# or
yarn install
```

3. **Start the development server**:

```bash
npm start
# or
yarn start
```

This will launch the frontend on:

```
http://localhost:3000
```

---


### 🧠 Notes

* Make sure the Django backend is running before using the frontend.

---



## Django Backend

## 📁 Full Backend Setup Commands (Conda Recommended)

```bash
# Step 1: Navigate to the backend directory
cd Backend\dicom_project

# Step 2: Create the environment from file
conda env create -f environment.yml

# Step 3: Activate it
conda activate nnunet_django_env

# Step 4: Run the backend
python manage.py runserver
```

---


## 🐍 Alternative: Using `requirements.txt` for pip/venv users

If someone prefers `pip` and `venv` instead of Conda:

```bash
# Step 1: Navigate to the backend directory
cd Backend\dicom_project

# Step 2: Create a virtual environment
python -m venv nnunet_django_env

# Step 3: Activate it
# Windows
nnunet_django_env\Scripts\activate
# Linux/macOS
source nnunet_django_env/bin/activate

# Step 4: Install dependencies
pip install -r requirements.txt

# Step 5: Run the backend
python manage.py runserver
```

---

## 🧪 Run the Django Server

```bash
python manage.py runserver
```

---

### 🧠 Notes

* Always activate the conda environment **before** running server or installing packages.

---

For issues, make sure that:

* You installed Conda correctly
* The environment name is spelled exactly
* You activated from the same shell where Conda is initialized
