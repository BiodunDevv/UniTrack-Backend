const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password_hash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      default: "admin",
      immutable: true,
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
    last_login: {
      type: Date,
    },
    permissions: {
      type: [String],
      default: [
        "view_all_reports",
        "manage_teachers",
        "manage_students",
        "manage_courses",
        "system_settings",
      ],
    },
    is_super_admin: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
adminSchema.pre("save", async function (next) {
  if (!this.isModified("password_hash")) return next();

  try {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    this.password_hash = await bcrypt.hash(this.password_hash, rounds);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
adminSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password_hash);
};

// Update last login
adminSchema.methods.updateLastLogin = function () {
  this.last_login = new Date();
  return this.save();
};

module.exports = mongoose.model("Admin", adminSchema);
