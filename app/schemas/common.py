from typing import Any

from pydantic import BaseModel


class ApiResponse(BaseModel):
    success: bool = True
    data: Any = None
    message: str | None = None


class ApiError(BaseModel):
    code: str
    message: str


class ApiErrorResponse(BaseModel):
    success: bool = False
    error: ApiError
