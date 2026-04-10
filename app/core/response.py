from typing import Any

from fastapi.responses import JSONResponse


def success_response(
    data: Any = None, message: str | None = None, status_code: int = 200
) -> dict:
    body: dict[str, Any] = {"success": True, "data": data}
    if message:
        body["message"] = message
    return body


def error_response(code: str, message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "error": {"code": code, "message": message}},
    )
