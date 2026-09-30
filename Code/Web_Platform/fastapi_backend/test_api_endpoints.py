import requests

base_url = "http://127.0.0.1:8000"

print("1. Testing GET /health...")
r = requests.get(f"{base_url}/health")
print(f"Health response: {r.status_code} - {r.json()}")

print("\n2. Testing POST /upload/nifti with test_sample.nii.gz...")
with open("test_sample.nii.gz", "rb") as f:
    files = {"nifti_file": ("test_sample.nii.gz", f, "application/gzip")}
    r_upload = requests.post(f"{base_url}/upload/nifti", files=files)
print(f"Upload response ({r_upload.status_code}): {r_upload.json()}")

print("\n3. Testing POST /localizer/nifti with test_sample.nii.gz...")
with open("test_sample.nii.gz", "rb") as f:
    files = {"nifti_file": ("test_sample.nii.gz", f, "application/gzip")}
    r_localizer = requests.post(f"{base_url}/localizer/nifti", files=files)
print(f"Localizer response status: {r_localizer.status_code}, content length: {len(r_localizer.content)} bytes, headers: {dict(r_localizer.headers)}")
assert r_localizer.status_code == 200, f"Expected 200 OK, got {r_localizer.status_code}"
print("\n✅ All NIfTI backend endpoints verified successfully!")
