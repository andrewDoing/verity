export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

export function unescapePointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function getByPointer(data: unknown, pointer: string): unknown {
  if (pointer === '') return data;
  const segments = pointer.split('/').slice(1).map(unescapePointerSegment);
  let cursor = data;
  for (const segment of segments) {
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return undefined;
      cursor = cursor[index];
      continue;
    }
    if (!isRecord(cursor) || !(segment in cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

export function setByPointer(data: unknown, pointer: string, value: unknown): void {
  if (!isRecord(data) && !Array.isArray(data)) {
    throw new Error('Cannot patch a non-object artifact root.');
  }
  if (pointer === '') {
    throw new Error('Cannot replace the artifact root through annotation patching.');
  }

  const segments = pointer.split('/').slice(1).map(unescapePointerSegment);
  let cursor: unknown = data;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    if (Array.isArray(cursor)) {
      const arrayIndex = Number(segment);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0) throw new Error(`Invalid array index in pointer ${pointer}`);
      cursor[arrayIndex] ??= Number.isInteger(Number(nextSegment)) ? [] : {};
      cursor = cursor[arrayIndex];
      continue;
    }
    if (!isRecord(cursor)) throw new Error(`Cannot traverse non-object segment ${segment} in ${pointer}`);
    cursor[segment] ??= Number.isInteger(Number(nextSegment)) ? [] : {};
    cursor = cursor[segment];
  }

  const last = segments.at(-1);
  if (last === undefined) throw new Error(`Invalid pointer ${pointer}`);
  if (Array.isArray(cursor)) {
    if (last === '-') cursor.push(value);
    else cursor[Number(last)] = value;
    return;
  }
  if (!isRecord(cursor)) throw new Error(`Cannot set non-object segment ${last} in ${pointer}`);
  cursor[last] = value;
}

export function collectByPattern(data: unknown, pattern: string): Array<{ pointer: string; value: unknown }> {
  if (pattern === '') return [{ pointer: '', value: data }];
  const segments = pattern.split('/').slice(1).map(unescapePointerSegment);
  const out: Array<{ pointer: string; value: unknown }> = [];

  function visit(value: unknown, index: number, pointer: string): void {
    if (index === segments.length) {
      out.push({ pointer, value });
      return;
    }
    const segment = segments[index];
    if (segment === '*') {
      if (Array.isArray(value)) {
        value.forEach((item, itemIndex) => visit(item, index + 1, `${pointer}/${itemIndex}`));
      } else if (isRecord(value)) {
        for (const [key, item] of Object.entries(value)) {
          visit(item, index + 1, `${pointer}/${escapePointerSegment(key)}`);
        }
      }
      return;
    }
    const next = getByPointer(value, `/${escapePointerSegment(segment)}`);
    if (next !== undefined) visit(next, index + 1, `${pointer}/${escapePointerSegment(segment)}`);
  }

  visit(data, 0, '');
  return out;
}

export function stringifyPreview(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}
