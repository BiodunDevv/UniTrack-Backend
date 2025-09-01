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
    body("level")
      .isInt({ min: 100, max: 600 })
      .withMessage("Level must be between 100-600"),
  ],
  validate,
  auditLogger("student_added_to_course"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { matric_no, name, email, level } = req.body;

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
          level,
        });
        await student.save();
      } else {
        // Update student info if provided
        student.name = name;
        student.email = email;
        student.level = level;
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
      .isArray({ min: 1, max: 100 })
      .withMessage("Students array required (1-100 students)"),
    body("students.*.matric_no").custom((value) => {
      if (!isValidMatricNo(value)) {
        throw new Error("Invalid matriculation number format");
      }
      return true;
    }),
    body("students.*.name")
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be 2-100 characters"),
    body("students.*.email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("students.*.level")
      .isInt({ min: 100, max: 600 })
      .withMessage("Level must be between 100-600"),
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
        successful: [],
        failed: [],
        skipped: [],
      };

      // Process each student
      for (const studentData of students) {
        try {
          const { matric_no, name, email, level } = studentData;
          const matricNo = matric_no.toUpperCase();

          // Check if student already exists, create if not
          let student = await Student.findOne({ matric_no: matricNo });

          if (!student) {
            student = new Student({
              matric_no: matricNo,
              name,
              email,
              level,
            });
            await student.save();
          } else {
            // Update student info if provided
            student.name = name;
            student.email = email;
            if (level) student.level = level;
            await student.save();
          }

          // Check if student is already enrolled in course
          const existingEnrollment = await CourseStudent.findOne({
            course_id: courseId,
            student_id: student._id,
          });

          if (existingEnrollment) {
            results.skipped.push({
              matric_no: matricNo,
              name,
              reason: "Already enrolled in course",
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
          await courseStudent.populate(["student_id"]);

          results.successful.push({
            matric_no: matricNo,
            name,
            email,
            student_id: student._id,
            enrollment_id: courseStudent._id,
          });
        } catch (error) {
          console.error(
            `Error processing student ${studentData.matric_no}:`,
            error
          );
          results.failed.push({
            matric_no: studentData.matric_no,
            name: studentData.name,
            reason: error.message || "Processing error",
          });
        }
      }

      const totalProcessed = students.length;
      const successCount = results.successful.length;
      const failedCount = results.failed.length;
      const skippedCount = results.skipped.length;

      res.status(201).json({
        message: "Bulk student enrollment completed",
        summary: {
          total_processed: totalProcessed,
          successful: successCount,
          failed: failedCount,
          skipped: skippedCount,
        },
        results,
        course: {
          id: course._id,
          title: course.title,
          course_code: course.course_code,
        },
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

// Delete all students from course
router.delete(
  "/:courseId/students/all",
  auth,
  [param("courseId").isMongoId().withMessage("Valid course ID required")],
  validate,
  auditLogger("all_students_removed_from_course"),
  async (req, res) => {
    try {
      const { courseId } = req.params;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Get all enrolled students before deletion for the response
      const enrolledStudents = await CourseStudent.find({
        course_id: courseId,
      })
        .populate("student_id", "name email matric_no")
        .lean();

      // Delete all course enrollments
      const deleteResult = await CourseStudent.deleteMany({
        course_id: courseId,
      });

      // Also delete any attendance records for sessions in this course
      const courseSessions = await Session.find({ course_id: courseId }).select(
        "_id"
      );
      const sessionIds = courseSessions.map((session) => session._id);

      if (sessionIds.length > 0) {
        await Attendance.deleteMany({ session_id: { $in: sessionIds } });
      }

      res.json({
        message: "All students removed from course successfully",
        summary: {
          total_students_removed: deleteResult.deletedCount,
          course: {
            id: course._id,
            title: course.title,
            course_code: course.course_code,
          },
          deleted_students: enrolledStudents.map((enrollment) => ({
            id: enrollment.student_id._id,
            name: enrollment.student_id.name,
            email: enrollment.student_id.email,
            matric_no: enrollment.student_id.matric_no,
          })),
          attendance_records_cleaned: sessionIds.length > 0,
        },
      });
    } catch (error) {
      console.error("Remove all students error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Bulk delete specific students from course
router.delete(
  "/:courseId/students/bulk",
  auth,
  [
    param("courseId").isMongoId().withMessage("Valid course ID required"),
    body("student_ids")
      .isArray({ min: 1, max: 100 })
      .withMessage("Student IDs array required (1-100 students)"),
    body("student_ids.*").isMongoId().withMessage("Valid student ID required"),
  ],
  validate,
  auditLogger("bulk_students_removed_from_course"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { student_ids } = req.body;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      const results = {
        successful: [],
        not_found: [],
        failed: [],
      };

      // Process each student ID
      for (const studentId of student_ids) {
        try {
          // Find the enrollment
          const enrollment = await CourseStudent.findOne({
            course_id: courseId,
            student_id: studentId,
          }).populate("student_id", "name email matric_no");

          if (!enrollment) {
            results.not_found.push({
              student_id: studentId,
              reason: "Student not enrolled in this course",
            });
            continue;
          }

          // Delete the enrollment
          await CourseStudent.deleteOne({
            course_id: courseId,
            student_id: studentId,
          });

          // Delete attendance records for this student in this course's sessions
          const courseSessions = await Session.find({
            course_id: courseId,
          }).select("_id");
          const sessionIds = courseSessions.map((session) => session._id);

          if (sessionIds.length > 0) {
            await Attendance.deleteMany({
              session_id: { $in: sessionIds },
              student_id: studentId,
            });
          }

          results.successful.push({
            student_id: studentId,
            name: enrollment.student_id.name,
            email: enrollment.student_id.email,
            matric_no: enrollment.student_id.matric_no,
            attendance_records_cleaned: sessionIds.length > 0,
          });
        } catch (error) {
          console.error(`Error removing student ${studentId}:`, error);
          results.failed.push({
            student_id: studentId,
            reason: error.message || "Processing error",
          });
        }
      }

      const totalProcessed = student_ids.length;
      const successCount = results.successful.length;
      const notFoundCount = results.not_found.length;
      const failedCount = results.failed.length;

      res.json({
        message: "Bulk student removal completed",
        summary: {
          total_processed: totalProcessed,
          successful: successCount,
          not_found: notFoundCount,
          failed: failedCount,
          course: {
            id: course._id,
            title: course.title,
            course_code: course.course_code,
          },
        },
        results,
      });
    } catch (error) {
      console.error("Bulk remove students error:", error);
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

// Remove student from course
router.delete(
  "/:courseId/students/bulk",
  auth,
  [
    param("courseId").isMongoId().withMessage("Valid course ID required"),
    body("student_ids")
      .isArray({ min: 1, max: 100 })
      .withMessage("Student IDs array required (1-100 students)"),
    body("student_ids.*").isMongoId().withMessage("Valid student ID required"),
  ],
  validate,
  auditLogger("bulk_students_removed_from_course"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { student_ids } = req.body;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      const results = {
        successful: [],
        not_found: [],
        failed: [],
      };

      // Process each student ID
      for (const studentId of student_ids) {
        try {
          // Find the enrollment
          const enrollment = await CourseStudent.findOne({
            course_id: courseId,
            student_id: studentId,
          }).populate("student_id", "name email matric_no");

          if (!enrollment) {
            results.not_found.push({
              student_id: studentId,
              reason: "Student not enrolled in this course",
            });
            continue;
          }

          // Delete the enrollment
          await CourseStudent.deleteOne({
            course_id: courseId,
            student_id: studentId,
          });

          // Delete attendance records for this student in this course's sessions
          const courseSessions = await Session.find({
            course_id: courseId,
          }).select("_id");
          const sessionIds = courseSessions.map((session) => session._id);

          if (sessionIds.length > 0) {
            await Attendance.deleteMany({
              session_id: { $in: sessionIds },
              student_id: studentId,
            });
          }

          results.successful.push({
            student_id: studentId,
            name: enrollment.student_id.name,
            email: enrollment.student_id.email,
            matric_no: enrollment.student_id.matric_no,
            attendance_records_cleaned: sessionIds.length > 0,
          });
        } catch (error) {
          console.error(`Error removing student ${studentId}:`, error);
          results.failed.push({
            student_id: studentId,
            reason: error.message || "Processing error",
          });
        }
      }

      const totalProcessed = student_ids.length;
      const successCount = results.successful.length;
      const notFoundCount = results.not_found.length;
      const failedCount = results.failed.length;

      res.json({
        message: "Bulk student removal completed",
        summary: {
          total_processed: totalProcessed,
          successful: successCount,
          not_found: notFoundCount,
          failed: failedCount,
          course: {
            id: course._id,
            title: course.title,
            course_code: course.course_code,
          },
        },
        results,
      });
    } catch (error) {
      console.error("Bulk remove students error:", error);
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
        // Create new manual attendance record with unique device fingerprint
        const uniqueDeviceFingerprint = `manual_entry_${studentId}_${sessionId}_${Date.now()}`;

        attendance = new Attendance({
          session_id: sessionId,
          course_id: courseId,
          student_id: studentId,
          matric_no_submitted: student.matric_no,
          device_fingerprint: uniqueDeviceFingerprint,
          lat: session.lat,
          lng: session.lng,
          accuracy: 0,
          status,
          reason,
          receipt_signature: `manual_${Date.now()}`,
          device_info: {
            platform: "Manual Entry",
            browser: "Teacher Dashboard",
            user_agent: "Manual attendance marking by teacher",
            manual_entry: true,
          },
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

      // Handle duplicate key error specifically
      if (
        error.code === 11000 &&
        error.keyPattern &&
        error.keyPattern.device_fingerprint
      ) {
        return res.status(400).json({
          error: "Attendance record conflict",
          details: [
            "There was a conflict with the attendance record.",
            "This might be due to a duplicate manual entry.",
            "Please refresh the page and try again.",
          ],
        });
      }

      // Handle validation errors
      if (error.name === "ValidationError") {
        const validationErrors = Object.values(error.errors).map(
          (err) => err.message
        );
        return res.status(400).json({
          error: "Validation failed",
          details: validationErrors,
        });
      }

      res.status(500).json({
        error: "Internal server error",
        details: ["Failed to mark attendance. Please try again later."],
      });
    }
  }
);

// Bulk mark attendance for multiple students
router.patch(
  "/:courseId/students/bulk-mark",
  auth,
  [
    param("courseId").isMongoId().withMessage("Valid course ID required"),
    body("sessionId").isMongoId().withMessage("Valid session ID required"),
    body("students")
      .isArray({ min: 1, max: 100 })
      .withMessage("Students array required (1-100 students)"),
    body("students.*.studentId")
      .isMongoId()
      .withMessage("Valid student ID required"),
    body("students.*.status")
      .isIn(["present", "absent", "manual_present"])
      .withMessage("Valid status required"),
    body("students.*.reason")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Reason must be less than 500 characters"),
  ],
  validate,
  auditLogger("bulk_attendance_marked"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { sessionId, students } = req.body;

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

      const results = {
        successful: [],
        failed: [],
        skipped: [],
      };

      // Process each student
      for (const studentData of students) {
        try {
          const { studentId, status, reason } = studentData;

          // Verify student is enrolled in course
          const enrollment = await CourseStudent.findOne({
            course_id: courseId,
            student_id: studentId,
          });

          if (!enrollment) {
            results.failed.push({
              student_id: studentId,
              reason: "Student not enrolled in this course",
            });
            continue;
          }

          const student = await Student.findById(studentId);
          if (!student) {
            results.failed.push({
              student_id: studentId,
              reason: "Student not found",
            });
            continue;
          }

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
            
            results.skipped.push({
              student_id: studentId,
              matric_no: student.matric_no,
              name: student.name,
              status,
              reason: "Attendance record updated",
            });
          } else {
            // Create new manual attendance record with unique device fingerprint
            const uniqueDeviceFingerprint = `bulk_entry_${studentId}_${sessionId}_${Date.now()}`;

            attendance = new Attendance({
              session_id: sessionId,
              course_id: courseId,
              student_id: studentId,
              matric_no_submitted: student.matric_no,
              device_fingerprint: uniqueDeviceFingerprint,
              lat: session.lat,
              lng: session.lng,
              accuracy: 0,
              status,
              reason,
              receipt_signature: `bulk_${Date.now()}`,
              device_info: {
                platform: "Bulk Entry",
                browser: "Teacher Dashboard",
                user_agent: "Bulk attendance marking by teacher",
                manual_entry: true,
              },
            });
            await attendance.save();

            results.successful.push({
              student_id: studentId,
              matric_no: student.matric_no,
              name: student.name,
              status,
              attendance_id: attendance._id,
            });
          }
        } catch (error) {
          console.error(`Error processing student ${studentData.studentId}:`, error);
          
          // Handle duplicate key error specifically
          if (error.code === 11000 && error.keyPattern && error.keyPattern.device_fingerprint) {
            results.failed.push({
              student_id: studentData.studentId,
              reason: "Attendance record conflict - duplicate entry",
            });
          } else {
            results.failed.push({
              student_id: studentData.studentId,
              reason: error.message || "Processing error",
            });
          }
        }
      }

      const totalProcessed = students.length;
      const successCount = results.successful.length;
      const failedCount = results.failed.length;
      const skippedCount = results.skipped.length;

      res.json({
        message: "Bulk attendance marking completed",
        summary: {
          total_processed: totalProcessed,
          successful: successCount,
          failed: failedCount,
          skipped: skippedCount,
        },
        results,
        session: {
          id: session._id,
          session_code: session.session_code,
        },
        course: {
          id: course._id,
          title: course.title,
          course_code: course.course_code,
        },
      });
    } catch (error) {
      console.error("Bulk mark attendance error:", error);
      res.status(500).json({
        error: "Internal server error",
        details: ["Failed to bulk mark attendance. Please try again later."],
      });
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
