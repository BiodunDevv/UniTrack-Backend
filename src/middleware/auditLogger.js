const AuditLog = require("../models/AuditLog");

const auditLogger = (action) => {
  return async (req, res, next) => {
    // Store original send function
    const originalSend = res.send;

    // Override send function to capture response
    res.send = function (data) {
      // Log the action if user is authenticated and response is successful
      // Support both teacher (req.teacher) and admin (req.user/req.admin) authentication
      const user = req.teacher || req.admin || req.user;

      if (user && res.statusCode < 400) {
        setImmediate(async () => {
          try {
            // Determine actor type based on user type
            const actorType = req.userType === "admin" ? "Admin" : "Teacher";

            await AuditLog.create({
              actor_id: user._id,
              actor_type: actorType,
              action,
              payload: {
                method: req.method,
                url: req.url,
                body: req.body,
                params: req.params,
                query: req.query,
                ip: req.ip,
                userAgent: req.get("User-Agent"),
                userType: req.userType || "teacher",
              },
            });
          } catch (error) {
            console.error("Audit logging failed:", error);
          }
        });
      }

      // Call original send function
      originalSend.call(this, data);
    };

    next();
  };
};

module.exports = auditLogger;
