from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import ALLOWED_ORIGINS
from routers import upload, localizer, segment, convert

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
app.include_router(upload.router)
app.include_router(localizer.router)
app.include_router(segment.router)
app.include_router(convert.router)


@app.get("/", tags=["Health"])
def root():
    return {"message": "Myocardial Viability Assessment API is running ✅"}


@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "ok"}
