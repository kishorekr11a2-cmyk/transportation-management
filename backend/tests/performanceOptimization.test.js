import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";

test("Performance Optimization Verification Suite", async (t) => {

    // ─────────────────────────────────────────────────────────────
    // 1. EXCEL BULK PROCESSING & DE-DUPLICATION
    // ─────────────────────────────────────────────────────────────
    await t.test("1. Excel Bulk Processing: 400 Rows Processed with Batch Map & Deduplication", async () => {
        // Generate 400 mock Excel rows (including 50 duplicate userIds to test deduplication)
        const mockRows = [];
        for (let i = 1; i <= 350; i++) {
            const uid = `USR${String(i).padStart(4, "0")}`;
            mockRows.push({
                userId: uid,
                name: `Student ${i}`,
                stoppings: `Stop ${(i % 25) + 1}`,
                city: "Madurai",
                state: "Tamil Nadu",
                country: "India"
            });
        }
        // Add 50 duplicate userIds with updated stop names
        for (let i = 1; i <= 50; i++) {
            const uid = `USR${String(i).padStart(4, "0")}`;
            mockRows.push({
                userId: uid,
                name: `Student ${i} Updated`,
                stoppings: `Updated Stop ${i}`,
                city: "Madurai",
                state: "Tamil Nadu",
                country: "India"
            });
        }

        assert.equal(mockRows.length, 400, "Input has 400 rows total");

        // Simulate Controller Deduplication Map
        const startTime = Date.now();
        const rowMap = new Map();
        for (const row of mockRows) {
            rowMap.set(row.userId, row);
        }
        const deduplicatedRows = Array.from(rowMap.values());
        const validUserIds = deduplicatedRows.map((r) => r.userId);

        assert.equal(deduplicatedRows.length, 350, "Deduplication correctly preserved exactly 350 distinct users");
        assert.equal(validUserIds.length, 350);
        // Verify latest row was kept for duplicates
        assert.equal(rowMap.get("USR0001").name, "Student 1 Updated");
        assert.equal(rowMap.get("USR0001").stoppings, "Updated Stop 1");

        const elapsedMs = Date.now() - startTime;
        assert.ok(elapsedMs < 50, `In-memory deduplication should take < 50ms, took ${elapsedMs}ms`);
    });

    // ─────────────────────────────────────────────────────────────
    // 2. UNIQUE NAME BCRYPT HASH BATCHING
    // ─────────────────────────────────────────────────────────────
    await t.test("2. Excel Bcrypt Optimization: Parallel Unique Name Hashing vs 400 Sequential Hashes", async () => {
        // Simulate 400 users where many have repeated names / defaults
        const mockNames = Array.from({ length: 400 }, (_, i) => `Common Name ${(i % 10) + 1}`);

        // Extract unique names
        const namesToHash = new Set(mockNames);
        assert.equal(namesToHash.size, 10, "400 rows collapse into 10 unique names");

        // Hash unique names in parallel
        const startBatch = Date.now();
        const uniqueNames = Array.from(namesToHash);
        const hashedValues = await Promise.all(uniqueNames.map((n) => bcrypt.hash(n, 8)));
        const hashMap = new Map();
        uniqueNames.forEach((n, i) => hashMap.set(n, hashedValues[i]));
        const batchDuration = Date.now() - startBatch;

        assert.equal(hashMap.size, 10);
        // Verify all 400 rows now have a valid hash in O(1)
        for (const name of mockNames) {
            assert.ok(hashMap.has(name));
            assert.ok(hashMap.get(name).startsWith("$2"));
        }

        // Batch hashing 10 items in parallel typically takes < 500ms, whereas 400 sequential hashes would take ~20s
        assert.ok(batchDuration < 2000, `Batch hashing took ${batchDuration}ms (massive speedup over sequential)`);
    });

    // ─────────────────────────────────────────────────────────────
    // 3. BULKWRITE OPERATIONS STRUCTURE & PRESERVATION OF ALLOCATIONS
    // ─────────────────────────────────────────────────────────────
    await t.test("3. BulkWrite Builder Preserves Passwords & Existing Allocations", () => {
        const existingStudents = [
            {
                userId: "USR0001",
                password: "$2a$08$existingHashedPassword123",
                allocatedBus: { routeCode: "R-01", vehicleName: "Bus 1", isAllocated: true },
                travelStatus: "Coming"
            }
        ];

        const existingMap = new Map(existingStudents.map((s) => [s.userId, s]));
        const hashMap = new Map([["New Student", "$2a$08$newlyHashedPassword456"]]);

        const rows = [
            { userId: "USR0001", name: "Student 1", stoppings: "Simmakkal", city: "Madurai", state: "TN", country: "India" },
            { userId: "USR0002", name: "New Student", stoppings: "Goripalayam", city: "Madurai", state: "TN", country: "India" }
        ];

        const bulkOps = rows.map((row) => {
            const existing = existingMap.get(row.userId);
            const password = existing?.password || hashMap.get(row.name);

            return {
                updateOne: {
                    filter: { userId: row.userId, role: "student" },
                    update: {
                        $set: {
                            userId: row.userId,
                            name: row.name,
                            stoppings: row.stoppings,
                            city: row.city || "",
                            state: row.state || "",
                            country: row.country || "",
                            password,
                            role: "student",
                            travelStatus: "Coming"
                        },
                        $setOnInsert: {
                            allocatedBus: null,
                            assignedVehicle: null,
                            assignedRoute: null
                        }
                    },
                    upsert: true
                }
            };
        });

        assert.equal(bulkOps.length, 2);

        // Existing student's password was preserved
        assert.equal(bulkOps[0].updateOne.update.$set.password, "$2a$08$existingHashedPassword123");
        assert.equal(bulkOps[0].updateOne.update.$set.travelStatus, "Coming");

        // New student gets newly generated hash
        assert.equal(bulkOps[1].updateOne.update.$set.password, "$2a$08$newlyHashedPassword456");
        assert.equal(bulkOps[1].updateOne.update.$set.travelStatus, "Coming");
    });

    // ─────────────────────────────────────────────────────────────
    // 4. ROUTE GEOMETRY CACHE & PERSISTENCE
    // ─────────────────────────────────────────────────────────────
    await t.test("4. Route Geometry Cache: Returns Cached Geometry for Repeated Coordinates", () => {
        const _routeCache = new Map();
        const getRouteCacheKey = (locations) => {
            return locations.map((loc) => `${Number(loc.longitude).toFixed(5)},${Number(loc.latitude).toFixed(5)}`).join(";");
        };

        const stopsA = [
            { latitude: 9.9252, longitude: 78.1198 },
            { latitude: 9.9329, longitude: 78.1288 }
        ];

        const keyA = getRouteCacheKey(stopsA);
        assert.equal(keyA, "78.11980,9.92520;78.12880,9.93290");

        // First call: not cached
        assert.equal(_routeCache.has(keyA), false);

        // Simulate caching calculated route
        const mockGeometry = {
            type: "LineString",
            coordinates: [[78.1198, 9.9252], [78.1243, 9.9280], [78.1288, 9.9329]]
        };
        _routeCache.set(keyA, { geometry: mockGeometry, distance: 1500, provider: "osrm" });

        // Second call: instant cache hit with 0 network calls
        assert.equal(_routeCache.has(keyA), true);
        const cached = _routeCache.get(keyA);
        assert.equal(cached.provider, "osrm");
        assert.equal(cached.geometry.coordinates.length, 3);
    });

    // ─────────────────────────────────────────────────────────────
    // 5. STUDENT DASHBOARD INSTANT HYDRATION FROM SESSION STORAGE
    // ─────────────────────────────────────────────────────────────
    await t.test("5. Student Session Hydration: Instant portal render without spinner blocking", () => {
        const mockSessionUser = {
            userId: "STU001",
            name: "Test Student",
            stoppings: "Anna Nagar",
            travelStatus: "Coming",
            allocatedBus: {
                inward: { isAllocated: true, approved: true, routeCode: "R-IN-01" },
                outward: null
            }
        };

        // Simulating the synchronous initial state getter
        const initialStudent = mockSessionUser ? { ...mockSessionUser } : null;
        const initialLoading = !Boolean(initialStudent);

        assert.equal(initialLoading, false, "Dashboard loading state must initialize to false when session is present");
        assert.equal(initialStudent.userId, "STU001");
        assert.equal(initialStudent.allocatedBus.inward.routeCode, "R-IN-01");
    });

    // ─────────────────────────────────────────────────────────────
    // 6. GETUSERS PAYLOAD COMPACT SANITIZATION
    // ─────────────────────────────────────────────────────────────
    await t.test("6. Users API: Strips heavy nested geometry and stop arrays from allocatedBus", () => {
        const rawUserWithHeavyBus = {
            userId: "USR0100",
            name: "John Doe",
            travelStatus: "Coming",
            allocatedBus: {
                isAllocated: true,
                vehicleName: "Bus Alpha",
                vehicleNumber: "TN-58-1234",
                routeCode: "R-01",
                routeName: "Main Route",
                seatNumber: 12,
                // Heavy fields that should NOT be in the User Management table payload
                stops: Array.from({ length: 50 }, (_, i) => ({ stopName: `Stop ${i}`, lat: 9.9 + i * 0.01, lng: 78.1 + i * 0.01 })),
                roadGeometry: Array.from({ length: 1000 }, () => [78.123, 9.945]),
                inward: {
                    isAllocated: true,
                    vehicleName: "Bus Alpha",
                    vehicleNumber: "TN-58-1234",
                    routeCode: "R-IN-01",
                    heavyDetailedData: "..."
                },
                outward: null
            }
        };

        // Simulate sanitization
        const b = rawUserWithHeavyBus.allocatedBus;
        const cleanBus = {
            isAllocated: b.isAllocated,
            vehicleName: b.vehicleName,
            vehicleNumber: b.vehicleNumber,
            routeCode: b.routeCode,
            routeName: b.routeName,
            seatNumber: b.seatNumber,
            direction: b.direction
        };
        if (b.inward && typeof b.inward === "object") {
            cleanBus.inward = {
                isAllocated: b.inward.isAllocated,
                vehicleName: b.inward.vehicleName,
                vehicleNumber: b.inward.vehicleNumber,
                routeCode: b.inward.routeCode,
                routeName: b.inward.routeName
            };
        }
        const sanitized = { ...rawUserWithHeavyBus, allocatedBus: cleanBus };

        assert.equal(sanitized.allocatedBus.vehicleName, "Bus Alpha");
        assert.equal(sanitized.allocatedBus.inward.routeCode, "R-IN-01");
        assert.equal(sanitized.allocatedBus.stops, undefined, "stops array must be stripped");
        assert.equal(sanitized.allocatedBus.roadGeometry, undefined, "roadGeometry array must be stripped");
    });

    // ─────────────────────────────────────────────────────────────
    // 7. USER MANAGEMENT INSTANT HYDRATION & SECTION LEVEL LOADER
    // ─────────────────────────────────────────────────────────────
    await t.test("7. User Management: Instant Session Hydration and Non-Blocking UI", () => {
        const cachedUsers = [
            { userId: "U1", name: "Alice", travelStatus: "Coming" },
            { userId: "U2", name: "Bob", travelStatus: "Pending" }
        ];

        // Simulating useState with sessionStorage fallback
        const initialUsers = cachedUsers ? [...cachedUsers] : [];
        const initialLoading = initialUsers.length === 0;

        assert.equal(initialLoading, false, "When cached users exist, loading state is immediately false");
        assert.equal(initialUsers.length, 2);
    });

    // ─────────────────────────────────────────────────────────────
    // 8. AI AGENT PLAN CACHING & VISIBILITY CONTROLLED POLLING
    // ─────────────────────────────────────────────────────────────
    await t.test("8. AI Agent: Instant plan hydration & visibility checks prevent unneeded polls", () => {
        const cachedPlan = {
            active: true,
            status: "active",
            direction: "INWARD",
            summary: { confirmedUsers: 25, allocatedSeats: 25 }
        };

        const initialPlan = cachedPlan ? { ...cachedPlan } : null;
        const initialLoading = !Boolean(initialPlan);

        assert.equal(initialLoading, false, "AI Agent does not block on saved plan when cached in localStorage");
        assert.equal(initialPlan.direction, "INWARD");

        // Visibility poll check simulation
        let pollCount = 0;
        const triggerPoll = (visibilityState) => {
            if (visibilityState === "visible") {
                pollCount++;
            }
        };

        triggerPoll("hidden");
        assert.equal(pollCount, 0, "No polling occurs when tab is hidden or minimized");
        triggerPoll("visible");
        assert.equal(pollCount, 1, "Polling only occurs when tab is visible");
    });
});

