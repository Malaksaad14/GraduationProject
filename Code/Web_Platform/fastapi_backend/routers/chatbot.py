"""
chatbot.py - Gemini AI Chatbot Router

Provides a /chatbot/ask endpoint that uses the Google Gemini API (google-genai SDK)
to answer questions about cardiac MRI scans and myocardial viability.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
import os
from google import genai
from google.genai import types
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")
load_dotenv()  # Also check current working directory

router = APIRouter(prefix="/chatbot", tags=["Chatbot"])

# Configure Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
DEFAULT_MODEL = "gemini-3.5-flash"
GEMINI_MODEL = os.getenv("GEMINI_MODEL", DEFAULT_MODEL)

# Map known deprecated / sunsetted models to currently supported models
DEPRECATED_MODEL_MAP = {
    "gemini-1.5-flash": "gemini-3.5-flash",
    "gemini-1.5-flash-latest": "gemini-3.5-flash",
    "gemini-1.5-pro": "gemini-3.5-flash",
    "gemini-2.5-flash": "gemini-3.5-flash",
    "gemini-1.0-pro": "gemini-3.5-flash",
}

# Reliable fallback chain in priority order
FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"]


def get_gemini_client():
    key = os.getenv("GEMINI_API_KEY", GEMINI_API_KEY)
    if not key:
        return None
    return genai.Client(api_key=key)


def resolve_candidate_models():
    """Return ordered, deduplicated list of candidate models to try."""
    raw_model = os.getenv("GEMINI_MODEL", GEMINI_MODEL).strip()
    # Auto-remap deprecated models
    primary_model = DEPRECATED_MODEL_MAP.get(raw_model, raw_model) or DEFAULT_MODEL
    
    candidates = [primary_model]
    for m in FALLBACK_MODELS:
        if m not in candidates:
            candidates.append(m)
    return candidates


SYSTEM_PROMPT = """You are an expert Cardiac MRI AI Assistant specialized in:
- Left Ventricle (LV) localization and segmentation
- Myocardial viability assessment & scar transmurality grading
- Late Gadolinium Enhancement (LGE) interpretation
- Cine MRI wall motion and thickening assessment
- DICOM and NIfTI medical imaging formats
- Clinical guidelines (AHA 17-segment model, SCMR recommendations)

You assist radiologists and cardiologists using a medical imaging platform.
When asked to assess myocardial viability for a scan:
1. **Clinical Viability Grading (LGE Transmurality Standard)**:
   - Non-transmural hyperenhancement (< 25% wall thickness): High viability (>80% functional recovery likelihood after revascularization).
   - 25% - 50% transmurality: Intermediate/moderate viability (~50% likelihood of recovery).
   - 50% - 75% transmurality: Low viability (~15% likelihood of recovery).
   - Transmural (> 75% wall thickness): Non-viable scar tissue (<5% functional recovery; predicts adverse remodeling).
2. **End-Diastolic Wall Thickness (EDWT)**: Correlate that wall thinning (< 5.5 mm) in akinetic segments indicates non-viable chronic infarction.
3. **Scan Integration**: Connect your assessment directly to the active scan sequence, slice number, and any available patient metrics.
4. **Structured Assessment**: Format the response with clear bold sections:
   - **Viability Classification & Transmurality**
   - **Segmental & Wall Thickness Assessment**
   - **Predicted Functional Recovery**
   - **Clinical Recommendation**
   Use bullet points for readability.

Always be precise, professional, and evidence-based.
Keep responses focused and well-structured using bullet points when appropriate."""


class ChatRequest(BaseModel):
    message: str
    scan_context: Optional[dict] = None  # Optional scan metadata for context
    is_localized: Optional[bool] = False


class ChatResponse(BaseModel):
    reply: str
    model: str


@router.post("/ask", response_model=ChatResponse)
async def ask_chatbot(request: ChatRequest):
    """
    Send a message to the Gemini AI chatbot and receive a medical response.
    Includes automatic fallback across available Gemini models.
    """
    client = get_gemini_client()
    if not client:
        raise HTTPException(
            status_code=500,
            detail="Gemini API key not configured. Please set GEMINI_API_KEY in .env"
        )

    # Build context-enriched prompt
    context_block = ""
    if request.scan_context:
        ctx = request.scan_context
        clinical = ctx.get("clinicalData") or {}
        clinical_lines = []
        if clinical and isinstance(clinical, dict):
            for k, v in clinical.items():
                if v and not isinstance(v, (dict, list)):
                    clinical_lines.append(f"- Clinical {k.replace('_', ' ').title()}: {v}")
        clinical_text = "\n".join(clinical_lines) if clinical_lines else "- Clinical Data: Loaded in viewer"

        context_block = f"""
[Active Scan Context]
- File: {ctx.get('fileName', 'Unknown')}
- Sequence / Study: {ctx.get('sequenceType', ctx.get('type', 'Unknown').upper())}
- Patient / Study Name: {ctx.get('patientName', 'N/A')}
- Current Slice: {ctx.get('currentSlice', 0) + 1} of {ctx.get('totalSlices', 1)}
- Dimensions: {ctx.get('cols', 512)} x {ctx.get('rows', 512)}
- LV Localized ROI: {'Yes (ROI Bounding Box & Center Detected)' if request.is_localized else 'Not yet localized'}
- Segmentation Mask Status: {'AI/Ground Truth mask available' if ctx.get('hasAiMask') or ctx.get('hasGtMask') else 'Raw anatomical scan'}
{clinical_text}

"""

    full_prompt = context_block + request.message
    candidates = resolve_candidate_models()
    last_error = None

    for model_name in candidates:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=full_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.4,
                ),
            )
            reply_text = response.text.strip() if response.text else ""
            return ChatResponse(reply=reply_text, model=model_name)
        except Exception as e:
            last_error = e
            # Try next model in candidate chain if 404 NOT_FOUND, 503, or ServerError
            continue

    raise HTTPException(
        status_code=500,
        detail=f"Gemini API error: {str(last_error)}"
    )


@router.get("/health", tags=["Chatbot"])
def chatbot_health():
    """Check if the Gemini chatbot is configured and ready."""
    key = os.getenv("GEMINI_API_KEY", GEMINI_API_KEY)
    configured = bool(key)
    candidates = resolve_candidate_models()
    return {
        "status": "ready" if configured else "not_configured",
        "model": candidates[0] if candidates else DEFAULT_MODEL,
        "available_candidates": candidates,
        "api_key_set": configured
    }
