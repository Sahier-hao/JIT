"""Pydantic v2 contracts for the first router migration slice.

Only request bodies that were previously validated by hand and have a stable
shape are modeled here. Responses keep the existing JSON structure; the models
document it and appear in the generated OpenAPI contract.
"""
from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    status: str


class SharingUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')

    shared: bool


class SharingResponse(BaseModel):
    version: str
    shared: bool
