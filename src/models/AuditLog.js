const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    actor_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      // Generic reference - can point to either Teacher or Admin
    },
    actor_type: {
      type: String,
      enum: ["Teacher", "Admin", "System"],
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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
auditLogSchema.index({ actor_id: 1, created_at: -1 });
auditLogSchema.index({ action: 1, created_at: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
