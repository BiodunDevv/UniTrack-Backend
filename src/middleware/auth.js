const jwt = require("jsonwebtoken");
const Teacher = require("../models/Teacher");

const auth = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res
        .status(401)
        .json({ error: "Access denied. No token provided." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const teacher = await Teacher.findById(decoded.id);

    if (!teacher) {
      return res.status(401).json({ error: "Invalid token." });
    }

    req.teacher = teacher;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid token." });
  }
};

const adminAuth = async (req, res, next) => {
  auth(req, res, () => {
    if (req.teacher.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Access denied. Admin role required." });
    }
    next();
  });
};

module.exports = { auth, adminAuth };
