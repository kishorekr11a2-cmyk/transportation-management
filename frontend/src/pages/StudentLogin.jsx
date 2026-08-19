import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";

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

            // Save token
            localStorage.setItem(
                "token",
                response.data.token
            );

            // Save complete user object
            localStorage.setItem(
                "user",
                JSON.stringify(response.data.user)
            );

            // Save userId separately (used in StudentDashboard)
            localStorage.setItem(
                "userId",
                response.data.user.userId
            );

            toast.success("Login Successful");

            setTimeout(() => {
                navigate("/student-dashboard");
            }, 800);

        } catch (error) {

            console.log(error.response);

            toast.error(
                error.response?.data?.message ||
                "Login Failed"
            );

        } finally {

            setLoading(false);

        }

    };

    return (

        <div className="login-page">

            <button
                className="back-btn"
                onClick={() => navigate(-1)}
            >
                ← Back
            </button>

            <div className="login-card">

                <h1>User Login</h1>

                <p>AI Transportation Management System</p>

                <form onSubmit={handleSubmit}>

                    <input
                        type="text"
                        name="userId"
                        placeholder="User ID"
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
                        {loading ? "Please Wait..." : "Login"}
                    </button>

                </form>

            </div>

        </div>

    );

}

export default StudentLogin;