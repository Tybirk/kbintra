# /// script
# requires-python = ">=3.11"
# ///
"""
Single-command dev setup for KB Intra.

Usage:
    uv run setup.py
"""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

GREEN = "\033[32m"
RED = "\033[31m"
BOLD = "\033[1m"
RESET = "\033[0m"


def step(msg: str) -> None:
    print(f"\n{BOLD}==> {msg}{RESET}")


def run(cmd: list[str], cwd: Path) -> None:
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        print(f"{RED}Command failed: {' '.join(cmd)}{RESET}")
        sys.exit(1)


def check_prerequisites() -> None:
    step("Checking prerequisites")

    if not shutil.which("node") or not shutil.which("npm"):
        print(f"{RED}node/npm not found.{RESET}")
        print("Install Node.js 18+ from https://nodejs.org/ or via your package manager.")
        sys.exit(1)

    print(f"  {GREEN}uv{RESET}  — available (you're running this script with it)")
    print(f"  {GREEN}node{RESET} — available")
    print(f"  {GREEN}npm{RESET}  — available")


def main() -> None:
    print(f"{BOLD}KB Intra — Dev Setup{RESET}")

    check_prerequisites()

    step("Installing Python dependencies (backend)")
    run(["uv", "sync"], cwd=BACKEND)

    step("Installing Node dependencies (frontend)")
    run(["npm", "install"], cwd=FRONTEND)

    step("Running database migrations")
    run(["uv", "run", "python", "manage.py", "migrate"], cwd=BACKEND)

    step("Building search index (if empty)")
    run(
        ["uv", "run", "python", "manage.py", "rebuild_search_index", "--if-empty"],
        cwd=BACKEND,
    )

    print(f"\n{GREEN}{BOLD}Setup complete!{RESET}\n")
    print("Next steps:")
    print(f"  {BOLD}uv run dev.py{RESET}    — start backend + frontend dev servers")
    print(f"  Open {BOLD}http://localhost:5173{RESET} in your browser")
    print()


if __name__ == "__main__":
    main()
