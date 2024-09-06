export class Utils {
    static binarySearch(array, target, comparator) {
        let l = 0,
            h = array.length - 1,
            m, comparison;
        comparator = comparator || ((a, b) => {
            return (a < b ? -1 : (a > b ? 1 : 0));
        });
        while (l <= h) {
            m = (l + h) >>> 1;
            comparison = comparator(array[m], target);
            if (comparison < 0) {
                l = m + 1;
            } else if (comparison > 0) {
                h = m - 1;
            } else {
                return m;
            }
        }
        return ~l;
    }

    static clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    static compareStringsWithNumbers(a, b) {
        const aParts = a.split(/(\d+)/),
            bParts = b.split(/(\d+)/),
            length = Math.min(aParts.length, bParts.length);
        for (let i = 0; i < length; i++) {
            if (aParts[i] !== bParts[i]) {
                if (i % 2 === 1) {
                    return parseInt(aParts[i]) - parseInt(bParts[i]);
                } else {
                    return aParts[i].localeCompare(bParts[i]);
                }
            }
        }
        return aParts.length - bParts.length;
    }
    
}
