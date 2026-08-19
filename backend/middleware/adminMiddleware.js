const adminMiddleware = (req, res, next) => {
    try {
        if (!req.user || req.user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Access forbidden. Admin role required."
            });
        }
        next();
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Authentication error"
        });
    }
};

export default adminMiddleware;
