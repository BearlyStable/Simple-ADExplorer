FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/Nm1ss/ADExplorerSnapshot.git ADExplorerSnapshot

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn \
    && pip install --no-cache-dir --target /app/adex_deps rich bloodhound-ce requests dissect

COPY app.py .
COPY templates/ templates/
COPY static/ static/

RUN mkdir -p instance uploads

EXPOSE 5000

CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:5000", "--timeout", "600", "app:app"]
