const mongoose = require("mongoose");

const courseStudentSchema = new mongoose.Schema(
  {
    course_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    added_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    added_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure a student can only be added once to a course
courseStudentSchema.index({ course_id: 1, student_id: 1 }, { unique: true });

module.exports = mongoose.model("CourseStudent", courseStudentSchema);
