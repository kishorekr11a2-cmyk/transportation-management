import {
    useEffect,
    useState
} from "react";

import { useNavigate } from "react-router-dom";

import { toast } from "react-hot-toast";

import api from "../services/api";

import "../css/userManagement.css";


function UserManagement() {

    const navigate = useNavigate();


    const [users, setUsers] =
        useState([]);

    const [loading, setLoading] =
        useState(true);


    // ===============================
    // Fetch Users
    // ===============================

    const fetchUsers = async () => {

        try {

            setLoading(true);


            const response =
                await api.get(
                    "/users"
                );


            setUsers(
                response.data
            );

        } catch (error) {

            console.error(
                "Fetch Users Error:",
                error
            );


            toast.error(
                error.response?.data?.message ||
                "Failed to load users"
            );

        } finally {

            setLoading(false);

        }
    };


    // ===============================
    // Load On Page Open
    // ===============================

    useEffect(() => {

        fetchUsers();

    }, []);


    // ===============================
    // Loading
    // ===============================

    if (loading) {

        return (
            <div className="user-container">

                <h2>
                    Loading Users...
                </h2>

            </div>
        );
    }


    // ===============================
    // JSX
    // ===============================

    return (

        <div className="user-container">


            <button
                className="back-btn"
                onClick={() =>
                    navigate(-1)
                }
            >
                ← Back
            </button>


            <h2>
                User Management
            </h2>


            <table>

                <thead>

                    <tr>

                        <th>
                            User ID
                        </th>

                        <th>
                            Name
                        </th>

                        <th>
                            Stopping
                        </th>

                        <th>
                            Travel Status
                        </th>

                    </tr>

                </thead>


                <tbody>

                    {users.length === 0 ? (

                        <tr>

                            <td
                                colSpan="4"
                            >
                                No users found
                            </td>

                        </tr>

                    ) : (

                        users.map(
                            (user) => (

                                <tr
                                    key={
                                        user._id
                                    }
                                >

                                    <td>
                                        {
                                            user.userId
                                        }
                                    </td>


                                    <td>
                                        {
                                            user.name
                                        }
                                    </td>


                                    <td>
                                        {
                                            user.stoppings ||
                                            "-"
                                        }
                                    </td>


                                    <td>

                                        {
                                            user.travelStatus ||
                                            "Pending"
                                        }

                                    </td>

                                </tr>

                            )
                        )

                    )}

                </tbody>

            </table>

        </div>
    );
}


export default UserManagement;