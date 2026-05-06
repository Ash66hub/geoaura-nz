GeoAura NZ: Agentic Urban Risk Analysis

AI-Driven Due Diligence for New Zealand Property & Compliance

GeoAura NZ is a geospatial platform designed to bridge the gap between fragmented environmental hazard data and the NZ Building Code. It utilizes an agentic AI architecture to automate the "due diligence" process for urban development, providing instant, legally-cited risk assessments.

Tech Stack & Architecture
This project is built as a Monorepo to ensure seamless integration between spatial analysis and AI reasoning.

Frontend: Angular 21 (Signals, Standalone Components, MapLibre GL JS)

Backend: FastAPI (Python 3.11)

AI Brain: Gemini 1.5 Flash (via Google AI SDK)

Spatial Data: PostGIS, NIWA (Floods), GNS/GeoNet (Seismic), LINZ (Parcels)

## Local Development

### 1) Backend (FastAPI)

From the repo root:

```bash
cd apps/geoaura-api
cp mock.env .env
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Note: Virtual environments are local to your machine and should not be shared. Each developer should create their own `venv` and install dependencies from `requirements.txt`.

### 2) Frontend (Angular)

From the repo root:

```bash
cd apps/geoaura-ui
npm install
ng serve
```

The UI runs on http://localhost:4200 and the API on http://localhost:8000 by default.

## Environment Setup

Use the mock environment file as a template for local development:

```bash
cp mock.env .env
```

Update values in .env with your real keys and secrets.

## Backend Dependencies

The following libraries are required to run the GeoAura API:

```text
fastapi
uvicorn
httpx
google-genai
python-dotenv
supabase
pydantic-settings
pydantic
python-multipart
jinja2
bcrypt
pyjwt
python-jose[cryptography]
passlib[bcrypt]
```

## API Endpoint for Report Generation Queue status

Reports:

- GET /api/v1/reports/queue/status
  - Returns queue depth, processing count, max queue size, and worker status.
