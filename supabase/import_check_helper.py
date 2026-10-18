"""Helper module so pytest can invoke the importer validation cleanly."""

import importlib.util
from pathlib import Path


def run_importer_validation() -> int:
    script = Path(__file__).resolve().parent / "import" / "import_questions.py"
    spec = importlib.util.spec_from_file_location("import_questions", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return int(module.main(["--check"]))
