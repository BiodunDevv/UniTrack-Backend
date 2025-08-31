const mongoose = require("mongoose");

const deviceFingerprintSchema = new mongoose.Schema(
  {
    device_fingerprint: {
      type: String,
      required: true,
      unique: true,
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
    },
    first_seen: {
      type: Date,
      default: Date.now,
    },
    last_seen: {
      type: Date,
      default: Date.now,
    },
    // FingerprintJS specific fields
    fpjs_visitor_id: {
      type: String,
      index: true,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("DeviceFingerprint", deviceFingerprintSchema);
