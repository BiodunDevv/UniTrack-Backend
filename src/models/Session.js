const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    course_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    teacher_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    session_code: {
      type: String,
      required: true,
      length: 4,
    },
    start_ts: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiry_ts: {
      type: Date,
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
    radius_m: {
      type: Number,
      required: true,
      default: 100,
    },
    nonce: {
      type: String,
      required: true,
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient session code lookup
sessionSchema.index({ session_code: 1, is_active: 1 });
sessionSchema.index({ expiry_ts: 1 });

// Auto-expire sessions
sessionSchema.methods.isExpired = function () {
  return Date.now() > this.expiry_ts;
};

module.exports = mongoose.model("Session", sessionSchema);
