/**
 * The Cognitive Shift — PocketBase API Client Helpers
 *
 * Lightweight wrapper around PocketBase REST API for use on GitHub Pages.
 * No SDK dependency — uses fetch directly.
 */
const PocketBaseClient = {
  /**
   * Get the base URL from config.
   * @returns {string}
   */
  baseUrl() {
    return TCS_CONFIG.pocketbaseUrl;
  },

  /**
   * Create a new record in a collection.
   * @param {string} collection - Collection name
   * @param {Object} data - Record data
   * @returns {Promise<Object>} Created record
   */
  async create(collection, data) {
    const response = await fetch(`${this.baseUrl()}/api/collections/${encodeURIComponent(collection)}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`PocketBase error: ${response.status}`);
    }
    return response.json();
  },

  /**
   * List records from a collection.
   * @param {string} collection - Collection name
   * @param {Object} [params] - Query parameters (page, perPage, filter, sort)
   * @returns {Promise<Object>} Paginated result
   */
  async list(collection, params = {}) {
    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl()}/api/collections/${encodeURIComponent(collection)}/records${query ? '?' + query : ''}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`PocketBase error: ${response.status}`);
    }
    return response.json();
  },

  /**
   * Get a single record by ID.
   * @param {string} collection - Collection name
   * @param {string} id - Record ID
   * @returns {Promise<Object>} Record
   */
  async get(collection, id) {
    const response = await fetch(`${this.baseUrl()}/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`);
    if (!response.ok) {
      throw new Error(`PocketBase error: ${response.status}`);
    }
    return response.json();
  },
};
