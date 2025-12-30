import { get, set, del, clear, createStore } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';
import { QbQueryResponse } from './QbQueryResponse.js';
import { QbUpsertResponse } from './QbUpsertResponse.js';
import {
    parameterize,
    normalizeQbFields,
} from './utils.js';

export class QbRest {
    constructor(realm, appToken) {
        this.realm = realm;
        this.appToken = appToken;
    }
    tempTokens = {}
    baseUrl = "https://api.quickbase.com/v1";

    // Create a dedicated store for QB query cache
    static queryStore = createStore('qb-cache', 'qb_query');

    static async clearCache() {
        await clear(QbRest.queryStore);
    }

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

    async upsert(dbid, fields) {
        const reqdata = {};
        reqdata.to = dbid;
        reqdata.data = fields;
        const response = await this.makeRequest('POST', 'records', dbid, reqdata);
        return new QbUpsertResponse(response);
    }

    async updateRecord(dbid, recordId, fields) {
        // Add the record ID to the fields for update
        const recordData = {
            3: recordId, // Field 3 is always Record ID - will be normalized
            ...fields
        };
        return await this.upsert(dbid, [normalizeQbFields(recordData)]);
    }

    async getRecordById(dbid, recordId, fields) {
        // Add the record ID to the fields for update
        return await this.getRecordByUniqueFid(dbid, 3, recordId, fields, true);
    }

    // enable strict to fail if anythin other then 1 record is found
    async getRecordByUniqueFid(dbid, fid, value, fields, strict = false) {
        // get record(s) by unique field, set strict to fail if multiple records found
        const response = await this.query(dbid, fields, `{${fid}.EX."${value}"}`);
        if (strict) {
            if (response.count > 1) {
                throw new Error('Multiple records found for unique field');
            } else if (response.count === 0) {
                throw new Error('No records found for unique field');
            }
        }
        return response.unpackRecord(response.records[0]);
    }

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

    async queryCache(dbid, fields, qry, sort = null, options = null, cacheTTL = 5) {
        // Generate cache key from query parameters
        const cacheKey = `${this.realm}_${dbid}_${JSON.stringify({ fields, qry, sort, options })}`;

        try {
            // Check cache firstf
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
    // upsert function that will throw on partial line errors
    async strictUpsert(dbid, fields) {
        const response = await this.upsert(dbid, fields);
        if (response.hasErrors) {
            throw new Error(`Upsert Failed: ${JSON.stringify(response.errors)} `);
        }
        return response;
    }

    /**
     * Used to Synchronously Pre-authenticate a table to enable faster async queries later.
     * @param {number} dbid - The ID of the table to pre-authenticate.
     */
    async preauthTable(dbid) {
        await this.#getTempAuth(dbid);
    }

    async getUserXml() {
        const url = `https://${this.realm}.quickbase.com/db/main?a=API_GetUserInfo&ticket=${this.appToken}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Get user info failed: ${response.status} ${response.statusText}`);
        }

        return response.text();
    }
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
