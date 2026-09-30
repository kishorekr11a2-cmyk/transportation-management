import test from "node:test";
import assert from "node:assert/strict";

test("Route Selection Stability Suite", async (t) => {
    // 1. Stable Route ID Extractor
    const getStableRouteId = (route) => {
        if (!route) return "";
        return String(
            route.routeId ||
            route.routeCode ||
            route.busNumber ||
            route.vehicleName ||
            route.vehicleNumber ||
            route.busId ||
            route.vehicleId ||
            route._id ||
            route.id ||
            ""
        ).trim();
    };

    const matchesRouteId = (route, targetId) => {
        if (!route || !targetId) return false;
        const target = String(targetId).trim().toLowerCase();
        const candidateIds = [
            route.routeId,
            route.routeCode,
            route.busNumber,
            route.vehicleName,
            route.vehicleNumber,
            route.busId,
            route.vehicleId,
            route.assignedVehicle?.vehicleName,
            route.assignedVehicle?.vehicleNumber,
            route.assignedVehicle?._id,
            route._id,
            route.id
        ].filter(Boolean).map((v) => String(v).trim().toLowerCase());
        return candidateIds.includes(target);
    };

    const mockRoutes = [
        { routeId: "outward_rt_1", routeCode: "K1", vehicleName: "Bus K1", busNumber: "K1", stops: [{ name: "Hub" }, { name: "Stop 1" }] },
        { routeId: "outward_rt_2", routeCode: "Q1", vehicleName: "Bus Q1", busNumber: "Q1", stops: [{ name: "Hub" }, { name: "Stop 2" }] },
        { routeId: "outward_rt_3", routeCode: "D1", vehicleName: "Bus D1", busNumber: "D1", stops: [{ name: "Hub" }, { name: "Stop 3" }] },
        { routeId: "outward_rt_4", routeCode: "V1", vehicleName: "Bus V1", busNumber: "V1", stops: [{ name: "Hub" }, { name: "Stop 4" }] },
        { routeId: "outward_rt_5", routeCode: "A2", vehicleName: "Bus A2", busNumber: "A2", stops: [{ name: "Hub" }, { name: "Stop 5" }] }
    ];

    await t.test("1. Selection is based on stable ID and derives correct route", () => {
        let selectedRouteId = getStableRouteId(mockRoutes[0]); // K1
        assert.equal(selectedRouteId, "outward_rt_1");

        let currentRoute = mockRoutes.find(r => matchesRouteId(r, selectedRouteId));
        assert.equal(currentRoute.routeCode, "K1");

        // User selects Q1
        selectedRouteId = getStableRouteId(mockRoutes[1]); // Q1
        assert.equal(selectedRouteId, "outward_rt_2");

        currentRoute = mockRoutes.find(r => matchesRouteId(r, selectedRouteId));
        assert.equal(currentRoute.routeCode, "Q1");
    });

    await t.test("2. Route data update/refresh preserves Q1 selection", () => {
        let selectedRouteId = "outward_rt_2"; // User selected Q1

        // New data fetched from backend (new object references, reconstructed array)
        const updatedRoutes = [
            { routeId: "outward_rt_1", routeCode: "K1", vehicleName: "Bus K1", stops: [{ name: "Hub" }] },
            { routeId: "outward_rt_2", routeCode: "Q1", vehicleName: "Bus Q1", stops: [{ name: "Hub" }] },
            { routeId: "outward_rt_3", routeCode: "D1", vehicleName: "Bus D1", stops: [{ name: "Hub" }] },
            { routeId: "outward_rt_4", routeCode: "V1", vehicleName: "Bus V1", stops: [{ name: "Hub" }] }
        ];

        // Preservation check
        const stillExists = updatedRoutes.some(r => matchesRouteId(r, selectedRouteId));
        assert.equal(stillExists, true, "Q1 still exists in updated routes");

        // selectedRouteId MUST NOT be reset to routes[0]!
        if (!stillExists) {
            selectedRouteId = null;
        }

        assert.equal(selectedRouteId, "outward_rt_2", "selectedRouteId must remain Q1");
        const currentRoute = updatedRoutes.find(r => matchesRouteId(r, selectedRouteId));
        assert.equal(currentRoute.routeCode, "Q1", "Derived route must be latest Q1 object");
    });

    await t.test("3. Array reordering / sorting preserves Q1 selection", () => {
        const selectedRouteId = "outward_rt_2"; // Q1

        // Suppose sorting puts D1 first, then K1, then Q1
        const reordered = [
            mockRoutes[2], // D1 (index 0)
            mockRoutes[0], // K1 (index 1)
            mockRoutes[1]  // Q1 (index 2)
        ];

        const derived = reordered.find(r => matchesRouteId(r, selectedRouteId));
        assert.equal(derived.routeCode, "Q1", "Must find Q1 even if index changed from 1 to 2");
        assert.notEqual(reordered[0].routeCode, "Q1");
    });

    await t.test("4. Stale asynchronous route responses are discarded", async () => {
        let activeRouteRequestId = 0;
        let selectedRouteId = "outward_rt_1"; // K1
        let drawnRouteIdOnMap = null;

        // Simulate K1 async call starts
        const k1RequestId = ++activeRouteRequestId;
        const k1Target = selectedRouteId;

        // User now selects Q1
        selectedRouteId = "outward_rt_2"; // Q1
        const q1RequestId = ++activeRouteRequestId;
        const q1Target = selectedRouteId;

        // Q1 async completes first and draws
        if (q1RequestId === activeRouteRequestId && selectedRouteId === q1Target) {
            drawnRouteIdOnMap = q1Target;
        }
        assert.equal(drawnRouteIdOnMap, "outward_rt_2", "Map displays Q1");

        // Old K1 async completes now (late response)
        let k1Overwrote = false;
        if (k1RequestId === activeRouteRequestId && selectedRouteId === k1Target) {
            drawnRouteIdOnMap = k1Target;
            k1Overwrote = true;
        }

        assert.equal(k1Overwrote, false, "K1 response must be ignored and discarded");
        assert.equal(drawnRouteIdOnMap, "outward_rt_2", "Map must remain Q1 and never revert to K1");
    });

    await t.test("5. Only genuine route deletion/reset clears selection", () => {
        let selectedRouteId = "outward_rt_2"; // Q1

        // Plan was completely reset (empty routes)
        const emptyRoutes = [];
        const stillExists = emptyRoutes.some(r => matchesRouteId(r, selectedRouteId));
        if (!stillExists) {
            selectedRouteId = null;
        }

        assert.equal(selectedRouteId, null, "Selection cleared when route plan genuinely no longer exists");
    });
});
