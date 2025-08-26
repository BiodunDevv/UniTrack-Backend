const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema(
  {
    matric_no: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
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

module.exports = mongoose.model("Student", studentSchema);
