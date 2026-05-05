GeoAura NZ: Agentic Urban Risk Analysis

AI-Driven Due Diligence for New Zealand Property & Compliance

GeoAura NZ is a geospatial platform designed to bridge the gap between fragmented environmental hazard data and the NZ Building Code. It utilizes an agentic AI architecture to automate the "due diligence" process for urban development, providing instant, legally-cited risk assessments.

Tech Stack & Architecture
This project is built as a Monorepo to ensure seamless integration between spatial analysis and AI reasoning.

Frontend: Angular 21 (Signals, Standalone Components, MapLibre GL JS)

Backend: FastAPI (Python 3.11)

AI Brain: Gemini 1.5 Flash (via Google AI SDK)

Spatial Data: PostGIS, NIWA (Floods), GNS/GeoNet (Seismic), LINZ (Parcels)

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
