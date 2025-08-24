const mongoose = require("mongoose");

const studentShareRequestSchema = new mongoose.Schema(
  {
    requester_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    target_teacher_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    course_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    target_course_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    student_ids: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
        required: true,
      },
    ],
    message: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
    },
    processed_at: {
      type: Date,
    },
    processed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
    },
    response_message: {
      type: String,
      trim: true,
    },
    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
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

// Index for efficient querying
studentShareRequestSchema.index({ target_teacher_id: 1, status: 1 });
studentShareRequestSchema.index({ requester_id: 1, status: 1 });
studentShareRequestSchema.index({ expires_at: 1 });

// Auto-expire old requests
studentShareRequestSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model(
  "StudentShareRequest",
  studentShareRequestSchema
);
