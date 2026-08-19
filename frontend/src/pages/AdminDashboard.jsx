import React from "react";
import { Link } from "react-router-dom";
import "../css/AdminDashboard.css";


const AdminDashboard = () => {
  return (
    
    <div className="admin-dashboard">
      <button className="back-btn" onClick={() => window.history.back()}>
        ← Back
      </button>
      <h1>Admin Dashboard</h1>
      <p className="dashboard-subtitle">
        Manage college bus transportation system
      </p>

      <div className="dashboard-cards">

<Link to="/users" className="dashboard-card">       
   <h2>👨‍🎓 Users</h2>
          <p>
            Manage students, drivers and admin users.
          </p>
        </Link>


        <Link to="/vehicles" className="dashboard-card">
          <h2>🚌 Vehicles</h2>
          <p>
            Add, update and monitor buses.
          </p>
        </Link>


        <Link to="/routes" className="dashboard-card">
          <h2>🛣 Routes</h2>
          <p>
            Manage bus routes and stops.
          </p>
        </Link>


        <Link to="/schedule" className="dashboard-card">
          <h2>📅 Schedule</h2>
          <p>
            Create and manage bus timings.
          </p>
        </Link>
        <Link to="/excel-upload" className="dashboard-card">
    <h2>📄 Excel Upload</h2>
    <p>
        Upload student Excel file into MongoDB.
    </p>
</Link>
<Link to="/ai-agent" className="dashboard-card">
    <h2>🤖 AI Agent</h2>
    <p>Analyze users, vehicles, routes and schedules.</p>
</Link>


      </div>

    </div>
  );
};

export default AdminDashboard;