const express = require("express");
const { body, param, query } = require("express-validator");
const mongoose = require("mongoose");
const StudentShareRequest = require("../models/StudentShareRequest");
const Teacher = require("../models/Teacher");
const Course = require("../models/Course");
const Student = require("../models/Student");
const CourseStudent = require("../models/CourseStudent");
const { auth } = require("../middleware/auth");
const validate = require("../middleware/validation");
const auditLogger = require("../middleware/auditLogger");
const EmailService = require("../services/emailService");

const emailService = new EmailService();
const router = express.Router();

// Get all teachers for sharing (excluding self)
router.get("/teachers", auth, async (req, res) => {
  try {
    const teachers = await Teacher.find({
      _id: { $ne: req.teacher._id },
      role: "teacher",
    }).select("name email");

    res.json({
      teachers,
      total: teachers.length,
    });
  } catch (error) {
    console.error("Get teachers error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get another teacher's courses with details (for student sharing)
router.get(
  "/my-courses",
  auth,
  [
    query("teacher_id")
      .optional()
      .isMongoId()
      .withMessage("Valid teacher ID required"),
  ],
  validate,
  async (req, res) => {
    try {
      const { teacher_id } = req.query;

      // If teacher_id is provided, get that teacher's courses, otherwise get own courses
      const targetTeacherId = teacher_id || req.teacher._id;

      // If requesting another teacher's courses, verify the teacher exists
      if (teacher_id && teacher_id !== req.teacher._id.toString()) {
        const targetTeacher = await Teacher.findById(teacher_id).select(
          "name email"
        );
        if (!targetTeacher) {
          return res.status(404).json({ error: "Teacher not found" });
        }
      }

      const courses = await Course.aggregate([
        {
          $match: { teacher_id: new mongoose.Types.ObjectId(targetTeacherId) },
        },
        {
          $lookup: {
            from: "coursestudents",
            localField: "_id",
            foreignField: "course_id",
            as: "enrollments",
          },
        },
        {
          $lookup: {
            from: "teachers",
            localField: "teacher_id",
            foreignField: "_id",
            as: "teacher_info",
          },
        },
        {
          $addFields: {
            student_count: { $size: "$enrollments" },
            teacher: { $arrayElemAt: ["$teacher_info", 0] },
          },
        },
        {
          $project: {
            course_code: 1,
            title: 1,
            level: 1,
            semester: 1,
            academic_year: 1,
            student_count: 1,
            created_at: 1,
            "teacher.name": 1,
            "teacher.email": 1,
            "teacher._id": 1,
          },
        },
        { $sort: { created_at: -1 } },
      ]);

      // Get teacher info for response
      const teacherInfo = teacher_id
        ? await Teacher.findById(targetTeacherId).select("name email")
        : {
            name: req.teacher.name,
            email: req.teacher.email,
            _id: req.teacher._id,
          };

      res.json({
        courses,
        total: courses.length,
        teacher: teacherInfo,
        is_own_courses:
          !teacher_id || teacher_id === req.teacher._id.toString(),
      });
    } catch (error) {
      console.error("Get courses error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get teacher's courses with student counts (legacy - keeping for backward compatibility)
router.get("/my-courses-legacy", auth, async (req, res) => {
  try {
    const courses = await Course.aggregate([
      { $match: { teacher_id: req.teacher._id } },
      {
        $lookup: {
          from: "coursestudents",
          localField: "_id",
          foreignField: "course_id",
          as: "enrollments",
        },
      },
      {
        $addFields: {
          student_count: { $size: "$enrollments" },
        },
      },
      {
        $project: {
          course_code: 1,
          title: 1,
          student_count: 1,
          created_at: 1,
        },
      },
    ]);

    res.json({
      courses,
      total: courses.length,
    });
  } catch (error) {
    console.error("Get my courses error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get students from specific teacher's course
router.get(
  "/teachers/:teacherId/courses/:courseId/students",
  auth,
  [
    param("teacherId").isMongoId().withMessage("Valid teacher ID required"),
    param("courseId").isMongoId().withMessage("Valid course ID required"),
  ],
  validate,
  async (req, res) => {
    try {
      const { teacherId, courseId } = req.params;

      // Verify course belongs to the teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: teacherId,
      });

      if (!course) {
        return res.status(404).json({
          error: "Course not found or doesn't belong to specified teacher",
        });
      }

      // Get course students
      const courseStudents = await CourseStudent.find({ course_id: courseId })
        .populate("student_id", "name email matric_no phone")
        .populate("added_by", "name email");

      const students = courseStudents.map((cs) => ({
        ...cs.student_id.toObject(),
        added_by: cs.added_by,
        added_at: cs.added_at,
      }));

      res.json({
        course: {
          _id: course._id,
          course_code: course.course_code,
          title: course.title,
          teacher_name: (await Teacher.findById(teacherId).select("name")).name,
        },
        students,
        total: students.length,
      });
    } catch (error) {
      console.error("Get teacher course students error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Request students from another teacher
router.post(
  "/request",
  auth,
  [
    body("target_teacher_id")
      .isMongoId()
      .withMessage("Valid target teacher ID required"),
    body("target_course_id")
      .isMongoId()
      .withMessage("Valid target course ID required"),
    body("my_course_id").isMongoId().withMessage("Valid course ID required"),
    body("student_ids")
      .isArray({ min: 1 })
      .withMessage("At least one student ID required"),
    body("student_ids.*").isMongoId().withMessage("Valid student IDs required"),
    body("message")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Message too long"),
  ],
  validate,
  auditLogger("student_share_requested"),
  async (req, res) => {
    try {
      const {
        target_teacher_id,
        target_course_id,
        my_course_id,
        student_ids,
        message,
      } = req.body;

      // Verify requester owns the destination course
      const myCourse = await Course.findOne({
        _id: my_course_id,
        teacher_id: req.teacher._id,
      });

      if (!myCourse) {
        return res
          .status(404)
          .json({ error: "Course not found or not owned by you" });
      }

      // Verify target course exists and belongs to target teacher
      const targetCourse = await Course.findOne({
        _id: target_course_id,
        teacher_id: target_teacher_id,
      });

      if (!targetCourse) {
        return res.status(404).json({
          error:
            "Target course not found or doesn't belong to specified teacher",
        });
      }

      // Verify target teacher exists
      const targetTeacher = await Teacher.findById(target_teacher_id);
      if (!targetTeacher) {
        return res.status(404).json({ error: "Target teacher not found" });
      }

      // Verify students exist and belong to target course
      const courseStudents = await CourseStudent.find({
        course_id: target_course_id,
        student_id: { $in: student_ids },
      });

      if (courseStudents.length !== student_ids.length) {
        return res.status(400).json({
          error: "Some students are not enrolled in the target course",
        });
      }

      // Check for existing pending request
      const existingRequest = await StudentShareRequest.findOne({
        requester_id: req.teacher._id,
        target_teacher_id,
        course_id: my_course_id,
        target_course_id,
        status: "pending",
      });

      if (existingRequest) {
        return res.status(400).json({
          error: "You already have a pending request for this course",
        });
      }

      // Create share request
      const shareRequest = new StudentShareRequest({
        requester_id: req.teacher._id,
        target_teacher_id,
        course_id: my_course_id,
        target_course_id,
        student_ids,
        message,
      });

      await shareRequest.save();

      // Populate for response
      await shareRequest.populate([
        { path: "requester_id", select: "name email" },
        { path: "target_teacher_id", select: "name email" },
        { path: "course_id", select: "course_code title" },
        { path: "target_course_id", select: "course_code title" },
        { path: "student_ids", select: "name matric_no email" },
      ]);

      // Send email notification to target teacher
      try {
        await emailService.sendStudentShareRequest(
          targetTeacher.email,
          targetTeacher.name,
          req.teacher.name,
          myCourse.course_code + " - " + myCourse.title,
          targetCourse.course_code + " - " + targetCourse.title,
          shareRequest.student_ids.length,
          message || "No message provided",
          shareRequest._id
        );
      } catch (emailError) {
        console.error("Failed to send share request email:", emailError);
        // Don't fail the request if email fails
      }

      res.status(201).json({
        message: "Student share request sent successfully",
        request: shareRequest,
      });
    } catch (error) {
      console.error("Student share request error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get incoming share requests
router.get(
  "/incoming",
  auth,
  [
    query("status").optional().isIn(["pending", "approved", "rejected", "all"]),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { status = "pending", page = 1, limit = 20 } = req.query;
      const skip = (page - 1) * limit;

      const filter = { target_teacher_id: req.teacher._id };
      if (status !== "all") {
        filter.status = status;
      }

      const [requests, total] = await Promise.all([
        StudentShareRequest.find(filter)
          .populate("requester_id", "name email")
          .populate("course_id", "course_code title")
          .populate("target_course_id", "course_code title")
          .populate("student_ids", "name matric_no email")
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        StudentShareRequest.countDocuments(filter),
      ]);

      res.json({
        requests,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(total / limit),
          total_requests: total,
          per_page: parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Get incoming requests error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get outgoing share requests
router.get(
  "/outgoing",
  auth,
  [
    query("status")
      .optional()
      .isIn(["pending", "approved", "rejected", "cancelled", "all"]),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { status = "all", page = 1, limit = 20 } = req.query;
      const skip = (page - 1) * limit;

      const filter = { requester_id: req.teacher._id };
      if (status !== "all") {
        filter.status = status;
      }

      const [requests, total] = await Promise.all([
        StudentShareRequest.find(filter)
          .populate("target_teacher_id", "name email")
          .populate("course_id", "course_code title")
          .populate("target_course_id", "course_code title")
          .populate("student_ids", "name matric_no email")
          .populate("processed_by", "name email")
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        StudentShareRequest.countDocuments(filter),
      ]);

      res.json({
        requests,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(total / limit),
          total_requests: total,
          per_page: parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Get outgoing requests error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Respond to share request (approve/reject)
router.patch(
  "/:requestId/respond",
  auth,
  [
    param("requestId").isMongoId().withMessage("Valid request ID required"),
    body("action")
      .isIn(["approve", "reject"])
      .withMessage("Action must be approve or reject"),
    body("response_message")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Response message too long"),
  ],
  validate,
  auditLogger("student_share_responded"),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const { action, response_message } = req.body;

      const shareRequest = await StudentShareRequest.findOne({
        _id: requestId,
        target_teacher_id: req.teacher._id,
        status: "pending",
      }).populate([
        { path: "requester_id", select: "name email" },
        { path: "course_id", select: "course_code title" },
        { path: "target_course_id", select: "course_code title" },
        { path: "student_ids", select: "name matric_no email" },
      ]);

      if (!shareRequest) {
        return res.status(404).json({
          error: "Share request not found or already processed",
        });
      }

      // Update request status
      shareRequest.status = action === "approve" ? "approved" : "rejected";
      shareRequest.processed_at = new Date();
      shareRequest.processed_by = req.teacher._id;
      shareRequest.response_message = response_message;

      await shareRequest.save();

      // If approved, add students to requester's course
      if (action === "approve") {
        try {
          const enrollmentPromises = shareRequest.student_ids.map((student) =>
            CourseStudent.findOneAndUpdate(
              {
                course_id: shareRequest.course_id._id,
                student_id: student._id,
              },
              {
                course_id: shareRequest.course_id._id,
                student_id: student._id,
                added_by: req.teacher._id,
                added_at: new Date(),
              },
              { upsert: true, new: true }
            )
          );

          await Promise.all(enrollmentPromises);
        } catch (enrollmentError) {
          console.error("Error enrolling students:", enrollmentError);
          // Revert the approval
          shareRequest.status = "pending";
          shareRequest.processed_at = null;
          shareRequest.processed_by = null;
          await shareRequest.save();

          return res.status(500).json({
            error: "Failed to enroll students. Request reverted to pending.",
          });
        }
      }

      // Send response email to requester
      try {
        await emailService.sendStudentShareResponse(
          shareRequest.requester_id.email,
          shareRequest.requester_id.name,
          req.teacher.name,
          shareRequest.course_id.course_code +
            " - " +
            shareRequest.course_id.title,
          shareRequest.target_course_id.course_code +
            " - " +
            shareRequest.target_course_id.title,
          action === "approve",
          shareRequest.student_ids.length,
          response_message || ""
        );
      } catch (emailError) {
        console.error("Failed to send response email:", emailError);
        // Don't fail the request if email fails
      }

      res.json({
        message: `Share request ${action}d successfully`,
        request: shareRequest,
      });
    } catch (error) {
      console.error("Respond to share request error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Cancel outgoing request
router.patch(
  "/:requestId/cancel",
  auth,
  [param("requestId").isMongoId().withMessage("Valid request ID required")],
  validate,
  auditLogger("student_share_cancelled"),
  async (req, res) => {
    try {
      const { requestId } = req.params;

      const shareRequest = await StudentShareRequest.findOneAndUpdate(
        {
          _id: requestId,
          requester_id: req.teacher._id,
          status: "pending",
        },
        {
          status: "cancelled",
          processed_at: new Date(),
          processed_by: req.teacher._id,
        },
        { new: true }
      ).populate([
        { path: "target_teacher_id", select: "name email" },
        { path: "course_id", select: "course_code title" },
        { path: "target_course_id", select: "course_code title" },
      ]);

      if (!shareRequest) {
        return res.status(404).json({
          error: "Share request not found or already processed",
        });
      }

      res.json({
        message: "Share request cancelled successfully",
        request: shareRequest,
      });
    } catch (error) {
      console.error("Cancel share request error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
