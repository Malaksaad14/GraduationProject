import csv
import re
from pathlib import Path
from typing import Dict, Any, Optional

# Primary EMIDEC search directories
EMIDEC_DIRS = [
    Path(r"C:\Users\ahmed\Downloads\emidec-dataset-1.0.1\emidec-dataset-1.0.1"),
    Path(r"C:\Users\ahmed\Downloads\emidec-dataset-1.0.1"),
    Path(r"D:\Datasets"),
    Path(r"D:\Datasets\emidec"),
]

# Secondary fallback CSV path
CSV_PATH = Path(r"D:\Datasets\dataset_information.csv")

_clinical_records_csv = {}

def load_csv_data():
    global _clinical_records_csv
    if _clinical_records_csv:
        return _clinical_records_csv
    if not CSV_PATH.exists():
        return _clinical_records_csv
    try:
        with open(CSV_PATH, mode="r", encoding="utf-8-sig", errors="ignore") as f:
            reader = csv.DictReader(f)
            for row in reader:
                code_raw = str(row.get("SUBJECT_CODE", "")).strip()
                disease = str(row.get("DISEASE", "")).strip()
                if not disease or not code_raw:
                    continue
                clean_num = code_raw.split(".")[0].strip()
                if clean_num:
                    _clinical_records_csv[clean_num] = row
    except Exception as e:
        print(f"[ClinicalService] Error loading CSV fallback: {e}")
    return _clinical_records_csv

def extract_patient_id(filename: str, ds=None) -> str:
    """
    Extracts patient ID from DICOM header or filename without mangling IDs.
    """
    if ds is not None:
        raw_id = getattr(ds, "PatientID", None) or getattr(ds, "PatientName", None)
        if raw_id:
            raw_str = str(raw_id).strip()
            if raw_str and raw_str.upper() not in ("N/A", "NONE", "UNKNOWN", "ANONYMOUS", "ANONYMIZED"):
                # If EMIDEC pattern like N012 or P001, preserve upper code
                m = re.search(r"\b([NP]\d+)\b", raw_str, re.IGNORECASE)
                if m:
                    return m.group(1).upper()
                return raw_str

    # Check filename e.g. 'Case_N012.nii.gz', 'Case N012.txt', 'P005.dcm', '001_SA_CINE.nii'
    # 1. EMIDEC N or P pattern
    m_np = re.search(r"(?:case[\s_-]*)?([NP]\d+)", filename, re.IGNORECASE)
    if m_np:
        return m_np.group(1).upper()

    # 2. M&Ms-2 3-digit pattern strictly at beginning e.g. '001_SA_CINE.nii'
    m_mms = re.match(r"^(\d{3})_(?:SA|LA|2CH|4CH|CINE|ED|ES)", filename, re.IGNORECASE)
    if m_mms:
        return m_mms.group(1)

    # 3. Explicit prefix like patient_01 or subject-12
    m_pref = re.search(r"(?:patient|case|subject)[_-\s]*([A-Za-z0-9_-]+)", filename, re.IGNORECASE)
    if m_pref:
        return m_pref.group(1).strip()

    # Fallback to filename stem
    clean_stem = Path(filename).name.replace(".nii.gz", "").replace(".nii", "").replace(".dcm", "").replace(".dicom", "")
    return clean_stem or "Unknown"

def extract_clinical_from_dicom(ds, filename: str = "") -> dict:
    """
    Extracts clinical & scanner metadata directly from authoritative DICOM headers.
    Avoids any incorrect fallback to external CSV files (e.g. M&Ms-2) for non-M&Ms scans.
    """
    def _clean(val):
        if val is None:
            return None
        s = str(val).strip()
        if s.lower() in ("", "none", "n/a", "null", "unknown", "nan"):
            return None
        return s

    raw_pid = _clean(getattr(ds, "PatientID", None))
    raw_pname = _clean(getattr(ds, "PatientName", None))
    
    # Clean patient ID
    patient_id = raw_pid or raw_pname or (Path(filename).stem if filename else "Unknown")
    
    # Demographics
    demographics: Dict[str, Any] = {"id": str(patient_id)}
    if raw_pname and raw_pname != raw_pid and raw_pname.upper() not in ("ANONYMOUS", "ANONYMIZED"):
        # Format DICOM caret name like "DOE^JOHN" to "DOE JOHN"
        clean_name = raw_pname.replace("^", " ").strip()
        if clean_name:
            demographics["name"] = clean_name
    
    # Age
    raw_age = _clean(getattr(ds, "PatientAge", None))
    if raw_age:
        age_digits = re.findall(r"\d+", raw_age)
        if age_digits:
            demographics["age"] = int(age_digits[0])
    elif getattr(ds, "PatientBirthDate", None) and getattr(ds, "StudyDate", None):
        try:
            b_year = int(str(ds.PatientBirthDate)[:4])
            s_year = int(str(ds.StudyDate)[:4])
            if s_year > b_year:
                demographics["age"] = s_year - b_year
        except Exception:
            pass

    # Gender
    raw_sex = _clean(getattr(ds, "PatientSex", None))
    if raw_sex:
        s_upper = raw_sex.upper()
        demographics["gender"] = "Female" if s_upper.startswith("F") else ("Male" if s_upper.startswith("M") else raw_sex)

    # Weight & Size/Height
    raw_weight = _clean(getattr(ds, "PatientWeight", None))
    if raw_weight:
        try:
            demographics["weight"] = f"{float(raw_weight):.1f} kg"
        except Exception:
            demographics["weight"] = f"{raw_weight} kg"

    raw_size = _clean(getattr(ds, "PatientSize", None))
    if raw_size:
        try:
            demographics["height"] = f"{float(raw_size):.2f} m"
        except Exception:
            demographics["height"] = f"{raw_size} m"

    # Additional Clinical Notes / History if embedded in DICOM
    clinical_history = (
        _clean(getattr(ds, "AdditionalPatientHistory", None)) or
        _clean(getattr(ds, "PatientComments", None)) or
        _clean(getattr(ds, "MedicalAlerts", None)) or
        _clean(getattr(ds, "AdmittingDiagnosesDescription", None))
    )
    if clinical_history:
        demographics["clinical_notes"] = clinical_history

    # Scanner & Acquisition Specs
    imaging_specs: Dict[str, Any] = {}
    
    station = _clean(getattr(ds, "StationName", None))
    institution = _clean(getattr(ds, "InstitutionName", None))
    study_desc = _clean(getattr(ds, "StudyDescription", None))
    series_desc = _clean(getattr(ds, "SeriesDescription", None))
    protocol = _clean(getattr(ds, "ProtocolName", None))
    vendor = _clean(getattr(ds, "Manufacturer", None))
    scanner = _clean(getattr(ds, "ManufacturerModelName", None))
    
    # Infer meaningful dataset / study title
    if study_desc:
        imaging_specs["dataset"] = study_desc
    elif institution:
        imaging_specs["dataset"] = f"{institution} Cardiac Study"
    elif station:
        imaging_specs["dataset"] = f"{station} Acquisition"
    else:
        imaging_specs["dataset"] = "Native DICOM Acquisition"

    if vendor:
        imaging_specs["vendor"] = vendor
    if scanner:
        imaging_specs["scanner"] = scanner
    if station:
        imaging_specs["station"] = station
    if institution:
        imaging_specs["institution"] = institution

    # Magnetic Field Strength (e.g. 3.0T, 1.5T)
    field = getattr(ds, "MagneticFieldStrength", None)
    if field is not None:
        try:
            field_f = float(field)
            imaging_specs["field_strength"] = f"{field_f:.1f} T"
        except Exception:
            imaging_specs["field_strength"] = f"{field} T"

    modality = _clean(getattr(ds, "Modality", None)) or "MR"
    imaging_specs["modality"] = f"Cardiac {modality}" if modality == "MR" else modality

    if series_desc:
        imaging_specs["series_description"] = series_desc
    if protocol:
        imaging_specs["protocol_name"] = protocol

    heart_rate = _clean(getattr(ds, "HeartRate", None))
    if heart_rate:
        imaging_specs["heart_rate"] = f"{heart_rate} bpm"

    rep_time = getattr(ds, "RepetitionTime", None)
    if rep_time is not None:
        imaging_specs["repetition_time"] = f"{rep_time} ms"

    echo_time = getattr(ds, "EchoTime", None)
    if echo_time is not None:
        imaging_specs["echo_time"] = f"{echo_time} ms"

    flip = getattr(ds, "FlipAngle", None)
    if flip is not None:
        imaging_specs["flip_angle"] = f"{flip}°"

    study_date = _clean(getattr(ds, "StudyDate", None))
    if study_date and len(study_date) == 8:
        imaging_specs["study_date"] = f"{study_date[:4]}-{study_date[4:6]}-{study_date[6:]}"

    slice_loc = _clean(getattr(ds, "SliceLocation", None))
    if slice_loc:
        imaging_specs["slice_location"] = f"{slice_loc} mm"

    inversion_time = _clean(getattr(ds, "InversionTime", None))
    if inversion_time:
        imaging_specs["inversion_time"] = f"{inversion_time} ms"

    trigger_time = _clean(getattr(ds, "TriggerTime", None))
    if trigger_time:
        imaging_specs["trigger_time"] = f"{trigger_time} ms"

    available_sections = []
    if demographics:
        available_sections.append("demographics")
    if imaging_specs:
        available_sections.append("imaging_specs")

    return {
        "found": True,
        "source": "DICOM Header (Native Metadata)",
        "patient_id": str(patient_id),
        "is_dicom_native": True,
        "available_sections": available_sections,
        "demographics": demographics,
        "imaging_specs": imaging_specs,
        "lab_results": [],
        "risk_factors": {},
        "notice": "Metadata extracted directly from DICOM headers. No external lab test or clinical records attached.",
        "raw_record": {
            k: v for k, v in {
                "PatientID": getattr(ds, "PatientID", None),
                "PatientName": str(getattr(ds, "PatientName", "")),
                "Manufacturer": getattr(ds, "Manufacturer", None),
                "Model": getattr(ds, "ManufacturerModelName", None),
                "Station": getattr(ds, "StationName", None),
                "Institution": getattr(ds, "InstitutionName", None),
                "FieldStrength": getattr(ds, "MagneticFieldStrength", None),
                "StudyDescription": getattr(ds, "StudyDescription", None),
                "SeriesDescription": getattr(ds, "SeriesDescription", None),
                "Protocol": getattr(ds, "ProtocolName", None),
            }.items() if v is not None and str(v).strip() != ""
        }
    }

def _find_emidec_txt_file(patient_id: str) -> Optional[Path]:
    """Locates the real .txt file for an EMIDEC patient."""
    clean_id = patient_id.strip()
    digits = "".join(re.findall(r"\d+", clean_id))
    
    # Candidate filenames to test
    candidates = []
    # If ID already specifies N or P (e.g. N012 or P001)
    if clean_id.upper().startswith("N") or clean_id.upper().startswith("P"):
        norm_id = clean_id.upper()
        candidates.extend([
            f"Case {norm_id}.txt",
            f"Case_{norm_id}.txt",
            f"{norm_id}.txt",
        ])
    elif digits:
        # Numeric ID e.g. '12' or '012' -> test both N and P with 3-digit padding
        num_int = int(digits)
        candidates.extend([
            f"Case N{num_int:03d}.txt",
            f"Case P{num_int:03d}.txt",
            f"Case_{num_int:03d}.txt",
            f"Case {num_int:03d}.txt",
            f"{num_int:03d}.txt",
        ])

    for base_dir in EMIDEC_DIRS:
        if not base_dir.exists():
            continue
        # Direct check in base_dir
        for cand in candidates:
            p = base_dir / cand
            if p.exists():
                return p
        # Check inside subdirectories (e.g. base_dir / Case_N012 / Case N012.txt)
        if clean_id.upper().startswith(("N", "P")):
            folder_cand = base_dir / f"Case_{clean_id.upper()}"
            if folder_cand.exists() and folder_cand.is_dir():
                for cand in candidates:
                    p = folder_cand / cand
                    if p.exists():
                        return p
        # Scan files matching Case*.txt
        try:
            for item in base_dir.iterdir():
                if item.is_file() and item.name.lower().endswith(".txt"):
                    if clean_id.upper() in item.name.upper():
                        return item
        except Exception:
            pass

    return None

def _parse_emidec_txt(txt_path: Path) -> Dict[str, str]:
    """Parses key:value lines from an EMIDEC .txt metadata file."""
    data = {}
    with open(txt_path, mode="r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if ":" in line and not line.startswith("The datasets"):
                k, v = line.split(":", 1)
                data[k.strip()] = v.strip()
    return data

def get_clinical_data(patient_id_raw: str, filename: str = "") -> dict:
    """
    Looks up external clinical history or biomarker records.
    1. Primary: Real EMIDEC .txt file — ONLY for EMIDEC cases (starts with N or P, or has Case N/P).
    2. Secondary: dataset_information.csv — STRICTLY for M&Ms-2 scans (naming e.g. 001_SA_ED.nii).
    3. Otherwise: Returns found=False gracefully without injecting false data or leaking M&Ms-2 records.
    """
    clean_id = str(patient_id_raw).strip()
    fn = str(filename or "").strip()

    # 1. EMIDEC Lookup (ONLY if patient ID or filename matches EMIDEC pattern)
    is_emidec_id = bool(re.match(r'^[NP]\d+$', clean_id, re.IGNORECASE)) or bool(re.search(r'(?:case[\s_-]*)?[NP]\d+', fn, re.IGNORECASE))
    txt_file = _find_emidec_txt_file(clean_id) if is_emidec_id else None

    if txt_file and txt_file.exists():
        try:
            emidec_kv = _parse_emidec_txt(txt_file)
            filename_case = txt_file.stem  # e.g. 'Case N012'
            is_normal = "N" in filename_case.upper() or clean_id.upper().startswith("N")
            
            sex_raw = emidec_kv.get("Sex", "M").upper()
            gender = "Female" if sex_raw == "F" else "Male"
            age_str = emidec_kv.get("Age", "45")
            try:
                age = int(re.findall(r"\d+", age_str)[0])
            except Exception:
                age = 45

            # Clinical status
            if is_normal:
                diagnosis = "Normal (Healthy Control)"
                disease_code = "NOR"
                category = "Normal / Control"
                severity = "Low"
            else:
                diagnosis = "Myocardial Infarction (STEMI / NSTEMI)"
                disease_code = "MI"
                category = "Infarction"
                severity = "Critical" if emidec_kv.get("Killip Max") in ["3", "4"] else "High"

            # Values — only include what the file actually contains
            troponin_str = emidec_kv.get("Troponin", "").strip()
            fevg_str     = emidec_kv.get("FEVG", "").strip()
            ntprobnp_str = emidec_kv.get("NTProBNP", "").strip()
            killip_str   = emidec_kv.get("Killip Max", "").strip()
            ecg_st       = emidec_kv.get("ECG (ST +)", "").strip()
            gap_slices   = emidec_kv.get("Gap between slices", "").strip()

            # Build lab results — skip entries with no real value
            raw_lab_candidates = []

            if troponin_str:
                try:
                    trop_val = float(troponin_str)
                    trop_status = "normal" if trop_val <= 0.04 else ("critical" if trop_val > 1.0 else "high")
                except Exception:
                    trop_status = "high"
                raw_lab_candidates.append({"test": "Cardiac Troponin I (cTnI)", "value": troponin_str, "unit": "ng/mL", "reference": "< 0.04", "status": trop_status})

            if ntprobnp_str:
                try:
                    bnp_val = float(ntprobnp_str)
                    bnp_status = "normal" if bnp_val < 125 else "high"
                except Exception:
                    bnp_status = "high"
                raw_lab_candidates.append({"test": "NT-proBNP", "value": ntprobnp_str, "unit": "pg/mL", "reference": "< 125", "status": bnp_status})

            if fevg_str:
                try:
                    fevg_val = float(fevg_str)
                    fevg_status = "normal" if fevg_val >= 50 else "low"
                except Exception:
                    fevg_status = "low"
                raw_lab_candidates.append({"test": "Left Ventricular EF (FEVG)", "value": f"{fevg_str}%", "unit": "%", "reference": "55 - 70%", "status": fevg_status})

            if killip_str:
                k_status = "high" if killip_str not in ["1"] else "normal"
                raw_lab_candidates.append({"test": "Killip Classification", "value": f"Class {killip_str}", "unit": "Grade", "reference": "Class 1", "status": k_status})

            if ecg_st:
                ecg_positive = ecg_st.upper() == "Y"
                raw_lab_candidates.append({"test": "ECG (ST Elevation)", "value": "Positive (STEMI)" if ecg_positive else "Negative", "unit": "ECG", "reference": "Negative", "status": "critical" if ecg_positive else "normal"})

            lab_results = raw_lab_candidates  # Only real values, no N/A placeholders

            # Risk factors — only include where value is actually positive/set
            _EMPTY_RISK = {"", "N", "0", "No", "no", "NO", "n/a", "N/A"}
            risk_factors = {}
            rf_map = {
                "Hypertension": emidec_kv.get("Arterial hypertension", ""),
                "Diabetes": emidec_kv.get("Diabetes", ""),
                "Tobacco": emidec_kv.get("Tobacco", ""),
                "Overweight": emidec_kv.get("Overweight", ""),
                "Family History CAD": emidec_kv.get("Familial history of coronary artery disease", ""),
            }
            for rf_key, rf_val in rf_map.items():
                if rf_val.strip() not in _EMPTY_RISK:
                    risk_factors[rf_key] = rf_val.strip()

            demographics = {
                "id": clean_id,
                "case": filename_case,
                "disease_code": disease_code,
                "diagnosis": diagnosis,
                "category": category,
                "severity": severity,
            }
            # Only attach age / gender if the file actually has them
            if emidec_kv.get("Age", "").strip():
                demographics["age"] = age
            if emidec_kv.get("Sex", "").strip():
                demographics["gender"] = gender

            imaging_specs = {
                "modality": "Cardiac MRI (Late Gadolinium Enhancement - LGE)",
                "dataset": "EMIDEC Challenge",
            }
            if gap_slices:
                imaging_specs["gap_between_slices"] = gap_slices

            # Determine which sections have real data
            available_sections = ["demographics"]
            if imaging_specs:
                available_sections.append("imaging_specs")
            if lab_results:
                available_sections.append("lab_results")
            if risk_factors:
                available_sections.append("risk_factors")

            return {
                "found": True,
                "source": "EMIDEC .txt (Original Case File)",
                "patient_id": clean_id,
                "case_name": filename_case,
                "available_sections": available_sections,
                "demographics": demographics,
                "imaging_specs": imaging_specs,
                "lab_results": lab_results,
                "risk_factors": risk_factors,
                "raw_record": emidec_kv
            }
        except Exception as e:
            print(f"[ClinicalService] Error parsing .txt file {txt_file}: {e}")

    # 2. M&Ms-2 Lookup: STRICTLY only if this file is genuinely an M&Ms-2 scan!
    # M&Ms-2 files are named e.g. '001_SA_CINE.nii', '003_SA_ED.nii.gz', '012_LA_2CH.nii'
    is_mms2 = bool(re.match(r'^\d{3}_(?:SA|LA|2CH|4CH|CINE|ED|ES)', fn, re.IGNORECASE))
    if not is_mms2 and bool(re.match(r'^\d{1,3}$', clean_id)) and any(k in fn.upper() for k in ('SA_', 'LA_', 'CINE', 'ED', 'ES')):
        is_mms2 = True

    if is_mms2:
        csv_records = load_csv_data()
        digits_match = re.findall(r"\d+", clean_id)
        search_key = str(int(digits_match[0])) if digits_match else clean_id
        row = csv_records.get(search_key)

        if row:
            disease_code = str(row.get("DISEASE", "")).strip().upper() or None
            vendor  = str(row.get("VENDOR",  "")).strip() or None
            scanner = str(row.get("SCANNER", "")).strip() or None
            field   = str(row.get("FIELD",   "")).strip() or None
            centre  = str(row.get("CENTRE",  "")).strip() or None

            # Build only the demographic fields that actually exist in this CSV row
            demographics: Dict[str, Any] = {"id": clean_id}
            if disease_code:
                diagnosis = "Normal Control" if disease_code == "NOR" else "Cardiac Abnormality"
                demographics["disease_code"] = disease_code
                demographics["diagnosis"]    = diagnosis
                demographics["category"]     = disease_code
                demographics["severity"]     = "Low" if disease_code == "NOR" else "Moderate"

            # Build imaging_specs only from real CSV columns
            imaging_specs: Dict[str, Any] = {}
            if vendor:  imaging_specs["vendor"] = vendor
            if scanner: imaging_specs["scanner"] = scanner
            if field:   imaging_specs["field_strength"] = f"{field} T" if not field.endswith("T") else field
            if centre:  imaging_specs["centre"] = centre
            imaging_specs["dataset"] = "M&Ms-2 Challenge"

            available_sections = ["demographics"]
            if imaging_specs:
                available_sections.append("imaging_specs")

            return {
                "found": True,
                "source": "M&Ms-2 Clinical Record (dataset_information.csv)",
                "patient_id": clean_id,
                "available_sections": available_sections,
                "demographics": demographics,
                "imaging_specs": imaging_specs,
                "lab_results": [],      # CSV has no lab data
                "risk_factors": {},
                "raw_record": {k: v for k, v in row.items() if v and str(v).strip() not in ("", "Unknown", "N/A")}
            }

    # 3. Graceful fallback for anonymized / non-cataloged datasets
    return {
        "found": False,
        "patient_id": clean_id,
        "source": "None",
        "message": "Metadata sourced from image headers only / No external clinical record or lab results attached."
    }

# Pre-load fallback CSV
load_csv_data()
