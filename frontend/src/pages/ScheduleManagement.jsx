import { useEffect, useState } from "react";
import axios from "axios";
import "../css/ScheduleManagement.css";

const API_URL = "http://localhost:5000/api";

const ScheduleManagement = () => {
    const [vehicles, setVehicles] = useState([]);
    const [schedules, setSchedules] = useState([]);

    const [vehicle, setVehicle] = useState("");
    const [date, setDate] = useState("");
    const [availability, setAvailability] =
        useState("Available");

    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");

    const getConfig = () => ({
        headers: {
            Authorization: `Bearer ${localStorage.getItem(
                "token"
            )}`
        }
    });

    const loadData = async () => {
        try {
            const [
                vehicleResponse,
                scheduleResponse
            ] = await Promise.all([
                axios.get(
                    `${API_URL}/vehicles`,
                    getConfig()
                ),
                axios.get(
                    `${API_URL}/schedules`,
                    getConfig()
                )
            ]);

            const vehicleData =
                vehicleResponse.data.vehicles ||
                vehicleResponse.data.data ||
                [];

            setVehicles(vehicleData);

            setSchedules(
                scheduleResponse.data.schedules ||
                []
            );
        } catch (error) {
            console.error(
                "Load Scheduling Error:",
                error
            );

            setMessage(
                error.response?.data?.message ||
                "Unable to load scheduling data."
            );
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!vehicle || !date) {
            setMessage(
                "Please select a bus and date."
            );
            return;
        }

        try {
            setLoading(true);
            setMessage("");

            await axios.post(
                `${API_URL}/schedules`,
                {
                    vehicle,
                    date,
                    availability
                },
                getConfig()
            );

            setMessage(
                "Bus availability saved successfully."
            );

            await loadData();
        } catch (error) {
            console.error(
                "Save Schedule Error:",
                error
            );

            setMessage(
                error.response?.data?.message ||
                "Unable to save bus availability."
            );
        } finally {
            setLoading(false);
        }
    };

    const setBusAvailability = async (
        schedule,
        newAvailability
    ) => {
        if (
            schedule.availability ===
            newAvailability
        ) {
            return;
        }

        try {
            setMessage("");

            await axios.put(
                `${API_URL}/schedules/${schedule._id}`,
                {
                    vehicle:
                        schedule.vehicle?._id,
                    date:
                        schedule.date,
                    availability:
                        newAvailability
                },
                getConfig()
            );

            await loadData();
        } catch (error) {
            console.error(
                "Update Availability Error:",
                error
            );

            setMessage(
                error.response?.data?.message ||
                "Unable to update availability."
            );
        }
    };

    const deleteSchedule = async (
        scheduleId
    ) => {
        try {
            await axios.delete(
                `${API_URL}/schedules/${scheduleId}`,
                getConfig()
            );

            await loadData();
        } catch (error) {
            console.error(
                "Delete Schedule Error:",
                error
            );

            setMessage(
                error.response?.data?.message ||
                "Unable to delete availability."
            );
        }
    };

    return (
        <div className="schedule-management">

            <div className="schedule-header">
                <h2>Bus Availability</h2>

                <p>
                    Set the availability of each
                    bus for a particular date.
                </p>
            </div>

            <form
                className="schedule-form"
                onSubmit={handleSubmit}
            >
                <div className="form-group">
                    <label>Bus</label>

                    <select
                        value={vehicle}
                        onChange={(e) =>
                            setVehicle(
                                e.target.value
                            )
                        }
                    >
                        <option value="">
                            Select Bus
                        </option>

                        {vehicles.map(
                            (item) => (
                                <option
                                    key={item._id}
                                    value={item._id}
                                >
                                    {item.vehicleName}
                                    {" - "}
                                    {item.capacity}
                                    {" seats"}
                                </option>
                            )
                        )}
                    </select>
                </div>

                <div className="form-group">
                    <label>Date</label>

                    <input
                        type="date"
                        value={date}
                        onChange={(e) =>
                            setDate(
                                e.target.value
                            )
                        }
                    />
                </div>

                <div className="form-group">
                    <label>
                        Availability
                    </label>

                    <select
                        value={availability}
                        onChange={(e) =>
                            setAvailability(
                                e.target.value
                            )
                        }
                    >
                        <option value="Available">
                            Available
                        </option>

                        <option value="Not Available">
                            Not Available
                        </option>
                    </select>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                >
                    {loading
                        ? "Saving..."
                        : "Save"}
                </button>
            </form>

            {message && (
                <div className="schedule-message">
                    {message}
                </div>
            )}

            <div className="schedule-list">

                <h3>Bus Availability</h3>

                {schedules.length === 0 ? (
                    <p className="empty-state">
                        No availability records yet.
                    </p>
                ) : (
                    <div className="schedule-table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Bus</th>
                                    <th>Capacity</th>
                                    <th>Date</th>
                                    <th>Availability</th>
                                    <th>Change</th>
                                    <th>Action</th>
                                </tr>
                            </thead>

                            <tbody>
                                {schedules.map(
                                    (schedule) => (
                                        <tr
                                            key={
                                                schedule._id
                                            }
                                        >
                                            <td>
                                                {
                                                    schedule
                                                        .vehicle
                                                        ?.vehicleName
                                                }
                                            </td>

                                            <td>
                                                {
                                                    schedule
                                                        .vehicle
                                                        ?.capacity
                                                }
                                            </td>

                                            <td>
                                                {new Date(
                                                    schedule.date
                                                ).toLocaleDateString(
                                                    "en-IN"
                                                )}
                                            </td>

                                            <td>
                                                <span
                                                    className={
                                                        schedule.availability ===
                                                        "Available"
                                                            ? "availability available"
                                                            : "availability unavailable"
                                                    }
                                                >
                                                    {
                                                        schedule.availability
                                                    }
                                                </span>
                                            </td>

                                            <td>
                                                <button
                                                    type="button"
                                                    className="available-button"
                                                    disabled={
                                                        schedule.availability ===
                                                        "Available"
                                                    }
                                                    onClick={() =>
                                                        setBusAvailability(
                                                            schedule,
                                                            "Available"
                                                        )
                                                    }
                                                >
                                                    Available
                                                </button>

                                                <button
                                                    type="button"
                                                    className="unavailable-button"
                                                    disabled={
                                                        schedule.availability ===
                                                        "Not Available"
                                                    }
                                                    onClick={() =>
                                                        setBusAvailability(
                                                            schedule,
                                                            "Not Available"
                                                        )
                                                    }
                                                >
                                                    Not Available
                                                </button>
                                            </td>

                                            <td>
                                                <button
                                                    type="button"
                                                    className="delete-button"
                                                    onClick={() =>
                                                        deleteSchedule(
                                                            schedule._id
                                                        )
                                                    }
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ScheduleManagement;