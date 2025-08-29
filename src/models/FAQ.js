const mongoose = require("mongoose");

const faqSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "general",
        "security",
        "technical",
        "attendance",
        "reports",
        "support",
      ],
      default: "general",
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    display_order: {
      type: Number,
      default: 0,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    last_updated: {
      type: Date,
      default: Date.now,
    },
    view_count: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Index for better search performance
faqSchema.index({ question: "text", answer: "text", tags: "text" });
faqSchema.index({ category: 1, is_active: 1, display_order: 1 });

module.exports = mongoose.model("FAQ", faqSchema);
