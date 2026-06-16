const customerOtpService = require('../services/customerOtpService');

function tenantId(req) {
  return req.tenant._id.toString();
}

exports.requestOtp = async (req, res, next) => {
  try {
    res.json(await customerOtpService.requestOtp(tenantId(req), req.body || {}));
  } catch (err) {
    next(err);
  }
};

exports.verifyOtp = async (req, res, next) => {
  try {
    res.json(await customerOtpService.verifyOtp(tenantId(req), req.body || {}));
  } catch (err) {
    next(err);
  }
};
