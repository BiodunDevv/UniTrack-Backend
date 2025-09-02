const crypto = require("crypto");

// Generate random OTP
const generateOTP = (length = 6) => {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
};

// Generate random session code
const generateSessionCode = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Generate nonce for session security
const generateNonce = () => {
  return crypto.randomBytes(16).toString("hex");
};

// Generate device fingerprint from user agent and other factors
const generateDeviceFingerprint = (userAgent, additionalData = {}) => {
  const data = JSON.stringify({
    userAgent,
    ...additionalData,
  });
  return crypto.createHash("sha256").update(data).digest("hex");
};

// Generate receipt signature for attendance
const generateReceiptSignature = (sessionId, matricNo, timestamp, nonce) => {
  const data = `${sessionId}:${matricNo}:${timestamp}:${nonce}`;
  return crypto.createHash("sha256").update(data).digest("hex");
};

// Calculate distance between two coordinates (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
};

// Check if location is within radius
const isWithinRadius = (
  sessionLat,
  sessionLng,
  userLat,
  userLng,
  radiusMeters
) => {
  const distance = calculateDistance(sessionLat, sessionLng, userLat, userLng);
  return distance <= radiusMeters;
};

// Sanitize input to prevent injection attacks
const sanitizeInput = (input) => {
  if (typeof input !== "string") return input;
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "");
};

// Generate random password
const generateRandomPassword = (length = 12) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  return password;
};

// Format date for reports
const formatDate = (date) => {
  return new Date(date).toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

// Validate email format
const isValidEmail = (email) => {
  // More comprehensive email regex that accepts dots, dashes, underscores, and plus signs
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
};

// Validate matriculation number format (accepts any format, just checks it's not empty)
const isValidMatricNo = (matricNo) => {
  // Accept any non-empty string format - will be converted to uppercase on backend
  return typeof matricNo === "string" && matricNo.trim().length > 0;
};

module.exports = {
  generateOTP,
  generateSessionCode,
  generateNonce,
  generateDeviceFingerprint,
  generateReceiptSignature,
  calculateDistance,
  isWithinRadius,
  sanitizeInput,
  generateRandomPassword,
  formatDate,
  isValidEmail,
  isValidMatricNo,
};
