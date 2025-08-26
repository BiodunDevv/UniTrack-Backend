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
    level: {
      type: Number,
      required: true,
      min: 100,
      max: 600,
      validate: {
        validator: function (v) {
          return v >= 100 && v <= 600 && v % 100 === 0;
        },
        message:
          "Level must be between 100 and 600 in increments of 100 (100, 200, 300, 400, 500, 600)",
      },
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

// Remove unique constraint on course code to allow multiple teachers to use same code
courseSchema.index({ teacher_id: 1, course_code: 1, level: 1 });

module.exports = mongoose.model("Course", courseSchema);
