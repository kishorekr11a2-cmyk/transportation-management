import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { HiArrowLeft } from "react-icons/hi2";
import { MdDirectionsBus, MdAdminPanelSettings } from "react-icons/md";

import api from "../services/api";
import "../css/login.css";

function AdminLogin() {
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

            // Correct backend route
            const response = await api.post(
                "/auth/admin/login",
                formData
            );

            console.log(response.data);

            // Save token in tab-isolated sessionStorage
            try {
                sessionStorage.setItem("token", response.data.token);
                sessionStorage.setItem("user", JSON.stringify(response.data.user));
                sessionStorage.setItem("role", "admin");
            } catch (e) {}

            // Save in localStorage with admin prefix and standard keys
            localStorage.setItem("admin_token", response.data.token);
            localStorage.setItem("admin_user", JSON.stringify(response.data.user));
            localStorage.setItem("token", response.data.token);
            localStorage.setItem("user", JSON.stringify(response.data.user));

            toast.success("Login Successful");

            if (response.data.user.role === "admin") {
                navigate("/admin-dashboard");
            } else {
                toast.error("You are not an Admin");
                try {
                    sessionStorage.removeItem("token");
                    sessionStorage.removeItem("user");
                } catch (e) {}
                localStorage.removeItem("token");
                localStorage.removeItem("user");
                localStorage.removeItem("admin_token");
                localStorage.removeItem("admin_user");
            }
        } catch (error) {
            console.error(error);
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
                <div className="login-visual-panel login-visual-panel--admin">
                    <div className="login-visual-top">
                        <div className="login-visual-badge">
                            <MdDirectionsBus aria-hidden="true" />
                            <span>Fleet Operations</span>
                        </div>
                    </div>

                    <div className="login-visual-bottom">
                        <h2 className="login-visual-title">Transportation Fleet Operations</h2>
                        <p className="login-visual-desc">
                            Coordinate vehicles, manage daily route schedules, and review passenger transit allocations.
                        </p>
                    </div>
                </div>

                {/* Right Form Panel */}
                <div className="login-form-panel">
                    <div className="login-form-topbar">
                        <span className="login-portal-label">Admin Access</span>
                    </div>

                    <div className="login-form-header">
                        <h1>Admin Login</h1>
                        <p>AI Transportation Management System</p>
                    </div>

                    <form className="login-form" onSubmit={handleSubmit}>
                        <div className="login-field-group">
                            <label htmlFor="admin-userId" className="login-field-label">
                                Admin ID
                            </label>
                            <input
                                id="admin-userId"
                                type="text"
                                name="userId"
                                placeholder="Admin ID"
                                value={formData.userId}
                                onChange={handleChange}
                                autoComplete="username"
                                required
                            />
                        </div>

                        <div className="login-field-group">
                            <label htmlFor="admin-password" className="login-field-label">
                                Password
                            </label>
                            <input
                                id="admin-password"
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
                            disabled={loading}
                            id="btn-admin-submit"
                        >
                            {loading ? "Please Wait..." : "Login"}
                        </button>
                    </form>

                    <div className="login-form-footer">
                        Authorized administrator credentials only
                    </div>
                </div>
            </div>
        </main>
    );
}

export default AdminLogin;