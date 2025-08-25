const jwt = require("jsonwebtoken");
const Teacher = require("../models/Teacher");
const Admin = require("../models/Admin");

const auth = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res
        .status(401)
        .json({ error: "Access denied. No token provided." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user based on userType in token
    let user;
    if (decoded.userType === "admin") {
      user = await Admin.findById(decoded.id);
      req.admin = user;
    } else {
      user = await Teacher.findById(decoded.id);
      req.teacher = user;
    }

    if (!user) {
      return res.status(401).json({ error: "Invalid token." });
    }

    req.user = user; // Generic user object
    req.userType = decoded.userType;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid token." });
  }
};

const adminAuth = async (req, res, next) => {
  auth(req, res, () => {
    if (req.userType !== "admin" && req.user?.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Access denied. Admin role required." });
    }
    next();
  });
};

const teacherAuth = async (req, res, next) => {
  auth(req, res, () => {
    if (req.userType !== "teacher") {
      return res
        .status(403)
        .json({ error: "Access denied. Teacher role required." });
    }
    next();
  });
};

module.exports = { auth, adminAuth, teacherAuth };
