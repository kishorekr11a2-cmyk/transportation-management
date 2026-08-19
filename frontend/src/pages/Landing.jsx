import { useNavigate } from "react-router-dom";
import "../css/landing.css";

function Landing() {

    const navigate = useNavigate();

    return (
        <div className="landing">

            <div className="overlay"></div>

            <div className="landing-container">

                <h1>
                    AI-Based Transportation
                    <span> Management System</span>
                </h1>

                <p>
                    Smart • Secure • Intelligent Transportation Management
                </p>

                <div className="button-group">

                    <button
                        className="admin-btn"
                        onClick={() => navigate("/admin-login")}
                    >
                        Admin Login
                    </button>
                           
                    <button
                        className="student-btn"
                        onClick={() => navigate("/student-login")}
                    >
                        User Login
                    </button>

                </div>

            </div>

        </div>
    );
}

export default Landing;