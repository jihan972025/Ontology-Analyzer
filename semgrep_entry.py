"""Entry point for bundled semgrep CLI (PyInstaller)."""
import sys
from semgrep.cli import cli

if __name__ == "__main__":
    cli()
