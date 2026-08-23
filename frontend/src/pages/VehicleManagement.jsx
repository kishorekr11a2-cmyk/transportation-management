import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";

import api from "../services/api";

import "../css/VehicleManagement.css";


const VehicleManagement = () => {


    const navigate = useNavigate();


    const [vehicles,setVehicles] = useState([]);


    const [vehicle,setVehicle] = useState({

        vehicleName:"",
        capacity:""

    });


    const [editId,setEditId] = useState(null);



    // Get Vehicles
    const getVehicles = async () => {
        try {
            const response = await api.get("/vehicles");
            setVehicles(response.data.vehicles || []);
        } catch (error) {
            console.error("Failed to load vehicles:", error);
        }
    };

    useEffect(() => {
        getVehicles();

        const handleSync = () => {
            if (document.visibilityState === "visible") {
                getVehicles();
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        const pollInterval = setInterval(() => {
            getVehicles();
        }, 5000);

        return () => {
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
            clearInterval(pollInterval);
        };
    }, []);






    // Input Change

    const handleChange=(e)=>{

        setVehicle({

            ...vehicle,

            [e.target.name]:e.target.value

        });

    };






    // Add / Update Vehicle

    const handleSubmit=async(e)=>{

        e.preventDefault();


        if(!vehicle.vehicleName || !vehicle.capacity){

            toast.error("Fill all fields");

            return;

        }



        try{


            if(editId){


                const response = await api.put(

                    `/vehicles/${editId}`,

                    vehicle

                );


                toast.success(
                    response.data.message
                );


                setEditId(null);


            }

            else{


                const response = await api.post(

                    "/vehicles",

                    vehicle

                );


                toast.success(
                    response.data.message
                );


            }




            setVehicle({

                vehicleName:"",
                capacity:""

            });


            getVehicles();



        }
        catch(error){


            toast.error(

                error.response?.data?.message ||

                "Operation failed"

            );

        }


    };








    // Edit Vehicle


    const editVehicle=(bus)=>{


        setVehicle({

            vehicleName:bus.vehicleName,

            capacity:bus.capacity

        });


        setEditId(bus._id);


    };







    // Delete Vehicle


    const deleteVehicle=async(id)=>{


        try{


            const response = await api.delete(

                `/vehicles/${id}`

            );


            toast.success(
                response.data.message
            );


            getVehicles();


        }
        catch(error){


            toast.error(

                error.response?.data?.message ||

                "Delete failed"

            );

        }


    };






    return(


        <div className="vehicle-management">


            <button

            className="back-btn"

            onClick={()=>navigate(-1)}

            >

                ← Back

            </button>




            <h1>
                Vehicle Management
            </h1>





            <form onSubmit={handleSubmit}>


                <input

                type="text"

                name="vehicleName"

                placeholder="Vehicle Name"

                value={vehicle.vehicleName}

                onChange={handleChange}

                />




                <input

                type="number"

                name="capacity"

                placeholder="Seat Capacity"

                value={vehicle.capacity}

                onChange={handleChange}

                />




                <button type="submit">

                    {editId ? "Update Vehicle" : "Add Vehicle"}

                </button>


            </form>






            <div className="vehicle-list">


            {

                vehicles.map((bus)=>(


                    <div

                    className="vehicle-card"

                    key={bus._id}

                    >


                        <h3>

                            🚌 {bus.vehicleName}

                        </h3>



                        <p>

                            Seat Capacity : {bus.capacity}

                        </p>





                        <button

                        className="edit-btn"

                        onClick={()=>editVehicle(bus)}

                        >

                            Edit

                        </button>





                        <button

                        className="delete-btn"

                        onClick={()=>deleteVehicle(bus._id)}

                        >

                            Delete

                        </button>




                    </div>


                ))

            }


            </div>


        </div>


    );


};


export default VehicleManagement;