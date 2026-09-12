#!/usr/bin/env python3
"""把仓库根目录的 .env 读进 os.environ。只用标准库，不引 python-dotenv。"""

import os
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def load_env(path: Path = ENV_FILE) -> None:
    """已存在的环境变量优先，文件里的值不覆盖它。"""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(name.strip(), value)
