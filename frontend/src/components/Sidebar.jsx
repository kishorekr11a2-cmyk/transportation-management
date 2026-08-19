import { Link } from "react-router-dom";

import "../css/sidebar.css";

function Sidebar() {

    return (

        <div className="sidebar">

            <h2>AI Transport</h2>

            <Link to="/admin-dashboard">
                Dashboard
            </Link>

            <Link to="/users">
                User Management
            </Link>

            <Link to="/vehicles">
                Vehicle Management
            </Link>

            <Link to="/routes">
                Route Management
            </Link>

            <Link to="/schedule">
                Schedule Management
            </Link>
            <Link to="/ai-agent">
    AI Agent
</Link>

        </div>

    );

}

export default Sidebar;