const AuditLog = require("../models/AuditLog");

const auditLogger = (action) => {
  return async (req, res, next) => {
    // Store original send function
    const originalSend = res.send;

    // Override send function to capture response
    res.send = function (data) {
      // Log the action if teacher is authenticated and response is successful
      if (req.teacher && res.statusCode < 400) {
        setImmediate(async () => {
          try {
            await AuditLog.create({
              actor_id: req.teacher._id,
              action,
              payload: {
                method: req.method,
                url: req.url,
                body: req.body,
                params: req.params,
                query: req.query,
                ip: req.ip,
                userAgent: req.get("User-Agent"),
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
