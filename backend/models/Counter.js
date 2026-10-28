
const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
  companyKey: {
    type: String,
    required: true,
    unique: true
  },
  sequence: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model("Counter", counterSchema);
