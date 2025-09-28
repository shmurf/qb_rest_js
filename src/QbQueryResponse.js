import { getQbAppBaseUrl } from './utils.js';
class QbQueryResponse {
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
        const fieldValues = this.data.map(item => {
            const transformedItem = {};
            Object.keys(item).forEach(id => {
                const label = this.fieldMap[id];
                if (label) {
                    transformedItem[label] = item[id].value;
                } else {
                    transformedItem[id] = item[id].value;
                }
            });
            if (item['3']) {
                transformedItem.rid = item['3'].value;
            }
            return transformedItem;
        });
        return fieldValues;
    }

    unpackRecord(record, rekey = false) {
        const transformedRecord = {};
        Object.keys(record).forEach(id => {
            const label = !rekey ? id : this.fieldMap[id];
            if (label) {
                transformedRecord[label] = record[id].value;
            } else {
                transformedRecord[id] = record[id].value;
            }
        });
        return transformedRecord;
    }

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