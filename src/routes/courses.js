const express = require("express");
const { body, param } = require("express-validator");
const Course = require("../models/Course");
const Session = require("../models/Session");
const CourseStudent = require("../models/CourseStudent");
const Attendance = require("../models/Attendance");
const Teacher = require("../models/Teacher");
const { auth } = require("../middleware/auth");
const validate = require("../middleware/validation");
const auditLogger = require("../middleware/auditLogger");
const EmailService = require("../services/emailService");

const emailService = new EmailService();
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
    // Admin must provide lecturer_id when creating courses
    body("lecturer_id")
      .if((value, { req }) => req.userType === "admin")
      .isMongoId()
      .withMessage("Valid lecturer ID required when admin creates course"),
  ],
  validate,
  auditLogger("course_created"),
  async (req, res) => {
    try {
      const { course_code, title, level, lecturer_id } = req.body;

      // Check for unique course code - prevent duplicate course codes
      const existingCourse = await Course.findOne({
        course_code: course_code.toUpperCase(),
      });

      if (existingCourse) {
        return res.status(400).json({
          error: "Course code already exists",
          message: `A course with code "${course_code.toUpperCase()}" already exists. Please choose a different course code.`,
        });
      }

      // Determine teacher ID based on user type
      let assignedTeacherId;

      if (req.userType === "admin") {
        // Admin must provide lecturer_id
        if (!lecturer_id) {
          return res.status(400).json({
            error: "Lecturer ID required",
            message: "Admin must specify a lecturer for the course",
          });
        }

        // Verify the lecturer exists
        const lecturer = await Teacher.findById(lecturer_id);
        if (!lecturer) {
          return res.status(404).json({
            error: "Lecturer not found",
            message: "The specified lecturer does not exist",
          });
        }

        assignedTeacherId = lecturer_id;
      } else {
        // Teacher creating their own course
        assignedTeacherId = req.teacher._id;
      }

      const course = new Course({
        teacher_id: assignedTeacherId,
        course_code: course_code.toUpperCase(),
        title,
        level,
      });

      await course.save();

      // Populate teacher information
      await course.populate("teacher_id", "name email");

      // Send email notification if admin assigned course to lecturer
      if (req.userType === "admin" && lecturer_id) {
        try {
          await emailService.sendCourseAssignmentNotification({
            lecturer_email: course.teacher_id.email,
            lecturer_name: course.teacher_id.name,
            course_title: course.title,
            course_code: course.course_code,
            level: course.level,
            assignment_date: new Date(),
            assigned_by: req.admin?.name || "System Administrator",
            is_reassignment: false,
            reason: "New course assignment",
          });
        } catch (emailError) {
          console.error("Failed to send course assignment email:", emailError);
          // Don't fail the course creation if email fails
        }
      }

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

    // Build query - teachers see only their courses, admins see all courses
    let query = {};

    // If teacher, only show their courses. If admin, show all courses
    if (req.teacher && req.userType !== "admin") {
      query.teacher_id = req.teacher._id;
    }

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

    // Get student counts and active session info for each course
    const coursesWithCounts = await Promise.all(
      courses.map(async (course) => {
        const studentCount = await CourseStudent.countDocuments({
          course_id: course._id,
        });

        // Get active sessions for this course
        const activeSessions = await Session.find({
          course_id: course._id,
          is_active: true,
          expiry_ts: { $gt: new Date() },
        }).select("_id session_code start_ts expiry_ts");

        return {
          ...course.toObject(),
          student_count: studentCount,
          active_sessions_count: activeSessions.length,
          has_active_session: activeSessions.length > 0,
          active_sessions: activeSessions,
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
      if (req.teacher && req.userType !== "admin") {
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

      // Get all session activity (changed from recent sessions to all sessions)
      const recentSessions = sessions.map((session) => ({
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
    body("lecturer_id")
      .optional()
      .isMongoId()
      .withMessage("Valid lecturer ID required"),
  ],
  validate,
  auditLogger("course_updated"),
  async (req, res) => {
    try {
      const { course_code, title, level, lecturer_id } = req.body;

      // Find course
      let courseQuery = { _id: req.params.id };

      // If teacher, only access their courses. If admin, access all courses
      if (req.teacher && req.userType !== "admin") {
        courseQuery.teacher_id = req.teacher._id;
      }

      const course = await Course.findOne(courseQuery);

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Check if course code is being changed and if it's unique
      if (course_code && course_code.toUpperCase() !== course.course_code) {
        const existingCourse = await Course.findOne({
          course_code: course_code.toUpperCase(),
          _id: { $ne: req.params.id }, // Exclude current course
        });

        if (existingCourse) {
          return res.status(400).json({
            error: "Course code already exists",
            message: `A course with code "${course_code.toUpperCase()}" already exists. Please choose a different course code.`,
          });
        }
      }

      // Handle lecturer assignment change (admin only)
      let lecturerChanged = false;
      let oldLecturerInfo = null;
      let newLecturerInfo = null;

      if (lecturer_id && req.userType === "admin") {
        const newLecturer = await Teacher.findById(lecturer_id);

        if (!newLecturer) {
          return res.status(404).json({
            error: "Lecturer not found",
            message: "The specified lecturer does not exist",
          });
        }

        // Check if lecturer is actually changing
        if (course.teacher_id.toString() !== lecturer_id) {
          // Store old lecturer info for email
          const oldLecturer = await Teacher.findById(course.teacher_id);
          oldLecturerInfo = oldLecturer;
          newLecturerInfo = newLecturer;
          lecturerChanged = true;
        }

        course.teacher_id = lecturer_id;
      } else if (lecturer_id && req.userType !== "admin") {
        return res.status(403).json({
          error: "Access denied",
          message: "Only administrators can change course lecturer assignment",
        });
      }

      // Update fields
      if (course_code) course.course_code = course_code.toUpperCase();
      if (title) course.title = title;
      if (level) course.level = level;

      await course.save();
      await course.populate("teacher_id", "name email");

      // Send email notification if lecturer was changed
      if (lecturerChanged && newLecturerInfo) {
        try {
          await emailService.sendCourseAssignmentNotification({
            lecturer_email: newLecturerInfo.email,
            lecturer_name: newLecturerInfo.name,
            course_title: course.title,
            course_code: course.course_code,
            level: course.level,
            assignment_date: new Date(),
            assigned_by: req.admin?.name || "System Administrator",
            is_reassignment: true,
            previous_lecturer: oldLecturerInfo?.name || "Previous Lecturer",
            reason: "Course lecturer assignment updated",
          });
        } catch (emailError) {
          console.error("Failed to send course update email:", emailError);
          // Don't fail the update if email fails
        }
      }

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
      let courseQuery = { _id: req.params.id };

      // If teacher, only access their courses. If admin, access all courses
      if (req.teacher && req.userType !== "admin") {
        courseQuery.teacher_id = req.teacher._id;
      }

      const course = await Course.findOne(courseQuery);

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

      // Verify both courses exist and user has access
      let courseQuery = {};

      // If teacher, only access their courses. If admin, access all courses
      if (req.teacher && req.userType !== "admin") {
        courseQuery.teacher_id = req.teacher._id;
      }

      const [targetCourse, sourceCourse] = await Promise.all([
        Course.findOne({ _id: courseId, ...courseQuery }),
        Course.findOne({ _id: sourceCourseId, ...courseQuery }),
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

// Get comprehensive attendance report for all sessions in a course
router.get(
  "/:courseId/attendance-report",
  auth,
  [param("courseId").isMongoId().withMessage("Valid course ID required")],
  validate,
  auditLogger("course_attendance_report_generated"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { format } = req.query; // optional: 'summary' or 'detailed' (default: detailed)

      // Verify course access - teachers can only access their courses, admins can access any course
      let query = { _id: courseId };

      // If teacher, only show their courses. If admin, show all courses
      if (req.teacher && req.userType !== "admin") {
        query.teacher_id = req.teacher._id;
      }

      const course = await Course.findOne(query);

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Get all sessions for this course
      const sessions = await Session.find({ course_id: courseId })
        .sort({ created_at: 1 })
        .lean();

      if (sessions.length === 0) {
        return res.json({
          message: "No sessions found for this course",
          course: {
            id: course._id,
            title: course.title,
            course_code: course.course_code,
            level: course.level,
          },
          summary: {
            total_sessions: 0,
            total_students: 0,
            students_below_75_percent: [],
          },
        });
      }

      // Get all enrolled students
      const enrolledStudents = await CourseStudent.find({
        course_id: courseId,
      })
        .populate("student_id", "name email matric_no level")
        .sort({ "student_id.name": 1 })
        .lean();

      // Get all attendance records for all sessions
      const sessionIds = sessions.map((session) => session._id);
      const allAttendanceRecords = await Attendance.find({
        session_id: { $in: sessionIds },
      })
        .populate("student_id", "name email matric_no")
        .lean();

      // Create attendance map for quick lookup
      const attendanceMap = {};
      allAttendanceRecords.forEach((record) => {
        const sessionId = record.session_id.toString();
        const studentId = record.student_id._id.toString();

        if (!attendanceMap[studentId]) {
          attendanceMap[studentId] = {};
        }
        attendanceMap[studentId][sessionId] = record;
      });

      // Calculate statistics for each student
      const studentReports = enrolledStudents.map((enrollment) => {
        const student = enrollment.student_id;
        const studentId = student._id.toString();

        let totalSessions = sessions.length;
        let attendedSessions = 0;
        let presentCount = 0;
        let absentCount = 0;
        let sessionDetails = [];

        sessions.forEach((session) => {
          const sessionId = session._id.toString();
          const attendance =
            attendanceMap[studentId] && attendanceMap[studentId][sessionId];

          if (attendance) {
            const isPresent = ["present", "manual_present"].includes(
              attendance.status
            );
            if (isPresent) {
              attendedSessions++;
              presentCount++;
            }

            sessionDetails.push({
              session_id: session._id,
              session_code: session.session_code,
              date: session.created_at,
              status: attendance.status,
              submitted_at: attendance.submitted_at,
              distance_m: attendance.distance_from_session_m,
            });
          } else {
            absentCount++;
            sessionDetails.push({
              session_id: session._id,
              session_code: session.session_code,
              date: session.created_at,
              status: "absent",
              submitted_at: null,
              distance_m: null,
            });
          }
        });

        const attendanceRate =
          totalSessions > 0 ? (attendedSessions / totalSessions) * 100 : 0;
        const meetsRequirement = attendanceRate >= 75;

        return {
          student: {
            id: student._id,
            name: student.name,
            email: student.email,
            matric_no: student.matric_no,
            level: student.level,
          },
          statistics: {
            total_sessions: totalSessions,
            attended_sessions: attendedSessions,
            missed_sessions: absentCount,
            attendance_rate: Math.round(attendanceRate * 100) / 100,
            meets_75_percent_requirement: meetsRequirement,
            sessions_needed_for_75_percent: meetsRequirement
              ? 0
              : Math.ceil(totalSessions * 0.75) - attendedSessions,
          },
          session_details: format === "summary" ? [] : sessionDetails,
        };
      });

      // Identify students below 75% attendance
      const studentsBelow75Percent = studentReports.filter(
        (report) => !report.statistics.meets_75_percent_requirement
      );

      // Calculate overall course statistics
      const totalStudents = enrolledStudents.length;
      const totalSessions = sessions.length;
      const totalPossibleAttendance = totalStudents * totalSessions;
      const totalActualAttendance = allAttendanceRecords.filter((record) =>
        ["present", "manual_present"].includes(record.status)
      ).length;

      const overallAttendanceRate =
        totalPossibleAttendance > 0
          ? (totalActualAttendance / totalPossibleAttendance) * 100
          : 0;

      // Session-wise statistics
      const sessionStatistics = sessions.map((session) => {
        const sessionAttendance = allAttendanceRecords.filter(
          (record) => record.session_id.toString() === session._id.toString()
        );

        const presentCount = sessionAttendance.filter((record) =>
          ["present", "manual_present"].includes(record.status)
        ).length;

        const sessionRate =
          totalStudents > 0 ? (presentCount / totalStudents) * 100 : 0;

        return {
          session_id: session._id,
          session_code: session.session_code,
          date: session.created_at,
          start_time: session.start_ts,
          end_time: session.expiry_ts,
          total_submissions: sessionAttendance.length,
          present_count: presentCount,
          absent_count: totalStudents - sessionAttendance.length,
          attendance_rate: Math.round(sessionRate * 100) / 100,
          location: {
            lat: session.lat,
            lng: session.lng,
            radius_m: session.radius_m,
          },
        };
      });

      // Performance insights
      const insights = {
        best_attended_session: sessionStatistics.reduce(
          (best, current) =>
            current.attendance_rate > best.attendance_rate ? current : best,
          sessionStatistics[0]
        ),
        worst_attended_session: sessionStatistics.reduce(
          (worst, current) =>
            current.attendance_rate < worst.attendance_rate ? current : worst,
          sessionStatistics[0]
        ),
        average_session_attendance:
          sessionStatistics.length > 0
            ? Math.round(
                (sessionStatistics.reduce(
                  (sum, session) => sum + session.attendance_rate,
                  0
                ) /
                  sessionStatistics.length) *
                  100
              ) / 100
            : 0,
        students_with_perfect_attendance: studentReports.filter(
          (report) => report.statistics.attendance_rate === 100
        ).length,
        students_at_risk: studentsBelow75Percent.length,
      };

      // Risk analysis
      const riskLevels = {
        critical: studentsBelow75Percent.filter(
          (s) => s.statistics.attendance_rate < 50
        ).length,
        high: studentsBelow75Percent.filter(
          (s) =>
            s.statistics.attendance_rate >= 50 &&
            s.statistics.attendance_rate < 65
        ).length,
        medium: studentsBelow75Percent.filter(
          (s) =>
            s.statistics.attendance_rate >= 65 &&
            s.statistics.attendance_rate < 75
        ).length,
      };

      res.json({
        message: "Course attendance report generated successfully",
        course: {
          id: course._id,
          title: course.title,
          course_code: course.course_code,
          level: course.level,
          created_at: course.created_at,
        },
        summary: {
          total_sessions: totalSessions,
          total_students: totalStudents,
          overall_attendance_rate:
            Math.round(overallAttendanceRate * 100) / 100,
          students_meeting_75_percent:
            totalStudents - studentsBelow75Percent.length,
          students_below_75_percent: studentsBelow75Percent.length,
          perfect_attendance_students:
            insights.students_with_perfect_attendance,
        },
        risk_analysis: {
          critical_risk: riskLevels.critical, // < 50%
          high_risk: riskLevels.high, // 50-64%
          medium_risk: riskLevels.medium, // 65-74%
          total_at_risk: studentsBelow75Percent.length,
        },
        insights,
        sessions_overview: sessionStatistics,
        students_below_75_percent: studentsBelow75Percent.map((report) => ({
          ...report.student,
          attendance_rate: report.statistics.attendance_rate,
          sessions_attended: report.statistics.attended_sessions,
          sessions_missed: report.statistics.missed_sessions,
          sessions_needed_for_75_percent:
            report.statistics.sessions_needed_for_75_percent,
          risk_level:
            report.statistics.attendance_rate < 50
              ? "critical"
              : report.statistics.attendance_rate < 65
              ? "high"
              : "medium",
        })),
        all_students: format === "summary" ? [] : studentReports,
        generated_at: new Date(),
        report_parameters: {
          minimum_attendance_requirement: 75,
          format: format || "detailed",
        },
      });
    } catch (error) {
      console.error("Generate attendance report error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Admin route: Reassign course to another lecturer
router.patch(
  "/:courseId/reassign-lecturer",
  auth,
  [
    param("courseId").isMongoId().withMessage("Valid course ID required"),
    body("new_lecturer_id")
      .isMongoId()
      .withMessage("Valid new lecturer ID required"),
    body("reason")
      .optional()
      .trim()
      .isLength({ min: 3, max: 500 })
      .withMessage("Reason must be 3-500 characters if provided"),
  ],
  validate,
  auditLogger("course_reassigned"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { new_lecturer_id, reason } = req.body;

      // Only admins can reassign courses
      if (req.userType !== "admin") {
        return res.status(403).json({
          error: "Access denied",
          message: "Only administrators can reassign courses",
        });
      }

      // Verify course exists
      const course = await Course.findById(courseId).populate(
        "teacher_id",
        "name email"
      );

      if (!course) {
        return res.status(404).json({
          error: "Course not found",
          message: "The specified course does not exist",
        });
      }

      // Verify new lecturer exists
      const newLecturer = await Teacher.findById(new_lecturer_id);

      if (!newLecturer) {
        return res.status(404).json({
          error: "Lecturer not found",
          message: "The specified new lecturer does not exist",
        });
      }

      // Check if already assigned to the same lecturer
      if (course.teacher_id._id.toString() === new_lecturer_id) {
        return res.status(400).json({
          error: "Same lecturer",
          message: "Course is already assigned to this lecturer",
        });
      }

      // Store old lecturer info for response
      const oldLecturer = course.teacher_id;

      // Update course assignment
      course.teacher_id = new_lecturer_id;
      await course.save();

      // Populate new lecturer info
      await course.populate("teacher_id", "name email");

      // Send email notification to the new lecturer
      try {
        await emailService.sendCourseAssignmentNotification({
          lecturer_email: course.teacher_id.email,
          lecturer_name: course.teacher_id.name,
          course_title: course.title,
          course_code: course.course_code,
          level: course.level,
          assignment_date: new Date(),
          assigned_by: req.admin?.name || "System Administrator",
          is_reassignment: true,
          previous_lecturer: oldLecturer.name,
          reason: reason || "Course reassignment",
        });
      } catch (emailError) {
        console.error("Failed to send course reassignment email:", emailError);
        // Don't fail the reassignment if email fails
      }

      res.json({
        message: "Course reassigned successfully",
        course: {
          id: course._id,
          course_code: course.course_code,
          title: course.title,
          level: course.level,
        },
        reassignment: {
          from: {
            id: oldLecturer._id,
            name: oldLecturer.name,
            email: oldLecturer.email,
          },
          to: {
            id: course.teacher_id._id,
            name: course.teacher_id.name,
            email: course.teacher_id.email,
          },
          reason: reason || "No reason provided",
          reassigned_at: new Date(),
          reassigned_by: req.admin._id,
        },
      });
    } catch (error) {
      console.error("Course reassignment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
