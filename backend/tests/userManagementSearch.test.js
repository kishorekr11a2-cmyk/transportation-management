import { test, describe } from "node:test";
import assert from "node:assert";

// Pure multi-field normalization and search engine logic matching frontend implementation
const normalizeText = (val) => {
    if (val === null || val === undefined) return "";
    return String(val)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
};

const matchesSearch = (user, query) => {
    if (!query) return true;
    const q = normalizeText(query);
    if (!q) return true;

    const searchableFields = [
        user.userId,
        user.name,
        user.stoppings,
        user.city,
        user.district,
        user.state,
        user.country,
        user.travelStatus,
        user.role,
        user.assignedVehicle,
        user.assignedRoute,
        user.allocationStatus,
        user.allocatedBus?.vehicleName,
        user.allocatedBus?.vehicleNumber,
        user.allocatedBus?.routeCode,
        user.allocatedBus?.routeName,
        [user.stoppings, user.city, user.state, user.country].filter(Boolean).join(", ")
    ];

    return searchableFields.some((field) => {
        if (!field) return false;
        return normalizeText(field).includes(q);
    });
};

const filterUsers = (users, { query = "", status = "All", stop = "All", allocation = "All" } = {}) => {
    return users.filter((user) => {
        if (!matchesSearch(user, query)) return false;

        if (status !== "All") {
            const userStatus = user.travelStatus || "Pending";
            if (userStatus !== status) return false;
        }

        if (stop !== "All") {
            const userStop = user.stoppings ? user.stoppings.trim() : "Not set";
            if (userStop !== stop) return false;
        }

        if (allocation !== "All") {
            const isAllocated =
                user.travelStatus === "Coming" &&
                Boolean(user.allocatedBus?.isAllocated || user.assignedVehicle || user.allocatedBus?.vehicleName);

            if (allocation === "Allocated" && !isAllocated) return false;
            if (allocation === "Unallocated" && (isAllocated || user.travelStatus !== "Coming")) return false;
        }

        return true;
    });
};

describe("USER MANAGEMENT — Multi-Field Search & Filter Engine Verification", () => {
    const mockUsers = [
        {
            _id: "60d0fe4f5311236168a109ca",
            userId: "USR001",
            name: "Kishore Kumar",
            stoppings: "Arappalayam",
            city: "Madurai",
            district: "Madurai",
            state: "Tamil Nadu",
            country: "India",
            travelStatus: "Coming",
            assignedVehicle: "BUS-01",
            assignedRoute: "R-NORTH-01",
            allocatedBus: { isAllocated: true, vehicleName: "BUS-01", routeName: "Route North" }
        },
        {
            _id: "60d0fe4f5311236168a109cb",
            userId: "USR002",
            name: "Arun Prakash",
            stoppings: "Simmakkal",
            city: "Madurai",
            district: "Madurai",
            state: "Tamil Nadu",
            country: "India",
            travelStatus: "Coming",
            assignedVehicle: null,
            assignedRoute: null,
            allocatedBus: null
        },
        {
            _id: "60d0fe4f5311236168a109cc",
            userId: "USR003",
            name: "Deepa Rathi",
            stoppings: "Goripalayam",
            city: "Madurai",
            district: "Madurai",
            state: "Tamil Nadu",
            country: "India",
            travelStatus: "Pending",
            assignedVehicle: null,
            assignedRoute: null,
            allocatedBus: null
        },
        {
            _id: "60d0fe4f5311236168a109cd",
            userId: "USR004",
            name: "Vigneshwaran S",
            stoppings: "Mattuthavani",
            city: "Madurai",
            district: "Madurai",
            state: "Tamil Nadu",
            country: "India",
            travelStatus: "Not Coming",
            assignedVehicle: null,
            assignedRoute: null,
            allocatedBus: null
        },
        {
            _id: "60d0fe4f5311236168a109ce",
            userId: "USR005",
            name: "John Doe",
            stoppings: "Oxford Street",
            city: "London",
            district: "Greater London",
            state: "England",
            country: "United Kingdom",
            travelStatus: "Coming",
            assignedVehicle: "BUS-02",
            assignedRoute: "R-WEST-01",
            allocatedBus: { isAllocated: true, vehicleName: "BUS-02" }
        }
    ];

    test("1. Full name search finds exact match", () => {
        const results = filterUsers(mockUsers, { query: "Kishore Kumar" });
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].userId, "USR001");
    });

    test("2. Partial name search finds match", () => {
        const results = filterUsers(mockUsers, { query: "kish" });
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].name, "Kishore Kumar");
    });

    test("3. Exact User ID search", () => {
        const results = filterUsers(mockUsers, { query: "USR001" });
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].name, "Kishore Kumar");
    });

    test("4. Partial User ID search", () => {
        const results = filterUsers(mockUsers, { query: "usr0" });
        assert.strictEqual(results.length, 5);
    });

    test("5. Exact stopping area search", () => {
        const results = filterUsers(mockUsers, { query: "Arappalayam" });
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].userId, "USR001");
    });

    test("6. Partial stopping area search", () => {
        const results = filterUsers(mockUsers, { query: "arap" });
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].stoppings, "Arappalayam");
    });

    test("7. City search", () => {
        const results = filterUsers(mockUsers, { query: "Madurai" });
        assert.strictEqual(results.length, 4);
        assert.ok(results.every((u) => u.city === "Madurai"));
    });

    test("8. District search", () => {
        const results = filterUsers(mockUsers, { query: "Greater London" });
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].userId, "USR005");
    });

    test("9. State search", () => {
        const results = filterUsers(mockUsers, { query: "Tamil Nadu" });
        assert.strictEqual(results.length, 4);
    });

    test("10. Country search", () => {
        const results = filterUsers(mockUsers, { query: "United Kingdom" });
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].country, "United Kingdom");
    });

    test("11. Uppercase search is case-insensitive", () => {
        const results = filterUsers(mockUsers, { query: "ARAPPALAYAM" });
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].userId, "USR001");
    });

    test("12. Mixed-case search is case-insensitive", () => {
        const results = filterUsers(mockUsers, { query: "kIsHoRe" });
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].userId, "USR001");
    });

    test("13. Search + Coming filter", () => {
        const results = filterUsers(mockUsers, { query: "Madurai", status: "Coming" });
        assert.strictEqual(results.length, 2); // USR001 and USR002
        assert.ok(results.every((u) => u.travelStatus === "Coming"));
    });

    test("14. Search + Pending filter", () => {
        const results = filterUsers(mockUsers, { query: "Madurai", status: "Pending" });
        assert.strictEqual(results.length, 1); // USR003
        assert.strictEqual(results[0].userId, "USR003");
    });

    test("15. Search + Not Coming filter", () => {
        const results = filterUsers(mockUsers, { query: "Madurai", status: "Not Coming" });
        assert.strictEqual(results.length, 1); // USR004
        assert.strictEqual(results[0].userId, "USR004");
    });

    test("16. Non-matching query returns zero results without crashing", () => {
        const results = filterUsers(mockUsers, { query: "XYZNONEXISTENT" });
        assert.strictEqual(results.length, 0);
    });

    test("17. Clearing search immediately restores full dataset", () => {
        const results = filterUsers(mockUsers, { query: "" });
        assert.strictEqual(results.length, 5);
    });

    test("18. Excel-imported user is immediately searchable", () => {
        const importedUser = {
            _id: "60d0fe4f5311236168a109cf",
            userId: "USR401",
            name: "Sundar Pichai",
            stoppings: "Villapuram",
            city: "Madurai",
            district: "Madurai",
            state: "Tamil Nadu",
            country: "India",
            travelStatus: "Coming"
        };
        const datasetWithImport = [importedUser, ...mockUsers];

        const searchResult = filterUsers(datasetWithImport, { query: "Villapuram" });
        assert.strictEqual(searchResult.length, 1);
        assert.strictEqual(searchResult[0].userId, "USR401");
        assert.strictEqual(searchResult[0].name, "Sundar Pichai");
    });

    test("19. Updated user is searchable under new stop and excluded from old stop", () => {
        const updatedUsers = mockUsers.map((u) =>
            u.userId === "USR001" ? { ...u, stoppings: "Kochadai" } : u
        );

        const oldSearchResult = filterUsers(updatedUsers, { query: "Arappalayam" });
        assert.strictEqual(oldSearchResult.length, 0);

        const newSearchResult = filterUsers(updatedUsers, { query: "Kochadai" });
        assert.strictEqual(newSearchResult.length, 1);
        assert.strictEqual(newSearchResult[0].userId, "USR001");
    });

    test("20. Deleted user is immediately excluded from search and counts", () => {
        const datasetAfterDelete = mockUsers.filter((u) => u.userId !== "USR001");
        const results = filterUsers(datasetAfterDelete, { query: "Kishore" });
        assert.strictEqual(results.length, 0);
        assert.strictEqual(datasetAfterDelete.length, 4);
    });

    test("21. Allocation filter (Allocated vs Unallocated)", () => {
        const allocated = filterUsers(mockUsers, { allocation: "Allocated" });
        assert.strictEqual(allocated.length, 2); // USR001 & USR005

        const unallocated = filterUsers(mockUsers, { allocation: "Unallocated" });
        assert.strictEqual(unallocated.length, 1); // USR002 is Coming with no bus
        assert.strictEqual(unallocated[0].userId, "USR002");
    });
});
