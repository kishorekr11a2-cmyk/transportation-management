import React, { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import api from "../services/api";
import "../css/StudentDashboard.css";

const StudentDashboard = () => {
    const [student, setStudent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);

    const loadStudentData = async () => {
        try {
            setLoading(true);

            const response = await api.get("/users/me");

            if (response.data.success) {
                setStudent(response.data.user);
            }
        } catch (error) {
            console.error("Load Student Error:", error);

            toast.error(
                error.response?.data?.message ||
                "Failed to load user information"
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadStudentData();
    }, []);

    const handleTravelStatus = async (status) => {
        try {
            setUpdating(true);

            const response = await api.put(
                "/users/travel-status",
                {
                    travelStatus: status
                }
            );

            if (response.data.success) {
                setStudent((previous) => ({
                    ...previous,
                    travelStatus: response.data.travelStatus
                }));

                const storedUser = JSON.parse(
                    localStorage.getItem("user")
                );

                if (storedUser) {
                    storedUser.travelStatus =
                        response.data.travelStatus;

                    localStorage.setItem(
                        "user",
                        JSON.stringify(storedUser)
                    );
                }

                toast.success(response.data.message);
            }
        } catch (error) {
            console.error("Travel Status Error:", error);

            toast.error(
                error.response?.data?.message ||
                "Failed to update travel status"
            );
        } finally {
            setUpdating(false);
        }
    };

    if (loading) {
        return (
            <div className="student-dashboard">
                <h2>Loading...</h2>
            </div>
        );
    }

    if (!student) {
        return (
            <div className="student-dashboard">
                <h2>Unable to load user information</h2>
            </div>
        );
    }

    return (
        <div className="student-dashboard">

            <h1>Welcome, {student.name}</h1>

            <div className="student-cards">

                <div className="student-card">
                    <h2>User Information</h2>

                    <p>
                        <strong>User ID:</strong>{" "}
                        {student.userId}
                    </p>

                    <p>
                        <strong>Stopping:</strong>{" "}
                        {student.stoppings || "Not assigned"}
                    </p>
                </div>

                <div className="student-card">

                    <h2>Travel Status</h2>

                    <p>
                        <strong>Current Status:</strong>{" "}
                        {student.travelStatus || "Pending"}
                    </p>

                    {/* Buttons show ONLY when status is Pending */}

                    {student.travelStatus === "Pending" && (
                        <div className="travel-buttons">

                            <button
                                type="button"
                                className="primary-btn"
                                onClick={() =>
                                    handleTravelStatus("Coming")
                                }
                                disabled={updating}
                            >
                                {updating
                                    ? "Updating..."
                                    : "I am Coming"}
                            </button>

                            <button
                                type="button"
                                className="primary-btn"
                                onClick={() =>
                                    handleTravelStatus("Not Coming")
                                }
                                disabled={updating}
                            >
                                {updating
                                    ? "Updating..."
                                    : "I am Not Coming"}
                            </button>

                        </div>
                    )}

                    {/* After user selects Coming */}

                    {student.travelStatus === "Coming" && (
                        <p className="status-message">
                            You have confirmed that you are coming.
                        </p>
                    )}

                    {/* After user selects Not Coming */}

                    {student.travelStatus === "Not Coming" && (
                        <p className="status-message">
                            You have confirmed that you are not coming.
                        </p>
                    )}

                </div>

                <div className="student-card">

                    <h2>Bus Information</h2>

                    <p>
                        Bus allocation will appear here after
                        confirmation and admin approval.
                    </p>

                </div>

            </div>

        </div>
    );
};

export default StudentDashboard;