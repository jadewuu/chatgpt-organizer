class FakeChatGPTAdapter {
  constructor({ accountFingerprint = "account-fixture", results = {}, verificationResults = {} } = {}) {
    this.accountFingerprint = accountFingerprint;
    this.results = results;
    this.verificationResults = verificationResults;
    this.actions = [];
    this.verifications = [];
    this.closed = false;
  }

  async getAccountFingerprint() { return this.accountFingerprint; }

  resultFor(key) {
    const value = this.results[key];
    if (Array.isArray(value)) return value.shift() || { status: "verified" };
    return value || { status: "verified" };
  }

  async createProject(name) {
    this.actions.push(["createProject", name]);
    return this.resultFor(`createProject:${name}`);
  }

  async moveConversation(id, project) {
    this.actions.push(["move", id, project]);
    return this.resultFor(`move:${id}`);
  }

  async archiveConversation(id) {
    this.actions.push(["archive", id]);
    return this.resultFor(`archive:${id}`);
  }

  async verifyConversationLocation(id, expected) {
    this.verifications.push([id, expected]);
    return this.verificationResults[id] || { status: "verified" };
  }

  async close() { this.closed = true; }
}

module.exports = { FakeChatGPTAdapter };
