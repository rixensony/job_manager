
const mongoose = require("mongoose");

const applicationSchema = new mongoose.Schema({
  applicationId: {
    type: String,
    required: true,
    unique: true
  },
  company: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    required: true,
    trim: true
  },
  jobType: {
    type: String,
    enum: ["Full-time", "Internship", "Contract"],
    required: true
  },
  appliedDate: {
    type: Date,
    required: true
  },
  salary: {
    type: Number,
    default: null
  },
  notes: {
    type: String,
    default: ""
  },
  status: {
    type: String,
    enum: ["Applied", "Interview", "Offer", "Rejected", "Accepted", "Declined"],
    default: "Applied"
  },
  statusHistory: [{
    status: String,
    date: { type: Date, default: Date.now }
  }],
  followUpDate: {
    type: Date,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model("Application", applicationSchema);
