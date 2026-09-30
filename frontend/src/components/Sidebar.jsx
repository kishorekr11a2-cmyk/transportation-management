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

            <Link to="/admin/inward-starting-places">
                Inward Starting Places
            </Link>

            <Link to="/ai-agent">
                AI Agent
            </Link>

            <Link to="/admin/plan-confirmation">
                Plan Confirmation
            </Link>

            <Link to="/admin/automation">
                Automation
            </Link>

        </div>

    );

}

export default Sidebar;