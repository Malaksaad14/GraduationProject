from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import ALLOWED_ORIGINS
from routers import dicom, predict

app = FastAPI(
    title="Myocardial Viability Assessment API",
    description="API for uploading DICOM/NIfTI files and running cardiac segmentation models.",
    version="1.0.0",
)

# Allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(dicom.router)
app.include_router(predict.router)


@app.get("/", tags=["Health"])
def root():
    return {"message": "Myocardial Viability Assessment API is running ✅"}


@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "ok"}
