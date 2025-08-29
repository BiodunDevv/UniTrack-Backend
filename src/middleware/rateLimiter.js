const rateLimit = require("express-rate-limit");

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
});

// Strict rate limiter for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: "Too many attempts from this IP, please try again later.",
  },
});

// OTP rate limiter
const otpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1, // Only 1 OTP request per minute
  message: {
    error: "Please wait before requesting another OTP.",
  },
});

// Attendance submission rate limiter
const attendanceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // Max 3 attendance submissions per minute
  message: {
    error: "Too many attendance submissions. Please wait.",
  },
});

// Support request rate limiter
const supportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 2, // Max 2 support requests per 5 minutes
  message: {
    error:
      "Too many support requests. Please wait before submitting another request.",
  },
});

module.exports = {
  generalLimiter,
  strictLimiter,
  otpLimiter,
  attendanceLimiter,
  supportLimiter,
};
