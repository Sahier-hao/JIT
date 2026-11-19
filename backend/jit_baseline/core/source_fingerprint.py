"""Source fingerprints for run identity.

Modules are resolved by import path rather than by a file path relative to the
calling module, so moving a module into a domain package does not change how the
training-code provenance is computed.
"""
import hashlib
from importlib import import_module
from pathlib import Path


def source_hash(module_path: str) -> str:
    module = import_module(module_path)
    return hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()


def source_hashes(mapping: dict[str, str]) -> dict[str, str]:
    return {name: source_hash(module_path) for name, module_path in mapping.items()}
