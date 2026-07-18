ifeq ($(OS),Windows_NT)
    VENV_BIN := .venv/Scripts
    PYTHON   := python
else
    VENV_BIN := .venv/bin
    PYTHON   := python3
endif

VENV_PYTHON := $(VENV_BIN)/python
PIP         := $(VENV_BIN)/pip

IMAGE   := simple-adexplorer
VERSION := latest

.PHONY: setup run clean release help

help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "  setup    clone conversion tools, create venv, install dependencies"
	@echo "  run      start the Flask development server (runs setup if needed)"
	@echo "  release  build Docker image $(IMAGE):$(VERSION)"
	@echo "  clean    remove the development and build artifacts"

setup: .venv/pyvenv.cfg src/adex_deps/.installed

src/ADExplorerSnapshot/ADExplorerSnapshot.py:
	git clone --depth 1 https://github.com/c3c/ADExplorerSnapshot.git src/ADExplorerSnapshot

.venv/pyvenv.cfg: requirements.txt src/ADExplorerSnapshot/ADExplorerSnapshot.py
	$(PYTHON) -m venv .venv
	$(PIP) install --upgrade pip --quiet
	$(PIP) install -r requirements.txt --quiet

src/adex_deps/.installed: .venv/pyvenv.cfg
	$(PIP) install --target src/adex_deps rich bloodhound-ce requests dissect --quiet
	touch src/adex_deps/.installed
	@echo "Setup complete. Run 'make run' to start the server."

run: .venv/pyvenv.cfg
	$(VENV_PYTHON) src/app.py

release:
	docker build -f docker/Dockerfile -t $(IMAGE):$(VERSION) .
	@echo "Built $(IMAGE):$(VERSION)"
	docker image save -o $(IMAGE)-$(VERSION).tar.gz $(IMAGE):$(VERSION)
	@echo "Exported $(IMAGE)-$(VERSION).tar.gz"

clean:
	rm -rf .venv
	@echo "Virtual environment removed."
	rm -rf src/ADExplorerSnapshot
	@echo "ADExplorerSnapshot removed."
	rm -rf src/adex_deps
	@echo "adex_deps removed."
	rm -rf src/instance
	@echo "instance removed."
	rm -rf src/uploads
	@echo "uploads removed."
	find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	@echo "Python caches removed."
