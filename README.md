[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/ncRwI7td)

# Code Rush — Fleet Command Simulator

This workspace implements a complete end-to-end fleet command system with:
- Express.js backend running a 1 Hz ship simulator
- React + Vite dashboard with real-time map sync
- Socket.IO for persistent realtime state updates
- PostgreSQL database for ship state, restricted zones, alerts, directives, and playback history
- Local Docker Compose stack for easy startup

## Project setup

The database is configured with the credentials below and is exposed through a local Postgres container.

- Database name: `warr_gaye`
- User: `postgres`
- Password: `NuxHH2OmMIcDlS5r`

## Run locally with Docker

From the repository root:

```bash
docker compose up --build
```

This starts three services:
- `db` on port `5432`
- `backend` on port `4000`
- `frontend` on port `5173`

Open the frontend at `http://localhost:5173`.

## Environment

The project uses a root `.env` file for local development. Example values are available in `.env.example`.

For Vercel, configure the project environment variables under Vercel dashboard instead of using `.env`.
Set these values for the frontend build and any hosted backend:

- `VITE_API_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` (if you deploy the backend or use Supabase Postgres directly)

## Supabase / database notes

This implementation currently runs against a PostgreSQL data layer. The backend expects a valid `DATABASE_URL` in the root `.env` file.

If you want to use hosted Supabase instead of the local Postgres container, you must provide these values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `DATABASE_URL` (Supabase PostgreSQL connection string) or update the backend to use Supabase client access.

In Docker mode, the frontend is also loaded with root `.env` variables, so `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are available in the React app if you add them to `.env`.

> Important: if your `.env` only contains `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, the backend will fail because it still needs a database connection string.

## Commands

### Build and run from Docker
```bash
docker compose up --build
```

### Backend only (if you want to develop without Docker)
```bash
cd server
npm install
npm start
```

### Frontend only (if you want to develop without Docker)
```bash
cd client
npm install
npm run dev -- --host
```

## What is implemented

- Live ship tracking for 15 ships with position, heading, fuel, cargo, destination, and status
- Realtime shared state using Socket.IO
- Command role with restricted zone creation and directive issuance
- Captain role with accept / escalate distress workflow
- Automated route planning that avoids restricted zones and uses weather impact in fuel
- Adverse weather penalties and alerts
- Proximity warnings when ships come within 2 km
- Playback snapshots every 30 seconds and event timeline support
