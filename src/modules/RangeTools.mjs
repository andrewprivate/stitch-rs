import { Utils } from "../utils/Utils.mjs";

export class RangeSet {
    constructor(initialRanges) {
        this.sortedRanges = [];
        if (initialRanges) {
            initialRanges.forEach(range => this.addRange(range.start, range.end));
        }
    }

    getRanges() {
        return this.sortedRanges;
    }

    addRange(start, end) {
        const newRange = { start, end };

        const rangeIndexStart = Utils.binarySearch(this.sortedRanges, newRange.start, (compareRange, newRangeStart) => {
            if (compareRange.end < newRangeStart) return -1; // compareRange ends before newRange starts
            if (compareRange.start > newRangeStart) return 1; // compareRange starts after newRange starts
            return 0; // compareRange starts at newRange starts
        });

        const rangeIndexEnd = Utils.binarySearch(this.sortedRanges, newRange.end, (compareRange, newRangeEnd) => {
            if (compareRange.end < newRangeEnd) return -1; // compareRange ends before newRange ends
            if (compareRange.start > newRangeEnd) return 1; // compareRange starts after newRange ends
            return 0; // compareRange starts at newRange ends
        });

        if (rangeIndexStart < 0 && rangeIndexEnd < 0) {
            // No overlap, add new range
            this.sortedRanges.splice(~rangeIndexStart, 0, newRange);
        } else if (rangeIndexStart >= 0 && rangeIndexEnd < 0) { 
            // Overlap at start, merge with existing range
            this.sortedRanges[rangeIndexStart].end = newRange.end;
        } else if (rangeIndexStart < 0 && rangeIndexEnd >= 0) {
            // Overlap at end, merge with existing range
            this.sortedRanges[rangeIndexEnd].start = newRange.start;
        } else {
            // Full overlap, merge with existing range
            if (rangeIndexStart === rangeIndexEnd) {
                return; // Already completely overlaps
            }

            this.sortedRanges[rangeIndexStart].end = this.sortedRanges[rangeIndexEnd].end;
            this.sortedRanges.splice(rangeIndexStart + 1, rangeIndexEnd - rangeIndexStart);
        }
    }

    removeRange(start, end) {
        const newRange = { start, end };

        const rangeIndexStart = Utils.binarySearch(this.sortedRanges, newRange.start, (compareRange, newRangeStart) => {
            if (compareRange.end < newRangeStart) return -1; // compareRange ends before newRange starts
            if (compareRange.start > newRangeStart) return 1; // compareRange starts after newRange starts
            return 0; // compareRange starts at newRange starts
        });

        const rangeIndexEnd = Utils.binarySearch(this.sortedRanges, newRange.end, (compareRange, newRangeEnd) => {
            if (compareRange.end < newRangeEnd) return -1; // compareRange ends before newRange ends
            if (compareRange.start > newRangeEnd) return 1; // compareRange starts after newRange ends
            return 0; // compareRange starts at newRange ends
        });

        const rangeStart = rangeIndexStart >= 0 ? this.sortedRanges[rangeIndexStart] : null;
        const rangeEnd = rangeIndexEnd >= 0 ? this.sortedRanges[rangeIndexEnd] : null;

        if (!rangeStart && !rangeEnd) {
            return; // No ranges to remove
        } else if (rangeStart && !rangeEnd) {
            // Remove part of the start range
            if (rangeStart.start < newRange.start) {
                rangeStart.end = newRange.start;
            } else {
                this.sortedRanges.splice(rangeIndexStart, 1);
            }
        } else if (!rangeStart && rangeEnd) {
            // Remove part of the end range
            if (rangeEnd.end > newRange.end) {
                rangeEnd.start = newRange.end;
            } else {
                this.sortedRanges.splice(rangeIndexEnd, 1);
            }
        } else {
            // Both ranges exist
            if (rangeIndexStart === rangeIndexEnd) {
                if (rangeStart.start < newRange.start && rangeEnd.end > newRange.end) {
                    // Split the range
                    this.sortedRanges.splice(rangeIndexStart, 1, { start: rangeStart.start, end: newRange.start }, { start: newRange.end, end: rangeEnd.end });
                } else if (rangeStart.start < newRange.start) {
                    rangeStart.end = newRange.start;
                } else if (rangeEnd.end > newRange.end) {
                    rangeEnd.start = newRange.end;
                } else {
                    this.sortedRanges.splice(rangeIndexStart, 1);
                }
            } else {
                if (rangeStart.start < newRange.start) {
                    rangeStart.end = newRange.start;
                } else {
                    this.sortedRanges.splice(rangeIndexStart, 1);
                }

                if (rangeEnd.end > newRange.end) {
                    rangeEnd.start = newRange.end;
                } else {
                    this.sortedRanges.splice(rangeIndexEnd, 1);
                }
            }
        }
    }

    intersects(start, end) {
        const index = Utils.binarySearch(this.sortedRanges, null, (compareRange) => {
            if (compareRange.end <= start) return -1; // compareRange ends before the start
            if (compareRange.start >= end) return 1; // compareRange starts after the end
            return 0; // overlap
        });

        return index >= 0;
    }

    encompasses(start, end) {
        const index = Utils.binarySearch(this.sortedRanges, null, (compareRange) => {
            if (compareRange.start <= start && compareRange.end >= end) return 0; // encompasses
            if (compareRange.end < start) return -1; // compareRange ends before the start
            return 1; // compareRange starts after the end
        });

        return index >= 0;
    }
}