# TASK: Completely Update ARCHITECTURE.md for GitHub Mermaid Rendering

Project: AI-Based Transportation Management System  
Project Path: `E:\AI-Transportation-Management`

## OBJECTIVE

Update the existing `ARCHITECTURE.md` file with a new, accurate, professional System Architecture Diagram that GitHub can render directly.

The old architecture diagram is outdated. Audit the current source code first, then replace the old high-level architecture diagram with a new one reflecting the current implementation.

IMPORTANT: This task is ONLY for `ARCHITECTURE.md`. Do not modify application code or create unnecessary files.

## 1. AUDIT THE CURRENT CODEBASE

Inspect the current project before writing the diagram:

- `frontend/src/pages/`
- `backend/server.js`
- `backend/routes/`
- `backend/controllers/`
- `backend/services/`
- `backend/models/`
- Backend integrations and configuration.

Document only components that exist or can be verified from the source code.

Do not assume that old documentation accurately describes the current system.

## 2. REQUIRED ARCHITECTURE SECTIONS

Create one main diagram with these numbered sections:

### 1. Users
- Admin
- Student

### 2. Frontend — React + Vite
- Admin Dashboard
- User Management
- Vehicle Management
- Schedule Management
- Route Management and Map
- AI Agent — Inward and Outward Planning
- Admin Manual Plan
- Plan Confirmation
- Student Dashboard
- Excel Upload / Import
- Automation Interface, if implemented

### 3. Backend — Node.js + Express
- REST API
- Authentication and Authorization
- Controllers and API Routes
- User and Travel Status Management
- Vehicle and Schedule Management
- Route and Stop Management
- AI Agent Orchestration
- Plan Preview, Approval and Activation
- Student Bus Allocation
- Late-Response Lifecycle
- Excel Import Processing
- WhatsApp Integration, if confirmed in code

### 4. AI Route Optimization Engine
- Road-Aware Stop Grouping
- OSRM Road Distance and Travel-Time Matrix
- Clarke-Wright Savings and Candidate Search
- 2-Opt Stop-Sequence Optimization
- Route Rebalancing and Stop Relocation
- Vehicle Capacity and Availability Checks
- Route Continuity Validation
- Passenger Uniqueness and Allocation Validation
- Historical Route and Co-occurrence Scoring
- Deterministic Heuristic Optimization

### 5. Database — MongoDB
Include the models and data domains actually used:
- Users and Travel Status
- Vehicles
- Schedules
- Routes and Stops
- AI Plans and Manual Plans
- Late-Response Events
- Historical Routes
- Route Performance
- Road Matrix Cache
- Inward Starting Places
- Map Locations, if applicable

### 6. External and Supporting Services
- OpenStreetMap
- Nominatim Geocoding
- OSRM Routing
- Excel/XLSX Import
- WhatsApp Integration, if implemented
- n8n, only if an actual integration exists
- Trained ML Model, only if implemented and active

## 3. REQUIRED CONNECTIONS

Use correctly directed arrows to show:

Admin / Student → Frontend → REST API → Controllers and Services → MongoDB.

Show the AI planning flow:

Confirmed Coming Passengers → AI Recommendation or Admin Manual Plan → Preview and Review → Admin Approval → Plan Activation → Student Allocation.

Show the late-response flow:

Late Coming Response After Plan Approval → Late-Response Queue → Administrative Re-planning → Approval and Activation → Resolution.

Connect the optimization engine to road-routing services, historical data, and road-matrix caching wherever the code supports those connections.

Do not draw unsupported connections, duplicate arrows, or misleading relationships. Keep the diagram logically organized and readable.

## 4. GITHUB MERMAID REQUIREMENTS

The primary diagram MUST be written using GitHub-supported Mermaid syntax inside a fenced Markdown block:

\`\`\`mermaid
flowchart LR
    ...
\`\`\`

Use a clean `flowchart LR` layout with logical subgraphs and short component labels.

Requirements:
- Valid Mermaid syntax.
- Balanced brackets, parentheses, quotation marks and subgraphs.
- Every node has a unique identifier.
- All subgraphs are properly closed.
- No unsupported HTML or custom rendering dependencies.
- No external JavaScript, CSS, plugins or image paths required for the main diagram.
- Use Mermaid `classDef` and `class` only if supported by GitHub rendering.
- Keep text concise enough to avoid excessively large cards.
- Avoid self-referencing arrows and unnecessary crossing lines.
- Ensure the diagram renders when someone opens `ARCHITECTURE.md` on GitHub.

Use GitHub's standard Mermaid renderer. Do not assume GitHub will display a separately styled SVG/PNG automatically inside the Markdown.

## 5. VISUAL STYLE

Use the uploaded reference diagram as the design inspiration.

Aim for:
- A dark blue and white visual appearance where supported by Mermaid.
- A large, clear architecture heading.
- Six numbered architectural sections.
- Distinct component groups.
- Consistent labels and spacing.
- Clear directional arrows.
- A professional academic-project presentation style.

Do not sacrifice GitHub compatibility to imitate the reference image. Prioritize a diagram that renders reliably on GitHub.

## 6. UPDATE THE DOCUMENTATION

Replace the old high-level architecture diagram rather than appending a second competing architecture diagram.

Keep useful documentation, but revise outdated claims about:
- Active trained ML models.
- Optimization capabilities.
- Plan approval and activation.
- Late-response handling.
- Database collections and external integrations.

The current prediction service indicates deterministic heuristic optimization, with trained-model integration pending. Represent this accurately unless the current source code proves that this status has changed.

Keep the following sections after the main architecture diagram, updating them where necessary:
1. Core Architectural Principles
2. Plan Lifecycle
3. Late-Response Workflow
4. Optimization Approach
5. Database and Integration Overview

Remove obsolete descriptions that no longer match the code.

## 7. VALIDATION

Before finishing:

1. Verify every component against the current repository.
2. Verify Mermaid syntax and subgraph structure.
3. Ensure there is only one primary high-level System Architecture Diagram.
4. Check that the Markdown renders correctly in a compatible Mermaid preview.
5. Confirm that only `ARCHITECTURE.md` has been changed.
6. Summarize the changes and identify any features excluded because they could not be verified.

Do not modify React components, CSS, backend services, routes, controllers, database schemas, dependencies, or application behavior.

## FINAL RESULT

The updated `ARCHITECTURE.md` must contain a current, accurate and readable System Architecture Diagram that renders directly on the GitHub repository page.

Audit first, then update the Markdown file, validate the Mermaid syntax, and report completion.
