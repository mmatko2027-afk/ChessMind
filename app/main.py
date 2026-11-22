
import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.settings import settings
from app.models import CoachRequest, CoachResponse
from app.service import ChessService
from app.storage import ChessStorage
from app.telemetry import setup_logging, RequestIdFilter

from app.providers.errors import (
    ProviderTimeoutError,
    ProviderRateLimitError,
    ProviderUnavailableError,
    ProviderInvalidResponseError,
    ProviderStreamError,
    ProviderBudgetExceededError,
    ProviderAuthenticationError
)

import os
from fastapi.staticfiles import StaticFiles

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version
)

setup_logging()

logger = logging.getLogger("chessmind")

for handler in logging.getLogger().handlers:
    handler.addFilter(RequestIdFilter())



service = ChessService()
storage = ChessStorage()

start_time = time.time()


@app.middleware("http")
async def add_request_id(request: Request, call_next):

    request_id = str(uuid.uuid4())
    request.state.request_id = request_id

    response = await call_next(request)

    response.headers["X-Request-ID"] = request_id

    return response


@app.on_event("startup")
def startup():

    storage.initialize()

    logger.info("ChessMind started")


@app.get("/health")
def health():

    return {
        "status": "ok",
        "version": settings.app_version,
        "provider": settings.llm_provider,
        "model": settings.llm_model,
        "mode": settings.llm_provider,
        "storage": "ok",
        "extra": {
            "chess_engine": "not_loaded"
        },
        "uptime_s": int(time.time() - start_time)
    }


@app.post(
    "/api/coach/explain",
    response_model=CoachResponse
)
def explain(data: CoachRequest, request: Request):

    request_id = request.state.request_id

    logger.info(
        "API received assistant request",
        extra={"request_id": request_id}
    )

    result = service.explain_position(
        question=data.question,
        position=data.position,
        request_id=request_id
    )

    logger.info(
        "API returned assistant response",
        extra={"request_id": request_id}
    )

    return result


@app.exception_handler(ProviderTimeoutError)
async def handle_timeout(request: Request, exc: ProviderTimeoutError):

    request_id = request.state.request_id

    return JSONResponse(
        status_code=504,
        content={
            "error": {
                "kind": "provider_timeout",
                "message": str(exc),
                "retryable": True,
                "request_id": request_id
            }
        },
        headers={"X-Request-ID": request_id}
    )


@app.exception_handler(ProviderRateLimitError)
async def handle_rate_limit(request: Request, exc: ProviderRateLimitError):

    request_id = request.state.request_id

    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "kind": "rate_limit",
                "message": str(exc),
                "retryable": True,
                "request_id": request_id
            }
        },
        headers={"X-Request-ID": request_id}
    )


@app.exception_handler(ProviderUnavailableError)
async def handle_unavailable(request: Request, exc: ProviderUnavailableError):

    request_id = request.state.request_id

    return JSONResponse(
        status_code=503,
        content={
            "error": {
                "kind": "provider_unavailable",
                "message": str(exc),
                "retryable": exc.retryable,
                "request_id": request_id
            }
        },
        headers={"X-Request-ID": request_id}
    )


@app.exception_handler(ProviderInvalidResponseError)
async def handle_invalid_response(request: Request, exc: ProviderInvalidResponseError):

    request_id = request.state.request_id

    return JSONResponse(
        status_code=502,
        content={
            "error": {
                "kind": "invalid_response",
                "message": str(exc),
                "retryable": exc.retryable,
                "request_id": request_id
            }
        },
        headers={"X-Request-ID": request_id}
    )


@app.exception_handler(ProviderStreamError)
async def handle_stream_error(request: Request, exc: ProviderStreamError):

    request_id = request.state.request_id

    return JSONResponse(
        status_code=502,
        content={
            "error": {
                "kind": "stream_interrupted",
                "message": str(exc),
                "retryable": exc.retryable,
                "request_id": request_id
            }
        },
        headers={"X-Request-ID": request_id}
    )

@app.exception_handler(ProviderBudgetExceededError)
async def handle_budget_exceeded(
    request: Request,
    exc: ProviderBudgetExceededError
):
    request_id = request.state.request_id

    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "kind": "budget_exceeded",
                "message": str(exc),
                "retryable": False,
                "request_id": request_id
            }
        },
        headers={"X-Request-ID": request_id}
    )


@app.exception_handler(ProviderAuthenticationError)
async def handle_authentication_error(
    request: Request,
    exc: ProviderAuthenticationError
):
    request_id = request.state.request_id

    return JSONResponse(
        status_code=401,
        content={
            "error": {
                "kind": "authentication_error",
                "message": "Помилка автентифікації AI-провайдера.",
                "retryable": False,
                "request_id": request_id
            }
        },
        headers={"X-Request-ID": request_id}
    )

frontend_dist = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "frontend",
    "dist"
)

if os.path.isdir(frontend_dist):
    app.mount(
        "/",
        StaticFiles(directory=frontend_dist, html=True),
        name="frontend"
    )