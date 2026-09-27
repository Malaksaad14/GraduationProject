import os
import io
import uuid
import json
import base64
import logging
import datetime
import numpy as np
import pydicom
from pydicom.errors import InvalidDicomError
from pydicom.dataset import Dataset, FileDataset

from django.conf import settings
from django.http import JsonResponse, HttpResponse, FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.shortcuts import render
from django.core.files.storage import FileSystemStorage

from .models.model_processor import process_image, process_slices_group
# from .nnunet_engine.inference_runner import predict_from_dicom, nifti_to_dicom

# Set up logging
logger = logging.getLogger(__name__)



# Create a simple home view
def home(request):
    return HttpResponse("<h1>Welcome to the DICOM Viewer API</h1><p>Use <code>/api/upload-dicom/</code> to upload a DICOM file and view metadata.</p>")


@csrf_exempt  # For simplicity; use CSRF tokens for security in production
def upload_dicom(request):
    if request.method == 'POST' and request.FILES.get('dicom_file'):
        dicom_file = request.FILES['dicom_file']

        # Define the path to save the uploads DICOM file
        # save_path = r'/dicom_project/uploads'
        save_path = r'C:\Graduation Project\Code\Dicom viewer backend pycharam\Trial 1\dicom_project\uploads'

        # Ensure the directory exists
        os.makedirs(save_path, exist_ok=True)

        # Construct the full file path
        file_path = os.path.join(save_path, dicom_file.name)

        # Save the uploads DICOM file
        with open(file_path, 'wb') as output_file:
            for chunk in dicom_file.chunks():
                output_file.write(chunk)

        try:
            # Read the saved DICOM file using pydicom
            ds = pydicom.dcmread(file_path)

            # Extract metadata as a dictionary
            metadata = {}
            for element in ds:
                tag_key = f"({element.tag.group:04X}, {element.tag.element:04X})"
                # if element.keyword != 'PixelData':  # Exclude Pixel Data
                #     metadata[tag_key] = {
                #         'name': element.name,
                #         'value': str(element.value)
                #     }

                metadata[tag_key] = {
                    'name': element.name,
                    'value': str(element.value)
                }

            return JsonResponse(metadata, safe=False)

        except InvalidDicomError:
            return JsonResponse({'error': 'Invalid DICOM file'}, status=400)

    return JsonResponse({'error': 'Invalid request'}, status=400)


@csrf_exempt  # For simplicity; use CSRF tokens for security in production
def save_modified_dicom(request):
    if request.method == 'POST' and request.FILES.get('modified_pixel_data') and request.POST.get('original_dicom_path'):
        # Get the modified pixel data and the original DICOM path
        modified_pixel_data = request.FILES['modified_pixel_data']
        original_dicom_path = request.POST['original_dicom_path']

        print("original_dicom_path", original_dicom_path)

        # Load the original DICOM file
        try:
            original_dicom = pydicom.dcmread(original_dicom_path)
        except Exception as e:
            return JsonResponse({'error': f"Failed to read original DICOM file: {str(e)}"}, status=400)

        # Reads the raw binary data from the uploaded file.
        # np.frombuffer: Converts the binary data into a NumPy array, treating the data as
        # uint16 (16-bit unsigned integers). This matches the DICOM pixel data format.
        modified_pixel_array = np.frombuffer(modified_pixel_data.read(),
                                             dtype=np.uint16)  # Ensure it's uint16, sent from frontend

        #  Reshapes the flat 1D NumPy array into a 2D array that matches the dimensions of
        #  the original DICOM image (Rows × Columns).
        modified_pixel_array = modified_pixel_array.reshape(original_dicom.Rows, original_dicom.Columns)

        # --- Modify Pixel Values Here ---
        # Example modification: Increase all pixel values by 500
        modified_pixel_array = np.clip(modified_pixel_array + 50, 0, 65535)  # Ensure values are within uint16 range

        # # Increase contrast by multiplying the pixel values by a factor
        # contrast_factor = 1.1  # Double the contrast
        # modified_pixel_array = np.clip(modified_pixel_array * contrast_factor, 0, 65535)

        # Update the pixel data in the DICOM object (convert back to bytes)
        original_dicom.PixelData = modified_pixel_array.tobytes()

        # Create a new filename for the modified DICOM file
        new_dicom_path = os.path.join('uploads', f"modified_{os.path.basename(original_dicom_path)}")

        # Save the modified DICOM file in the same format as the original file
        try:
            original_dicom.save_as(new_dicom_path)
        except Exception as e:
            return JsonResponse({'error': f"Failed to save modified DICOM file: {str(e)}"}, status=400)

        return JsonResponse({'message': 'Modified DICOM file saved successfully', 'new_dicom_path': new_dicom_path})

    return JsonResponse({'error': 'Invalid request'}, status=400)



@csrf_exempt  # For simplicity; use CSRF tokens for security in production
def extract_metadata(request):
    if request.method == 'POST' and request.FILES.get('dicom_file'):
        dicom_file = request.FILES['dicom_file']

        try:
            # Read the file into memory using BytesIO
            dicom_data = dicom_file.read()
            dicom_stream = io.BytesIO(dicom_data)

            # Read the DICOM file from memory
            ds = pydicom.dcmread(dicom_stream)

            # Extract metadata as a dictionary
            metadata = {}
            for element in ds:
                tag_key = f"({element.tag.group:04X}, {element.tag.element:04X})"
                metadata[tag_key] = {
                    'name': element.name,
                    'value': str(element.value)
                }

            return JsonResponse(metadata, safe=False)

        except InvalidDicomError:
            return JsonResponse({'error': 'Invalid DICOM file'}, status=400)

    return JsonResponse({'error': 'Invalid request'}, status=400)



@csrf_exempt
def send_to_localizer(request):
    if request.method == 'POST' and request.FILES.get('dicom_file'):
        dicom_file = request.FILES['dicom_file']

        # Define the path to save the uploaded DICOM file and processed DICOM files
        save_path = r'C:\Graduation Project\Code\Dicom viewer backend pycharam\Trial 1\dicom_project\localizerImages'
        os.makedirs(save_path, exist_ok=True)

        # Construct the full file path to save the original DICOM
        file_path = os.path.join(save_path, dicom_file.name)

        # Save the uploaded DICOM file
        with open(file_path, 'wb') as output_file:
            for chunk in dicom_file.chunks():
                output_file.write(chunk)

        # Read the uploaded DICOM file using pydicom
        try:
            ds = pydicom.dcmread(file_path)

            # Ensure the file contains pixel data
            if 'PixelData' not in ds:
                return JsonResponse({'error': 'DICOM file does not contain pixel data.'}, status=400)

            # Extract the pixel data as a numpy array
            input_array = ds.pixel_array

            # Process the image to extract the ROI (the result should be the cropped area)
            result = process_image(input_array)  # Assuming this is a numpy array
            print("Result:", result)

            # Create a new DICOM file with the cropped ROI as pixel data
            new_ds = ds.copy()  # Copy metadata from the original DICOM

            # Update the pixel data with the cropped ROI (the result should be the correct shape)
            new_ds.PixelData = result.tobytes()
            new_ds.Rows, new_ds.Columns = result.shape  # Update the rows and columns
            new_ds.BitsAllocated = 16  # If the model returns 16-bit images
            new_ds.BitsStored = 16
            new_ds.HighBit = 15

            # Modify the SeriesNumber to indicate that it's a modified file (but keep it numeric)
            if 'SeriesNumber' in new_ds:
                original_series_number = new_ds.SeriesNumber
                # new_ds.SeriesNumber = original_series_number  # Keep the original SeriesNumber intact
                new_ds.SeriesNumber = original_series_number * 100 # Append '00' as a numeric value

            # Add a custom indicator for modified files
            new_ds.SeriesDescription = f"It is a cropped ROI of the left ventricle : {new_ds.SeriesDescription}"  # Example change to SeriesDescription

            # bazwdd hagat mn nfsyy
            # new_ds.Manufacturer = f"{ds.Manufacturer} - Processed"
            # new_ds.SoftwareVersions = f"{ds.SoftwareVersions} - Localizer Model v1.0"

            # Generate a new file name with the prefix "processed_"
            processed_file_name = f"localized_{dicom_file.name}"


            # Save the new DICOM file with the new name
            processed_file_path = os.path.join(save_path, processed_file_name)
            new_ds.save_as(processed_file_path)

            # Read the processed file and encode it to base64
            with open(processed_file_path, 'rb') as f:
                dicom_file_data = f.read()

            # Convert the binary data to a base64 string
            dicom_base64 = base64.b64encode(dicom_file_data).decode('utf-8')

            return JsonResponse({
                'message': 'Processed DICOM file created successfully',
                'dicom_file_data': dicom_base64,
                'processed_file_name': processed_file_name  # Include the processed file name in the response
            })

        except InvalidDicomError:
            return JsonResponse({'error': 'Invalid DICOM file'}, status=400)
        except Exception as e:
            return JsonResponse({'error': f"Error processing DICOM file: {str(e)}"}, status=400)

    return JsonResponse({'error': 'Invalid request'}, status=400)





@csrf_exempt
def send_series_to_localizer(request):
    if request.method == 'POST' and request.FILES:
        # Create a directory to save the series files
        save_path = r'C:\Graduation Project\Code\Dicom viewer backend pycharam\Trial 1\dicom_project\localizerImages'
        os.makedirs(save_path, exist_ok=True)

        processed_files = []
        pixel_arrays = []  # List to store pixel data for the series

        try:
            print(f"Number of files received: {len(request.FILES)}")

            # Process each uploaded DICOM file
            for file_key, dicom_file in request.FILES.items():
                print(f"Processing file: {dicom_file.name}")

                # Save the uploaded DICOM file
                file_path = os.path.join(save_path, dicom_file.name)
                with open(file_path, 'wb') as output_file:
                    for chunk in dicom_file.chunks():
                        output_file.write(chunk)
                print(f"File saved to: {file_path}")

                # Read the uploaded DICOM file using pydicom
                try:
                    ds = pydicom.dcmread(file_path)
                    if 'PixelData' not in ds:
                        print(f"Skipping file {dicom_file.name}: No PixelData found")
                        continue

                    pixel_arrays.append(ds.pixel_array)
                except InvalidDicomError:
                    print(f"Invalid DICOM file: {dicom_file.name}")
                    continue

            if pixel_arrays:
                print(f"Processing {len(pixel_arrays)} images in the series...")
                processed_results = process_slices_group(pixel_arrays)
                print(f"Processing complete. Number of results: {len(processed_results)}")
            else:
                print("No valid pixel data found in the series.")
                return JsonResponse({'error': 'No valid pixel data in the series.'}, status=400)

            # Process each result and prepare the response
            for i, result in enumerate(processed_results):
                ds = pydicom.dcmread(file_path)
                new_ds = ds.copy()
                new_ds.PixelData = result.tobytes()
                new_ds.Rows, new_ds.Columns = result.shape
                new_ds.BitsAllocated = 16
                new_ds.BitsStored = 16
                new_ds.HighBit = 15

                if 'InstanceNumber' in new_ds:
                    new_ds.InstanceNumber = i + 1
                if 'SeriesNumber' in new_ds:
                    original_series_number = new_ds.SeriesNumber
                    new_ds.SeriesNumber = original_series_number * 100

                new_ds.SeriesDescription = f"Localized ROI for Series: {new_ds.SeriesDescription}"

                processed_file_name = f"localized_result_{i + 1}.dcm"
                processed_file_path = os.path.join(save_path, processed_file_name)
                new_ds.save_as(processed_file_path)

                # Encode the processed file as base64
                with open(processed_file_path, "rb") as f:
                    file_data = base64.b64encode(f.read()).decode('utf-8')

                processed_files.append({
                    # This might be used for logging or debugging but is not directly used for any core functionality in the frontend.
                    'file_name': processed_file_name,
                    # The frontend does not use file_path for anything in your code. It would only be useful if the frontend had direct access to this path (e.g., through a file server).
                    'file_path': processed_file_path,
                    # The base64-encoded file_data is decoded and converted into a Blob for display in the DICOM viewer.
                    'file_data': file_data,  # Sending the file as base64
                    # The frontend doesn't seem to directly use the metadata from the backend in the provided code.
                    'metadata': {
                        'instance_number': new_ds.InstanceNumber if 'InstanceNumber' in new_ds else None,
                        'series_number': new_ds.SeriesNumber if 'SeriesNumber' in new_ds else None,
                        'description': new_ds.SeriesDescription
                    }
                })

            # Response: Array of processed files
            return JsonResponse({
                'message': 'Processed series successfully',
                'processed_files': processed_files,
            })

        except Exception as e:
            print(f"Error processing series: {str(e)}")
            return JsonResponse({'error': f"Error processing series: {str(e)}"}, status=400)

    print("Invalid request: No files or incorrect method")
    return JsonResponse({'error': 'Invalid request'}, status=400)





@csrf_exempt
def run_nnunet_on_nifti(request):
    """
    Handle NIfTI file upload and run nnU-Net prediction
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST method allowed'}, status=405)

    if not request.FILES.get('nifti_file'):
        return JsonResponse({'error': 'No NIfTI file provided'}, status=400)

    nii_file = request.FILES['nifti_file']

    # Validate file extension
    if not nii_file.name.lower().endswith(('.nii', '.nii.gz')):
        return JsonResponse({'error': 'Invalid file format. Please upload .nii or .nii.gz file'}, status=400)

    # Define base paths
    base_path = r"C:\Graduation Project\Code\Dicom viewer backend pycharam\Trial 1\dicom_project\uploads"
    output_base_path = r"C:\Graduation Project\Code\Dicom viewer backend pycharam\Trial 1\dicom_project\nnunet_outputs"

    # Create directories
    os.makedirs(base_path, exist_ok=True)
    os.makedirs(output_base_path, exist_ok=True)

    # Generate unique filename
    unique_id = uuid.uuid4().hex
    file_extension = '.nii.gz' if nii_file.name.lower().endswith('.nii.gz') else '.nii'
    saved_nii_path = os.path.join(base_path, f"input_{unique_id}{file_extension}")

    try:
        # Save uploaded NIfTI file
        with open(saved_nii_path, 'wb') as f:
            for chunk in nii_file.chunks():
                f.write(chunk)

        logger.info(f"NIfTI file saved to: {saved_nii_path}")

        # Import and run nnU-Net prediction
        from .nnunet_engine.inference_runner import predict_from_nifti

        predicted_path = predict_from_nifti(
            nifti_path=saved_nii_path,
            output_base_dir=output_base_path,
            task_name="Dataset033_EMDIC"
        )

        logger.info(f"Prediction saved to: {predicted_path}")

        # Check if prediction file exists
        if not os.path.exists(predicted_path):
            return JsonResponse({'error': 'Prediction file was not created'}, status=500)

        # Return the predicted file
        response = FileResponse(
            open(predicted_path, 'rb'),
            content_type="application/gzip",
            as_attachment=True,
            filename="predicted_segmentation.nii.gz"
        )

        # Clean up input file (optional)
        try:
            os.remove(saved_nii_path)
        except:
            pass  # Ignore cleanup errors

        return response

    except Exception as e:
        logger.error(f"nnU-Net prediction failed: {str(e)}")

        # Clean up files on error
        try:
            if os.path.exists(saved_nii_path):
                os.remove(saved_nii_path)
        except:
            pass

        return JsonResponse({
            'error': f'Prediction failed: {str(e)}',
            'details': 'Check server logs for more information'
        }, status=500)


@csrf_exempt
def run_nnunet_on_dicom(request):
    """
    Handle DICOM file upload, convert to NIfTI, run nnU-Net prediction, and convert back to DICOM
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST method allowed'}, status=405)

    if not request.FILES.get('dicom_file'):
        return JsonResponse({'error': 'No DICOM file provided'}, status=400)

    dicom_file = request.FILES['dicom_file']

    # Validate file extension
    if not dicom_file.name.lower().endswith(('.dcm', '.dicom')):
        return JsonResponse({'error': 'Invalid file format. Please upload .dcm or .dicom file'}, status=400)

    # Define base paths
    base_path = r"C:\Graduation Project\Code\Dicom viewer backend pycharam\Trial 1\dicom_project\nnunet_input"
    output_base_path = r"C:\Graduation Project\Code\Dicom viewer backend pycharam\Trial 1\dicom_project\nnunet_outputs"

    # Create directories
    os.makedirs(base_path, exist_ok=True)
    os.makedirs(output_base_path, exist_ok=True)

    # Generate unique filename
    unique_id = uuid.uuid4().hex
    saved_dicom_path = os.path.join(base_path, f"input_{unique_id}.dcm")

    try:
        # Save uploaded DICOM file
        with open(saved_dicom_path, 'wb') as f:
            for chunk in dicom_file.chunks():
                f.write(chunk)

        logger.info(f"DICOM file saved to: {saved_dicom_path}")

        # Validate DICOM file before processing
        try:
            import pydicom
            import nibabel as nib
            import numpy as np
            from datetime import datetime

            original_ds = pydicom.dcmread(saved_dicom_path)
            if 'PixelData' not in original_ds:
                return JsonResponse({'error': 'DICOM file has no pixel data'}, status=400)
        except Exception as e:
            return JsonResponse({'error': f'Invalid DICOM file: {str(e)}'}, status=400)

        # Import and run complete pipeline
        from .nnunet_engine.inference_runner import predict_from_dicom

        result = predict_from_dicom(
            dicom_path=saved_dicom_path,
            output_base_dir=output_base_path,
            task_name="Dataset033_EMDIC",
            use_python_api=True  # Explicitly use Python API for better control
        )

        predicted_path = result['predicted_nifti']
        logger.info(f"Prediction saved to: {predicted_path}")

        # Check if prediction file exists
        if not os.path.exists(predicted_path):
            return JsonResponse({'error': 'Prediction file was not created'}, status=500)

        # Save a copy of the NIfTI output for reference
        nifti_output_copy = os.path.join(output_base_path, f"segmentation_{unique_id}.nii.gz")
        try:
            import shutil
            shutil.copy2(predicted_path, nifti_output_copy)
            logger.info(f"NIfTI segmentation copy saved to: {nifti_output_copy}")
        except Exception as e:
            logger.warning(f"Failed to save NIfTI copy: {str(e)}")

        # Convert NIfTI segmentation back to DICOM
        try:
            output_dicom_path = nifti_to_dicom(
                nifti_path=predicted_path,
                reference_dicom_path=saved_dicom_path,
                output_dicom_path=os.path.join(output_base_path, f"segmentation_{unique_id}.dcm"),
                unique_id=unique_id
            )

            logger.info(f"Segmentation DICOM saved to: {output_dicom_path}")

        except Exception as e:
            logger.error(f"Failed to convert NIfTI to DICOM: {str(e)}")
            return JsonResponse({'error': f'Failed to convert segmentation to DICOM: {str(e)}'}, status=500)

        # Check if DICOM file was created successfully
        if not os.path.exists(output_dicom_path):
            return JsonResponse({'error': 'DICOM segmentation file was not created'}, status=500)

        # Return the predicted DICOM file
        response = FileResponse(
            open(output_dicom_path, 'rb'),
            content_type="application/dicom",
            as_attachment=True,
            filename="segmentation_result.dcm"
        )

        # Clean up input files (optional)
        try:
            os.remove(saved_dicom_path)
            # Keep both NIfTI files for debugging/reference
            # os.remove(predicted_path)
            # os.remove(nifti_output_copy)
        except:
            pass  # Ignore cleanup errors

        return response

    except Exception as e:
        logger.error(f"DICOM to nnU-Net prediction failed: {str(e)}")

        # Clean up files on error
        try:
            if os.path.exists(saved_dicom_path):
                os.remove(saved_dicom_path)
        except:
            pass

        return JsonResponse({
            'error': f'Prediction failed: {str(e)}',
            'details': 'Check server logs for more information'
        }, status=500)


def nifti_to_dicom(nifti_path, reference_dicom_path, output_dicom_path, unique_id):
    """
    Convert NIfTI segmentation back to DICOM format using reference DICOM
    This function reverses the transformations applied in dicom_to_nifti
    """
    import pydicom
    import nibabel as nib
    import numpy as np
    from datetime import datetime

    # Load the NIfTI segmentation
    nifti_img = nib.load(nifti_path)
    segmentation_data = nifti_img.get_fdata()

    # Load reference DICOM for metadata
    reference_ds = pydicom.dcmread(reference_dicom_path)

    # Reverse the transformations applied in dicom_to_nifti
    # The original dicom_to_nifti applied:
    # 1. np.rot90(pixel_array, k=1, axes=(0, 1))  # 90 degrees counterclockwise
    # 2. np.flip(pixel_array, axis=0)             # Flip vertically

    # To reverse these transformations:
    # 1. First, reverse the vertical flip
    pixel_data = np.flip(segmentation_data, axis=0)

    # 2. Then, reverse the 90-degree rotation (rotate 90 degrees clockwise, k=-1)
    pixel_data = np.rot90(pixel_data, k=-1, axes=(0, 1))

    # Handle 3D data - if we have multiple slices, take the middle slice or create composite
    if len(pixel_data.shape) == 3:
        if pixel_data.shape[2] > 1:
            # Take middle slice
            middle_slice_idx = pixel_data.shape[2] // 2
            pixel_data = pixel_data[:, :, middle_slice_idx]

            # Alternative: Maximum intensity projection across all slices
            # pixel_data = np.max(pixel_data, axis=2)
        else:
            pixel_data = pixel_data[:, :, 0]

    # Ensure pixel data is in correct format for DICOM
    # Convert to appropriate data type
    pixel_data = pixel_data.astype(np.uint16)

    # Create a new DICOM dataset based on the reference
    output_ds = reference_ds.copy()

    # Update relevant DICOM tags for segmentation
    output_ds.SeriesDescription = "nnU-Net Segmentation"
    output_ds.SeriesNumber = str(int(getattr(reference_ds, 'SeriesNumber', 999)) + 1000)
    output_ds.StudyDescription = getattr(reference_ds, 'StudyDescription', '') + " - AI Segmentation"
    output_ds.ImageComments = "Generated by nnU-Net AI segmentation model"

    # Update timestamps
    current_time = datetime.now()
    output_ds.SeriesDate = current_time.strftime('%Y%m%d')
    output_ds.SeriesTime = current_time.strftime('%H%M%S.%f')[:-3]
    output_ds.ContentDate = current_time.strftime('%Y%m%d')
    output_ds.ContentTime = current_time.strftime('%H%M%S.%f')[:-3]

    # Update image dimensions to match the processed data
    output_ds.Rows = pixel_data.shape[0]
    output_ds.Columns = pixel_data.shape[1]
    output_ds.BitsAllocated = 16
    output_ds.BitsStored = 16
    output_ds.HighBit = 15
    output_ds.PixelRepresentation = 0  # Unsigned
    output_ds.SamplesPerPixel = 1
    output_ds.PhotometricInterpretation = "MONOCHROME2"

    # Set pixel data
    output_ds.PixelData = pixel_data.tobytes()

    # Update Window/Level for better visualization of segmentation
    max_val = np.max(pixel_data)
    min_val = np.min(pixel_data)
    if max_val > min_val:
        output_ds.WindowCenter = str((max_val + min_val) // 2)
        output_ds.WindowWidth = str(max_val - min_val)
    else:
        output_ds.WindowCenter = str(max_val // 2) if max_val > 0 else "128"
        output_ds.WindowWidth = str(max_val) if max_val > 0 else "256"

    # Generate unique SOPInstanceUID for the new segmentation
    from pydicom.uid import generate_uid
    output_ds.SOPInstanceUID = generate_uid()

    # Update MediaStorageSOPInstanceUID if present
    if hasattr(output_ds, 'file_meta') and hasattr(output_ds.file_meta, 'MediaStorageSOPInstanceUID'):
        output_ds.file_meta.MediaStorageSOPInstanceUID = output_ds.SOPInstanceUID

    # Save the DICOM file
    output_ds.save_as(output_dicom_path)

    return output_dicom_path

@csrf_exempt
def get_prediction_info(request):
    """
    Get information about available predictions
    """
    if request.method != 'GET':
        return JsonResponse({'error': 'Only GET method allowed'}, status=405)

    # output_base_path = r"C:\Graduation Project\Code\Dicom viewer backend pycharam\Trial 1\dicom_project\nnunet_outputs"
    output_base_path = r"C:\Graduation Project\Code\Dicom viewer backend pycharam\Trial 1\dicom_project\nnunet_output"

    try:
        if not os.path.exists(output_base_path):
            return JsonResponse({'predictions': []})

        predictions = []
        for item in os.listdir(output_base_path):
            item_path = os.path.join(output_base_path, item)
            if os.path.isdir(item_path):
                prediction_files = [f for f in os.listdir(item_path) if f.endswith('.nii.gz')]
                if prediction_files:
                    predictions.append({
                        'directory': item,
                        'files': prediction_files,
                        'created': os.path.getctime(item_path)
                    })

        return JsonResponse({'predictions': predictions})

    except Exception as e:
        return JsonResponse({'error': f'Failed to get prediction info: {str(e)}'}, status=500)

