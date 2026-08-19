import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import MapLocation from "../models/MapLocation.js";

const router =
    express.Router();

router.get(
    "/",
    authMiddleware,
    async (req, res) => {
        try {
            const locations =
                await MapLocation.find()
                    .sort({
                        name: 1
                    });

            res.json({
                success: true,
                locations
            });
        } catch (error) {
            console.error(
                "Map locations error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to load map locations."
            });
        }
    }
);

router.post(
    "/",
    authMiddleware,
    async (req, res) => {
        try {
            const {
                name,
                latitude,
                longitude
            } = req.body;

            if (
                !name ||
                !Number.isFinite(
                    Number(latitude)
                ) ||
                !Number.isFinite(
                    Number(longitude)
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Valid location details are required."
                });
            }

            const location =
                await MapLocation.findOneAndUpdate(
                    {
                        name: {
                            $regex:
                                `^${escapeRegex(
                                    name.trim()
                                )}$`,
                            $options: "i"
                        }
                    },
                    {
                        name:
                            name.trim(),
                        latitude:
                            Number(
                                latitude
                            ),
                        longitude:
                            Number(
                                longitude
                            )
                    },
                    {
                        new: true,
                        upsert: true,
                        setDefaultsOnInsert:
                            true
                    }
                );

            res.json({
                success: true,
                location
            });
        } catch (error) {
            console.error(
                "Save map location error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to save map location."
            });
        }
    }
);

const escapeRegex =
    value =>
        value.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

export default router;