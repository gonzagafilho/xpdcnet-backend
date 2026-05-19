class BaseBillingAdapter {
  constructor(providerCode) {
    this.providerCode = providerCode;
  }

  async createCustomer() { throw new Error('NOT_IMPLEMENTED:createCustomer'); }
  async updateCustomer() { throw new Error('NOT_IMPLEMENTED:updateCustomer'); }
  async createCharge() { throw new Error('NOT_IMPLEMENTED:createCharge'); }
  async getCharge() { throw new Error('NOT_IMPLEMENTED:getCharge'); }
  async cancelCharge() { throw new Error('NOT_IMPLEMENTED:cancelCharge'); }
  async listCharges() { throw new Error('NOT_IMPLEMENTED:listCharges'); }
  parseWebhook() { throw new Error('NOT_IMPLEMENTED:parseWebhook'); }
  mapExternalStatusToInternalStatus() { throw new Error('NOT_IMPLEMENTED:mapExternalStatusToInternalStatus'); }
}

module.exports = BaseBillingAdapter;
