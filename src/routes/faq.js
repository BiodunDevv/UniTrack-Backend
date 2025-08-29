const express = require("express");
const { body, param, query, validationResult } = require("express-validator");
const FAQ = require("../models/FAQ");
const { adminAuth, teacherAuth } = require("../middleware/auth");

const router = express.Router();

// Get all FAQs (public access)
router.get("/", async (req, res) => {
  try {
    const { category, search, limit = 20, page = 1 } = req.query;

    let query = { is_active: true };

    if (category) {
      query.category = category;
    }

    if (search) {
      query.$text = { $search: search };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const faqs = await FAQ.find(query)
      .sort({ display_order: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("created_by", "name")
      .lean();

    const total = await FAQ.countDocuments(query);

    res.json({
      success: true,
      data: {
        faqs,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(total / parseInt(limit)),
          total_items: total,
          items_per_page: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get FAQs error:", error);
    res.status(500).json({
      error: "Failed to fetch FAQs",
      message: "An internal server error occurred",
    });
  }
});

// Get FAQ categories with counts
router.get("/categories", async (req, res) => {
  try {
    const categories = await FAQ.aggregate([
      { $match: { is_active: true } },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          latest_update: { $max: "$last_updated" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const categoryInfo = {
      general: "General questions about UniTrack",
      security: "Security and fraud prevention",
      technical: "Technical issues and troubleshooting",
      attendance: "Attendance submission and tracking",
      reports: "Reports and analytics",
      support: "Support and documentation",
    };

    const result = categories.map((cat) => ({
      category: cat._id,
      description: categoryInfo[cat._id] || "Category information",
      count: cat.count,
      latest_update: cat.latest_update,
    }));

    res.json({
      success: true,
      data: { categories: result },
    });
  } catch (error) {
    console.error("Get FAQ categories error:", error);
    res.status(500).json({
      error: "Failed to fetch FAQ categories",
      message: "An internal server error occurred",
    });
  }
});

// Get single FAQ by ID and increment view count
router.get(
  "/:id",
  [param("id").isMongoId().withMessage("Invalid FAQ ID")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const faq = await FAQ.findOneAndUpdate(
        { _id: req.params.id, is_active: true },
        { $inc: { view_count: 1 } },
        { new: true }
      ).populate("created_by", "name");

      if (!faq) {
        return res.status(404).json({
          error: "FAQ not found",
          message: "The requested FAQ does not exist or is not active",
        });
      }

      res.json({
        success: true,
        data: { faq },
      });
    } catch (error) {
      console.error("Get FAQ by ID error:", error);
      res.status(500).json({
        error: "Failed to fetch FAQ",
        message: "An internal server error occurred",
      });
    }
  }
);

// Create new FAQ (Admin only)
router.post(
  "/",
  [
    adminAuth,
    body("question")
      .trim()
      .notEmpty()
      .withMessage("Question is required")
      .isLength({ min: 10, max: 500 })
      .withMessage("Question must be 10-500 characters"),
    body("answer")
      .trim()
      .notEmpty()
      .withMessage("Answer is required")
      .isLength({ min: 20, max: 2000 })
      .withMessage("Answer must be 20-2000 characters"),
    body("category")
      .isIn([
        "general",
        "security",
        "technical",
        "attendance",
        "reports",
        "support",
      ])
      .withMessage("Invalid category"),
    body("display_order")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Display order must be a positive integer"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { question, answer, category, display_order, tags } = req.body;

      const faq = new FAQ({
        question,
        answer,
        category,
        display_order: display_order || 0,
        tags: tags || [],
        created_by: req.admin.id,
      });

      await faq.save();
      await faq.populate("created_by", "name");

      res.status(201).json({
        success: true,
        message: "FAQ created successfully",
        data: { faq },
      });
    } catch (error) {
      console.error("Create FAQ error:", error);
      res.status(500).json({
        error: "Failed to create FAQ",
        message: "An internal server error occurred",
      });
    }
  }
);

// Update FAQ (Admin only)
router.put(
  "/:id",
  [
    adminAuth,
    param("id").isMongoId().withMessage("Invalid FAQ ID"),
    body("question")
      .optional()
      .trim()
      .isLength({ min: 10, max: 500 })
      .withMessage("Question must be 10-500 characters"),
    body("answer")
      .optional()
      .trim()
      .isLength({ min: 20, max: 2000 })
      .withMessage("Answer must be 20-2000 characters"),
    body("category")
      .optional()
      .isIn([
        "general",
        "security",
        "technical",
        "attendance",
        "reports",
        "support",
      ])
      .withMessage("Invalid category"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const faq = await FAQ.findByIdAndUpdate(
        req.params.id,
        { ...req.body, last_updated: new Date() },
        { new: true, runValidators: true }
      ).populate("created_by", "name");

      if (!faq) {
        return res.status(404).json({
          error: "FAQ not found",
          message: "The requested FAQ does not exist",
        });
      }

      res.json({
        success: true,
        message: "FAQ updated successfully",
        data: { faq },
      });
    } catch (error) {
      console.error("Update FAQ error:", error);
      res.status(500).json({
        error: "Failed to update FAQ",
        message: "An internal server error occurred",
      });
    }
  }
);

// Delete FAQ (Admin only)
router.delete(
  "/:id",
  [adminAuth, param("id").isMongoId().withMessage("Invalid FAQ ID")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const faq = await FAQ.findByIdAndUpdate(
        req.params.id,
        { is_active: false, last_updated: new Date() },
        { new: true }
      );

      if (!faq) {
        return res.status(404).json({
          error: "FAQ not found",
          message: "The requested FAQ does not exist",
        });
      }

      res.json({
        success: true,
        message: "FAQ deleted successfully",
      });
    } catch (error) {
      console.error("Delete FAQ error:", error);
      res.status(500).json({
        error: "Failed to delete FAQ",
        message: "An internal server error occurred",
      });
    }
  }
);

// Bulk create FAQs (Admin only)
router.post(
  "/bulk",
  [
    adminAuth,
    body("faqs")
      .isArray({ min: 1 })
      .withMessage("FAQs array is required with at least one item"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { faqs } = req.body;

      // Validate each FAQ
      for (const faq of faqs) {
        if (!faq.question || !faq.answer || !faq.category) {
          return res.status(400).json({
            error: "Invalid FAQ data",
            message: "Each FAQ must have question, answer, and category",
          });
        }
      }

      // Add created_by to each FAQ
      const faqsWithCreator = faqs.map((faq) => ({
        ...faq,
        created_by: req.admin.id,
      }));

      const createdFaqs = await FAQ.insertMany(faqsWithCreator);

      res.status(201).json({
        success: true,
        message: `${createdFaqs.length} FAQs created successfully`,
        data: {
          created_count: createdFaqs.length,
          faqs: createdFaqs,
        },
      });
    } catch (error) {
      console.error("Bulk create FAQs error:", error);
      res.status(500).json({
        error: "Failed to create FAQs",
        message: "An internal server error occurred",
      });
    }
  }
);

module.exports = router;
