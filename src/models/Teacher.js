const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const teacherSchema = new mongoose.Schema(
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
      enum: ["teacher", "admin"],
      default: "teacher",
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
    last_login: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
teacherSchema.pre("save", async function (next) {
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
teacherSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password_hash);
};

// Remove password from JSON output
teacherSchema.methods.toJSON = function () {
  const teacher = this.toObject();
  delete teacher.password_hash;
  return teacher;
};

module.exports = mongoose.model("Teacher", teacherSchema);
