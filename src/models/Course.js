const mongoose = require("mongoose");

const courseSchema = new mongoose.Schema(
  {
    teacher_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    course_code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for teacher and course code uniqueness
courseSchema.index({ teacher_id: 1, course_code: 1 }, { unique: true });

module.exports = mongoose.model("Course", courseSchema);
