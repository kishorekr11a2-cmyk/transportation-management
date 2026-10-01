# TASK: Replace the Old System Architecture Diagram with an Updated Architecture

Project: AI-Based Transportation Management System

Project folder: `E:\AI-Transportation-Management`

## 1. AUDIT THE CURRENT PROJECT FIRST

Before changing anything, inspect the current frontend, backend, services, models, routes, and integrations. The existing architecture in `ARCHITECTURE.md` is outdated because the project has been updated.

Identify the components that are actually implemented. Do not assume that every component described in the old documentation is still present.

Inspect relevant files, including:
- `frontend/src/pages/`
- `backend/server.js`
- `backend/routes/`
- `backend/controllers/`
- `backend/services/`
- `backend/models/`
- Backend configuration and integration files.

## 2. REMOVE AND REPLACE THE OLD ARCHITECTURE DIAGRAM

In `ARCHITECTURE.md`, replace the existing **High-Level System Architecture** diagram with a new architecture diagram that accurately represents the current project.

Do not delete the entire Markdown file. Preserve and update useful documentation about the plan lifecycle, optimization approach, and data domains.

## 3. NEW ARCHITECTURE COMPONENTS

Organize the diagram into clearly numbered sections.

**1. USERS**
- Admin
- Student

**2. FRONTEND — React + Vite**
- Admin Dashboard
- User Management
- Vehicle Management
- Schedule Management
- Route Management and Map
- AI Agent — Inward and Outward Planning
- Admin Manual Plan
- Plan Confirmation
- Student Dashboard
- Excel Import / Upload
- Automation Interface, if implemented

**3. BACKEND API — Node.js + Express**
- REST API and Routes
- Authentication and Authorization
- Controllers
- User, Vehicle, Schedule, Route and Stop Management
- Travel Status and Demand Aggregation
- AI Agent Orchestration
- Plan Approval, Activation and Allocation
- Late-Response Lifecycle
- Excel Import Processing
- WhatsApp Integration, if confirmed by the current code

**4. AI ROUTE OPTIMIZATION ENGINE**
- Road-Aware Stop Grouping
- Road Distance and Travel-Time Matrix
- Clarke-Wright Savings and Route Candidate Search
- 2-Opt Stop-Sequence Optimization
- Route Rebalancing and Stop Relocation
- Vehicle Capacity and Availability Validation
- Route Continuity and Passenger Allocation Validation
- Historical Route and Co-occurrence Scoring
- Deterministic Heuristic Optimization

**5. DATABASE — MongoDB**
Include the data collections or models actually used, such as:
- Users and Travel Status
- Vehicles
- Schedules
- Routes and Stops
- AI Plans and Manual Plans
- Late-Response Events
- Historical Routes and Route Performance
- Road Matrix Cache
- Inward Starting Places
- Map Locations, where applicable

**6. EXTERNAL AND SUPPORTING SERVICES**
- OpenStreetMap for map display
- Nominatim for geocoding and place search
- OSRM for road distances, travel durations and route geometry
- Excel/XLSX import
- WhatsApp connectivity and QR pairing, if confirmed in the code
- n8n only if a working integration is present in the current project
- Trained ML model only if actually implemented and active

These are proposed diagram categories, not permission to invent functionality. Verify each item against the code before including it.

## 4. CONNECTIONS AND DATA FLOW

Show clear, correctly directed arrows representing the actual system:

Admin / Student → React Frontend → Express REST API → Controllers and Services → MongoDB.

Show the AI planning flow separately:

Confirmed Coming Passengers → AI Recommendation or Admin Manual Plan → Preview and Review → Admin Approval → Plan Activation → Student Bus Allocation.

Show that late Coming responses received after plan approval or activation enter the late-response workflow and require the supported administrative re-planning process.

Connect the optimization engine to OSRM, Nominatim, historical data and the road-matrix cache wherever the implementation supports those connections.

Distinguish read operations, write operations and external API calls where doing so improves clarity. Avoid unnecessary crossing arrows, duplicate connections and self-referencing loops.

## 5. VISUAL DESIGN

Use the uploaded architecture reference image as the design guide.

The final diagram should have:
- A dark royal-blue background.
- A large, centered, readable title: **AI-BASED TRANSPORTATION MANAGEMENT SYSTEM — ARCHITECTURE DIAGRAM**.
- White or light-colored component cards.
- Numbered section headers.
- Clear icons and concise labels.
- Frontend and backend as the main central columns.
- Users on the left.
- Database and external services on the right or lower section.
- Directional arrows with readable labels.
- Consistent spacing, alignment, font sizes and card dimensions.
- A professional academic-project presentation style.
- A landscape layout suitable for a final-year project report or presentation.

Do not simply put all components in one long Mermaid flowchart and consider the task complete. Create a polished, properly arranged architecture diagram.

## 6. OUTPUT FILES

Create or update the following:

1. `ARCHITECTURE.md` — updated architecture documentation and Mermaid source.
2. `docs/system-architecture.svg` — a polished, scalable architecture diagram matching the reference style, if feasible with the available tooling.
3. `docs/system-architecture.png` — a high-resolution export if the available tooling supports it.

If you create an SVG or PNG, ensure it is valid, readable and consistent with the Mermaid source and the actual codebase. Do not generate fake screenshots or placeholder diagrams.

## 7. STRICT SAFETY RULES

- Do not modify frontend application logic.
- Do not modify backend application logic.
- Do not modify database schemas, API behavior, optimization algorithms or authentication.
- Do not install unnecessary dependencies.
- Do not claim trained ML is active if the project currently uses heuristic scoring.
- Do not claim n8n integration is active unless the code confirms it.
- Preserve useful existing documentation outside the replaced architecture section.
- Do not delete project files unrelated to the documentation task.

## 8. VALIDATION AND FINAL REPORT

Before finishing:
- Verify that all components and connections match the current source code.
- Check that the Markdown and Mermaid syntax are valid.
- Check the SVG/PNG output if generated.
- Confirm that only intended documentation and diagram files were changed.
- Report the files created or updated and any components omitted because they were not implemented or could not be verified.

First audit, then implement the documentation and diagram updates. Do not change the application's working functionality.
