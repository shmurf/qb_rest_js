class QbUpsertResponse {
    constructor(rawResponse) {
        this.raw = rawResponse;
        this.data = rawResponse.data || [];
        this.metadata = rawResponse.metadata || {};
    }

    get hasErrors() {
        return !!(this.metadata.lineErrors && Object.keys(this.metadata.lineErrors).length > 0);
    }

    get errors() {
        return this.metadata.lineErrors || {};
    }

    get createdRecords() {
        return this.metadata.createdRecordIds || [];
    }

    get updatedRecords() {
        return this.metadata.updatedRecordIds || [];
    }

    get totalProcessed() {
        return this.metadata.totalNumberOfRecordsProcessed || 0;
    }

    get createdCount() {
        return this.createdRecords.length;
    }

    get updatedCount() {
        return this.updatedRecords.length;
    }

    get wasSuccessful() {
        return !this.hasErrors && this.totalProcessed > 0;
    }

    // Get the record IDs that were affected
    get affectedRecordIds() {
        return [...this.createdRecords, ...this.updatedRecords];
    }
}
