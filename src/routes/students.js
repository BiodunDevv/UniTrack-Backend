const express = require("express");
const { body, param } = require("express-validator");
const Student = require("../models/Student");
const Course = require("../models/Course");
const CourseStudent = require("../models/CourseStudent");
const Attendance = require("../models/Attendance");
const Session = require("../models/Session");
const { auth } = require("../middleware/auth");
const validate = require("../middleware/validation");
const auditLogger = require("../middleware/auditLogger");
const { isValidMatricNo } = require("../utils/helpers");

const router = express.Router();

// Add student to course
router.post(
  "/:courseId/students",
  auth,
  [
    param("courseId").isMongoId().withMessage("Valid course ID required"),
    body("matric_no").custom((value) => {
      if (!isValidMatricNo(value)) {
        throw new Error("Invalid matriculation number format");
      }
      return true;
    }),
    body("name")
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be 2-100 characters"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("phone")
      .optional()
      .trim()
      .isLength({ min: 10, max: 15 })
      .withMessage("Invalid phone number"),
    body("level")
      .isInt({ min: 100, max: 600 })
      .custom((value) => {
        if (value % 100 !== 0) {
          throw new Error(
            "Level must be in increments of 100 (100, 200, 300, 400, 500, 600)"
          );
        }
        return true;
      })
      .withMessage("Level must be between 100 and 600 in increments of 100"),
  ],
  validate,
  auditLogger("student_added_to_course"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { matric_no, name, email, phone, level } = req.body;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Check if student already exists, create if not
      let student = await Student.findOne({
        matric_no: matric_no.toUpperCase(),
      });

      if (!student) {
        student = new Student({
          matric_no: matric_no.toUpperCase(),
          name,
          email,
          phone,
          level,
        });
        await student.save();
      } else {
        // Update student info if provided
        student.name = name;
        student.email = email;
        student.level = level;
        if (phone) student.phone = phone;
        await student.save();
      }

      // Check if student is already enrolled in course
      const existingEnrollment = await CourseStudent.findOne({
        course_id: courseId,
        student_id: student._id,
      });

      if (existingEnrollment) {
        return res
          .status(400)
          .json({ error: "Student is already enrolled in this course" });
      }

      // Add student to course
      const courseStudent = new CourseStudent({
        course_id: courseId,
        student_id: student._id,
        added_by: req.teacher._id,
      });

      await courseStudent.save();
      await courseStudent.populate(["student_id", "course_id", "added_by"]);

      res.status(201).json({
        message: "Student added to course successfully",
        enrollment: courseStudent,
      });
    } catch (error) {
      console.error("Add student error:", error);
      if (error.code === 11000) {
        res.status(400).json({
          error: "Student with this matriculation number already exists",
        });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// Bulk add students to course
router.post(
  "/:courseId/students/bulk",
  auth,
  [
    param("courseId").isMongoId().withMessage("Valid course ID required"),
    body("students")
      .isArray({ min: 1 })
      .withMessage(
        "Students array is required and must contain at least one student"
      ),
    body("students.*.course_code")
      .trim()
      .isLength({ min: 1, max: 20 })
      .withMessage("Course code is required for each student"),
    body("students.*.matric_no").custom((value) => {
      if (!isValidMatricNo(value)) {
        throw new Error("Invalid matriculation number format");
      }
      return true;
    }),
    body("students.*.name")
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be 2-100 characters for each student"),
    body("students.*.email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required for each student"),
    body("students.*.phone")
      .optional()
      .trim()
      .isLength({ min: 10, max: 15 })
      .withMessage("Invalid phone number"),
    body("students.*.level")
      .isInt({ min: 100, max: 600 })
      .custom((value) => {
        if (value % 100 !== 0) {
          throw new Error(
            "Level must be in increments of 100 (100, 200, 300, 400, 500, 600)"
          );
        }
        return true;
      })
      .withMessage(
        "Level must be between 100 and 600 in increments of 100 for each student"
      ),
  ],
  validate,
  auditLogger("bulk_students_added_to_course"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { students } = req.body;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      const results = {
        added: [],
        updated: [],
        skipped: [],
        errors: [],
      };

      for (let i = 0; i < students.length; i++) {
        const studentData = students[i];
        try {
          const { course_code, matric_no, name, email, phone, level } =
            studentData;

          // Validate that course_code matches the course
          if (course_code.toUpperCase() !== course.course_code) {
            results.errors.push({
              index: i + 1,
              matric_no: matric_no,
              error: `Course code '${course_code}' does not match course '${course.course_code}'`,
            });
            continue;
          }

          // Check if student already exists
          let student = await Student.findOne({
            matric_no: matric_no.toUpperCase(),
          });

          if (!student) {
            // Create new student
            student = new Student({
              matric_no: matric_no.toUpperCase(),
              name,
              email,
              phone,
              level,
            });
            await student.save();
          } else {
            // Update existing student info
            const oldData = { ...student.toObject() };
            student.name = name;
            student.email = email;
            student.level = level;
            if (phone) student.phone = phone;
            await student.save();

            results.updated.push({
              index: i + 1,
              student: student,
              oldData: {
                name: oldData.name,
                email: oldData.email,
                level: oldData.level,
                phone: oldData.phone,
              },
            });
          }

          // Check if student is already enrolled in course
          const existingEnrollment = await CourseStudent.findOne({
            course_id: courseId,
            student_id: student._id,
          });

          if (existingEnrollment) {
            results.skipped.push({
              index: i + 1,
              student: student,
              reason: "Already enrolled in this course",
            });
            continue;
          }

          // Add student to course
          const courseStudent = new CourseStudent({
            course_id: courseId,
            student_id: student._id,
            added_by: req.teacher._id,
          });

          await courseStudent.save();
          await courseStudent.populate(["student_id", "course_id", "added_by"]);

          results.added.push({
            index: i + 1,
            enrollment: courseStudent,
          });
        } catch (error) {
          console.error(`Error processing student ${i + 1}:`, error);
          results.errors.push({
            index: i + 1,
            matric_no: studentData.matric_no || "unknown",
            error: error.message || "Unknown error occurred",
          });
        }
      }

      res.status(201).json({
        message: `Bulk student addition completed. Added: ${results.added.length}, Updated: ${results.updated.length}, Skipped: ${results.skipped.length}, Errors: ${results.errors.length}`,
        summary: {
          total_processed: students.length,
          added: results.added.length,
          updated: results.updated.length,
          skipped: results.skipped.length,
          errors: results.errors.length,
        },
        results,
      });
    } catch (error) {
      console.error("Bulk add students error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get students in course
router.get(
  "/:courseId/students",
  auth,
  [param("courseId").isMongoId().withMessage("Valid course ID required")],
  validate,
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      const enrollments = await CourseStudent.find({ course_id: courseId })
        .populate("student_id", "matric_no name email phone created_at")
        .populate("added_by", "name email")
        .sort({ added_at: -1 })
        .skip(skip)
        .limit(limit);

      const total = await CourseStudent.countDocuments({ course_id: courseId });

      res.json({
        course,
        students: enrollments,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalStudents: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get students error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Remove student from course
router.delete(
  "/:courseId/students/:studentId",
  auth,
  [
    param("courseId").isMongoId().withMessage("Valid course ID required"),
    param("studentId").isMongoId().withMessage("Valid student ID required"),
  ],
  validate,
  auditLogger("student_removed_from_course"),
  async (req, res) => {
    try {
      const { courseId, studentId } = req.params;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Remove enrollment
      const enrollment = await CourseStudent.findOneAndDelete({
        course_id: courseId,
        student_id: studentId,
      });

      if (!enrollment) {
        return res
          .status(404)
          .json({ error: "Student not found in this course" });
      }

      res.json({ message: "Student removed from course successfully" });
    } catch (error) {
      console.error("Remove student error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Manually mark attendance
router.patch(
  "/:courseId/students/:studentId/mark",
  auth,
  [
    param("courseId").isMongoId().withMessage("Valid course ID required"),
    param("studentId").isMongoId().withMessage("Valid student ID required"),
    body("sessionId").isMongoId().withMessage("Valid session ID required"),
    body("status")
      .isIn(["present", "absent", "manual_present"])
      .withMessage("Valid status required"),
    body("reason")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Reason must be less than 500 characters"),
  ],
  validate,
  auditLogger("manual_attendance_marked"),
  async (req, res) => {
    try {
      const { courseId, studentId } = req.params;
      const { sessionId, status, reason } = req.body;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Verify session belongs to this course
      const session = await Session.findOne({
        _id: sessionId,
        course_id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Verify student is enrolled in course
      const enrollment = await CourseStudent.findOne({
        course_id: courseId,
        student_id: studentId,
      });

      if (!enrollment) {
        return res
          .status(404)
          .json({ error: "Student not enrolled in this course" });
      }

      const student = await Student.findById(studentId);

      // Check if attendance already exists
      let attendance = await Attendance.findOne({
        session_id: sessionId,
        student_id: studentId,
      });

      if (attendance) {
        // Update existing attendance
        attendance.status = status;
        attendance.reason = reason;
        await attendance.save();
      } else {
        // Create new manual attendance record
        attendance = new Attendance({
          session_id: sessionId,
          course_id: courseId,
          student_id: studentId,
          matric_no_submitted: student.matric_no,
          device_fingerprint: "manual_entry",
          lat: session.lat,
          lng: session.lng,
          accuracy: 0,
          status,
          reason,
          receipt_signature: `manual_${Date.now()}`,
        });
        await attendance.save();
      }

      await attendance.populate(["student_id", "session_id", "course_id"]);

      res.json({
        message: "Attendance marked successfully",
        attendance,
      });
    } catch (error) {
      console.error("Manual attendance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get student attendance history for a course
router.get(
  "/:courseId/students/:studentId/attendance",
  auth,
  [
    param("courseId").isMongoId().withMessage("Valid course ID required"),
    param("studentId").isMongoId().withMessage("Valid student ID required"),
  ],
  validate,
  async (req, res) => {
    try {
      const { courseId, studentId } = req.params;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Get attendance records
      const attendanceRecords = await Attendance.find({
        course_id: courseId,
        student_id: studentId,
      })
        .populate("session_id", "session_code start_ts expiry_ts")
        .populate("student_id", "matric_no name")
        .sort({ submitted_at: -1 });

      const student = await Student.findById(studentId);

      // Calculate attendance statistics
      const totalSessions = await Session.countDocuments({
        course_id: courseId,
        teacher_id: req.teacher._id,
      });

      const presentCount = attendanceRecords.filter(
        (record) =>
          record.status === "present" || record.status === "manual_present"
      ).length;

      const attendanceRate =
        totalSessions > 0
          ? Math.round((presentCount / totalSessions) * 100)
          : 0;

      res.json({
        student,
        course,
        attendanceRecords,
        statistics: {
          totalSessions,
          attendedSessions: presentCount,
          missedSessions: totalSessions - presentCount,
          attendanceRate: `${attendanceRate}%`,
        },
      });
    } catch (error) {
      console.error("Get student attendance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
