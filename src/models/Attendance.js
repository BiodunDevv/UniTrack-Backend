const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    session_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
    },
    course_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
    },
    matric_no_submitted: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    device_fingerprint: {
      type: String,
      required: true,
    },
    lat: {
      type: Number,
      required: true,
    },
    lng: {
      type: Number,
      required: true,
    },
    accuracy: {
      type: Number,
    },
    status: {
      type: String,
      enum: ["present", "absent", "rejected", "manual_present"],
      default: "present",
    },
    reason: {
      type: String,
    },
    submitted_at: {
      type: Date,
      default: Date.now,
    },
    receipt_signature: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate attendance submissions
attendanceSchema.index(
  { session_id: 1, matric_no_submitted: 1 },
  { unique: true }
);
attendanceSchema.index(
  { session_id: 1, device_fingerprint: 1 },
  { unique: true }
);

module.exports = mongoose.model("Attendance", attendanceSchema);
