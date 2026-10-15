import { requireAdmin } from "./authorizeMiddleware.js";

/**
 * Admin Authorization Middleware (Backwards-compatible wrapper)
 * Ensures the authenticated user has the 'admin' role.
 */
const adminMiddleware = (req, res, next) => {
    return requireAdmin(req, res, next);
};

export default adminMiddleware;
