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
	@echo "  setup    create virtual environment and install dependencies"
	@echo "  run      start the Flask development server (runs setup if needed)"
	@echo "  release  build Docker image $(IMAGE):$(VERSION)"
	@echo "  clean    remove the virtual environment"

setup: .venv/pyvenv.cfg

.venv/pyvenv.cfg: requirements.txt
	$(PYTHON) -m venv .venv
	$(PIP) install --upgrade pip --quiet
	$(PIP) install -r requirements.txt --quiet
	@echo "Setup complete. Run 'make run' to start the server."

run: .venv/pyvenv.cfg
	$(VENV_PYTHON) app.py

release:
	docker build -t $(IMAGE):$(VERSION) .
	@echo "Built $(IMAGE):$(VERSION)"

clean:
	rm -rf .venv
	@echo "Virtual environment removed."
