from fastapi import FastAPI

from app.consult import router as consult_router

app = FastAPI(title="Preface AI", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(consult_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
