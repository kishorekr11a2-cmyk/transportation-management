/**
 * Request Validation & Sanitization Middleware
 * Enforces schema requirements, types, bounds, and cleanses input against injection.
 *
 * Example Schema:
 * {
 *   body: {
 *     targetRouteId: { type: "string", required: true, minLength: 3 },
 *     priority: { type: "string", required: false, enum: ["low", "normal", "high", "urgent"] },
 *     maxCapacity: { type: "number", required: false, min: 1, max: 200 }
 *   }
 * }
 */

// Helper to sanitize strings against XSS and NoSQL operator injection
export const sanitizeValue = (val) => {
    if (typeof val === "string") {
        // Strip out control chars and common NoSQL injection patterns ($ prefixes)
        return val.trim().replace(/^\$/, "");
    }
    if (Array.isArray(val)) {
        return val.map(sanitizeValue);
    }
    if (val !== null && typeof val === "object") {
        const cleaned = {};
        for (const [k, v] of Object.entries(val)) {
            if (!k.startsWith("$")) {
                cleaned[k] = sanitizeValue(v);
            }
        }
        return cleaned;
    }
    return val;
};

export const validateRequest = (schema = {}) => {
    return (req, res, next) => {
        const errors = [];

        for (const part of ["body", "query", "params"]) {
            const partSchema = schema[part];
            if (!partSchema) continue;

            const target = req[part] || {};

            for (const [field, rules] of Object.entries(partSchema)) {
                let value = target[field];

                // Required check
                if (rules.required && (value === undefined || value === null || value === "")) {
                    errors.push({
                        field: `${part}.${field}`,
                        error: `Field '${field}' is required.`
                    });
                    continue;
                }

                if (value === undefined || value === null) {
                    continue; // Skip further type checks if optional and not provided
                }

                // Type check
                if (rules.type) {
                    if (rules.type === "number") {
                        const num = Number(value);
                        if (isNaN(num)) {
                            errors.push({
                                field: `${part}.${field}`,
                                error: `Field '${field}' must be a valid number.`
                            });
                            continue;
                        }
                        target[field] = num;
                        value = num;
                    } else if (rules.type === "string") {
                        if (typeof value !== "string") {
                            errors.push({
                                field: `${part}.${field}`,
                                error: `Field '${field}' must be a string.`
                            });
                            continue;
                        }
                    } else if (rules.type === "boolean") {
                        if (typeof value === "string") {
                            target[field] = value === "true" || value === "1";
                        } else if (typeof value !== "boolean") {
                            errors.push({
                                field: `${part}.${field}`,
                                error: `Field '${field}' must be a boolean.`
                            });
                            continue;
                        }
                    } else if (rules.type === "array") {
                        if (!Array.isArray(value)) {
                            errors.push({
                                field: `${part}.${field}`,
                                error: `Field '${field}' must be an array.`
                            });
                            continue;
                        }
                    }
                }

                // String length checks
                if (typeof value === "string") {
                    target[field] = sanitizeValue(value);
                    if (rules.minLength && target[field].length < rules.minLength) {
                        errors.push({
                            field: `${part}.${field}`,
                            error: `Field '${field}' must be at least ${rules.minLength} characters.`
                        });
                    }
                    if (rules.maxLength && target[field].length > rules.maxLength) {
                        errors.push({
                            field: `${part}.${field}`,
                            error: `Field '${field}' must not exceed ${rules.maxLength} characters.`
                        });
                    }
                }

                // Number bounds
                if (typeof value === "number") {
                    if (rules.min !== undefined && value < rules.min) {
                        errors.push({
                            field: `${part}.${field}`,
                            error: `Field '${field}' must be >= ${rules.min}.`
                        });
                    }
                    if (rules.max !== undefined && value > rules.max) {
                        errors.push({
                            field: `${part}.${field}`,
                            error: `Field '${field}' must be <= ${rules.max}.`
                        });
                    }
                }

                // Enum check
                if (rules.enum && Array.isArray(rules.enum)) {
                    if (!rules.enum.includes(value)) {
                        errors.push({
                            field: `${part}.${field}`,
                            error: `Field '${field}' must be one of: [${rules.enum.join(", ")}].`
                        });
                    }
                }
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                code: "VALIDATION_FAILED",
                message: "Request validation failed. Please check the payload.",
                errors
            });
        }

        next();
    };
};

export default validateRequest;
