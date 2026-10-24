"""Consistent JSON error responses: {"error": {"code", "message", "details"}}."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo.errors import PyMongoError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("chill.errors")


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str, details=None):
        self.status, self.code, self.message, self.details = status, code, message, details


def _resp(status: int, code: str, message: str, details=None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}})


def install(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def _api(_: Request, e: APIError):
        return _resp(e.status, e.code, e.message, e.details)

    @app.exception_handler(RequestValidationError)
    async def _val(_: Request, e: RequestValidationError):
        details = [
            {"field": ".".join(str(x) for x in err.get("loc", []) if x != "body"), "message": err.get("msg")}
            for err in e.errors()
        ]
        return _resp(422, "validation_error", "ข้อมูลที่ส่งมาไม่ถูกต้อง", details)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        return _resp(e.status_code, "http_error", str(e.detail))

    @app.exception_handler(PyMongoError)
    async def _mongo(_: Request, e: PyMongoError):
        log.exception("MongoDB error")
        return _resp(503, "database_error", "ไม่สามารถเชื่อมต่อฐานข้อมูลได้ในขณะนี้")

    @app.exception_handler(Exception)
    async def _any(_: Request, e: Exception):
        log.exception("Unhandled error")
        return _resp(500, "internal_error", "เกิดข้อผิดพลาดภายในระบบ")
