import { get, set, del, clear, createStore } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';
import { QbQueryResponse } from './QbQueryResponse.js';
import { QbUpsertResponse } from './QbUpsertResponse.js';
import {
    parameterize,
    normalizeQbFields,
} from './utils.js';

/**
 * Main class for interacting with the QuickBase REST API
 */
export class QbRest {
    /**
     * Creates a new QbRest instance
     * @param {string} realm - The QuickBase realm hostname (e.g., 'example' from 'example.quickbase.com')
     * @param {string} appToken - The application token for authentication
     */
    constructor(realm, appToken) {
        this.realm = realm;
        this.appToken = appToken;
    }
    tempTokens = {}
    baseUrl = "https://api.quickbase.com/v1";

    // Create a dedicated store for QB query cache
    static queryStore = createStore('qb-cache', 'qb_query');

    /**
     * Clears the entire query cache
     * @static
     * @async
     * @returns {Promise<void>}
     */
    static async clearCache() {
        await clear(QbRest.queryStore);
    }

    /**
     * Gets a temporary authorization token for a specific table
     * @private
     * @async
     * @param {string} tableId - The table ID to get authorization for
     * @returns {Promise<string>} The temporary authorization token
     * @throws {Error} If token retrieval fails
     */
    async #getTempAuth(tableId) {
        if (tableId in this.tempTokens) return this.tempTokens[tableId]

        const response = await fetch(`${this.baseUrl}/auth/temporary/${tableId}`,
            {
                method: 'GET',
                mode: 'cors', // no-cors, *cors, same-origin
                credentials: 'include', // include, *same-origin, omit
                headers: {
                    'QB-Realm-Hostname': this.realm,
                    'QB-App-Token': this.appToken
                },
            });

        const json = await response.json()
        if (response?.ok) {
            this.tempTokens[tableId] = json.temporaryAuthorization;
            setTimeout(() => { delete this.tempTokens[tableId]; }, 1000 * 60 * 4);
            return this.tempTokens[tableId];
        } else {
            throw new Error(`Get token failed: ${json.message}`);
        }
    }

    /**
     * Base function for making a request to the QuickBase API
     * @async
     * @param {string} method - HTTP method (GET, POST, etc.)
     * @param {string} endpoint - API endpoint path
     * @param {string} dbid - Database/table ID
     * @param {Object|null} data - Request body data
     * @param {Object|null} params - URL query parameters
     * @returns {Promise<Object>} The JSON response from the API
     * @throws {Error} If the request fails
     */
    async makeRequest(method, endpoint, dbid, data = null, params = null) {
        const query = params ? parameterize(params) : "";
        const url = `${this.baseUrl}/${endpoint}${query}`;
        const opts = {
            method: method,
            headers: {
                'QB-Realm-Hostname': this.realm,
                'Content-Type': 'application/json',
                'Authorization': `QB-TEMP-TOKEN ${await this.#getTempAuth(dbid)}`
            },
        }

        if (data !== null) opts['body'] = JSON.stringify(data)

        const response = await fetch(url, opts);
        const json = await response.json()

        if (response?.ok) {
            return json;
        } else {
            throw new Error(`${response?.status}: ${json.message || response.statusText}`);
        }
    }

    /**
     * Upserts (inserts or updates) records into QuickBase
     * Include the record ID or mergeField for updates
     * @async
     * @param {string} dbid - The database/table ID
     * @param {Array<Object>} records - Array of record objects to upsert
     * @returns {Promise<QbUpsertResponse>} The upsert response
     */
    async upsert(dbid, records, mergeFieldId = null) {
        const reqdata = {};
        reqdata.to = dbid;
        reqdata.data = records;
        if (mergeFieldId) {
            reqdata.mergeFieldId = mergeFieldId;
        }
        const response = await this.makeRequest('POST', 'records', dbid, reqdata);
        return new QbUpsertResponse(response);
    }

    /**
     * Upsert function that will throw an error on partial line errors
     * @async
     * @param {string} dbid - The database/table ID
     * @param {Array<Object>} records - Array of record objects to upsert
     * @returns {Promise<QbUpsertResponse>} The upsert response
     * @throws {Error} If any records fail to upsert
     */
    async strictUpsert(dbid, records) {
        const response = await this.upsert(dbid, records);
        if (response.hasErrors) {
            throw new Error(`Upsert Failed: ${JSON.stringify(response.errors)} `);
        }
        return response;
    }

    /**
     * Updates a single record by ID
     * @async
     * @param {string} dbid - The database/table ID
     * @param {number} recordId - The record ID to update
     * @param {Object} fields - Object containing field IDs/names and values to update
     * @returns {Promise<QbUpsertResponse>} The upsert response
     */
    async updateRecord(dbid, recordId, fields) {
        const recordData = {
            3: recordId, // Field 3 is always Record ID - will be normalized
            ...fields
        };
        return await this.upsert(dbid, [normalizeQbFields(recordData)]);
    }

    /**
     * Gets a single record by its record ID
     * @async
     * @param {string} dbid - The database/table ID
     * @param {number} recordId - The record ID to retrieve
     * @param {Array<number>} fields - Array of field IDs to select
     * @returns {Promise<Object>} The unpacked record object
     * @throws {Error} If no record is found or multiple records match
     */
    async getRecordById(dbid, recordId, fields) {
        // Add the record ID to the fields for update
        return await this.getRecordByUniqueFid(dbid, 3, recordId, fields, true);
    }

    /**
     * Gets a single record by a unique field ID
     * Returns first match, or throws if strict mode is enabled and multiple matches found
     * @async
     * @param {string} dbid - The database/table ID
     * @param {number} fid - The field ID to query
     * @param {string|number} value - The value to match
     * @param {Array<number>} fields - Array of field IDs to select
     * @param {boolean} [strict=false] - If true, throws error on multiple matches
     * @returns {Promise<Object>} The unpacked record object
     * @throws {Error} If no records found or (in strict mode) multiple records match
     */
    async getRecordByUniqueFid(dbid, fid, value, fields, strict = false) {
        const response = await this.query(dbid, fields, `{${fid}.EX."${value}"}`);
        if (response.count === 0) {
            throw new Error('No records found for unique field');
        }
        if (strict) {
            if (response.count > 1) {
                throw new Error('Multiple records found for unique field');
            }
        }
        return response.unpackRecord(response.records[0]);
    }

    /**
     * Queries records in QuickBase
     * @async
     * @param {string} dbid - The database/table ID
     * @param {Array<number>} fields - Array of field IDs to select
     * @param {string} qry - QuickBase query string (e.g., '{3.EX.123}')
     * @param {Object|null} [sort=null] - Sort options
     * @param {Object|null} [options=null] - Additional query options
     * @returns {Promise<QbQueryResponse>} The query response
     */
    async query(dbid, fields, qry, sort = null, options = null) {
        const reqdata = {};
        reqdata.from = dbid;
        reqdata.select = fields;
        reqdata.where = qry;
        sort && (reqdata.sortBy = sort);
        options && (reqdata.options = options);
        const response = await this.makeRequest('POST', 'records/query', dbid, reqdata);
        return new QbQueryResponse(response, dbid);
    }

    /**
     * Queries records in QuickBase with caching support
     * @async
     * @param {string} dbid - The database/table ID
     * @param {Array<number>} fields - Array of field IDs to select
     * @param {string} qry - QuickBase query string (e.g., '{3.EX.123}')
     * @param {Object|null} [sort=null] - Sort options
     * @param {Object|null} [options=null] - Additional query options
     * @param {number} [cacheTTL=5] - Cache time-to-live in minutes
     * @returns {Promise<QbQueryResponse>} The query response (from cache or fresh)
     */
    async queryCache(dbid, fields, qry, sort = null, options = null, cacheTTL = 5) {
        // Generate cache key from query parameters
        const cacheKey = `${this.realm}_${dbid}_${JSON.stringify({ fields, qry, sort, options })}`;

        try {
            // Check cache first
            const cached = await get(cacheKey, QbRest.queryStore);
            if (cached && cached.expires > Date.now()) {
                return new QbQueryResponse(cached.data, dbid);
            }
        } catch (error) {
            // Cache read failed, continue without cache
            console.warn('Cache read error:', error);
        }

        // Cache miss or expired - use the existing query method
        const response = await this.query(dbid, fields, qry, sort, options);

        try {
            // Store raw data in cache with TTL
            await set(cacheKey, {
                data: response.raw,
                expires: Date.now() + cacheTTL * 1000 * 60,
                cached: Date.now()
            }, QbRest.queryStore);
        } catch (error) {
            // Cache write failed, continue without caching
            console.warn('Cache write error:', error);
        }

        return response;
    }

    /**
     * Pre-authenticates a table to enable faster async queries later
     * @async
     * @param {string} dbid - The ID of the table to pre-authenticate
     * @returns {Promise<void>}
     */
    async preauthTable(dbid) {
        await this.#getTempAuth(dbid);
    }

    /**
     * Gets current user information as XML using the legacy API
     * @async
     * @returns {Promise<string>} The XML response containing user information
     * @throws {Error} If the request fails
     */
    async getUserXml() {
        const url = `https://${this.realm}.quickbase.com/db/main?a=API_GetUserInfo&ticket=${this.appToken}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Get user info failed: ${response.status} ${response.statusText}`);
        }

        return response.text();
    }
    /**
     * Gets current user information as JSON by parsing XML response
     * @async
     * @returns {Promise<Object>} Object containing user information (id, firstName, lastName, login, email, screenName, isVerified, externalAuth)
     * @throws {Error} If the request fails or XML is invalid
     */
    async getUserJson() {
        const xml = await this.getUserXml();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml, "text/xml");

        const userElement = xmlDoc.querySelector('user');
        if (!userElement) {
            throw new Error('Invalid XML response - no user element found');
        }

        return {
            id: userElement.id,
            firstName: xmlDoc.querySelector('firstName')?.textContent,
            lastName: xmlDoc.querySelector('lastName')?.textContent,
            login: xmlDoc.querySelector('login')?.textContent,
            email: xmlDoc.querySelector('email')?.textContent,
            screenName: xmlDoc.querySelector('screenName')?.textContent,
            isVerified: xmlDoc.querySelector('isVerified')?.textContent === 'true',
            externalAuth: xmlDoc.querySelector('externalAuth')?.textContent === 'true'
        }
    }
}
