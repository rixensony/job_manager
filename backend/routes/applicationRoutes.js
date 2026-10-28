
const express = require("express");
const router = express.Router();
const Application = require("../models/Application");
const Counter = require("../models/Counter");

const FINAL = ["Rejected", "Accepted", "Declined"];

const transitions = {
  Applied: ["Interview", "Rejected"],
  Interview: ["Offer", "Rejected"],
  Offer: ["Accepted", "Declined"],
  Rejected: [],
  Accepted: [],
  Declined: []
};

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    message,
    data: null
  });
}

function isValidDate(value) {
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function overdue(application) {
  return application.status === "Applied" &&
    new Date() > new Date(application.followUpDate);
}

function output(application) {
  const item = application.toObject();
  item.isOverdue = overdue(application);
  return item;
}

function companyPrefix(company) {
  return company.replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase().padEnd(3, "X");
}

// CREATE
router.post("/", async (req, res) => {
  try {
    const { company, role, jobType, appliedDate, salary, notes } = req.body;

    if (!company?.trim() || !role?.trim() || !jobType || !appliedDate) {
      return sendError(res, 400, "Company, role, job type and applied date are required.");
    }

    if (!["Full-time", "Internship", "Contract"].includes(jobType)) {
      return sendError(res, 400, "Invalid job type.");
    }

    if (!isValidDate(appliedDate)) {
      return sendError(res, 400, "Invalid applied date.");
    }

    const applied = new Date(appliedDate);
    if (applied > startOfToday()) {
      return sendError(res, 400, "Applied date cannot be in the future.");
    }

    const duplicate = await Application.findOne({
      company: { $regex: `^${company.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
      role: { $regex: `^${role.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
      status: { $nin: FINAL }
    });

    if (duplicate) {
      return sendError(res, 409, "An active application already exists for this company and role.");
    }

    const companyKey = company.trim().toLowerCase();
    const counter = await Counter.findOneAndUpdate(
      { companyKey },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true }
    );

    const applicationId = `JA-${companyPrefix(company.trim())}-${String(counter.sequence).padStart(3, "0")}`;

    const application = await Application.create({
      applicationId,
      company: company.trim(),
      role: role.trim(),
      jobType,
      appliedDate: applied,
      salary: salary === "" || salary == null ? null : Number(salary),
      notes: notes || "",
      status: "Applied",
      statusHistory: [{ status: "Applied", date: new Date() }],
      followUpDate: addDays(applied, 7)
    });

    return res.status(201).json({
      success: true,
      message: "Application created successfully.",
      data: output(application)
    });
  } catch (error) {
    console.error(error);
    return sendError(res, 400, "Could not create application. Check the supplied values.");
  }
});

// LIST + BACKEND FILTERING/SEARCH
router.get("/", async (req, res) => {
  try {
    const query = {};

    if (req.query.status && req.query.status !== "All") {
      if (!transitions[req.query.status]) {
        return sendError(res, 400, "Invalid status filter.");
      }
      query.status = req.query.status;
    }

    if (req.query.company) {
      query.company = { $regex: req.query.company, $options: "i" };
    }

    const applications = await Application.find(query).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Applications retrieved successfully.",
      data: applications.map(output)
    });
  } catch (error) {
    return sendError(res, 400, "Could not retrieve applications.");
  }
});

// STATUS COUNTS
router.get("/stats", async (req, res) => {
  try {
    const counts = await Application.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    const data = { Applied: 0, Interview: 0, Offer: 0, Rejected: 0, Accepted: 0, Declined: 0 };
    counts.forEach(item => { data[item._id] = item.count; });

    return res.status(200).json({
      success: true,
      message: "Status counts retrieved.",
      data
    });
  } catch (error) {
    return sendError(res, 400, "Could not retrieve status counts.");
  }
});

// GET ONE
router.get("/:id", async (req, res) => {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) return sendError(res, 404, "Application not found.");

    return res.status(200).json({
      success: true,
      message: "Application retrieved.",
      data: output(application)
    });
  } catch (error) {
    return sendError(res, 400, "Invalid application ID.");
  }
});

// EDIT (applicationId and appliedDate cannot be changed)
router.put("/:id", async (req, res) => {
  try {
    const { company, role, jobType, salary, notes } = req.body;

    if (company !== undefined && !String(company).trim()) {
      return sendError(res, 400, "Company cannot be empty.");
    }
    if (role !== undefined && !String(role).trim()) {
      return sendError(res, 400, "Role cannot be empty.");
    }
    if (jobType !== undefined && !["Full-time", "Internship", "Contract"].includes(jobType)) {
      return sendError(res, 400, "Invalid job type.");
    }

    const application = await Application.findById(req.params.id);
    if (!application) return sendError(res, 404, "Application not found.");

    const nextCompany = company === undefined ? application.company : String(company).trim();
    const nextRole = role === undefined ? application.role : String(role).trim();

    if (nextCompany !== application.company || nextRole !== application.role) {
      const duplicate = await Application.findOne({
        _id: { $ne: application._id },
        company: { $regex: `^${nextCompany.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        role: { $regex: `^${nextRole.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        status: { $nin: FINAL }
      });
      if (duplicate) return sendError(res, 409, "An active application already exists for this company and role.");
    }

    application.company = nextCompany;
    application.role = nextRole;
    if (jobType !== undefined) application.jobType = jobType;
    if (salary !== undefined) application.salary = salary === "" || salary == null ? null : Number(salary);
    if (notes !== undefined) application.notes = notes;

    await application.save();

    return res.status(200).json({
      success: true,
      message: "Application updated successfully.",
      data: output(application)
    });
  } catch (error) {
    console.error(error);
    return sendError(res, 400, "Could not update application.");
  }
});

// CHANGE STATUS
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    if (!transitions[status]) {
      return sendError(res, 400, "Invalid status.");
    }

    const application = await Application.findById(req.params.id);
    if (!application) return sendError(res, 404, "Application not found.");

    if (!transitions[application.status].includes(status)) {
      return sendError(res, 400, `Cannot change status from ${application.status} to ${status}.`);
    }

    application.status = status;
    application.statusHistory.push({ status, date: new Date() });
    await application.save();

    return res.status(200).json({
      success: true,
      message: "Status updated successfully.",
      data: output(application)
    });
  } catch (error) {
    return sendError(res, 400, "Could not update status.");
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) return sendError(res, 404, "Application not found.");

    if (["Interview", "Offer"].includes(application.status)) {
      return sendError(res, 400, "Applications in Interview or Offer status cannot be deleted.");
    }

    await application.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Application deleted successfully.",
      data: { id: req.params.id }
    });
  } catch (error) {
    return sendError(res, 400, "Could not delete application.");
  }
});

module.exports = router;
