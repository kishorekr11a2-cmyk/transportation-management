import express from "express";


import {
    getStops,
    addStop,
    updateStop,
    deleteStop,
} from "../controllers/stopController.js";


const router =
    express.Router();


// ======================================================
// GET ALL STOPS
// ======================================================

router.get(
    "/",
    getStops
);


// ======================================================
// ADD STOP
// ======================================================

router.post(
    "/",
    addStop
);


// ======================================================
// UPDATE STOP
// ======================================================

router.put(
    "/:id",
    updateStop
);


// ======================================================
// DELETE STOP
// ======================================================

router.delete(
    "/:id",
    deleteStop
);


export default router;