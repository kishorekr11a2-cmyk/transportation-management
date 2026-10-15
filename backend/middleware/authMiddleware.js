import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "transportation_secret_key";

/**
 * JWT Authentication Middleware
 * Verifies Bearer token, checks expiration and validity, and attaches decoded user to req.user.
 */
export const authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Access Denied: Authentication token required"
            });
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                message: "Access Denied: Empty token"
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        // Standardize req.user and convenience aliases
        req.user = {
            ...decoded,
            role: (decoded.role || "").toLowerCase()
        };
        req.userId = decoded.id || decoded.userId;

        next();
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({
                success: false,
                code: "TOKEN_EXPIRED",
                message: "Token has expired. Please log in again."
            });
        }

        return res.status(401).json({
            success: false,
            code: "INVALID_TOKEN",
            message: "Invalid Token"
        });
    }
};

/**
 * Helper to generate JWT token
 */
export const generateToken = (payload, expiresIn = "1d") => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

/**
 * Helper to verify JWT token programmatically
 */
export const verifyToken = (token) => {
    return jwt.verify(token, JWT_SECRET);
};

export default authMiddleware;