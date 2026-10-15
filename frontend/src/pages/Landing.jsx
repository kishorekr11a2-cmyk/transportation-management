import { useNavigate } from "react-router-dom";
import {
    MdDirectionsBus,
    MdAdminPanelSettings,
    MdPerson,
    MdArrowForward,
    MdCheck
} from "react-icons/md";
import "../css/landing.css";

function Landing() {
    const navigate = useNavigate();

    return (
        <main className="landing">
            <div className="landing-content">
                {/* Institutional Header Section */}
                <header className="landing-header">
                    <div className="landing-badge">
                        <span className="landing-badge__icon" aria-hidden="true">
                            <MdDirectionsBus />
                        </span>
                        <span>Institutional Transportation Portal</span>
                    </div>

                    <h1 className="landing-title">
                        AI-Based Transportation
                        <span> Management System</span>
                    </h1>

                    <p className="landing-subtitle">
                        Smart • Secure • Intelligent Transportation Management
                    </p>

                    <p className="landing-desc">
                        Centralized transportation access and management portal for college bus operations, fleet coordination, and passenger travel access.
                    </p>
                </header>

                {/* Role Selection Section */}
                <section className="landing-roles-section">
                    <div className="landing-roles-grid">
                    {/* Administrator Role Card */}
                    <div className="landing-role-card landing-role-card--admin">
                        <div className="landing-role-header-accent" />
                        <div className="landing-role-body">
                            <div className="landing-role-meta">
                                <span className="landing-role-tag">Operations Management</span>
                                <div className="landing-role-icon" aria-hidden="true">
                                    <MdAdminPanelSettings />
                                </div>
                            </div>

                            <h2 className="landing-role-title">Administrator Portal</h2>
                            <p className="landing-role-desc">
                                Manage vehicles and daily schedules, run AI route optimization, and review travel allocations.
                            </p>

                            <ul className="landing-capabilities-list" aria-label="Administrator capabilities">
                                <li className="landing-capability-item">
                                    <MdCheck size={16} aria-hidden="true" />
                                    <span>Fleet capacity &amp; schedule management</span>
                                </li>
                                <li className="landing-capability-item">
                                    <MdCheck size={16} aria-hidden="true" />
                                    <span>AI route optimization &amp; stop planning</span>
                                </li>
                                <li className="landing-capability-item">
                                    <MdCheck size={16} aria-hidden="true" />
                                    <span>Plan approval, confirmation &amp; automation</span>
                                </li>
                            </ul>

                            <button
                                type="button"
                                className="landing-action-btn admin-btn"
                                onClick={() => navigate("/admin-login")}
                                id="btn-admin-login"
                            >
                                <span>Admin Login</span>
                                <MdArrowForward size={16} aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    {/* User / Student Role Card */}
                    <div className="landing-role-card landing-role-card--user">
                        <div className="landing-role-header-accent" />
                        <div className="landing-role-body">
                            <div className="landing-role-meta">
                                <span className="landing-role-tag">Passenger Portal</span>
                                <div className="landing-role-icon" aria-hidden="true">
                                    <MdPerson />
                                </div>
                            </div>

                            <h2 className="landing-role-title">User Portal</h2>
                            <p className="landing-role-desc">
                                Confirm daily attendance, view your assigned bus number, route code, and designated stop.
                            </p>

                            <ul className="landing-capabilities-list" aria-label="User capabilities">
                                <li className="landing-capability-item">
                                    <MdCheck size={16} aria-hidden="true" />
                                    <span>Daily Coming / Not Coming status response</span>
                                </li>
                                <li className="landing-capability-item">
                                    <MdCheck size={16} aria-hidden="true" />
                                    <span>Assigned vehicle name &amp; route allocation</span>
                                </li>
                                <li className="landing-capability-item">
                                    <MdCheck size={16} aria-hidden="true" />
                                    <span>Designated boarding stop &amp; pickup order</span>
                                </li>
                            </ul>

                            <button
                                type="button"
                                className="landing-action-btn student-btn"
                                onClick={() => navigate("/student-login")}
                                id="btn-student-login"
                            >
                                <span>User Login</span>
                                <MdArrowForward size={16} aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <footer className="landing-footer">
                <span>AI-Based Transportation Management System</span>
                <span>Institutional Transit Operations</span>
            </footer>
        </main>
    );
}

export default Landing;