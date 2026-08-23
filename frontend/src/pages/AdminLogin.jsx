import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";

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

            // ✅ Correct backend route
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

        <div className="login-page">

            <button className="back-btn" onClick={() => navigate(-1)}>
                ← Back
            </button>

            <div className="login-card">

                <h1>Admin Login</h1>

                <p>AI Transportation Management System</p>

                <form onSubmit={handleSubmit}>

                    <input
                        type="text"
                        name="userId"
                        placeholder="Admin ID"
                        value={formData.userId}
                        onChange={handleChange}
                        required
                    />

                    <input
                        type="password"
                        name="password"
                        placeholder="Password"
                        value={formData.password}
                        onChange={handleChange}
                        required
                    />

                    <button
                        type="submit"
                        disabled={loading}
                    >
                        {
                            loading
                                ? "Please Wait..."
                                : "Login"
                        }
                    </button>

                </form>

            </div>

        </div>

    );

}

export default AdminLogin;