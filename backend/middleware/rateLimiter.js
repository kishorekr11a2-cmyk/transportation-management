import rateLimit from "express-rate-limit";

/**
 * Standard JSON response handler for rate limit violations
 */
const rateLimitHandler = (customMessage) => (req, res, _next, options) => {
    const retryAfter = Math.ceil(options.windowMs / 1000);
    return res.status(options.statusCode || 429).json({
        success: false,
        code: "RATE_LIMIT_EXCEEDED",
        message: customMessage || options.message || "Too many requests. Please try again later.",
        retryAfterSeconds: retryAfter,
        timestamp: new Date().toISOString()
    });
};

/**
 * Helper to identify request origin: authenticated User ID or client IP
 */
export const userOrIpKeyGenerator = (req) => {
    if (req.user && (req.user.id || req.user.userId)) {
        return `user:${req.user.id || req.user.userId}`;
    }
    // Fallback to IP address
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
        return String(forwarded).split(",")[0].trim();
    }
    return req.ip || "127.0.0.1";
};

/**
 * Check if rate limiting should be skipped (e.g. general test runs unless explicitly enabled)
 */
const shouldSkip = (req) => {
    if (process.env.NODE_ENV === "test" && process.env.ENABLE_TEST_RATE_LIMIT !== "true") {
        return true;
    }
    return false;
};

/**
 * Factory function to create custom rate limiters
 */
export const createRateLimiter = ({
    windowMs = 15 * 60 * 1000,
    limit = 100,
    message = "Too many requests from this IP. Please try again later.",
    keyGenerator = undefined,
    skip = shouldSkip
} = {}) => {
    const config = {
        windowMs,
        limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        validate: false,
        skip,
        handler: rateLimitHandler(message)
    };

    if (keyGenerator) {
        config.keyGenerator = keyGenerator;
    }

    return rateLimit(config);
};

/**
 * 1. Auth Rate Limiter
 * Strict rate limiting for login & password verification to prevent brute force attacks.
 * Limit: 10 attempts per 15 minutes per IP.
 */
export const authRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: "Too many login attempts. For security reasons, please try again in 15 minutes."
});

/**
 * 2. Sensitive Action Rate Limiter
 * For high-impact operations like plan confirmation, allocation resets, and critical overrides.
 * Limit: 60 operations per 15 minutes keyed by authenticated user ID (or IP).
 */
export const sensitiveActionLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    keyGenerator: userOrIpKeyGenerator,
    message: "Too many sensitive actions performed. Please slow down and try again shortly."
});

/**
 * 3. General API Rate Limiter
 * Standard API throughput limiter.
 * Limit: 300 requests per 15 minutes per client.
 */
export const apiRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    message: "API rate limit exceeded. Please try again later."
});

export default {
    createRateLimiter,
    authRateLimiter,
    sensitiveActionLimiter,
    apiRateLimiter,
    userOrIpKeyGenerator
};
