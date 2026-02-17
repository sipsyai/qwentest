// Embed utilities for dataset records → vector DB pipeline

import type { Dataset, DatasetRecord } from './datasetsApi';

/** Traverse a dot-separated path on an object: getNestedValue(obj, "author.name") */
export function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((cur, key) => {
    if (cur == null) return undefined;
    return cur[key];
  }, obj);
}

/** Convert a dataset record to embeddable text.
 *  If dataset has extract_fields → "field: value\n..." format.
 *  Otherwise → JSON.stringify(record.data) */
export function recordToText(record: DatasetRecord, dataset: Dataset | null): string {
  if (dataset && dataset.extract_fields && dataset.extract_fields.length > 0) {
    const lines: string[] = [];
    for (const field of dataset.extract_fields) {
      const val = getNestedValue(record.data, field);
      if (val !== undefined && val !== null) {
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        lines.push(`${field}: ${str}`);
      }
    }
    return lines.length > 0 ? lines.join('\n') : JSON.stringify(record.data);
  }
  return JSON.stringify(record.data);
}

/** Split an array into batches of given size */
export function batchArray<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
