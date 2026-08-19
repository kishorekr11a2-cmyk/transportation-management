import Stop from "../models/Stop.js";


// ======================================================
// GET ALL STOPS
// ======================================================

export const getStops = async (
    req,
    res
) => {

    try {

        const stops =
            await Stop.find()
                .sort({
                    createdAt: -1,
                });


        res.status(200).json({

            success: true,

            stops,

        });


    } catch (error) {

        console.error(
            "Get Stops Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to fetch stops",

            error:
                error.message,

        });

    }

};


// ======================================================
// ADD STOP
// ======================================================

export const addStop = async (
    req,
    res
) => {

    try {

        const {
            stopName,
            latitude,
            longitude,
        } = req.body;


        if (
            !stopName ||
            latitude === undefined ||
            longitude === undefined
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Stop name, latitude and longitude are required",

            });

        }


        const stop =
            await Stop.create({

                stopName:
                    stopName.trim(),

                latitude:
                    Number(latitude),

                longitude:
                    Number(longitude),

            });


        res.status(201).json({

            success: true,

            message:
                "Stop added successfully",

            stop,

        });


    } catch (error) {

        console.error(
            "Add Stop Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to add stop",

            error:
                error.message,

        });

    }

};


// ======================================================
// UPDATE STOP
// ======================================================

export const updateStop = async (
    req,
    res
) => {

    try {

        const {
            id,
        } = req.params;


        const {
            stopName,
            latitude,
            longitude,
        } = req.body;


        if (
            !stopName ||
            latitude === undefined ||
            longitude === undefined
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Stop name, latitude and longitude are required",

            });

        }


        const stop =
            await Stop.findByIdAndUpdate(

                id,

                {

                    stopName:
                        stopName.trim(),

                    latitude:
                        Number(latitude),

                    longitude:
                        Number(longitude),

                },

                {

                    new: true,

                    runValidators: true,

                }

            );


        if (!stop) {

            return res.status(404).json({

                success: false,

                message:
                    "Stop not found",

            });

        }


        res.status(200).json({

            success: true,

            message:
                "Stop updated successfully",

            stop,

        });


    } catch (error) {

        console.error(
            "Update Stop Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to update stop",

            error:
                error.message,

        });

    }

};


// ======================================================
// DELETE STOP
// ======================================================

export const deleteStop = async (
    req,
    res
) => {

    try {

        const {
            id,
        } = req.params;


        const stop =
            await Stop.findByIdAndDelete(
                id
            );


        if (!stop) {

            return res.status(404).json({

                success: false,

                message:
                    "Stop not found",

            });

        }


        res.status(200).json({

            success: true,

            message:
                "Stop deleted successfully",

        });


    } catch (error) {

        console.error(
            "Delete Stop Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to delete stop",

            error:
                error.message,

        });

    }

};