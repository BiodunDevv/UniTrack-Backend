const express = require("express");
const { body, param } = require("express-validator");
const Course = require("../models/Course");
const Session = require("../models/Session");
const CourseStudent = require("../models/CourseStudent");
const Attendance = require("../models/Attendance");
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
  auditLogger("course_created"),
  async (req, res) => {
    try {
      const { course_code, title, level } = req.body;

      // No longer checking for unique course code - different lecturers can use same code
      const course = new Course({
        teacher_id: req.teacher._id,
        course_code: course_code.toUpperCase(),
        title,
        level,
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
    const { level, search } = req.query;

    // Build query
    const query = { teacher_id: req.teacher._id };

    if (level) {
      query.level = parseInt(level);
    }

    if (search) {
      query.$or = [
        { course_code: { $regex: search, $options: "i" } },
        { title: { $regex: search, $options: "i" } },
      ];
    }

    const courses = await Course.find(query)
      .populate("teacher_id", "name email")
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Course.countDocuments(query);

    // Get student counts for each course
    const coursesWithCounts = await Promise.all(
      courses.map(async (course) => {
        const studentCount = await CourseStudent.countDocuments({
          course_id: course._id,
        });
        return {
          ...course.toObject(),
          student_count: studentCount,
        };
      })
    );

    res.json({
      courses: coursesWithCounts,
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

// Get specific course with comprehensive details
router.get(
  "/:id",
  auth,
  [param("id").isMongoId().withMessage("Valid course ID required")],
  validate,
  async (req, res) => {
    try {
      // Build query based on user type
      let query = { _id: req.params.id };

      // If teacher, only show their courses. If admin, show all courses
      if (req.teacher) {
        query.teacher_id = req.teacher._id;
      }

      const course = await Course.findOne(query).populate(
        "teacher_id",
        "name email"
      );

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Get enrolled students
      const courseStudents = await CourseStudent.find({ course_id: course._id })
        .populate("student_id", "matric_no name email")
        .sort({ enrolled_at: -1 });

      const students = courseStudents.map((cs) => ({
        ...cs.student_id.toObject(),
        enrolled_at: cs.enrolled_at,
        status: cs.status,
      }));

      // Get all sessions for this course
      const sessions = await Session.find({ course_id: course._id }).sort({
        start_ts: -1,
      });

      // Categorize sessions
      const activeSessions = sessions.filter((session) => !session.isExpired());
      const expiredSessions = sessions.filter((session) => session.isExpired());

      // Calculate course statistics
      const totalSessions = sessions.length;
      const totalStudents = students.length;

      // Get attendance statistics
      const attendanceStats = await Attendance.aggregate([
        {
          $lookup: {
            from: "sessions",
            localField: "session_id",
            foreignField: "_id",
            as: "session",
          },
        },
        {
          $match: {
            "session.course_id": course._id,
          },
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);

      // Process attendance stats
      let totalAttendanceRecords = 0;
      let presentCount = 0;
      let absentCount = 0;
      let rejectedCount = 0;

      attendanceStats.forEach((stat) => {
        totalAttendanceRecords += stat.count;
        if (stat._id === "present" || stat._id === "manual_present") {
          presentCount += stat.count;
        } else if (stat._id === "absent") {
          absentCount += stat.count;
        } else if (stat._id === "rejected") {
          rejectedCount += stat.count;
        }
      });

      // Calculate average attendance rate
      const averageAttendanceRate =
        totalAttendanceRecords > 0
          ? Math.round((presentCount / totalAttendanceRecords) * 100)
          : 0;

      // Get recent session activity
      const recentSessions = sessions.slice(0, 5).map((session) => ({
        _id: session._id,
        session_code: session.session_code,
        start_time: session.start_ts,
        end_time: session.end_ts,
        expiry_time: session.expiry_ts,
        duration_minutes: session.duration_minutes,
        is_active: !session.isExpired(),
        is_expired: session.isExpired(),
        location: session.location,
      }));

      res.json({
        course: course.toObject(),
        students: {
          total: totalStudents,
          active: students.filter((s) => s.status === "active").length,
          inactive: students.filter((s) => s.status === "inactive").length,
          list: students,
        },
        sessions: {
          total: totalSessions,
          active: activeSessions.length,
          expired: expiredSessions.length,
          recent: recentSessions,
          active_sessions: activeSessions.map((session) => ({
            _id: session._id,
            session_code: session.session_code,
            start_time: session.start_ts,
            expiry_time: session.expiry_ts,
            duration_minutes: session.duration_minutes,
            location: session.location,
          })),
          pending_sessions: [], // You might want to add scheduled sessions here
        },
        statistics: {
          total_students: totalStudents,
          total_sessions: totalSessions,
          active_sessions: activeSessions.length,
          total_attendance_records: totalAttendanceRecords,
          present_count: presentCount,
          absent_count: absentCount,
          rejected_count: rejectedCount,
          average_attendance_rate: averageAttendanceRate,
          last_session: sessions.length > 0 ? sessions[0].start_ts : null,
          course_activity: {
            sessions_this_week: sessions.filter(
              (s) =>
                s.start_ts >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            ).length,
            sessions_this_month: sessions.filter(
              (s) =>
                s.start_ts >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            ).length,
          },
        },
      });
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
    body("level")
      .optional()
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
  auditLogger("course_updated"),
  async (req, res) => {
    try {
      const { course_code, title, level } = req.body;

      // Find course
      const course = await Course.findOne({
        _id: req.params.id,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Update fields
      if (course_code) course.course_code = course_code.toUpperCase();
      if (title) course.title = title;
      if (level) course.level = level;

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

      // Clean up related data
      await CourseStudent.deleteMany({ course_id: req.params.id });

      await Course.findByIdAndDelete(req.params.id);

      res.json({ message: "Course deleted successfully" });
    } catch (error) {
      console.error("Course deletion error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Copy students from another course to current course
router.post(
  "/:courseId/copy-students/:sourceCourseId",
  auth,
  [
    param("courseId")
      .isMongoId()
      .withMessage("Valid target course ID required"),
    param("sourceCourseId")
      .isMongoId()
      .withMessage("Valid source course ID required"),
    body("student_ids")
      .optional()
      .isArray()
      .withMessage("Student IDs must be an array")
      .custom((value) => {
        if (value && value.some((id) => !id.match(/^[0-9a-fA-F]{24}$/))) {
          throw new Error("All student IDs must be valid MongoDB ObjectIds");
        }
        return true;
      }),
  ],
  validate,
  auditLogger("students_copied_between_courses"),
  async (req, res) => {
    try {
      const { courseId, sourceCourseId } = req.params;
      const { student_ids } = req.body;

      // Verify both courses belong to the teacher
      const [targetCourse, sourceCourse] = await Promise.all([
        Course.findOne({ _id: courseId, teacher_id: req.teacher._id }),
        Course.findOne({ _id: sourceCourseId, teacher_id: req.teacher._id }),
      ]);

      if (!targetCourse) {
        return res.status(404).json({ error: "Target course not found" });
      }

      if (!sourceCourse) {
        return res.status(404).json({ error: "Source course not found" });
      }

      // Get students to copy
      let studentsQuery = { course_id: sourceCourseId };
      if (student_ids && student_ids.length > 0) {
        studentsQuery.student_id = { $in: student_ids };
      }

      const sourceEnrollments = await CourseStudent.find(
        studentsQuery
      ).populate("student_id");

      if (sourceEnrollments.length === 0) {
        return res.status(400).json({ error: "No students found to copy" });
      }

      // Check for existing enrollments in target course
      const existingEnrollments = await CourseStudent.find({
        course_id: courseId,
        student_id: { $in: sourceEnrollments.map((e) => e.student_id._id) },
      });

      const existingStudentIds = existingEnrollments.map((e) =>
        e.student_id.toString()
      );
      const newEnrollments = [];
      const skippedStudents = [];

      for (const enrollment of sourceEnrollments) {
        if (existingStudentIds.includes(enrollment.student_id._id.toString())) {
          skippedStudents.push(enrollment.student_id);
        } else {
          newEnrollments.push({
            course_id: courseId,
            student_id: enrollment.student_id._id,
            added_by: req.teacher._id,
          });
        }
      }

      // Insert new enrollments
      let addedStudents = [];
      if (newEnrollments.length > 0) {
        const insertedEnrollments = await CourseStudent.insertMany(
          newEnrollments
        );
        addedStudents = await CourseStudent.find({
          _id: { $in: insertedEnrollments.map((e) => e._id) },
        }).populate("student_id", "matric_no name email phone level");
      }

      res.json({
        message: `Successfully copied ${addedStudents.length} students to course`,
        addedStudents,
        skippedStudents: skippedStudents.map((s) => ({
          matric_no: s.matric_no,
          name: s.name,
          reason: "Already enrolled in target course",
        })),
        summary: {
          total_processed: sourceEnrollments.length,
          added: addedStudents.length,
          skipped: skippedStudents.length,
        },
      });
    } catch (error) {
      console.error("Copy students error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
