const express = require("express");
const { body, param } = require("express-validator");
const Course = require("../models/Course");
const { auth } = require("../middleware/auth");
const validate = require("../middleware/validation");
const auditLogger = require("../middleware/auditLogger");

const router = express.Router();

// Create new course
router.post(
  "/",
  auth,
  [
    body("course_code")
      .trim()
      .isLength({ min: 2, max: 20 })
      .withMessage("Course code must be 2-20 characters"),
    body("title")
      .trim()
      .isLength({ min: 3, max: 200 })
      .withMessage("Title must be 3-200 characters"),
  ],
  validate,
  auditLogger("course_created"),
  async (req, res) => {
    try {
      const { course_code, title } = req.body;

      // Check if course with same code exists for this teacher
      const existingCourse = await Course.findOne({
        teacher_id: req.teacher._id,
        course_code: course_code.toUpperCase(),
      });

      if (existingCourse) {
        return res
          .status(400)
          .json({ error: "Course with this code already exists" });
      }

      const course = new Course({
        teacher_id: req.teacher._id,
        course_code: course_code.toUpperCase(),
        title,
      });

      await course.save();

      // Populate teacher information
      await course.populate("teacher_id", "name email");

      res.status(201).json({
        message: "Course created successfully",
        course,
      });
    } catch (error) {
      console.error("Course creation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get all courses by teacher
router.get("/", auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const courses = await Course.find({ teacher_id: req.teacher._id })
      .populate("teacher_id", "name email")
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Course.countDocuments({ teacher_id: req.teacher._id });

    res.json({
      courses,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalCourses: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Get courses error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get specific course
router.get(
  "/:id",
  auth,
  [param("id").isMongoId().withMessage("Valid course ID required")],
  validate,
  async (req, res) => {
    try {
      const course = await Course.findOne({
        _id: req.params.id,
        teacher_id: req.teacher._id,
      }).populate("teacher_id", "name email");

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      res.json({ course });
    } catch (error) {
      console.error("Get course error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Update course
router.patch(
  "/:id",
  auth,
  [
    param("id").isMongoId().withMessage("Valid course ID required"),
    body("course_code")
      .optional()
      .trim()
      .isLength({ min: 2, max: 20 })
      .withMessage("Course code must be 2-20 characters"),
    body("title")
      .optional()
      .trim()
      .isLength({ min: 3, max: 200 })
      .withMessage("Title must be 3-200 characters"),
  ],
  validate,
  auditLogger("course_updated"),
  async (req, res) => {
    try {
      const { course_code, title } = req.body;

      // Find course
      const course = await Course.findOne({
        _id: req.params.id,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Check if new course code conflicts with existing courses
      if (course_code && course_code.toUpperCase() !== course.course_code) {
        const existingCourse = await Course.findOne({
          teacher_id: req.teacher._id,
          course_code: course_code.toUpperCase(),
          _id: { $ne: course._id },
        });

        if (existingCourse) {
          return res
            .status(400)
            .json({ error: "Course with this code already exists" });
        }
      }

      // Update fields
      if (course_code) course.course_code = course_code.toUpperCase();
      if (title) course.title = title;

      await course.save();
      await course.populate("teacher_id", "name email");

      res.json({
        message: "Course updated successfully",
        course,
      });
    } catch (error) {
      console.error("Course update error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Delete course
router.delete(
  "/:id",
  auth,
  [param("id").isMongoId().withMessage("Valid course ID required")],
  validate,
  auditLogger("course_deleted"),
  async (req, res) => {
    try {
      const course = await Course.findOne({
        _id: req.params.id,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // TODO: Add check for existing sessions and students
      // For now, we'll allow deletion but in production you might want to:
      // 1. Check if there are active sessions
      // 2. Check if there are students enrolled
      // 3. Archive instead of delete

      await Course.findByIdAndDelete(req.params.id);

      res.json({ message: "Course deleted successfully" });
    } catch (error) {
      console.error("Course deletion error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
