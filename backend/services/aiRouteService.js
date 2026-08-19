import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";

// ======================================================
// NORMALIZE DATE
// ======================================================

const normalizeDate = (date) => {

    if (!date) {
        return null;
    }

    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
        return null;
    }

    return parsedDate
        .toISOString()
        .split("T")[0];

};

// ======================================================
// GET USED VEHICLES FOR DATE
// ======================================================

const getUsedVehicleIds = async (date) => {

    if (!date) {
        return new Set();
    }

    const startDate = new Date(
        `${date}T00:00:00.000Z`
    );

    const endDate = new Date(
        `${date}T23:59:59.999Z`
    );

    const schedules = await Schedule.find({
        date: {
            $gte: startDate,
            $lte: endDate
        }
    })
        .select("vehicle")
        .lean();

    return new Set(
        schedules
            .map(
                (schedule) =>
                    schedule.vehicle?.toString()
            )
            .filter(Boolean)
    );

};

// ======================================================
// GROUP USERS BY STOPPING
// ======================================================

const groupUsersByStopping = (users) => {

    const groups = new Map();

    users.forEach((user) => {

        const stopping =
            user.stoppings?.trim();

        if (!stopping) {
            return;
        }

        const key =
            stopping.toLowerCase();

        if (!groups.has(key)) {

            groups.set(key, {
                name: stopping,
                users: [],
                userCount: 0
            });

        }

        const group =
            groups.get(key);

        group.users.push({
            userId: user.userId,
            name: user.name
        });

        group.userCount =
            group.users.length;

    });

    return Array.from(
        groups.values()
    );

};

// ======================================================
// CREATE ROUTE GROUP
// ======================================================

const createRouteGroup = (
    stops,
    capacity
) => {

    const selectedStops = [];

    let totalUsers = 0;

    for (
        const stop of stops
    ) {

        if (
            totalUsers +
            stop.userCount <=
            capacity
        ) {

            selectedStops.push(
                stop
            );

            totalUsers +=
                stop.userCount;

        }

    }

    return {
        stops: selectedStops,
        totalUsers
    };

};

// ======================================================
// GENERATE ROUTE RECOMMENDATIONS
// ======================================================

export const generateRouteRecommendations =
    async (request = {}) => {

        const requestedDate =
            normalizeDate(
                request.date
            );

        // ==================================================
        // GET USERS
        // ==================================================

        const users =
            await User.find({
                role: "student",
                travelStatus: "Coming"
            })
                .lean();

        // ==================================================
        // GET VEHICLES
        // ==================================================

        const vehicles =
            await Vehicle.find()
                .sort({
                    capacity: 1
                })
                .lean();

        // ==================================================
        // BASIC VALIDATION
        // ==================================================

        if (!users.length) {

            return [];

        }

        if (!vehicles.length) {

            return [];

        }

        // ==================================================
        // GROUP USERS BY STOPPING
        // ==================================================

        const stopGroups =
            groupUsersByStopping(
                users
            );

        if (!stopGroups.length) {

            return [];

        }

        // ==================================================
        // VEHICLES ALREADY USED THAT DAY
        // ==================================================

        const usedVehicleIds =
            await getUsedVehicleIds(
                requestedDate
            );

        // ==================================================
        // AVAILABLE VEHICLES
        // ==================================================

        const availableVehicles =
            requestedDate
                ? vehicles.filter(
                    (vehicle) =>
                        !usedVehicleIds.has(
                            vehicle._id.toString()
                        )
                )
                : vehicles;

        if (
            !availableVehicles.length
        ) {

            return [];

        }

        // ==================================================
        // SORT STOPS BY NUMBER OF USERS
        // ==================================================

        const sortedStops = [
            ...stopGroups
        ].sort(
            (a, b) =>
                b.userCount -
                a.userCount
        );

        // ==================================================
        // GENERATE RECOMMENDATIONS
        // ==================================================

        const recommendations = [];

        const maxRecommendations =
            Math.min(
                availableVehicles.length,
                5
            );

        for (
            let i = 0;
            i < maxRecommendations;
            i++
        ) {

            const vehicle =
                availableVehicles[i];

            const capacity =
                Number(
                    vehicle.capacity
                ) || 0;

            if (capacity <= 0) {
                continue;
            }

            const route =
                createRouteGroup(
                    sortedStops,
                    capacity
                );

            if (
                route.totalUsers === 0
            ) {
                continue;
            }

            recommendations.push({

                recommendationId:
                    `AI-${Date.now()}-${i + 1}`,

                routeName:
                    `AI Recommended Route ${i + 1}`,

                date:
                    requestedDate,

                vehicle: {

                    id:
                        vehicle._id,

                    vehicleName:
                        vehicle.vehicleName,

                    capacity:
                        capacity

                },

                totalUsers:
                    route.totalUsers,

                availableSeats:
                    capacity -
                    route.totalUsers,

                stops:
                    route.stops.map(
                        (
                            stop,
                            index
                        ) => ({

                            sequence:
                                index + 1,

                            stopping:
                                stop.name,

                            userCount:
                                stop.userCount,

                            users:
                                stop.users

                        })
                    ),

                reason:
                    `This route groups ${route.totalUsers} confirmed users across ${route.stops.length} stopping areas within the ${capacity}-seat vehicle capacity.`

            });

        }

        return recommendations;

    };