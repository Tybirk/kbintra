# /// script
# requires-python = ">=3.11"
# ///
"""
Start backend and frontend dev servers for KB Intra.

Usage:
    uv run dev.py
"""

import os
import signal
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

# Overridable so a second checkout (e.g. a git worktree) can run alongside the default one.
BACKEND_PORT = os.getenv("BACKEND_PORT", "7000")
FRONTEND_PORT = os.getenv("FRONTEND_PORT", "5173")

BOLD = "\033[1m"
RESET = "\033[0m"
BLUE = "\033[34m"
MAGENTA = "\033[35m"


def prefix_stream(stream, prefix: str) -> None:
    """Read lines from a stream and print them with a prefix."""
    for line in iter(stream.readline, ""):
        print(f"{prefix}{line}", end="", flush=True)


def main() -> None:
    print(f"{BOLD}KB Intra — Dev Servers{RESET}\n")
    print(f"  Backend:  http://localhost:{BACKEND_PORT}")
    print(f"  Frontend: http://localhost:{FRONTEND_PORT}")
    print("  Press Ctrl+C to stop\n")

    backend_prefix = f"{BLUE}[backend]{RESET}  "
    frontend_prefix = f"{MAGENTA}[frontend]{RESET} "

    _shell = sys.platform == "win32"

    backend = subprocess.Popen(
        [
            "uv",
            "run",
            "daphne",
            "-b",
            "0.0.0.0",
            "-p",
            BACKEND_PORT,
            "config.asgi:application",
        ],
        cwd=BACKEND,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        shell=_shell,
    )

    frontend = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=FRONTEND,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        shell=_shell,
        env={
            **os.environ,
            "VITE_DEV_PORT": FRONTEND_PORT,
            "VITE_BACKEND_PORT": BACKEND_PORT,
        },
    )

    procs = [backend, frontend]

    # Stream output in background threads
    threading.Thread(
        target=prefix_stream, args=(backend.stdout, backend_prefix), daemon=True
    ).start()
    threading.Thread(
        target=prefix_stream, args=(frontend.stdout, frontend_prefix), daemon=True
    ).start()

    def shutdown(signum=None, frame=None) -> None:
        print(f"\n{BOLD}Shutting down...{RESET}")
        for proc in procs:
            proc.terminate()
        for proc in procs:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Wait for either process to exit
    while True:
        for proc in procs:
            try:
                proc.wait(timeout=0.5)
                # A process exited — shut everything down
                shutdown()
            except subprocess.TimeoutExpired:
                pass


if __name__ == "__main__":
    main()
