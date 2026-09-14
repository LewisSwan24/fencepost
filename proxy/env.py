#!/usr/bin/env python3
"""把仓库根目录的 .env 与 .env.local 读进 os.environ。只用标准库，不引 python-dotenv。

两个文件分工不同：`.env` 是手填的（API key、令牌密钥），`.env.local` 由
`vercel integration add` 与 `vercel env pull` 生成，托管库的地址和令牌在那里。
两个都读，本机跑起来看到的才和部署上是同一组变量。两个都在 .gitignore 里。
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
LOCAL_ENV_FILE = ROOT / ".env.local"


def load_env(path: Path = ENV_FILE, also: Path = LOCAL_ENV_FILE) -> None:
    """已存在的环境变量优先，文件里的值不覆盖它。

    先读 .env.local 再读 .env：setdefault 是先到先得，所以手填的 .env 在冲突时说了算。
    实际上两边的变量名不重叠，这只是把顺序写死，免得以后重叠了要靠猜。
    """
    if also is not None and also != path:
        _read_into_environ(also)
    _read_into_environ(path)


def _read_into_environ(path: Path) -> None:
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
