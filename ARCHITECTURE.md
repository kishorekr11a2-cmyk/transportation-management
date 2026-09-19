# AI-Based Transportation Management System — Hybrid Optimization Architecture

A production-grade, multi-tier transportation management and routing platform designed for institutions, universities, schools, and corporate campuses of arbitrary scale.

---

## 1. High-Level System Architecture

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Layer (React + Vite)"]
        UI_Admin["Admin Operations Dashboard"]
        UI_Student["Student / Passenger Portal"]
        UI_AIAgent["AI Optimization & Plan Management"]
        UI_Expl["Explainable AI Metrics & Route Diagnostics"]
    end

    subgraph APILayer ["API & Business Logic Layer (Node.js / Express)"]
        AUTH["JWT Authentication & RBAC"]
        CTRL["REST Controllers & Routes"]
        AIAgent["AI Agent Orchestrator (aiAgentService)"]
        Demand["Demand Aggregation & Travel Status Engine"]
        LateResp["Late-Response Lifecycle Controller"]
    end

    subgraph OptimizationEngine ["Hybrid AI Optimization Engine"]
        GeoCache["Geocoding & Matrix Cache (Nominatim + MongoDB RoadMatrixCache)"]
        OSRM_Client["OSRM Engine (Table API + Route API)"]
        CW_Opt["Combinatorial Optimizer (Clarke-Wright Savings + 2-Opt)"]
        Cluster["Capacity-Aware Spatial & Co-occurrence Clustering"]
        ML_Scoring["Tabular ML Route & Stop Compatibility Predictor"]
        DeterministicVal["Deterministic Validation Layer (Zero-Loss / Strict Capacity)"]
    end

    subgraph DataPipeline ["Historical & ML Training Pipeline (Python + Node.js)"]
        Hist_Store["Historical Route Repository (HistoricalRoute Model)"]
        Perf_Telemetry["Plan Performance Telemetry (RoutePerformance Model)"]
        ETL["Training Data Preprocessor (prepare_dataset.py)"]
        Model_Train["Baseline ML Model Trainer (train_model.py)"]
        Model_Weights["Exported Weights (route_quality_model.json)"]
    end

    subgraph StorageLayer ["Persistence Layer (MongoDB Atlas)"]
        DB_Users[("Users / Passengers")]
        DB_Vehicles[("Vehicles & Capacity")]
        DB_Schedules[("Schedules & Constraints")]
        DB_Plans[("AI Plans & Manual Plans")]
        DB_LateEvents[("LateResponseEvents")]
        DB_HistRoutes[("Historical Routes")]
        DB_MatrixCache[("RoadMatrixCache")]
        DB_Perf[("RoutePerformance")]
    end

    %% Client to API
    UI_Admin --> CTRL
    UI_Student --> CTRL
    UI_AIAgent --> CTRL
    CTRL --> AUTH
    CTRL --> AIAgent
    CTRL --> Demand

    %% API to Optimization
    AIAgent --> Cluster
    Cluster --> CW_Opt
    CW_Opt --> ML_Scoring
    CW_Opt --> CW_Opt
    Cluster --> GeoCache
    GeoCache --> OSRM_Client
    CW_Opt --> DeterministicVal
    DeterministicVal --> AIAgent

    %% Late Response Workflow
    Demand --> LateResp
    LateResp --> DB_LateEvents

    %% Persistence
    CTRL --> DB_Users
    CTRL --> DB_Vehicles
    CTRL --> DB_Schedules
    AIAgent --> DB_Plans
    GeoCache --> DB_MatrixCache
    AIAgent --> DB_Perf

    %% ML Pipeline & Telemetry
    AIAgent -.-> Perf_Telemetry
    Perf_Telemetry --> Hist_Store
    Hist_Store --> DB_HistRoutes
    Hist_Store --> ETL
    ETL --> Model_Train
    Model_Train --> Model_Weights
    Model_Weights -.-> ML_Scoring
```

---

## 2. Core Architectural Principles

The architecture follows a strict hierarchy of authority:

```
+-------------------------------------------------------------+
|                      HUMAN AUTHORITY                        |
|   Admin Reviews, Approves, and Activates Transportation     |
+-------------------------------------------------------------+
                              |
+-------------------------------------------------------------+
|                 DETERMINISTIC SAFETY LAYER                  |
|   Zero passenger loss; strict vehicle capacity enforcement; |
|   passenger uniqueness; schedule availability checking.      |
+-------------------------------------------------------------+
                              |
+-------------------------------------------------------------+
|                    ROAD NETWORK VERIFIER                    |
|   OSRM Table API (real travel time/distance matrices) &     |
|   OSRM Route API (true road geometry and turn-by-turn).     |
+-------------------------------------------------------------+
                              |
+-------------------------------------------------------------+
|                  COMBINATORIAL SEARCH & DSA                 |
|   Clarke-Wright Savings; Min-Heap Priority Queue;           |
|   Capacity-Aware Greedy Clustering; 2-Opt Local Search.     |
+-------------------------------------------------------------+
                              |
+-------------------------------------------------------------+
|                     MACHINE LEARNING                        |
|   Tabular scoring advisor: Stop Compatibility, Route        |
|   Quality, Vehicle Suitability (never overrides road laws).  |
+-------------------------------------------------------------+
```

---

## 3. Detailed Component Lifecycles

### A. AI Plan vs Manual Plan Lifecycle
1. **Demand Snapshot**: Student travel status is aggregated (`Coming`, `Not Coming`, `Pending`). Only confirmed `Coming` passengers are routed.
2. **Recommendation Generation (Dry-Run)**: The engine clusters stops, queries OSRM (with MongoDB caching), calculates Clarke-Wright savings, scores candidates with ML, and applies 2-opt search. No database records are modified during preview.
3. **Admin Review & Approval**: The plan is saved as `DRAFT`, then transitioned to `APPROVED`.
4. **Plan Activation**: Upon activation, students are assigned their bus details, and a telemetry record is automatically written to `RoutePerformance` and `HistoricalRoute` to continuously expand training data.

### B. Late-Response Isolation Workflow
```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant System as Travel Status Controller
    participant DB as MongoDB (LateResponseEvent)
    actor Admin
    participant Engine as AI Route Optimization Engine

    Student->>System: Updates status to "Coming" (AFTER plan approved/active)
    System->>DB: Log LateResponseEvent (status: PENDING)
    System-->>Student: Confirm received; status: UNALLOCATED / WAITING
    Note over Student,System: Student is NOT automatically inserted into active route
    Admin->>System: Inspects Unallocated / Late-Response Queue
    Admin->>Engine: Requests Route Regeneration or Manual Allocation
    Engine-->>Admin: Proposes Revised Plan with Capacity Checks
    Admin->>System: Approves & Activates Updated Plan
    System->>DB: Mark LateResponseEvent as RESOLVED
    System-->>Student: Bus Allocation Confirmed
```

---

## 4. Multi-Tier ML Fallback Hierarchy

To guarantee reliability across organizations of all sizes (from single school startups to multi-campus universities):

1. **Tier 1 (Trained ML Model)**: Used when `>= 10` validated historical routes exist. Scores candidate routes and stop co-occurrence affinities using weights learned from actual institutional trips.
2. **Tier 2 (Historical Co-occurrence Graph)**: When formal models are training, candidate stops are scored based on empirical Jaccard similarity and co-occurrence frequency in past schedules.
3. **Tier 3 (Pure Deterministic Optimization)**: When cold-starting with zero historical data, the engine gracefully falls back to classical Clarke-Wright savings, nearest insertion, spatial Euclidean/OSRM heuristics, and 2-opt refinement.

---

## 5. Algorithmic Specifications

| Component | Algorithm / Structure | Purpose |
| :--- | :--- | :--- |
| **Savings Queue** | Binary Min-Heap (`PriorityQueue`) | $O(\log K)$ extraction of top Clarke-Wright savings candidates |
| **Stop Clustering** | Capacity-Constrained Greedy Clustering | Prevents cluster overflow before routing commences |
| **Route Generation** | Clarke-Wright Savings with ML Blending | Merges radial trips based on road savings $\times$ ML affinity |
| **Stop Sequencing** | 2-Opt Local Search | Uncrosses paths and minimizes total road distance/time |
| **Matrix Caching** | Two-Tier Cache (In-Memory + MongoDB TTL) | Eliminates redundant OSRM network calls for recurring stops |
| **Telemetry Recording** | Automated Event Listener | Records planned vs. actual operational metrics upon plan activation |
