const crypto = require("crypto");

function generateResetToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  generateResetToken,
  hashResetToken,
};