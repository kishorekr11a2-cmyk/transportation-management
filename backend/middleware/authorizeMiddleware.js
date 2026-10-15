/**
 * Role-Based Authorization Middleware (RBAC)
 * Verifies that the authenticated user possesses one of the permitted roles.
 *
 * Usage:
 *   router.get("/admin-only", authMiddleware, authorize("admin"), handler);
 *   router.get("/multi-role", authMiddleware, authorize("admin", "manager"), handler);
 */
export const authorize = (...allowedRoles) => {
    const normalizedAllowed = allowedRoles.map((r) => String(r).toLowerCase().trim());

    return (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    code: "UNAUTHORIZED",
                    message: "Access Denied: User not authenticated."
                });
            }

            const userRole = (req.user.role || "").toLowerCase().trim();

            if (normalizedAllowed.length > 0 && !normalizedAllowed.includes(userRole)) {
                return res.status(403).json({
                    success: false,
                    code: "FORBIDDEN",
                    message: `Access forbidden. Required role: ${allowedRoles.join(" or ")}.`
                });
            }

            next();
        } catch (error) {
            return res.status(500).json({
                success: false,
                code: "AUTHORIZATION_ERROR",
                message: "Internal authorization error: " + error.message
            });
        }
    };
};

export const requireAdmin = authorize("admin");
export const requireStudent = authorize("student");
export const requireRoles = (...roles) => authorize(...roles);

export default authorize;
