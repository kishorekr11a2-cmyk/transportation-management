IT IS UNDER DEVELOPMENT OF A TRANSPORTATION MANAGEMENT SYSTEM WITH AI , IN WHICH THE COLLEGE,SCHOOL,UNIVERSITY, OR ANY OTHER INSTUTION USING A TRANSPORATION 
CAN ACCOMEND WITH THIS WEBPAGE FOR THE USER AND THE ADMIN



```mermaid
flowchart TD

    Admin[Admin]
    Student[Student]

    Frontend[React Frontend]

    UserManagement[User Management]
    Vehicle[Vehicle Management]
    Route[Route Management]
    Schedule[Schedule Management]
    AIAgent[AI Agent]
    Reports[Reports]

    API[Express REST API]

    Controllers[Controllers]
    Services[Business Logic / Services]

    MongoDB[(MongoDB Atlas)]

    OSRM[OSRM Routing API]
    Nominatim[Nominatim Geocoding]
    Excel[Excel Dataset]
    N8N[n8n Automation]

    Admin --> Frontend
    Student --> Frontend

    Frontend --> UserManagement
    Frontend --> Vehicle
    Frontend --> Route
    Frontend --> Schedule
    Frontend --> AIAgent
    Frontend --> Reports

    UserManagement --> API
    Vehicle --> API
    Route --> API
    Schedule --> API
    AIAgent --> API
    Reports --> API

    API --> Controllers
    Controllers --> Services
    Services --> MongoDB

    Services --> OSRM
    Services --> Nominatim
    Services --> Excel
    Services --> N8N
```
