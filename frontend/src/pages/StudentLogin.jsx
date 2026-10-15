import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { HiArrowLeft } from "react-icons/hi2";
import { MdDirectionsBus } from "react-icons/md";

import api from "../services/api";
import "../css/login.css";

function StudentLogin() {
    const navigate = useNavigate();

    const [formData, setFormData] = useState({
        userId: "",
        password: ""
    });

    const [loading, setLoading] = useState(false);

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        try {
            setLoading(true);

            const response = await api.post(
                "/auth/student/login",
                formData
            );

            // Save token in tab-isolated sessionStorage
            try {
                sessionStorage.setItem("token", response.data.token);
                sessionStorage.setItem("user", JSON.stringify(response.data.user));
                sessionStorage.setItem("role", "student");
            } catch (e) {}

            // Save in localStorage with student prefix and standard keys
            localStorage.setItem("student_token", response.data.token);
            localStorage.setItem("student_user", JSON.stringify(response.data.user));
            localStorage.setItem("token", response.data.token);
            localStorage.setItem("user", JSON.stringify(response.data.user));
            localStorage.setItem("userId", response.data.user.userId);

            toast.success("Login Successful");
            navigate("/student-dashboard");
        } catch (error) {
            console.error(error.response);
            toast.error(
                error.response?.data?.message || "Login Failed"
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="login-page">
            <button
                type="button"
                className="back-btn"
                onClick={() => navigate(-1)}
                aria-label="Go back"
            >
                <HiArrowLeft size={16} aria-hidden="true" />
                <span>Back</span>
            </button>

            <div className="login-split-card">
                {/* Left Showcase Panel */}
                <div className="login-visual-panel login-visual-panel--student">
                    <div className="login-visual-top">
                        <div className="login-visual-badge">
                            <MdDirectionsBus aria-hidden="true" />
                            <span>Passenger Transit</span>
                        </div>
                    </div>

                    <div className="login-visual-bottom">
                        <h2 className="login-visual-title">Passenger Transit Access</h2>
                        <p className="login-visual-desc">
                            Submit your daily travel confirmation, check your allocated bus number, and view designated pickup stops.
                        </p>
                    </div>
                </div>

                {/* Right Form Panel */}
                <div className="login-form-panel">
                    <div className="login-form-topbar">
                        <span className="login-portal-label">User Access</span>
                    </div>

                    <div className="login-form-header">
                        <h1>User Login</h1>
                        <p>AI Transportation Management System</p>
                    </div>

                    <form className="login-form" onSubmit={handleSubmit}>
                        <div className="login-field-group">
                            <label htmlFor="student-userId" className="login-field-label">
                                User ID
                            </label>
                            <input
                                id="student-userId"
                                type="text"
                                name="userId"
                                placeholder="User ID"
                                value={formData.userId}
                                onChange={handleChange}
                                autoComplete="username"
                                required
                            />
                        </div>

                        <div className="login-field-group">
                            <label htmlFor="student-password" className="login-field-label">
                                Password
                            </label>
                            <input
                                id="student-password"
                                type="password"
                                name="password"
                                placeholder="Password"
                                value={formData.password}
                                onChange={handleChange}
                                autoComplete="current-password"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            className="student-submit-btn"
                            disabled={loading}
                            id="btn-student-submit"
                        >
                            {loading ? "Please Wait..." : "Login"}
                        </button>
                    </form>

                    <div className="login-form-footer">
                        Registered student and staff passenger credentials
                    </div>
                </div>
            </div>
        </main>
    );
}

export default StudentLogin;