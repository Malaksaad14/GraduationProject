# dicom_app/urls.py
from django.urls import path
from .views import upload_dicom, save_modified_dicom, send_to_localizer, extract_metadata, send_series_to_localizer, \
    run_nnunet_on_nifti, run_nnunet_on_dicom

# from .views import save_processed_dicom

urlpatterns = [
    path('upload-dicom/', upload_dicom, name='upload_dicom'),
   path('save-processed-dicom/', save_modified_dicom, name='save_modified_dicom'),  # Add this line
    path('send-to-localizer/', send_to_localizer, name='send_to_localizer'),
    path('extract-metadata/', extract_metadata, name='extract_metadata'),
    path('send-series-to-model/', send_series_to_localizer, name='send_series_to_localizer'),
    # path('predict-nnunet/', send_to_nnunet, name='send_to_nnunet'),
    path('predict-nifti/', run_nnunet_on_nifti, name='run_nnunet_on_nifti'),
    path('predict-dicom/', run_nnunet_on_dicom, name='run_nnunet_on_dicom'),
    # path('convert-nifti-to-dicom/', convert_nifti_to_dicom, name='convert_nifti_to_dicom'),


]

