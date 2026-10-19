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
    Extracts patient ID from DICOM header or filename.
    Prioritizes EMIDEC codes like N012, P001, or numeric codes like 001, 12.
    """
    if ds is not None:
        raw_id = getattr(ds, "PatientID", None) or getattr(ds, "PatientName", None)
        if raw_id:
            raw_str = str(raw_id).strip()
            # Match N012 or P001
            m = re.search(r"([NP]\d+)", raw_str, re.IGNORECASE)
            if m:
                return m.group(1).upper()
            digits = re.findall(r"\d+", raw_str)
            if digits:
                return digits[0]
            if raw_str and raw_str != "N/A":
                return raw_str

    # Check filename e.g. 'Case_N012.nii.gz', 'Case N012.txt', 'P005.dcm', '001_SA_CINE.nii'
    # 1. EMIDEC N or P pattern
    m_np = re.search(r"(?:case[\s_-]*)?([NP]\d+)", filename, re.IGNORECASE)
    if m_np:
        return m_np.group(1).upper()

    # 2. General digits
    m_num = re.search(r"(?:patient|case[_-]?[pn]?|subject[_-]?)?0*(\d+)", filename, re.IGNORECASE)
    if m_num:
        return m_num.group(1)

    return "Unknown"

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

def get_clinical_data(patient_id_raw: str) -> dict:
    """
    Primary: Parses real EMIDEC .txt file — ONLY for IDs with N or P prefix (e.g. N012, P005).
    Fallback: Uses dataset_information.csv for purely numeric IDs (e.g. M&Ms-2 patients).
    """
    clean_id = str(patient_id_raw).strip()

    # EMIDEC IDs always start with N or P — skip txt search for pure-numeric M&Ms-2 IDs
    is_emidec_id = bool(re.match(r'^[NP]\d+$', clean_id, re.IGNORECASE))
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

    # Fallback to CSV
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
        imaging_specs["dataset"] = "M&Ms-2 / CSV"

        available_sections = ["demographics"]
        if imaging_specs:
            available_sections.append("imaging_specs")

        return {
            "found": True,
            "source": "dataset_information.csv",
            "patient_id": clean_id,
            "available_sections": available_sections,
            "demographics": demographics,
            "imaging_specs": imaging_specs,
            "lab_results": [],      # CSV has no lab data
            "risk_factors": {},
            "raw_record": {k: v for k, v in row.items() if v and str(v).strip() not in ("", "Unknown", "N/A")}
        }

    return {
        "found": False,
        "patient_id": clean_id,
        "message": f"No EMIDEC .txt or CSV record found for Patient ID: {clean_id}"
    }

# Pre-load fallback CSV
load_csv_data()
