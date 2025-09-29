import { getQbAppBaseUrl } from './utils.js';
export class QbQueryResponse {
    constructor(rawResponse, dbid) {
        this.raw = rawResponse;
        this.data = rawResponse.data || [];
        this.fields = rawResponse.fields || [];
        this.metadata = rawResponse.metadata || {};
        this.dbid = dbid;
    }

    get records() {
        return this.data;
    }

    get count() {
        return this.data.length;
    }

    get fieldMap() {
        const map = {};
        this.fields.forEach(field => {
            map[field.id] = field.label;
        });
        return map;
    }

    // Get records as objects with field names as keys
    get formattedRecords() {
        return this.records.map(record => this.unpackRecord(record, true));
    }

    /**
     * Format records with custom field names as keys
     * if fieldMap is not provided, will return default formatted records
     * @param {Object} [fieldMap] - Optional field map to use for transformation
     * @returns {Array<Object>} - Formatted records with field names as keys
     */
    remapRecords(fieldMap = null) {
        if (!fieldMap) {
            return this.formattedRecords;
        }
        return this.records.map(record => this.unpackRecord(record, true, fieldMap));
    }

    /**
     * Get records as objects with values directly availble by field IDs
     * @returns {Array<Object>} - Records with field IDs as keys
     */
    get unpackedRecords() {
        return this.records.map(record => this.unpackRecord(record));
    }

    /**
     * Unpacks a record object with field values as sub-objects into a flat object. Optional parameters to rekey using fieldnames or custom mappping
     * @param {Object} record - The record object to unpack
     * @param {boolean} [rekey=false] - If true, will use the field IDs as object keys instead of field labels
     * @param {Object} [fieldMap=null] - Optional custom field map to use for transformation
     * @returns {Object} - The unpacked record object with field names as keys
     */
    unpackRecord(record, rekey = false, fieldMap = null) {
        const mapper = fieldMap || this.fieldMap;
        const transformedRecord = {};
        Object.keys(record).forEach(id => {
            const label = !rekey ? id : mapper[id];
            if (label) {
                transformedRecord[label] = record[id].value;
            } else {
                transformedRecord[id] = record[id].value;
            }
        });
        if (record['3']) {
            transformedRecord.rid = record['3'].value;
        }
        return transformedRecord;
    }

    /**
     * Gets an object with URLs for viewing and editing each record.
     * @returns {Object<string, {view: string, edit: string}>} - Object with record IDs as keys and URL objects as values
     * @throws {Error} - If the Record ID field is not found
     */
    get urls() {
        if (!this.fieldMap['3']) {
            throw new Error('Cannot get URLs - Record ID field not found');
        }
        const tableUrl = `${getQbAppBaseUrl()}table/${this.dbid}/action/`;
        const urlObj = {};
        this.records.forEach(record =>
            urlObj[record['3'].value] = {
                view: `${tableUrl}dr/?rid=${record['3'].value}`,
                edit: `${tableUrl}er/?rid=${record['3'].value}`,
            }
        );
        return urlObj;
    }
}